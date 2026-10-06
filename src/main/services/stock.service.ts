import { todayIso } from '@shared/date'
import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'
import { normalizeQty, type Minor, type Rate } from '@shared/money'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { LedgerService } from '../accounting/ledger'
import { ACC } from '../accounting/chart'
import { InventoryService } from '../inventory/inventory.service'
import { NumberingService } from './numbering.service'
import { AuditService } from './audit.service'

export interface AdjustmentItemInput {
  variantId: number
  /** الكمية الجديدة بعد الجرد (لنوع count) أو مقدار التغيير (للأنواع الأخرى) */
  quantity: number
  unitCost?: Rate
  notes?: string | null
}

export interface AdjustmentInput {
  date: string
  warehouseId: number
  adjustmentType: 'count' | 'damage' | 'loss' | 'opening' | 'other'
  reason?: string | null
  items: AdjustmentItemInput[]
}

export interface TransferInput {
  date: string
  fromWarehouseId: number
  toWarehouseId: number
  notes?: string | null
  items: { variantId: number; quantity: number }[]
}

/**
 * تسويات المخزون والتحويلات بين المخازن.
 *
 * - «جرد»: الكمية المُدخلة هي الرصيد الفعلي بعد العدّ، والنظام يحسب الفرق.
 * - «تالف/فاقد»: الكمية المُدخلة هي مقدار النقص.
 * - «رصيد افتتاحي»: إدخال أرصدة بداية التشغيل مقابل حساب الأرصدة الافتتاحية.
 * التحويل بين المخازن لا يُنتج أثرًا محاسبيًا لأن الملكية لم تتغيّر.
 */
export class StockService {
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

  createAdjustment(input: AdjustmentInput): { id: number; adjustmentNumber: string } {
    if (!input.items?.length) throw ERRORS.validation('يجب إضافة صنف واحد على الأقل.')

    const run = this.db.transaction(() => {
      const adjustmentNumber = this.numbering.next('stock_adjustment', new Date(input.date))
      const info = this.db
        .prepare(
          `INSERT INTO stock_adjustments (adjustment_number, date, warehouse_id, adjustment_type, reason, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(adjustmentNumber, input.date, input.warehouseId, input.adjustmentType, input.reason ?? null, actorId(this.ctx))
      const adjustmentId = Number(info.lastInsertRowid)

      const insertItem = this.db.prepare(
        `INSERT INTO stock_adjustment_items (adjustment_id, line_no, variant_id, quantity, unit_cost, value, notes)
         VALUES (@adjustmentId, @lineNo, @variantId, @quantity, @unitCost, @value, @notes)`
      )
      const valueByAccount = new Map<string, Minor>()
      let totalValue = 0

      input.items.forEach((item, index) => {
        const variant = this.inventory.variant(item.variantId)
        if (variant.track_inventory === 0) throw ERRORS.validation('لا يمكن تسوية صنف غير مُتابَع مخزنيًا.')

        let delta: number
        if (input.adjustmentType === 'count') {
          const current = this.inventory.stockAt(item.variantId, input.warehouseId)
          delta = normalizeQty(item.quantity - current)
        } else if (input.adjustmentType === 'damage' || input.adjustmentType === 'loss') {
          delta = -Math.abs(normalizeQty(item.quantity))
        } else {
          delta = normalizeQty(item.quantity)
        }
        if (delta === 0) return

        const movementType = input.adjustmentType === 'opening' ? 'opening' : input.adjustmentType === 'damage' ? 'damage' : 'adjustment'
        const movement = this.inventory.adjust({
          date: input.date,
          variantId: item.variantId,
          warehouseId: input.warehouseId,
          quantity: delta,
          unitCost: item.unitCost,
          movementType,
          refType: 'stock_adjustment',
          refId: adjustmentId,
          refNumber: adjustmentNumber,
          notes: item.notes ?? input.reason ?? null
        })

        insertItem.run({
          adjustmentId,
          lineNo: index + 1,
          variantId: item.variantId,
          quantity: delta,
          unitCost: movement.unitCost,
          value: movement.value,
          notes: item.notes ?? null
        })

        const accountKey = variant.product_type === 'raw' ? ACC.INVENTORY_RAW : ACC.INVENTORY_FINISHED
        valueByAccount.set(accountKey, (valueByAccount.get(accountKey) ?? 0) + movement.value)
        totalValue += movement.value
      })

      if (totalValue !== 0) {
        const counterKey = input.adjustmentType === 'opening' ? ACC.OPENING_BALANCE_EQUITY : ACC.INVENTORY_ADJUSTMENT
        const entryId = this.ledger.post({
          date: input.date,
          refType: 'adjustment',
          refId: adjustmentId,
          refNumber: adjustmentNumber,
          description: `تسوية مخزون ${adjustmentNumber} — ${input.reason ?? ''}`.trim(),
          lines: [
            ...[...valueByAccount.entries()].map(([key, value]) =>
              value >= 0 ? { accountKey: key, debit: value } : { accountKey: key, credit: -value }
            ),
            totalValue >= 0 ? { accountKey: counterKey, credit: totalValue } : { accountKey: counterKey, debit: -totalValue }
          ]
        })
        this.db.prepare('UPDATE stock_adjustments SET journal_entry_id = ?, total_value = ? WHERE id = ?').run(entryId, totalValue, adjustmentId)
      }

      return { adjustmentId, adjustmentNumber }
    })

    const result = run.immediate()
    this.audit.log({
      action: 'create',
      entityType: 'stock_adjustment',
      entityId: result.adjustmentId,
      entityLabel: result.adjustmentNumber,
      newValue: { type: input.adjustmentType, items: input.items.length },
      reason: input.reason ?? null,
      severity: 'warning'
    })
    return { id: result.adjustmentId, adjustmentNumber: result.adjustmentNumber }
  }

  voidAdjustment(id: number, reason: string): void {
    const adj = this.db.prepare('SELECT * FROM stock_adjustments WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!adj) throw ERRORS.notFound('التسوية')
    if (adj.status === 'void') throw ERRORS.conflict('التسوية ملغاة بالفعل.')
    const date = todayIso()

    const run = this.db.transaction(() => {
      const items = this.db.prepare('SELECT * FROM stock_adjustment_items WHERE adjustment_id = ?').all(id) as Record<string, unknown>[]
      for (const item of items) {
        this.inventory.adjust({
          date,
          variantId: item.variant_id as number,
          warehouseId: adj.warehouse_id as number,
          quantity: -(item.quantity as number),
          unitCost: item.unit_cost as number,
          refType: 'stock_adjustment_void',
          refId: id,
          refNumber: String(adj.adjustment_number),
          notes: reason
        })
      }
      if (adj.journal_entry_id) this.ledger.reverse(adj.journal_entry_id as number, date, `إلغاء تسوية ${adj.adjustment_number}: ${reason}`)
      this.db.prepare("UPDATE stock_adjustments SET status = 'void' WHERE id = ?").run(id)
    })
    run.immediate()
    this.audit.log({ action: 'void', entityType: 'stock_adjustment', entityId: id, reason, severity: 'critical' })
  }

  listAdjustments(filters: { from?: string; to?: string; warehouseId?: number; type?: string } = {}): Record<string, unknown>[] {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.from) { where.push('a.date >= @from'); params.from = filters.from }
    if (filters.to) { where.push('a.date <= @to'); params.to = filters.to }
    if (filters.warehouseId) { where.push('a.warehouse_id = @warehouseId'); params.warehouseId = filters.warehouseId }
    if (filters.type) { where.push('a.adjustment_type = @type'); params.type = filters.type }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return this.db
      .prepare(
        `SELECT a.*, w.name AS warehouse_name, u.full_name AS created_by_name,
                (SELECT COUNT(*) FROM stock_adjustment_items i WHERE i.adjustment_id = a.id) AS item_count
         FROM stock_adjustments a JOIN warehouses w ON w.id = a.warehouse_id
         LEFT JOIN users u ON u.id = a.created_by
         ${clause} ORDER BY a.date DESC, a.id DESC LIMIT 500`
      )
      .all(params) as Record<string, unknown>[]
  }

  getAdjustment(id: number): Record<string, unknown> {
    const adj = this.db
      .prepare(
        `SELECT a.*, w.name AS warehouse_name, u.full_name AS created_by_name
         FROM stock_adjustments a JOIN warehouses w ON w.id = a.warehouse_id
         LEFT JOIN users u ON u.id = a.created_by WHERE a.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    if (!adj) throw ERRORS.notFound('التسوية')
    const items = this.db
      .prepare(
        `SELECT i.*, p.name AS product_name, v.sku, v.size, v.color, p.unit
         FROM stock_adjustment_items i JOIN product_variants v ON v.id = i.variant_id
         JOIN products p ON p.id = v.product_id WHERE i.adjustment_id = ? ORDER BY i.line_no`
      )
      .all(id) as Record<string, unknown>[]
    return { ...adj, items }
  }

  createTransfer(input: TransferInput): { id: number; transferNumber: string } {
    if (input.fromWarehouseId === input.toWarehouseId) throw ERRORS.validation('لا يمكن التحويل إلى نفس المخزن.')
    if (!input.items?.length) throw ERRORS.validation('يجب إضافة صنف واحد على الأقل.')

    const run = this.db.transaction(() => {
      const transferNumber = this.numbering.next('stock_transfer', new Date(input.date))
      const info = this.db
        .prepare(
          `INSERT INTO stock_transfers (transfer_number, date, from_warehouse_id, to_warehouse_id, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(transferNumber, input.date, input.fromWarehouseId, input.toWarehouseId, input.notes ?? null, actorId(this.ctx))
      const transferId = Number(info.lastInsertRowid)

      const insertItem = this.db.prepare(
        'INSERT INTO stock_transfer_items (transfer_id, line_no, variant_id, quantity, unit_cost) VALUES (?, ?, ?, ?, ?)'
      )
      input.items.forEach((item, index) => {
        const out = this.inventory.issue({
          date: input.date,
          variantId: item.variantId,
          warehouseId: input.fromWarehouseId,
          quantity: item.quantity,
          movementType: 'transfer_out',
          refType: 'stock_transfer',
          refId: transferId,
          refNumber: transferNumber
        })
        this.inventory.receive({
          date: input.date,
          variantId: item.variantId,
          warehouseId: input.toWarehouseId,
          quantity: item.quantity,
          unitCost: out.unitCost,
          movementType: 'transfer_in',
          refType: 'stock_transfer',
          refId: transferId,
          refNumber: transferNumber
        })
        insertItem.run(transferId, index + 1, item.variantId, normalizeQty(item.quantity), out.unitCost)
      })
      return { transferId, transferNumber }
    })

    const result = run.immediate()
    this.audit.log({ action: 'create', entityType: 'stock_transfer', entityId: result.transferId, entityLabel: result.transferNumber })
    return { id: result.transferId, transferNumber: result.transferNumber }
  }

  listTransfers(filters: { from?: string; to?: string } = {}): Record<string, unknown>[] {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.from) { where.push('t.date >= @from'); params.from = filters.from }
    if (filters.to) { where.push('t.date <= @to'); params.to = filters.to }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return this.db
      .prepare(
        `SELECT t.*, wf.name AS from_warehouse_name, wt.name AS to_warehouse_name,
                (SELECT COUNT(*) FROM stock_transfer_items i WHERE i.transfer_id = t.id) AS item_count
         FROM stock_transfers t JOIN warehouses wf ON wf.id = t.from_warehouse_id
         JOIN warehouses wt ON wt.id = t.to_warehouse_id
         ${clause} ORDER BY t.date DESC, t.id DESC LIMIT 500`
      )
      .all(params) as Record<string, unknown>[]
  }
}
