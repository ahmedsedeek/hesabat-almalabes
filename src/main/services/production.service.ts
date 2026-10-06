import { todayIso } from '@shared/date'
import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'
import { normalizeQty, qtyGreater, rateFromAmount, type Minor, type Rate } from '@shared/money'
import type { ProductionStatus } from '@shared/types'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { LedgerService } from '../accounting/ledger'
import { ACC } from '../accounting/chart'
import { InventoryService } from '../inventory/inventory.service'
import { NumberingService } from './numbering.service'
import { AuditService } from './audit.service'

export interface ProductionOrderInput {
  date: string
  factoryId: number
  outputVariantId: number
  warehouseId?: number
  expectedQty: number
  expectedDate?: string | null
  notes?: string | null
  materials?: { variantId: number; plannedQty: number; notes?: string | null }[]
}

export interface IssueMaterialsInput {
  orderId: number
  date: string
  warehouseId?: number
  items: { variantId: number; quantity: number }[]
  notes?: string | null
}

export interface ProductionCostInput {
  orderId: number
  date: string
  costType: 'factory' | 'other'
  description?: string | null
  amount: Minor
  /** حساب الصندوق/البنك عند الدفع الفوري، أو null لتسجيلها كمستحق على المصنع */
  paymentAccountId?: number | null
  methodId?: number | null
}

export interface ReceiveOutputInput {
  orderId: number
  date: string
  quantity: number
  warehouseId?: number
  /** آخر استلام للأمر — يستوعب كامل التكلفة المتبقية تحت التشغيل */
  isFinal?: boolean
}

const STATUS_LABEL: Record<ProductionStatus, string> = {
  draft: 'مسودة',
  sent: 'أُرسل للمصنع',
  in_production: 'قيد التنفيذ',
  partial: 'مكتمل جزئيًا',
  completed: 'مكتمل',
  cancelled: 'ملغى'
}

/**
 * التصنيع لدى المصانع.
 *
 * دورة التكلفة:
 *   1) صرف الخامات للمصنع  →  من «بضاعة لدى المصانع» إلى مخزون الخامات (تخرج من المخزن فلا تُستخدم مرتين)
 *   2) تكاليف التصنيع       →  تُضاف إلى «بضاعة لدى المصانع» مقابل مستحقات المصنع أو النقدية
 *   3) استلام الإنتاج       →  تُنقل التكلفة من «بضاعة لدى المصانع» إلى مخزون البضاعة الجاهزة
 *   4) إقفال الأمر          →  أي فرق متبقٍ يُرحَّل إلى «فروقات تكلفة الإنتاج»
 *
 * بهذا تكون تكلفة القطعة المنتجة = (الخامات + أجر التصنيع + التكاليف الأخرى) ÷ الكمية المنتجة.
 */
export class ProductionService {
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

  // ------------------------- إنشاء الأمر -------------------------

  create(input: ProductionOrderInput): { id: number; orderNumber: string } {
    const factory = this.db.prepare("SELECT id, name FROM parties WHERE id = ? AND party_type = 'factory'").get(input.factoryId) as
      | { id: number; name: string }
      | undefined
    if (!factory) throw ERRORS.notFound('المصنع')
    if (!(input.expectedQty > 0)) throw ERRORS.validation('الكمية المتوقعة يجب أن تكون أكبر من صفر.', 'expectedQty')
    this.inventory.variant(input.outputVariantId)

    const warehouseId =
      input.warehouseId ?? (this.db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get() as { id: number }).id

    const run = this.db.transaction(() => {
      const orderNumber = this.numbering.next('production_order', new Date(input.date))
      const info = this.db
        .prepare(
          `INSERT INTO production_orders (order_number, date, factory_id, output_variant_id, warehouse_id,
                                          expected_qty, expected_date, status, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
        )
        .run(
          orderNumber,
          input.date,
          input.factoryId,
          input.outputVariantId,
          warehouseId,
          normalizeQty(input.expectedQty),
          input.expectedDate ?? null,
          input.notes ?? null,
          actorId(this.ctx)
        )
      const orderId = Number(info.lastInsertRowid)
      const insertMaterial = this.db.prepare(
        'INSERT INTO production_materials (order_id, line_no, variant_id, planned_qty, notes) VALUES (?, ?, ?, ?, ?)'
      )
      ;(input.materials ?? []).forEach((m, index) => {
        insertMaterial.run(orderId, index + 1, m.variantId, normalizeQty(m.plannedQty), m.notes ?? null)
      })
      return { orderId, orderNumber }
    })

    const result = run.immediate()
    this.audit.log({
      action: 'create',
      entityType: 'production_order',
      entityId: result.orderId,
      entityLabel: result.orderNumber,
      newValue: { factoryId: input.factoryId, expectedQty: input.expectedQty }
    })
    return { id: result.orderId, orderNumber: result.orderNumber }
  }

  private order(id: number): Record<string, unknown> {
    const row = this.db.prepare('SELECT * FROM production_orders WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw ERRORS.notFound('أمر الإنتاج')
    return row
  }

  private assertOpen(order: Record<string, unknown>): void {
    if (order.status === 'cancelled') throw ERRORS.conflict('أمر الإنتاج ملغى.')
    if (order.status === 'completed') throw ERRORS.conflict('أمر الإنتاج مقفل. لا يمكن تسجيل حركات جديدة عليه.')
  }

  updateHeader(id: number, patch: { expectedQty?: number; expectedDate?: string | null; notes?: string | null; materials?: { variantId: number; plannedQty: number }[] }): void {
    const order = this.order(id)
    this.assertOpen(order)
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE production_orders SET expected_qty = COALESCE(?, expected_qty), expected_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .run(patch.expectedQty ? normalizeQty(patch.expectedQty) : null, patch.expectedDate ?? (order.expected_date as string | null), patch.notes ?? (order.notes as string | null), id)
      if (patch.materials) {
        // لا تُحذف الخامات التي صُرفت فعلًا
        const issued = this.db.prepare('SELECT variant_id FROM production_materials WHERE order_id = ? AND issued_qty <> 0').all(id) as { variant_id: number }[]
        const issuedIds = new Set(issued.map((r) => r.variant_id))
        this.db.prepare('DELETE FROM production_materials WHERE order_id = ? AND issued_qty = 0').run(id)
        const insert = this.db.prepare(
          'INSERT INTO production_materials (order_id, line_no, variant_id, planned_qty) VALUES (?, ?, ?, ?)'
        )
        const update = this.db.prepare('UPDATE production_materials SET planned_qty = ? WHERE order_id = ? AND variant_id = ?')
        patch.materials.forEach((m, index) => {
          if (issuedIds.has(m.variantId)) update.run(normalizeQty(m.plannedQty), id, m.variantId)
          else insert.run(id, index + 1, m.variantId, normalizeQty(m.plannedQty))
        })
      }
    })
    run.immediate()
    this.audit.log({ action: 'update', entityType: 'production_order', entityId: id, entityLabel: String(order.order_number), newValue: patch })
  }

  setStatus(id: number, status: ProductionStatus, reason?: string): void {
    const order = this.order(id)
    if (order.status === 'completed' && status !== 'completed') {
      throw ERRORS.conflict('لا يمكن إعادة فتح أمر إنتاج مقفل.')
    }
    if (status === 'completed') { this.complete(id, reason); return }
    if (status === 'cancelled') { this.cancel(id, reason ?? 'إلغاء'); return }
    this.db.prepare("UPDATE production_orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
    this.audit.log({
      action: 'update',
      entityType: 'production_order',
      entityId: id,
      entityLabel: String(order.order_number),
      oldValue: { status: order.status },
      newValue: { status: STATUS_LABEL[status] }
    })
  }

  // ------------------------- صرف الخامات -------------------------

  issueMaterials(input: IssueMaterialsInput): void {
    const order = this.order(input.orderId)
    this.assertOpen(order)
    if (!input.items?.length) throw ERRORS.validation('يجب تحديد الخامات المصروفة.')
    const warehouseId = input.warehouseId ?? (order.warehouse_id as number)

    const run = this.db.transaction(() => {
      const valueByAccount = new Map<string, Minor>()
      let totalValue = 0

      for (const item of input.items) {
        const quantity = normalizeQty(item.quantity)
        if (quantity === 0) continue
        const variant = this.inventory.variant(item.variantId)
        if (variant.track_inventory === 0) throw ERRORS.validation('لا يمكن صرف صنف غير مُتابَع مخزنيًا للمصنع.')

        // الكمية الموجبة صرف للمصنع، والسالبة ارتجاع منه
        const movement =
          quantity > 0
            ? this.inventory.issue({
                date: input.date,
                variantId: item.variantId,
                warehouseId,
                quantity,
                movementType: 'production_issue',
                refType: 'production',
                refId: input.orderId,
                refNumber: String(order.order_number),
                notes: input.notes ?? null
              })
            : this.inventory.receive({
                date: input.date,
                variantId: item.variantId,
                warehouseId,
                quantity: -quantity,
                unitCost: this.issuedUnitCost(input.orderId, item.variantId),
                movementType: 'production_return',
                refType: 'production',
                refId: input.orderId,
                refNumber: String(order.order_number),
                notes: input.notes ?? null
              })

        // تكلفة منتقلة إلى «بضاعة لدى المصانع»: موجبة عند الصرف وسالبة عند الارتجاع
        const costValue = -movement.value
        this.db
          .prepare(
            `INSERT INTO production_issues (order_id, date, variant_id, quantity, unit_cost, value, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(input.orderId, input.date, item.variantId, quantity, movement.unitCost, costValue, actorId(this.ctx))

        // تحديث سطر الخامات المخطط أو إنشاؤه إن كانت خامة غير مخططة
        const existing = this.db
          .prepare('SELECT id FROM production_materials WHERE order_id = ? AND variant_id = ?')
          .get(input.orderId, item.variantId) as { id: number } | undefined
        if (existing) {
          this.db
            .prepare('UPDATE production_materials SET issued_qty = issued_qty + ?, issued_cost = issued_cost + ? WHERE id = ?')
            .run(quantity, costValue, existing.id)
        } else {
          const lineNo = ((this.db.prepare('SELECT COALESCE(MAX(line_no),0) AS n FROM production_materials WHERE order_id = ?').get(input.orderId) as { n: number }).n) + 1
          this.db
            .prepare('INSERT INTO production_materials (order_id, line_no, variant_id, planned_qty, issued_qty, issued_cost) VALUES (?, ?, ?, 0, ?, ?)')
            .run(input.orderId, lineNo, item.variantId, quantity, costValue)
        }

        const accountKey = variant.product_type === 'raw' ? ACC.INVENTORY_RAW : ACC.INVENTORY_FINISHED
        valueByAccount.set(accountKey, (valueByAccount.get(accountKey) ?? 0) + costValue)
        totalValue += costValue
      }

      if (totalValue !== 0) {
        const entryId = this.ledger.post({
          date: input.date,
          refType: 'production',
          refId: input.orderId,
          refNumber: String(order.order_number),
          description: `صرف خامات لأمر الإنتاج ${order.order_number}`,
          lines: [
            totalValue >= 0
              ? { accountKey: ACC.WIP_FACTORY, debit: totalValue, partyId: order.factory_id as number }
              : { accountKey: ACC.WIP_FACTORY, credit: -totalValue, partyId: order.factory_id as number },
            ...[...valueByAccount.entries()].map(([key, value]) =>
              value >= 0 ? { accountKey: key, credit: value } : { accountKey: key, debit: -value }
            )
          ]
        })
        this.db.prepare('UPDATE production_issues SET journal_entry_id = ? WHERE order_id = ? AND journal_entry_id IS NULL').run(entryId, input.orderId)
      }

      this.refreshCosts(input.orderId)
      if (order.status === 'draft' || order.status === 'sent') {
        this.db.prepare("UPDATE production_orders SET status = 'in_production' WHERE id = ?").run(input.orderId)
      }
    })
    run.immediate()

    this.audit.log({
      action: 'issue_materials',
      entityType: 'production_order',
      entityId: input.orderId,
      entityLabel: String(order.order_number),
      newValue: { items: input.items }
    })
  }

  /** متوسط تكلفة الخامة كما صُرفت لهذا الأمر — تُستخدم عند الارتجاع من المصنع */
  private issuedUnitCost(orderId: number, variantId: number): Rate {
    const row = this.db
      .prepare('SELECT SUM(quantity) AS q, SUM(value) AS v FROM production_issues WHERE order_id = ? AND variant_id = ?')
      .get(orderId, variantId) as { q: number | null; v: number | null }
    if (!row.q || row.q <= 0) return this.inventory.avgCost(variantId)
    return rateFromAmount(row.v ?? 0, row.q)
  }

  // ------------------------- تكاليف التصنيع -------------------------

  addCost(input: ProductionCostInput): number {
    const order = this.order(input.orderId)
    this.assertOpen(order)
    const amount = Math.round(input.amount)
    if (!(amount > 0)) throw ERRORS.validation('قيمة التكلفة يجب أن تكون أكبر من صفر.', 'amount')

    const run = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO production_costs (order_id, date, cost_type, description, amount, party_id, payment_account_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.orderId,
          input.date,
          input.costType,
          input.description ?? null,
          amount,
          order.factory_id as number,
          input.paymentAccountId ?? null,
          actorId(this.ctx)
        )
      const costId = Number(info.lastInsertRowid)

      const entryId = this.ledger.post({
        date: input.date,
        refType: 'production',
        refId: input.orderId,
        refNumber: String(order.order_number),
        description: `تكلفة تصنيع — ${input.description ?? STATUS_LABEL.in_production} (${order.order_number})`,
        lines: [
          { accountKey: ACC.WIP_FACTORY, debit: amount, partyId: order.factory_id as number },
          input.paymentAccountId
            ? { accountId: input.paymentAccountId, credit: amount }
            : { accountKey: ACC.FACTORY_PAYABLE, partyId: order.factory_id as number, credit: amount }
        ]
      })
      this.db.prepare('UPDATE production_costs SET journal_entry_id = ? WHERE id = ?').run(entryId, costId)
      this.refreshCosts(input.orderId)
      return costId
    })

    const costId = run.immediate()
    this.audit.log({
      action: 'add_cost',
      entityType: 'production_order',
      entityId: input.orderId,
      entityLabel: String(order.order_number),
      newValue: { costType: input.costType, amount }
    })
    return costId
  }

  voidCost(costId: number, reason: string): void {
    const cost = this.db.prepare('SELECT * FROM production_costs WHERE id = ?').get(costId) as Record<string, unknown> | undefined
    if (!cost) throw ERRORS.notFound('التكلفة')
    if (cost.status === 'void') throw ERRORS.conflict('التكلفة ملغاة بالفعل.')
    const date = todayIso()
    const run = this.db.transaction(() => {
      if (cost.journal_entry_id) this.ledger.reverse(cost.journal_entry_id as number, date, reason)
      this.db.prepare("UPDATE production_costs SET status = 'void' WHERE id = ?").run(costId)
      this.refreshCosts(cost.order_id as number)
    })
    run.immediate()
    this.audit.log({ action: 'void', entityType: 'production_cost', entityId: costId, reason, severity: 'warning' })
  }

  /** إعادة احتساب إجماليات التكلفة من الحركات الفعلية */
  private refreshCosts(orderId: number): void {
    const materials = this.db
      .prepare('SELECT COALESCE(SUM(value),0) AS v FROM production_issues WHERE order_id = ?')
      .get(orderId) as { v: number }
    const factory = this.db
      .prepare("SELECT COALESCE(SUM(amount),0) AS v FROM production_costs WHERE order_id = ? AND cost_type = 'factory' AND status = 'confirmed'")
      .get(orderId) as { v: number }
    const other = this.db
      .prepare("SELECT COALESCE(SUM(amount),0) AS v FROM production_costs WHERE order_id = ? AND cost_type = 'other' AND status = 'confirmed'")
      .get(orderId) as { v: number }
    const produced = this.db
      .prepare('SELECT COALESCE(SUM(quantity),0) AS q, COALESCE(SUM(total_cost),0) AS c FROM production_outputs WHERE order_id = ?')
      .get(orderId) as { q: number; c: number }

    const total = materials.v + factory.v + other.v
    const unitCost = produced.q > 0 ? rateFromAmount(produced.c, produced.q) : 0
    this.db
      .prepare(
        `UPDATE production_orders SET materials_cost = ?, factory_cost = ?, other_cost = ?, total_cost = ?,
           produced_qty = ?, unit_cost = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(materials.v, factory.v, other.v, total, normalizeQty(produced.q), unitCost, orderId)
  }

  /** رصيد التكلفة تحت التشغيل الذي لم يُستوعب بعد في منتج نهائي */
  wipRemaining(orderId: number): Minor {
    const order = this.order(orderId)
    const absorbed = this.db
      .prepare('SELECT COALESCE(SUM(total_cost),0) AS c FROM production_outputs WHERE order_id = ?')
      .get(orderId) as { c: number }
    return (order.total_cost as number) - absorbed.c
  }

  // ------------------------- استلام الإنتاج -------------------------

  receiveOutput(input: ReceiveOutputInput): { unitCost: Rate; totalCost: Minor } {
    const order = this.order(input.orderId)
    this.assertOpen(order)
    const quantity = normalizeQty(input.quantity)
    if (!(quantity > 0)) throw ERRORS.validation('الكمية المستلمة يجب أن تكون أكبر من صفر.', 'quantity')

    const warehouseId = input.warehouseId ?? (order.warehouse_id as number)
    const variantId = order.output_variant_id as number

    const run = this.db.transaction(() => {
      this.refreshCosts(input.orderId)
      const remainingCost = this.wipRemaining(input.orderId)
      const producedSoFar = (this.db.prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM production_outputs WHERE order_id = ?').get(input.orderId) as { q: number }).q
      const remainingExpected = Math.max(normalizeQty((order.expected_qty as number) - producedSoFar), 0)

      // آخر استلام يستوعب كامل التكلفة المتبقية؛ الاستلام الجزئي يأخذ نصيبه بنسبة الكمية
      const isFinal = input.isFinal === true || remainingExpected === 0 || !qtyGreater(remainingExpected, quantity)
      const totalCost = isFinal
        ? remainingCost
        : Math.round((remainingCost * quantity) / remainingExpected)
      const unitCost = rateFromAmount(totalCost, quantity)

      this.inventory.receive({
        date: input.date,
        variantId,
        warehouseId,
        quantity,
        unitCost,
        movementType: 'production_receipt',
        refType: 'production',
        refId: input.orderId,
        refNumber: String(order.order_number)
      })

      const variant = this.inventory.variant(variantId)
      const inventoryKey = variant.product_type === 'raw' ? ACC.INVENTORY_RAW : ACC.INVENTORY_FINISHED
      const entryId = this.ledger.post({
        date: input.date,
        refType: 'production',
        refId: input.orderId,
        refNumber: String(order.order_number),
        description: `استلام إنتاج ${order.order_number}`,
        lines: [
          { accountKey: inventoryKey, debit: totalCost },
          { accountKey: ACC.WIP_FACTORY, credit: totalCost, partyId: order.factory_id as number }
        ]
      })

      this.db
        .prepare(
          `INSERT INTO production_outputs (order_id, date, variant_id, quantity, unit_cost, total_cost, journal_entry_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(input.orderId, input.date, variantId, quantity, unitCost, totalCost, entryId, actorId(this.ctx))

      this.refreshCosts(input.orderId)
      const newProduced = producedSoFar + quantity
      const status: ProductionStatus = isFinal ? 'completed' : 'partial'
      this.db.prepare("UPDATE production_orders SET status = ?, completion_date = ? WHERE id = ?")
        .run(status, status === 'completed' ? input.date : null, input.orderId)
      if (status === 'completed') this.settleVariance(input.orderId, input.date)
      void newProduced
      return { unitCost, totalCost }
    })

    const result = run.immediate()
    this.audit.log({
      action: 'receive_output',
      entityType: 'production_order',
      entityId: input.orderId,
      entityLabel: String(order.order_number),
      newValue: { quantity, unitCost: result.unitCost, totalCost: result.totalCost }
    })
    return result
  }

  /** ترحيل أي فرق متبقٍ تحت التشغيل إلى حساب فروقات الإنتاج عند إقفال الأمر */
  private settleVariance(orderId: number, date: string): void {
    const remaining = this.wipRemaining(orderId)
    if (remaining === 0) return
    const order = this.order(orderId)
    this.ledger.post({
      date,
      refType: 'production',
      refId: orderId,
      refNumber: String(order.order_number),
      description: `فروقات تكلفة إنتاج ${order.order_number}`,
      lines:
        remaining > 0
          ? [
              { accountKey: ACC.PRODUCTION_VARIANCE, debit: remaining },
              { accountKey: ACC.WIP_FACTORY, credit: remaining, partyId: order.factory_id as number }
            ]
          : [
              { accountKey: ACC.WIP_FACTORY, debit: -remaining, partyId: order.factory_id as number },
              { accountKey: ACC.PRODUCTION_VARIANCE, credit: -remaining }
            ]
    })
  }

  complete(id: number, reason?: string): void {
    const order = this.order(id)
    if (order.status === 'completed') return
    const date = todayIso()
    const run = this.db.transaction(() => {
      this.refreshCosts(id)
      this.settleVariance(id, date)
      this.db.prepare("UPDATE production_orders SET status = 'completed', completion_date = ?, updated_at = datetime('now') WHERE id = ?").run(date, id)
    })
    run.immediate()
    this.audit.log({ action: 'complete', entityType: 'production_order', entityId: id, entityLabel: String(order.order_number), reason })
  }

  cancel(id: number, reason: string): void {
    const order = this.order(id)
    if (order.status === 'completed') throw ERRORS.conflict('لا يمكن إلغاء أمر إنتاج مكتمل.')
    const issued = this.db.prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM production_issues WHERE order_id = ?').get(id) as { q: number }
    if (issued.q > 0) {
      throw ERRORS.conflict('لا يمكن إلغاء أمر صُرفت له خامات. سجّل ارتجاع الخامات من المصنع أولًا.')
    }
    const produced = this.db.prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM production_outputs WHERE order_id = ?').get(id) as { q: number }
    if (produced.q > 0) throw ERRORS.conflict('لا يمكن إلغاء أمر تم استلام إنتاج منه.')

    this.db.prepare("UPDATE production_orders SET status = 'cancelled', void_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason, id)
    this.audit.log({ action: 'cancel', entityType: 'production_order', entityId: id, entityLabel: String(order.order_number), reason, severity: 'warning' })
  }

  // ------------------------- استعلامات -------------------------

  get(id: number): Record<string, unknown> {
    const order = this.db
      .prepare(
        `SELECT o.*, f.name AS factory_name, f.code AS factory_code, f.phone AS factory_phone,
                p.name AS product_name, v.sku AS product_sku, v.size, v.color, p.unit,
                w.name AS warehouse_name, u.full_name AS created_by_name
         FROM production_orders o
         JOIN parties f ON f.id = o.factory_id
         JOIN product_variants v ON v.id = o.output_variant_id
         JOIN products p ON p.id = v.product_id
         JOIN warehouses w ON w.id = o.warehouse_id
         LEFT JOIN users u ON u.id = o.created_by
         WHERE o.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    if (!order) throw ERRORS.notFound('أمر الإنتاج')

    const materials = this.db
      .prepare(
        `SELECT m.*, p.name AS product_name, v.sku, v.size, v.color, p.unit,
                COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.variant_id = m.variant_id), 0) AS available
         FROM production_materials m JOIN product_variants v ON v.id = m.variant_id
         JOIN products p ON p.id = v.product_id WHERE m.order_id = ? ORDER BY m.line_no`
      )
      .all(id) as Record<string, unknown>[]
    const costs = this.db
      .prepare('SELECT * FROM production_costs WHERE order_id = ? ORDER BY date, id')
      .all(id) as Record<string, unknown>[]
    const outputs = this.db
      .prepare('SELECT * FROM production_outputs WHERE order_id = ? ORDER BY date, id')
      .all(id) as Record<string, unknown>[]
    const issues = this.db
      .prepare(
        `SELECT i.*, p.name AS product_name, v.sku FROM production_issues i
         JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id
         WHERE i.order_id = ? ORDER BY i.date, i.id`
      )
      .all(id) as Record<string, unknown>[]

    return {
      ...order,
      status_label: STATUS_LABEL[order.status as ProductionStatus],
      materials,
      costs,
      outputs,
      issues,
      wip_remaining: this.wipRemaining(id)
    }
  }

  list(filters: { from?: string; to?: string; factoryId?: number; status?: ProductionStatus; search?: string; page?: number; pageSize?: number } = {}): {
    rows: Record<string, unknown>[]
    total: number
  } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.from) { where.push('o.date >= @from'); params.from = filters.from }
    if (filters.to) { where.push('o.date <= @to'); params.to = filters.to }
    if (filters.factoryId) { where.push('o.factory_id = @factoryId'); params.factoryId = filters.factoryId }
    if (filters.status) { where.push('o.status = @status'); params.status = filters.status }
    if (filters.search) {
      where.push('(o.order_number LIKE @search OR f.name LIKE @search OR p.name LIKE @search)')
      params.search = `%${filters.search}%`
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 50))

    const total = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM production_orders o JOIN parties f ON f.id = o.factory_id
           JOIN product_variants v ON v.id = o.output_variant_id JOIN products p ON p.id = v.product_id ${clause}`
        )
        .get(params) as { n: number }
    ).n

    const rows = this.db
      .prepare(
        `SELECT o.*, f.name AS factory_name, p.name AS product_name, v.size, v.color, p.unit
         FROM production_orders o JOIN parties f ON f.id = o.factory_id
         JOIN product_variants v ON v.id = o.output_variant_id JOIN products p ON p.id = v.product_id
         ${clause} ORDER BY o.date DESC, o.id DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[]

    return {
      rows: rows.map((r) => ({ ...r, status_label: STATUS_LABEL[r.status as ProductionStatus] })),
      total
    }
  }

  /** الخامات الموجودة حاليًا لدى كل مصنع (مصروفة ولم تُستهلك بعد في إنتاج مستلَم) */
  materialsAtFactories(): { factoryId: number; factoryName: string; wipValue: number; openOrders: number }[] {
    const rows = this.db
      .prepare(
        `SELECT f.id AS factoryId, f.name AS factoryName,
                COALESCE(SUM(o.total_cost - COALESCE((SELECT SUM(po.total_cost) FROM production_outputs po WHERE po.order_id = o.id),0)), 0) AS wipValue,
                SUM(CASE WHEN o.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS openOrders
         FROM parties f LEFT JOIN production_orders o ON o.factory_id = f.id AND o.status NOT IN ('cancelled')
         WHERE f.party_type = 'factory'
         GROUP BY f.id HAVING wipValue <> 0 OR openOrders > 0
         ORDER BY wipValue DESC`
      )
      .all() as { factoryId: number; factoryName: string; wipValue: number; openOrders: number }[]
    return rows
  }
}
