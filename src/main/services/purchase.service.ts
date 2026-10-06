import { todayIso } from '@shared/date'
import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'
import { normalizeQty, qtyGreater, rateFromAmount, type Minor, type Rate } from '@shared/money'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { LedgerService } from '../accounting/ledger'
import { ACC } from '../accounting/chart'
import { InventoryService } from '../inventory/inventory.service'
import { NumberingService } from './numbering.service'
import { AuditService } from './audit.service'
import { allocateLandedCosts, computeTotals } from './totals'
import { PaymentService } from './payment.service'

export interface PurchaseItemInput {
  variantId: number
  description?: string | null
  quantity: number
  unitPrice: Rate
  discountAmount?: Minor
  taxRate?: number
}

export interface PurchaseInput {
  date: string
  dueDate?: string | null
  supplierId: number
  warehouseId?: number
  purchaseType?: 'goods' | 'materials'
  supplierInvoiceNumber?: string | null
  items: PurchaseItemInput[]
  discountAmount?: Minor
  discountPercent?: number
  shippingAmount?: Minor
  otherCostAmount?: Minor
  notes?: string | null
  payment?: { amount: Minor; methodId: number; reference?: string | null }
}

export interface PurchaseFilters {
  from?: string
  to?: string
  supplierId?: number
  purchaseType?: 'goods' | 'materials'
  status?: 'draft' | 'confirmed' | 'void'
  paymentStatus?: 'paid' | 'partial' | 'unpaid'
  search?: string
  page?: number
  pageSize?: number
}

/**
 * المشتريات — سواء بضاعة جاهزة أو خامات للتصنيع.
 * الشحن والتكاليف الإضافية تُوزَّع على الأصناف لتصبح جزءًا من تكلفة الوحدة الفعلية (Landed Cost)،
 * فلا يظهر ربح وهمي لاحقًا عند البيع.
 */
export class PurchaseService {
  private readonly db: Database
  private readonly ledger: LedgerService
  private readonly inventory: InventoryService
  private readonly numbering: NumberingService
  private readonly audit: AuditService

  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db
    this.ledger = new LedgerService(ctx)
    this.inventory = new InventoryService(ctx)
    this.numbering = new NumberingService(ctx.db)
    this.audit = new AuditService(ctx)
  }

  create(input: PurchaseInput): { id: number; invoiceNumber: string } {
    const supplier = this.db
      .prepare("SELECT * FROM parties WHERE id = ? AND party_type IN ('supplier','factory')")
      .get(input.supplierId) as { id: number; name: string; party_type: 'supplier' | 'factory' } | undefined
    if (!supplier) throw ERRORS.notFound('المورد')
    if (!input.items?.length) throw ERRORS.validation('يجب إضافة صنف واحد على الأقل للفاتورة.')
    if (!input.date) throw ERRORS.validation('تاريخ الفاتورة مطلوب.', 'date')

    const warehouseId =
      input.warehouseId ??
      (this.db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get() as { id: number } | undefined)?.id
    if (!warehouseId) throw ERRORS.validation('يجب تحديد المخزن.')

    if (input.supplierInvoiceNumber?.trim()) {
      const dup = this.db
        .prepare("SELECT invoice_number FROM purchases WHERE supplier_id = ? AND supplier_invoice_number = ? AND status <> 'void'")
        .get(input.supplierId, input.supplierInvoiceNumber.trim()) as { invoice_number: string } | undefined
      if (dup) throw ERRORS.conflict(`رقم فاتورة المورد مسجَّل من قبل في الفاتورة ${dup.invoice_number}.`)
    }

    const shipping = Math.max(0, Math.round(input.shippingAmount ?? 0))
    const otherCost = Math.max(0, Math.round(input.otherCostAmount ?? 0))

    const totals = computeTotals({
      lines: input.items.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discountAmount: i.discountAmount,
        taxRate: i.taxRate
      })),
      headerDiscountAmount: input.discountAmount,
      headerDiscountPercent: input.discountPercent,
      shippingAmount: shipping + otherCost
    })

    // توزيع التكاليف الإضافية على الأسطر بنسبة صافي قيمة كل سطر
    const landedShares = allocateLandedCosts(totals.lines.map((l) => l.net), shipping + otherCost)

    const paymentAmount = Math.round(input.payment?.amount ?? 0)
    if (paymentAmount > totals.total) throw ERRORS.validation('المبلغ المدفوع أكبر من إجمالي الفاتورة.', 'payment')

    const run = this.db.transaction(() => {
      const invoiceNumber = this.numbering.next('purchase', new Date(input.date))
      const info = this.db
        .prepare(
          `INSERT INTO purchases (invoice_number, supplier_invoice_number, date, due_date, supplier_id, warehouse_id,
                                  purchase_type, subtotal, discount_amount, tax_amount, shipping_amount,
                                  other_cost_amount, total, status, notes, created_by)
           VALUES (@invoiceNumber, @supplierInvoiceNumber, @date, @dueDate, @supplierId, @warehouseId,
                   @purchaseType, @subtotal, @discountAmount, @taxAmount, @shippingAmount,
                   @otherCostAmount, @total, 'confirmed', @notes, @createdBy)`
        )
        .run({
          invoiceNumber,
          supplierInvoiceNumber: input.supplierInvoiceNumber?.trim() || null,
          date: input.date,
          dueDate: input.dueDate ?? null,
          supplierId: input.supplierId,
          warehouseId,
          purchaseType: input.purchaseType ?? 'goods',
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          shippingAmount: shipping,
          otherCostAmount: otherCost,
          total: totals.total,
          notes: input.notes ?? null,
          createdBy: actorId(this.ctx)
        })
      const purchaseId = Number(info.lastInsertRowid)

      const insertItem = this.db.prepare(
        `INSERT INTO purchase_items (purchase_id, line_no, variant_id, description, quantity, unit_price,
                                     discount_amount, tax_rate, tax_amount, line_total, landed_cost, unit_cost)
         VALUES (@purchaseId, @lineNo, @variantId, @description, @quantity, @unitPrice,
                 @discountAmount, @taxRate, @taxAmount, @lineTotal, @landedCost, @unitCost)`
      )
      const inventoryByAccount = new Map<string, Minor>()

      input.items.forEach((item, index) => {
        const computed = totals.lines[index]
        const landed = landedShares[index]
        const lineCostValue = computed.net + landed
        const unitCost = rateFromAmount(lineCostValue, item.quantity)
        const variant = this.inventory.variant(item.variantId)

        if (variant.track_inventory === 1) {
          this.inventory.receive({
            date: input.date,
            variantId: item.variantId,
            warehouseId,
            quantity: item.quantity,
            unitCost,
            movementType: 'purchase',
            refType: 'purchase',
            refId: purchaseId,
            refNumber: invoiceNumber
          })
          const accountKey = variant.product_type === 'raw' ? ACC.INVENTORY_RAW : ACC.INVENTORY_FINISHED
          inventoryByAccount.set(accountKey, (inventoryByAccount.get(accountKey) ?? 0) + lineCostValue)
        } else {
          // خدمات ومصروفات مشتراة لا تدخل المخزون
          inventoryByAccount.set(ACC.EXPENSE_OTHER, (inventoryByAccount.get(ACC.EXPENSE_OTHER) ?? 0) + lineCostValue)
        }

        insertItem.run({
          purchaseId,
          lineNo: index + 1,
          variantId: item.variantId,
          description: item.description ?? null,
          quantity: normalizeQty(item.quantity),
          unitPrice: item.unitPrice,
          discountAmount: computed.discountAmount,
          taxRate: computed.taxRate,
          taxAmount: computed.taxAmount,
          lineTotal: computed.lineTotal,
          landedCost: landed,
          unitCost
        })
      })

      const entryId = this.ledger.post({
        date: input.date,
        refType: 'purchase',
        refId: purchaseId,
        refNumber: invoiceNumber,
        description: `فاتورة شراء ${invoiceNumber} — ${supplier.name}`,
        lines: [
          ...[...inventoryByAccount.entries()].map(([key, value]) => ({ accountKey: key, debit: value })),
          { accountKey: ACC.TAX_INPUT, debit: totals.taxAmount },
          {
            accountKey: this.ledger.controlAccountKey(supplier.party_type),
            partyId: input.supplierId,
            credit: totals.total,
            description: `فاتورة ${invoiceNumber}`
          }
        ]
      })
      this.db.prepare('UPDATE purchases SET journal_entry_id = ? WHERE id = ?').run(entryId, purchaseId)
      return { purchaseId, invoiceNumber }
    })

    const result = run.immediate()

    if (paymentAmount > 0 && input.payment) {
      new PaymentService(this.ctx).create({
        date: input.date,
        direction: 'out',
        partyId: input.supplierId,
        amount: paymentAmount,
        methodId: input.payment.methodId,
        reference: input.payment.reference ?? null,
        notes: `دفعة على فاتورة شراء ${result.invoiceNumber}`,
        allocations: [{ docType: 'purchase', docId: result.purchaseId, amount: paymentAmount }]
      })
    }

    this.audit.log({
      action: 'create',
      entityType: 'purchase',
      entityId: result.purchaseId,
      entityLabel: result.invoiceNumber,
      newValue: { supplierId: input.supplierId, total: totals.total, items: input.items.length, paid: paymentAmount }
    })
    return { id: result.purchaseId, invoiceNumber: result.invoiceNumber }
  }

  get(id: number): Record<string, unknown> {
    const purchase = this.db
      .prepare(
        `SELECT p.*, s.name AS supplier_name, s.code AS supplier_code, s.phone AS supplier_phone,
                s.address AS supplier_address, s.tax_number AS supplier_tax_number,
                w.name AS warehouse_name, u.full_name AS created_by_name
         FROM purchases p JOIN parties s ON s.id = p.supplier_id
         JOIN warehouses w ON w.id = p.warehouse_id
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    if (!purchase) throw ERRORS.notFound('فاتورة الشراء')
    const items = this.db
      .prepare(
        `SELECT pi.*, pr.name AS product_name, pr.unit, v.sku, v.size, v.color
         FROM purchase_items pi JOIN product_variants v ON v.id = pi.variant_id
         JOIN products pr ON pr.id = v.product_id
         WHERE pi.purchase_id = ? ORDER BY pi.line_no`
      )
      .all(id) as Record<string, unknown>[]
    const payments = this.db
      .prepare(
        `SELECT pay.id, pay.payment_number, pay.date, pa.amount AS allocated, pm.name AS method_name, pay.status
         FROM payment_allocations pa JOIN payments pay ON pay.id = pa.payment_id
         JOIN payment_methods pm ON pm.id = pay.method_id
         WHERE pa.doc_type = 'purchase' AND pa.doc_id = ? AND pay.status = 'confirmed' ORDER BY pay.date`
      )
      .all(id) as Record<string, unknown>[]
    const returns = this.db
      .prepare("SELECT id, return_number, date, total FROM purchase_returns WHERE purchase_id = ? AND status = 'confirmed'")
      .all(id) as Record<string, unknown>[]
    return { ...purchase, items, payments, returns }
  }

  list(filters: PurchaseFilters = {}): { rows: Record<string, unknown>[]; total: number; summary: Record<string, number> } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.from) { where.push('p.date >= @from'); params.from = filters.from }
    if (filters.to) { where.push('p.date <= @to'); params.to = filters.to }
    if (filters.supplierId) { where.push('p.supplier_id = @supplierId'); params.supplierId = filters.supplierId }
    if (filters.purchaseType) { where.push('p.purchase_type = @purchaseType'); params.purchaseType = filters.purchaseType }
    if (filters.status) { where.push('p.status = @status'); params.status = filters.status }
    else where.push("p.status <> 'draft'")
    if (filters.paymentStatus === 'paid') where.push('p.total - p.paid_amount - p.returned_amount <= 0')
    if (filters.paymentStatus === 'unpaid') where.push('p.paid_amount = 0 AND p.total - p.returned_amount > 0')
    if (filters.paymentStatus === 'partial') where.push('p.paid_amount > 0 AND p.total - p.paid_amount - p.returned_amount > 0')
    if (filters.search) {
      where.push('(p.invoice_number LIKE @search OR p.supplier_invoice_number LIKE @search OR s.name LIKE @search OR p.notes LIKE @search)')
      params.search = `%${filters.search}%`
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 50))

    const summary = this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(p.total),0) AS total,
                COALESCE(SUM(p.paid_amount),0) AS paid,
                COALESCE(SUM(p.total - p.paid_amount - p.returned_amount),0) AS due
         FROM purchases p JOIN parties s ON s.id = p.supplier_id ${clause}`
      )
      .get(params) as Record<string, number>

    const rows = this.db
      .prepare(
        `SELECT p.id, p.invoice_number, p.supplier_invoice_number, p.date, p.due_date, p.purchase_type,
                p.total, p.paid_amount, p.returned_amount, p.status, p.notes,
                p.total - p.paid_amount - p.returned_amount AS due_amount,
                s.name AS supplier_name, s.code AS supplier_code,
                (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count
         FROM purchases p JOIN parties s ON s.id = p.supplier_id
         ${clause} ORDER BY p.date DESC, p.id DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[]

    return { rows, total: summary.count, summary }
  }

  void(id: number, reason: string): void {
    if (!reason?.trim()) throw ERRORS.validation('يجب إدخال سبب الإلغاء.', 'reason')
    const purchase = this.db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!purchase) throw ERRORS.notFound('فاتورة الشراء')
    if (purchase.status === 'void') throw ERRORS.conflict('الفاتورة ملغاة بالفعل.')

    const allocated = this.db
      .prepare(
        `SELECT COALESCE(SUM(pa.amount),0) AS n FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
         WHERE pa.doc_type = 'purchase' AND pa.doc_id = ? AND p.status = 'confirmed'`
      )
      .get(id) as { n: number }
    if (allocated.n > 0) throw ERRORS.conflict('لا يمكن إلغاء فاتورة عليها مدفوعات. ألغِ سندات الصرف المرتبطة بها أولًا.')

    const date = todayIso()
    const run = this.db.transaction(() => {
      const items = this.db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(id) as Record<string, unknown>[]
      for (const item of items) {
        const variant = this.inventory.variant(item.variant_id as number)
        if (variant.track_inventory === 0) continue
        // إخراج الكميات المشتراة — سيفشل إذا بيعت بالفعل، وهو السلوك الصحيح
        this.inventory.issue({
          date,
          variantId: item.variant_id as number,
          warehouseId: purchase.warehouse_id as number,
          quantity: item.quantity as number,
          unitCostOverride: item.unit_cost as number,
          movementType: 'purchase_return',
          refType: 'purchase_void',
          refId: id,
          refNumber: String(purchase.invoice_number),
          notes: `إلغاء فاتورة شراء: ${reason}`
        })
      }
      if (purchase.journal_entry_id) {
        this.ledger.reverse(purchase.journal_entry_id as number, date, `إلغاء فاتورة شراء ${purchase.invoice_number}: ${reason}`)
      }
      this.db
        .prepare("UPDATE purchases SET status = 'void', void_reason = ?, voided_at = datetime('now'), voided_by = ? WHERE id = ?")
        .run(reason, actorId(this.ctx), id)
    })
    run.immediate()
    this.audit.log({
      action: 'void',
      entityType: 'purchase',
      entityId: id,
      entityLabel: String(purchase.invoice_number),
      reason,
      severity: 'critical'
    })
  }

  // ------------------------- مردودات المشتريات -------------------------

  createReturn(input: {
    date: string
    purchaseId?: number | null
    supplierId: number
    warehouseId?: number
    reason?: string | null
    items: { purchaseItemId?: number | null; variantId: number; quantity: number; unitPrice: Rate; taxRate?: number }[]
  }): { id: number; returnNumber: string } {
    if (!input.items?.length) throw ERRORS.validation('يجب إضافة صنف واحد على الأقل للمردود.')
    const supplier = this.db
      .prepare("SELECT id, name, party_type FROM parties WHERE id = ? AND party_type IN ('supplier','factory')")
      .get(input.supplierId) as { id: number; name: string; party_type: 'supplier' | 'factory' } | undefined
    if (!supplier) throw ERRORS.notFound('المورد')

    const warehouseId =
      input.warehouseId ?? (this.db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get() as { id: number }).id

    if (input.purchaseId) {
      for (const item of input.items) {
        if (!item.purchaseItemId) continue
        const line = this.db
          .prepare('SELECT quantity, returned_qty FROM purchase_items WHERE id = ? AND purchase_id = ?')
          .get(item.purchaseItemId, input.purchaseId) as { quantity: number; returned_qty: number } | undefined
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

    const run = this.db.transaction(() => {
      const returnNumber = this.numbering.next('purchase_return', new Date(input.date))
      const info = this.db
        .prepare(
          `INSERT INTO purchase_returns (return_number, date, purchase_id, supplier_id, warehouse_id, subtotal, tax_amount, total, reason, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          returnNumber,
          input.date,
          input.purchaseId ?? null,
          input.supplierId,
          warehouseId,
          totals.subtotal,
          totals.taxAmount,
          totals.total,
          input.reason ?? null,
          actorId(this.ctx)
        )
      const returnId = Number(info.lastInsertRowid)

      const insertItem = this.db.prepare(
        `INSERT INTO purchase_return_items (return_id, line_no, purchase_item_id, variant_id, quantity, unit_price, tax_amount, line_total, unit_cost)
         VALUES (@returnId, @lineNo, @purchaseItemId, @variantId, @quantity, @unitPrice, @taxAmount, @lineTotal, @unitCost)`
      )
      const inventoryByAccount = new Map<string, Minor>()

      input.items.forEach((item, index) => {
        const computed = totals.lines[index]
        const variant = this.inventory.variant(item.variantId)
        let unitCost = 0
        if (variant.track_inventory === 1) {
          const originalCost = item.purchaseItemId
            ? ((this.db.prepare('SELECT unit_cost FROM purchase_items WHERE id = ?').get(item.purchaseItemId) as { unit_cost: number } | undefined)
                ?.unit_cost ?? variant.avg_cost)
            : variant.avg_cost
          const movement = this.inventory.issue({
            date: input.date,
            variantId: item.variantId,
            warehouseId,
            quantity: item.quantity,
            unitCostOverride: originalCost,
            movementType: 'purchase_return',
            refType: 'purchase_return',
            refId: returnId,
            refNumber: returnNumber
          })
          unitCost = originalCost
          const accountKey = variant.product_type === 'raw' ? ACC.INVENTORY_RAW : ACC.INVENTORY_FINISHED
          inventoryByAccount.set(accountKey, (inventoryByAccount.get(accountKey) ?? 0) + -movement.value)
        }
        insertItem.run({
          returnId,
          lineNo: index + 1,
          purchaseItemId: item.purchaseItemId ?? null,
          variantId: item.variantId,
          quantity: normalizeQty(item.quantity),
          unitPrice: item.unitPrice,
          taxAmount: computed.taxAmount,
          lineTotal: computed.lineTotal,
          unitCost
        })
        if (item.purchaseItemId) {
          this.db
            .prepare('UPDATE purchase_items SET returned_qty = returned_qty + ? WHERE id = ?')
            .run(normalizeQty(item.quantity), item.purchaseItemId)
        }
      })

      const inventoryTotal = [...inventoryByAccount.values()].reduce((s, v) => s + v, 0)
      // الفرق بين قيمة المردود وتكلفة البضاعة المُخرَجة يُسجَّل كخصم مشتريات مكتسب
      const difference = totals.total - totals.taxAmount - inventoryTotal

      const entryId = this.ledger.post({
        date: input.date,
        refType: 'purchase_return',
        refId: returnId,
        refNumber: returnNumber,
        description: `مردود مشتريات ${returnNumber} — ${supplier.name}`,
        lines: [
          {
            accountKey: this.ledger.controlAccountKey(supplier.party_type),
            partyId: input.supplierId,
            debit: totals.total,
            description: `مردود ${returnNumber}`
          },
          ...[...inventoryByAccount.entries()].map(([key, value]) => ({ accountKey: key, credit: value })),
          { accountKey: ACC.TAX_INPUT, credit: totals.taxAmount },
          difference >= 0
            ? { accountKey: ACC.PURCHASE_DISCOUNTS, credit: difference }
            : { accountKey: ACC.INVENTORY_ADJUSTMENT, debit: -difference }
        ]
      })

      this.db.prepare('UPDATE purchase_returns SET journal_entry_id = ? WHERE id = ?').run(entryId, returnId)
      if (input.purchaseId) {
        this.db.prepare('UPDATE purchases SET returned_amount = returned_amount + ? WHERE id = ?').run(totals.total, input.purchaseId)
      }
      return { returnId, returnNumber }
    })

    const result = run.immediate()
    this.audit.log({
      action: 'create',
      entityType: 'purchase_return',
      entityId: result.returnId,
      entityLabel: result.returnNumber,
      newValue: { supplierId: input.supplierId, total: totals.total }
    })
    return { id: result.returnId, returnNumber: result.returnNumber }
  }

  returnableItems(purchaseId: number): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT pi.id AS purchaseItemId, pi.variant_id AS variantId, pi.quantity, pi.returned_qty AS returnedQty,
                pi.quantity - pi.returned_qty AS remainingQty, pi.unit_price AS unitPrice, pi.tax_rate AS taxRate,
                p.name AS productName, v.sku, v.size, v.color, p.unit
         FROM purchase_items pi JOIN product_variants v ON v.id = pi.variant_id
         JOIN products p ON p.id = v.product_id
         WHERE pi.purchase_id = ? AND pi.quantity - pi.returned_qty > 0 ORDER BY pi.line_no`
      )
      .all(purchaseId) as Record<string, unknown>[]
  }
}
