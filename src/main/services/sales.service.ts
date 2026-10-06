import { todayIso } from '@shared/date'
import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'
import { lineAmount, normalizeQty, qtyGreater, rateFromAmount, type Minor, type Rate } from '@shared/money'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { LedgerService } from '../accounting/ledger'
import { ACC } from '../accounting/chart'
import { InventoryService } from '../inventory/inventory.service'
import { NumberingService } from './numbering.service'
import { AuditService } from './audit.service'
import { computeTotals } from './totals'
import { SettingsService } from './settings.service'
import { PaymentService } from './payment.service'

export interface SaleItemInput {
  variantId: number
  description?: string | null
  quantity: number
  unitPrice: Rate
  discountAmount?: Minor
  taxRate?: number
}

export type SaleChannel = 'wholesale' | 'retail' | 'online'

export interface SaleInput {
  date: string
  dueDate?: string | null
  customerId: number
  warehouseId?: number
  /** قناة البيع: جملة أو تجزئة أو أونلاين — تُستخدم في التقارير والتحليل */
  saleChannel?: SaleChannel
  items: SaleItemInput[]
  discountAmount?: Minor
  discountPercent?: number
  /** الشحن الذي يدفعه العميل لنا — إيراد */
  shippingAmount?: Minor
  /** تكلفة التوصيل التي ندفعها لشركة الشحن — مصروف، ليست جزءًا من إجمالي الفاتورة */
  deliveryCost?: Minor
  /** شركة الشحن؛ عند تركها فارغة ومع عدم تحديد حساب دفع تُسجَّل على «مصروفات مستحقة» */
  deliveryPartyId?: number | null
  /** حساب الدفع إن سُدِّدت تكلفة التوصيل فورًا؛ NULL = آجلة على شركة الشحن */
  deliveryPaymentAccountId?: number | null
  deliveryAddress?: string | null
  trackingNumber?: string | null
  /** رقم فاتورة جاهز — يُستخدم عند استيراد فواتير سابقة للحفاظ على ترقيمها الأصلي */
  invoiceNumber?: string | null
  notes?: string | null
  /** دفعة فورية مع الفاتورة (بيع نقدي أو دفعة جزئية) */
  payment?: { amount: Minor; methodId: number; reference?: string | null }
}

export interface SaleFilters {
  from?: string
  to?: string
  customerId?: number
  saleChannel?: SaleChannel
  status?: 'draft' | 'confirmed' | 'void'
  paymentStatus?: 'paid' | 'partial' | 'unpaid'
  search?: string
  warehouseId?: number
  page?: number
  pageSize?: number
}

/**
 * المبيعات — كل فاتورة مؤكدة تُنتج في معاملة واحدة:
 *   1) سجل الفاتورة وأسطرها
 *   2) حركات إخراج مخزني بتكلفة المتوسط المرجَّح
 *   3) قيدًا محاسبيًا يشمل الإيراد والضريبة والخصم وتكلفة البضاعة المباعة
 *   4) سند قبض إن وُجدت دفعة فورية
 * إما أن تنجح كل هذه الخطوات معًا أو لا يُحفظ منها شيء.
 */
export class SalesService {
  private readonly db: Database
  private readonly ledger: LedgerService
  private readonly inventory: InventoryService
  private readonly numbering: NumberingService
  private readonly audit: AuditService
  private readonly settings: SettingsService

  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db
    this.ledger = new LedgerService(ctx)
    this.inventory = new InventoryService(ctx)
    this.numbering = new NumberingService(ctx.db)
    this.audit = new AuditService(ctx)
    this.settings = new SettingsService(ctx.db)
  }

  create(input: SaleInput): { id: number; invoiceNumber: string } {
    const customer = this.db.prepare("SELECT * FROM parties WHERE id = ? AND party_type = 'customer'").get(input.customerId) as
      | { id: number; name: string; code: string; credit_limit: number }
      | undefined
    if (!customer) throw ERRORS.notFound('العميل')
    if (!input.items?.length) throw ERRORS.validation('يجب إضافة صنف واحد على الأقل للفاتورة.')
    if (!input.date) throw ERRORS.validation('تاريخ الفاتورة مطلوب.', 'date')

    const warehouseId =
      input.warehouseId ??
      (this.db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get() as { id: number } | undefined)?.id
    if (!warehouseId) throw ERRORS.validation('يجب تحديد المخزن.')

    const totals = computeTotals({
      lines: input.items.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discountAmount: i.discountAmount,
        taxRate: i.taxRate
      })),
      headerDiscountAmount: input.discountAmount,
      headerDiscountPercent: input.discountPercent,
      shippingAmount: input.shippingAmount
    })

    const paymentAmount = Math.round(input.payment?.amount ?? 0)
    if (paymentAmount > totals.total) {
      throw ERRORS.validation('المبلغ المدفوع أكبر من إجمالي الفاتورة.', 'payment')
    }

    const deliveryCost = Math.max(0, Math.round(input.deliveryCost ?? 0))
    if (deliveryCost > 0 && !input.deliveryPaymentAccountId && !input.deliveryPartyId) {
      throw ERRORS.validation('حدّد شركة الشحن أو حساب الدفع لتكلفة التوصيل.', 'deliveryCost')
    }
    if (deliveryCost > 0 && input.deliveryPartyId) {
      const courier = this.db.prepare('SELECT id FROM parties WHERE id = ?').get(input.deliveryPartyId)
      if (!courier) throw ERRORS.notFound('شركة الشحن')
    }

    // تنبيه حد الائتمان — لا يمنع البيع لكنه يُسجَّل كتحذير
    const creditWarning =
      customer.credit_limit > 0 &&
      this.ledger.partyBalance(customer.id) + (totals.total - paymentAmount) > customer.credit_limit

    if (input.invoiceNumber?.trim()) {
      const taken = this.db.prepare('SELECT id FROM sales WHERE invoice_number = ?').get(input.invoiceNumber.trim())
      if (taken) throw ERRORS.conflict(`رقم الفاتورة «${input.invoiceNumber}» مستخدم بالفعل.`)
    }

    const run = this.db.transaction(() => {
      const invoiceNumber = input.invoiceNumber?.trim() || this.numbering.next('sale', new Date(input.date))
      const info = this.db
        .prepare(
          `INSERT INTO sales (invoice_number, date, due_date, customer_id, warehouse_id, sale_channel, subtotal,
                              discount_amount, tax_amount, shipping_amount, total, status, notes, created_by,
                              delivery_cost, delivery_party_id, delivery_payment_account_id, delivery_address, tracking_number)
           VALUES (@invoiceNumber, @date, @dueDate, @customerId, @warehouseId, @saleChannel, @subtotal,
                   @discountAmount, @taxAmount, @shippingAmount, @total, 'confirmed', @notes, @createdBy,
                   @deliveryCost, @deliveryPartyId, @deliveryPaymentAccountId, @deliveryAddress, @trackingNumber)`
        )
        .run({
          invoiceNumber,
          date: input.date,
          dueDate: input.dueDate ?? null,
          customerId: input.customerId,
          warehouseId,
          saleChannel: input.saleChannel ?? 'wholesale',
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          shippingAmount: totals.shippingAmount,
          total: totals.total,
          notes: input.notes ?? null,
          createdBy: actorId(this.ctx),
          deliveryCost,
          deliveryPartyId: input.deliveryPartyId ?? null,
          deliveryPaymentAccountId: input.deliveryPaymentAccountId ?? null,
          deliveryAddress: input.deliveryAddress ?? null,
          trackingNumber: input.trackingNumber ?? null
        })
      const saleId = Number(info.lastInsertRowid)

      // إخراج المخزون وحساب تكلفة البضاعة المباعة
      const insertItem = this.db.prepare(
        `INSERT INTO sale_items (sale_id, line_no, variant_id, description, quantity, unit_price,
                                 discount_amount, tax_rate, tax_amount, line_total, unit_cost, cogs_amount)
         VALUES (@saleId, @lineNo, @variantId, @description, @quantity, @unitPrice,
                 @discountAmount, @taxRate, @taxAmount, @lineTotal, @unitCost, @cogsAmount)`
      )
      const cogsByAccount = new Map<string, Minor>()
      let totalCogs = 0

      input.items.forEach((item, index) => {
        const computed = totals.lines[index]
        const variant = this.inventory.variant(item.variantId)
        let unitCost = 0
        let cogsAmount = 0
        if (variant.track_inventory === 1) {
          const movement = this.inventory.issue({
            date: input.date,
            variantId: item.variantId,
            warehouseId,
            quantity: item.quantity,
            movementType: 'sale',
            refType: 'sale',
            refId: saleId,
            refNumber: invoiceNumber
          })
          unitCost = movement.unitCost
          cogsAmount = -movement.value
          const accountKey = variant.product_type === 'raw' ? ACC.INVENTORY_RAW : ACC.INVENTORY_FINISHED
          cogsByAccount.set(accountKey, (cogsByAccount.get(accountKey) ?? 0) + cogsAmount)
          totalCogs += cogsAmount
        }
        insertItem.run({
          saleId,
          lineNo: index + 1,
          variantId: item.variantId,
          description: item.description ?? null,
          quantity: normalizeQty(item.quantity),
          unitPrice: item.unitPrice,
          discountAmount: computed.discountAmount,
          taxRate: computed.taxRate,
          taxAmount: computed.taxAmount,
          lineTotal: computed.lineTotal,
          unitCost,
          cogsAmount
        })
      })

      // القيد المحاسبي: الإيراد + الضريبة + الخصم + تكلفة البضاعة المباعة
      const entryId = this.ledger.post({
        date: input.date,
        refType: 'sale',
        refId: saleId,
        refNumber: invoiceNumber,
        description: `فاتورة بيع ${invoiceNumber} — ${customer.name}`,
        lines: [
          { accountKey: ACC.RECEIVABLE, partyId: input.customerId, debit: totals.total, description: `فاتورة ${invoiceNumber}` },
          { accountKey: ACC.SALES_DISCOUNTS, debit: totals.discountAmount },
          { accountKey: ACC.SALES_REVENUE, credit: totals.subtotal },
          { accountKey: ACC.TAX_OUTPUT, credit: totals.taxAmount },
          { accountKey: ACC.SHIPPING_REVENUE, credit: totals.shippingAmount },
          { accountKey: ACC.COGS, debit: totalCogs, description: 'تكلفة البضاعة المباعة' },
          ...[...cogsByAccount.entries()].map(([key, value]) => ({ accountKey: key, credit: value })),
          // تكلفة التوصيل مصروف علينا، سواء حصّلنا شحنًا من العميل أم لا
          { accountKey: ACC.DELIVERY_EXPENSE, debit: deliveryCost, description: 'تكلفة توصيل الطلب' },
          deliveryCost > 0 && input.deliveryPaymentAccountId
            ? { accountId: input.deliveryPaymentAccountId, credit: deliveryCost }
            : { accountKey: ACC.PAYABLE, partyId: input.deliveryPartyId ?? null, credit: deliveryCost }
        ]
      })

      this.db
        .prepare('UPDATE sales SET journal_entry_id = ?, cogs_amount = ? WHERE id = ?')
        .run(entryId, totalCogs, saleId)

      return { saleId, invoiceNumber }
    })

    const result = run.immediate()

    // الدفعة الفورية تُسجَّل كسند قبض مستقل مربوط بالفاتورة
    if (paymentAmount > 0 && input.payment) {
      new PaymentService(this.ctx).create({
        date: input.date,
        direction: 'in',
        partyId: input.customerId,
        amount: paymentAmount,
        methodId: input.payment.methodId,
        reference: input.payment.reference ?? null,
        notes: `دفعة على فاتورة ${result.invoiceNumber}`,
        allocations: [{ docType: 'sale', docId: result.saleId, amount: paymentAmount }]
      })
    }

    this.audit.log({
      action: 'create',
      entityType: 'sale',
      entityId: result.saleId,
      entityLabel: result.invoiceNumber,
      newValue: { customerId: input.customerId, total: totals.total, items: input.items.length, paid: paymentAmount }
    })
    if (creditWarning) {
      this.notifyCreditLimit(customer.id, customer.name, result.invoiceNumber)
    }
    return { id: result.saleId, invoiceNumber: result.invoiceNumber }
  }

  private notifyCreditLimit(customerId: number, name: string, invoiceNumber: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO notifications (type, severity, title, body, ref_type, ref_id, dedupe_key)
         VALUES ('credit_limit', 'warning', ?, ?, 'party', ?, ?)`
      )
      .run(
        'تجاوز حد الائتمان',
        `تجاوز رصيد العميل «${name}» حد الائتمان المسموح بعد الفاتورة ${invoiceNumber}.`,
        customerId,
        `credit_limit:${customerId}`
      )
  }

  get(id: number): Record<string, unknown> {
    const sale = this.db
      .prepare(
        `SELECT s.*, p.name AS customer_name, p.code AS customer_code, p.phone AS customer_phone,
                p.address AS customer_address, p.tax_number AS customer_tax_number,
                w.name AS warehouse_name, u.full_name AS created_by_name
         FROM sales s JOIN parties p ON p.id = s.customer_id
         JOIN warehouses w ON w.id = s.warehouse_id
         LEFT JOIN users u ON u.id = s.created_by
         WHERE s.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    if (!sale) throw ERRORS.notFound('الفاتورة')
    const items = this.db
      .prepare(
        `SELECT si.*, pr.name AS product_name, pr.unit, v.sku, v.size, v.color
         FROM sale_items si JOIN product_variants v ON v.id = si.variant_id
         JOIN products pr ON pr.id = v.product_id
         WHERE si.sale_id = ? ORDER BY si.line_no`
      )
      .all(id) as Record<string, unknown>[]
    const payments = this.db
      .prepare(
        `SELECT pay.id, pay.payment_number, pay.date, pay.amount AS payment_amount, pa.amount AS allocated,
                pm.name AS method_name, pay.status
         FROM payment_allocations pa JOIN payments pay ON pay.id = pa.payment_id
         JOIN payment_methods pm ON pm.id = pay.method_id
         WHERE pa.doc_type = 'sale' AND pa.doc_id = ? AND pay.status = 'confirmed'
         ORDER BY pay.date`
      )
      .all(id) as Record<string, unknown>[]
    const returns = this.db
      .prepare('SELECT id, return_number, date, total FROM sales_returns WHERE sale_id = ? AND status = ?')
      .all(id, 'confirmed') as Record<string, unknown>[]
    return { ...sale, items, payments, returns }
  }

  list(filters: SaleFilters = {}): { rows: Record<string, unknown>[]; total: number; summary: Record<string, number> } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.from) { where.push('s.date >= @from'); params.from = filters.from }
    if (filters.to) { where.push('s.date <= @to'); params.to = filters.to }
    if (filters.customerId) { where.push('s.customer_id = @customerId'); params.customerId = filters.customerId }
    if (filters.saleChannel) { where.push('s.sale_channel = @saleChannel'); params.saleChannel = filters.saleChannel }
    if (filters.warehouseId) { where.push('s.warehouse_id = @warehouseId'); params.warehouseId = filters.warehouseId }
    if (filters.status) { where.push('s.status = @status'); params.status = filters.status }
    else where.push("s.status <> 'draft'")
    if (filters.paymentStatus === 'paid') where.push('s.total - s.paid_amount - s.returned_amount <= 0')
    if (filters.paymentStatus === 'unpaid') where.push('s.paid_amount = 0 AND s.total - s.returned_amount > 0')
    if (filters.paymentStatus === 'partial') where.push('s.paid_amount > 0 AND s.total - s.paid_amount - s.returned_amount > 0')
    if (filters.search) {
      where.push('(s.invoice_number LIKE @search OR p.name LIKE @search OR p.phone LIKE @search OR s.notes LIKE @search)')
      params.search = `%${filters.search}%`
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 50))

    const summaryRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(s.total),0) AS total,
                COALESCE(SUM(s.paid_amount),0) AS paid,
                COALESCE(SUM(s.total - s.paid_amount - s.returned_amount),0) AS due,
                COALESCE(SUM(s.cogs_amount),0) AS cogs,
                COALESCE(SUM(s.delivery_cost),0) AS deliveryCost
         FROM sales s JOIN parties p ON p.id = s.customer_id ${clause}`
      )
      .get(params) as Record<string, number>

    const rows = this.db
      .prepare(
        `SELECT s.id, s.invoice_number, s.date, s.due_date, s.total, s.paid_amount, s.returned_amount,
                s.cogs_amount, s.status, s.notes, s.sale_channel, s.delivery_cost,
                s.total - s.paid_amount - s.returned_amount AS due_amount,
                p.name AS customer_name, p.code AS customer_code, p.phone AS customer_phone,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
         FROM sales s JOIN parties p ON p.id = s.customer_id
         ${clause} ORDER BY s.date DESC, s.id DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[]

    return { rows, total: summaryRow.count, summary: summaryRow }
  }

  /**
   * إلغاء فاتورة: عكس القيد المحاسبي وإعادة الكميات للمخزون بنفس تكلفتها الأصلية.
   * لا تُحذف الفاتورة أبدًا — تبقى في السجل بحالة «ملغاة».
   */
  void(id: number, reason: string, voidDate?: string): void {
    if (!reason?.trim()) throw ERRORS.validation('يجب إدخال سبب الإلغاء.', 'reason')
    const sale = this.db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!sale) throw ERRORS.notFound('الفاتورة')
    if (sale.status === 'void') throw ERRORS.conflict('الفاتورة ملغاة بالفعل.')

    const allocated = this.db
      .prepare(
        `SELECT COALESCE(SUM(pa.amount),0) AS n FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id
         WHERE pa.doc_type = 'sale' AND pa.doc_id = ? AND p.status = 'confirmed'`
      )
      .get(id) as { n: number }
    if (allocated.n > 0) {
      throw ERRORS.conflict('لا يمكن إلغاء فاتورة عليها مدفوعات. ألغِ سندات القبض المرتبطة بها أولًا.')
    }
    const hasReturns = this.db
      .prepare("SELECT COUNT(*) AS n FROM sales_returns WHERE sale_id = ? AND status = 'confirmed'")
      .get(id) as { n: number }
    if (hasReturns.n > 0) throw ERRORS.conflict('لا يمكن إلغاء فاتورة لها مردودات مسجّلة. ألغِ المردودات أولًا.')

    const date = voidDate ?? todayIso()
    const run = this.db.transaction(() => {
      const items = this.db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id) as Record<string, unknown>[]
      for (const item of items) {
        const variant = this.inventory.variant(item.variant_id as number)
        if (variant.track_inventory === 0) continue
        this.inventory.receive({
          date,
          variantId: item.variant_id as number,
          warehouseId: sale.warehouse_id as number,
          quantity: item.quantity as number,
          unitCost: item.unit_cost as number,
          movementType: 'sale_return',
          refType: 'sale_void',
          refId: id,
          refNumber: String(sale.invoice_number),
          notes: `إلغاء فاتورة: ${reason}`
        })
      }
      if (sale.journal_entry_id) {
        this.ledger.reverse(sale.journal_entry_id as number, date, `إلغاء فاتورة ${sale.invoice_number}: ${reason}`)
      }
      this.db
        .prepare("UPDATE sales SET status = 'void', void_reason = ?, voided_at = datetime('now'), voided_by = ? WHERE id = ?")
        .run(reason, actorId(this.ctx), id)
    })
    run.immediate()

    this.audit.log({
      action: 'void',
      entityType: 'sale',
      entityId: id,
      entityLabel: String(sale.invoice_number),
      oldValue: { status: sale.status, total: sale.total },
      reason,
      severity: 'critical'
    })
  }

  // ------------------------- مردودات المبيعات -------------------------

  /**
   * مردود مبيعات.
   *
   * B2C: كثير من المرتجعات تعود غير صالحة للبيع، ولذلك:
   *  - restock = true  → ترتدّ البضاعة للمخزون بتكلفتها الأصلية
   *  - restock = false → لا تدخل المخزون، وتُحمَّل تكلفتها على «فروقات وتلف المخزون»
   *
   * وتكلفة إرجاع الشحنة (إن تحمّلناها) تُسجَّل مصروف توصيل،
   * أما الشحن الذي حصّلناه من العميل فلا يُردّ إلا إذا حُدِّد صراحةً.
   */
  createReturn(input: {
    date: string
    saleId?: number | null
    customerId: number
    warehouseId?: number
    reason?: string | null
    /** الافتراضي لكل الأصناف؛ يمكن تجاوزه لكل صنف على حدة */
    restock?: boolean
    /** الشحن المُعاد للعميل من الذي حصّلناه في الفاتورة الأصلية */
    refundedShipping?: Minor
    /** تكلفة إرجاع الشحنة التي ندفعها لشركة الشحن */
    deliveryCost?: Minor
    deliveryPartyId?: number | null
    deliveryPaymentAccountId?: number | null
    items: { saleItemId?: number | null; variantId: number; quantity: number; unitPrice: Rate; taxRate?: number; restock?: boolean }[]
  }): { id: number; returnNumber: string } {
    if (!input.items?.length) throw ERRORS.validation('يجب إضافة صنف واحد على الأقل للمردود.')
    const customer = this.db.prepare("SELECT * FROM parties WHERE id = ? AND party_type = 'customer'").get(input.customerId) as
      | { id: number; name: string }
      | undefined
    if (!customer) throw ERRORS.notFound('العميل')

    const warehouseId =
      input.warehouseId ??
      (this.db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get() as { id: number }).id

    const defaultRestock = input.restock !== false
    const refundedShipping = Math.max(0, Math.round(input.refundedShipping ?? 0))
    const deliveryCost = Math.max(0, Math.round(input.deliveryCost ?? 0))
    if (deliveryCost > 0 && !input.deliveryPaymentAccountId && !input.deliveryPartyId) {
      throw ERRORS.validation('حدّد شركة الشحن أو حساب الدفع لتكلفة إرجاع الشحنة.', 'deliveryCost')
    }

    // لا يُردّ من الشحن أكثر مما حُصِّل في الفاتورة الأصلية
    if (refundedShipping > 0 && input.saleId) {
      const sale = this.db.prepare('SELECT shipping_amount FROM sales WHERE id = ?').get(input.saleId) as
        | { shipping_amount: number }
        | undefined
      if (sale && refundedShipping > sale.shipping_amount) {
        throw ERRORS.validation('المبلغ المُعاد من الشحن أكبر مما حُصِّل في الفاتورة الأصلية.')
      }
    }

    // التحقق من عدم تجاوز الكميات المباعة عند الربط بفاتورة
    if (input.saleId) {
      for (const item of input.items) {
        if (!item.saleItemId) continue
        const line = this.db.prepare('SELECT quantity, returned_qty FROM sale_items WHERE id = ? AND sale_id = ?').get(item.saleItemId, input.saleId) as
          | { quantity: number; returned_qty: number }
          | undefined
        if (!line) throw ERRORS.validation('سطر الفاتورة المحدد غير موجود.')
        const remaining = line.quantity - line.returned_qty
        if (qtyGreater(item.quantity, remaining)) {
          throw ERRORS.validation(`الكمية المرتجعة أكبر من المتبقي في الفاتورة (${remaining}).`)
        }
      }
    }

    const totals = computeTotals({
      lines: input.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate }))
    })
    const creditTotal = totals.total + refundedShipping

    const run = this.db.transaction(() => {
      const returnNumber = this.numbering.next('sale_return', new Date(input.date))
      const info = this.db
        .prepare(
          `INSERT INTO sales_returns (return_number, date, sale_id, customer_id, warehouse_id, subtotal, tax_amount,
                                      total, reason, created_by, restock, refunded_shipping,
                                      delivery_cost, delivery_party_id, delivery_payment_account_id)
           VALUES (@returnNumber, @date, @saleId, @customerId, @warehouseId, @subtotal, @taxAmount,
                   @total, @reason, @createdBy, @restock, @refundedShipping,
                   @deliveryCost, @deliveryPartyId, @deliveryPaymentAccountId)`
        )
        .run({
          returnNumber,
          date: input.date,
          saleId: input.saleId ?? null,
          customerId: input.customerId,
          warehouseId,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          total: creditTotal,
          reason: input.reason ?? null,
          createdBy: actorId(this.ctx),
          restock: defaultRestock ? 1 : 0,
          refundedShipping,
          deliveryCost,
          deliveryPartyId: input.deliveryPartyId ?? null,
          deliveryPaymentAccountId: input.deliveryPaymentAccountId ?? null
        })
      const returnId = Number(info.lastInsertRowid)

      const insertItem = this.db.prepare(
        `INSERT INTO sales_return_items (return_id, line_no, sale_item_id, variant_id, quantity, unit_price, tax_amount, line_total, unit_cost, cogs_amount, restock)
         VALUES (@returnId, @lineNo, @saleItemId, @variantId, @quantity, @unitPrice, @taxAmount, @lineTotal, @unitCost, @cogsAmount, @restock)`
      )
      const restockedByAccount = new Map<string, Minor>()
      let damagedCost = 0
      let totalCogs = 0

      input.items.forEach((item, index) => {
        const computed = totals.lines[index]
        const variant = this.inventory.variant(item.variantId)
        const restock = item.restock ?? defaultRestock
        let unitCost = 0
        let cogsAmount = 0

        if (variant.track_inventory === 1) {
          // ترتدّ البضاعة بنفس تكلفتها وقت البيع حتى لا يتشوّه هامش الربح
          const originalCost = item.saleItemId
            ? ((this.db.prepare('SELECT unit_cost FROM sale_items WHERE id = ?').get(item.saleItemId) as { unit_cost: number } | undefined)?.unit_cost ??
              variant.avg_cost)
            : variant.avg_cost
          unitCost = originalCost
          cogsAmount = lineAmount(item.quantity, originalCost)

          if (restock) {
            this.inventory.receive({
              date: input.date,
              variantId: item.variantId,
              warehouseId,
              quantity: item.quantity,
              unitCost: originalCost,
              movementType: 'sale_return',
              refType: 'sale_return',
              refId: returnId,
              refNumber: returnNumber
            })
            const accountKey = variant.product_type === 'raw' ? ACC.INVENTORY_RAW : ACC.INVENTORY_FINISHED
            restockedByAccount.set(accountKey, (restockedByAccount.get(accountKey) ?? 0) + cogsAmount)
          } else {
            // بضاعة غير صالحة للبيع: لا تدخل المخزون وتُحمَّل تكلفتها على التلف
            damagedCost += cogsAmount
          }
          totalCogs += cogsAmount
        }

        insertItem.run({
          returnId,
          lineNo: index + 1,
          saleItemId: item.saleItemId ?? null,
          variantId: item.variantId,
          quantity: normalizeQty(item.quantity),
          unitPrice: item.unitPrice,
          taxAmount: computed.taxAmount,
          lineTotal: computed.lineTotal,
          unitCost,
          cogsAmount,
          restock: restock ? 1 : 0
        })
        if (item.saleItemId) {
          this.db
            .prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?')
            .run(normalizeQty(item.quantity), item.saleItemId)
        }
      })

      const entryId = this.ledger.post({
        date: input.date,
        refType: 'sale_return',
        refId: returnId,
        refNumber: returnNumber,
        description: `مردود مبيعات ${returnNumber} — ${customer.name}`,
        lines: [
          { accountKey: ACC.SALES_RETURNS, debit: totals.subtotal - totals.discountAmount },
          { accountKey: ACC.TAX_OUTPUT, debit: totals.taxAmount },
          // ما يُردّ من الشحن يُخصم من إيراد الشحن
          { accountKey: ACC.SHIPPING_REVENUE, debit: refundedShipping },
          { accountKey: ACC.RECEIVABLE, partyId: input.customerId, credit: creditTotal, description: `مردود ${returnNumber}` },
          ...[...restockedByAccount.entries()].map(([key, value]) => ({ accountKey: key, debit: value })),
          { accountKey: ACC.INVENTORY_ADJUSTMENT, debit: damagedCost, description: 'مرتجعات غير صالحة للبيع' },
          { accountKey: ACC.COGS, credit: totalCogs },
          // تكلفة إرجاع الشحنة مصروف علينا
          { accountKey: ACC.DELIVERY_EXPENSE, debit: deliveryCost, description: 'تكلفة إرجاع الشحنة' },
          deliveryCost > 0 && input.deliveryPaymentAccountId
            ? { accountId: input.deliveryPaymentAccountId, credit: deliveryCost }
            : { accountKey: ACC.PAYABLE, partyId: input.deliveryPartyId ?? null, credit: deliveryCost }
        ]
      })

      this.db
        .prepare('UPDATE sales_returns SET journal_entry_id = ?, cogs_amount = ? WHERE id = ?')
        .run(entryId, totalCogs, returnId)
      if (input.saleId) {
        this.db.prepare('UPDATE sales SET returned_amount = returned_amount + ? WHERE id = ?').run(creditTotal, input.saleId)
      }
      return { returnId, returnNumber }
    })

    const result = run.immediate()
    this.audit.log({
      action: 'create',
      entityType: 'sale_return',
      entityId: result.returnId,
      entityLabel: result.returnNumber,
      newValue: { customerId: input.customerId, total: creditTotal, restock: defaultRestock, deliveryCost }
    })
    return { id: result.returnId, returnNumber: result.returnNumber }
  }

  voidReturn(id: number, reason: string): void {
    if (!reason?.trim()) throw ERRORS.validation('يجب إدخال سبب الإلغاء.', 'reason')
    const ret = this.db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!ret) throw ERRORS.notFound('المردود')
    if (ret.status === 'void') throw ERRORS.conflict('المردود ملغى بالفعل.')
    const date = todayIso()

    const run = this.db.transaction(() => {
      const items = this.db.prepare('SELECT * FROM sales_return_items WHERE return_id = ?').all(id) as Record<string, unknown>[]
      for (const item of items) {
        const variant = this.inventory.variant(item.variant_id as number)
        // الأصناف التي لم تُعَد للمخزون (غير صالحة للبيع) ليس لها حركة مخزنية تُعكس
        if (variant.track_inventory === 1 && item.restock === 1) {
          this.inventory.issue({
            date,
            variantId: item.variant_id as number,
            warehouseId: ret.warehouse_id as number,
            quantity: item.quantity as number,
            movementType: 'sale',
            unitCostOverride: item.unit_cost as number,
            allowNegative: true,
            refType: 'sale_return_void',
            refId: id,
            refNumber: String(ret.return_number)
          })
        }
        if (item.sale_item_id) {
          this.db.prepare('UPDATE sale_items SET returned_qty = returned_qty - ? WHERE id = ?').run(item.quantity, item.sale_item_id)
        }
      }
      if (ret.journal_entry_id) {
        this.ledger.reverse(ret.journal_entry_id as number, date, `إلغاء مردود ${ret.return_number}: ${reason}`)
      }
      if (ret.sale_id) {
        this.db.prepare('UPDATE sales SET returned_amount = returned_amount - ? WHERE id = ?').run(ret.total, ret.sale_id)
      }
      this.db.prepare("UPDATE sales_returns SET status = 'void', void_reason = ? WHERE id = ?").run(reason, id)
    })
    run.immediate()
    this.audit.log({ action: 'void', entityType: 'sale_return', entityId: id, entityLabel: String(ret.return_number), reason, severity: 'critical' })
  }

  /** الأصناف القابلة للإرجاع في فاتورة */
  returnableItems(saleId: number): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT si.id AS saleItemId, si.variant_id AS variantId, si.quantity, si.returned_qty AS returnedQty,
                si.quantity - si.returned_qty AS remainingQty, si.unit_price AS unitPrice, si.tax_rate AS taxRate,
                p.name AS productName, v.sku, v.size, v.color, p.unit
         FROM sale_items si JOIN product_variants v ON v.id = si.variant_id
         JOIN products p ON p.id = v.product_id
         WHERE si.sale_id = ? AND si.quantity - si.returned_qty > 0
         ORDER BY si.line_no`
      )
      .all(saleId) as Record<string, unknown>[]
  }

  /** إعادة احتساب المدفوع من التخصيصات — يُستخدم في فحص سلامة البيانات */
  recalcPaidAmount(saleId: number): Minor {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(pa.amount),0) AS n FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id
         WHERE pa.doc_type = 'sale' AND pa.doc_id = ? AND p.status = 'confirmed'`
      )
      .get(saleId) as { n: number }
    this.db.prepare('UPDATE sales SET paid_amount = ? WHERE id = ?').run(row.n, saleId)
    return row.n
  }

  static unitCostFromTotal(total: Minor, quantity: number): Rate {
    return rateFromAmount(total, quantity)
  }
}
