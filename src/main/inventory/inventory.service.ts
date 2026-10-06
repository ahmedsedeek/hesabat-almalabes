import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'
import { lineAmount, normalizeQty, qtyGreater, rateFromAmount, type Minor, type Rate } from '@shared/money'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { SettingsService } from '../services/settings.service'

export type MovementType =
  | 'purchase' | 'purchase_return' | 'sale' | 'sale_return' | 'adjustment'
  | 'transfer_in' | 'transfer_out' | 'production_issue' | 'production_receipt'
  | 'production_return' | 'opening' | 'damage'

export interface MovementRef {
  refType: string
  refId?: number | null
  refNumber?: string | null
  notes?: string | null
}

export interface ReceiveInput extends MovementRef {
  date: string
  variantId: number
  warehouseId: number
  quantity: number
  /** تكلفة الوحدة بمقياس 10000 */
  unitCost: Rate
  movementType: MovementType
}

export interface IssueInput extends MovementRef {
  date: string
  variantId: number
  warehouseId: number
  quantity: number
  movementType: MovementType
  /** لتحديد تكلفة معيّنة بدلًا من المتوسط الحالي (مثل عكس حركة سابقة) */
  unitCostOverride?: Rate
  /** السماح بتجاوز فحص الرصيد (تسويات الجرد) */
  allowNegative?: boolean
}

export interface MovementResult {
  movementId: number
  quantity: number
  unitCost: Rate
  /** قيمة الحركة بالوحدة الصغرى — موجبة للإدخال وسالبة للإخراج */
  value: Minor
  balanceAfter: number
  avgCostAfter: Rate
}

interface VariantRow {
  id: number
  product_id: number
  sku: string
  avg_cost: number
  name: string
  product_type: 'finished' | 'raw' | 'service'
  track_inventory: number
  size: string | null
  color: string | null
}

/**
 * المخزون الدائم بطريقة المتوسط المرجَّح المتحرك.
 * - الكمية تُتابَع على مستوى (المتغيّر × المخزن).
 * - التكلفة تُتابَع كمتوسط واحد لكل متغيّر على مستوى الشركة (الطريقة المعتادة في تجارة الملابس).
 * - كل تغيير في الرصيد يُنتج سجل حركة دائم لا يُحذف؛ العكس يتم بحركة مضادة.
 */
export class InventoryService {
  private readonly db: Database
  private readonly settings: SettingsService

  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db
    this.settings = new SettingsService(ctx.db)
  }

  variant(variantId: number): VariantRow {
    const row = this.db
      .prepare(
        `SELECT v.id, v.product_id, v.sku, v.avg_cost, v.size, v.color,
                p.name, p.product_type, p.track_inventory
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = ?`
      )
      .get(variantId) as VariantRow | undefined
    if (!row) throw ERRORS.notFound('المنتج')
    return row
  }

  variantLabel(variantId: number): string {
    const v = this.variant(variantId)
    const attrs = [v.size, v.color].filter(Boolean).join(' / ')
    return attrs ? `${v.name} (${attrs})` : v.name
  }

  /** الرصيد في مخزن محدد */
  stockAt(variantId: number, warehouseId: number): number {
    const row = this.db
      .prepare('SELECT quantity FROM stock_levels WHERE variant_id = ? AND warehouse_id = ?')
      .get(variantId, warehouseId) as { quantity: number } | undefined
    return normalizeQty(row?.quantity ?? 0)
  }

  /** الرصيد الإجمالي في كل المخازن */
  totalStock(variantId: number): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM stock_levels WHERE variant_id = ?')
      .get(variantId) as { q: number }
    return normalizeQty(row.q)
  }

  avgCost(variantId: number): Rate {
    return this.variant(variantId).avg_cost
  }

  /** حساب المتوسط المرجَّح الجديد بعد إدخال كمية بتكلفة معيّنة */
  private recomputeAvgCost(variantId: number, incomingQty: number, incomingUnitCost: Rate): Rate {
    const current = this.variant(variantId)
    const onHand = this.totalStock(variantId)
    // إذا كان الرصيد صفرًا أو سالبًا، تُعتمد تكلفة الدفعة الجديدة مباشرة
    if (onHand <= 0) return incomingUnitCost
    const newQty = onHand + incomingQty
    if (newQty <= 0) return incomingUnitCost
    const currentValue = onHand * current.avg_cost
    const incomingValue = incomingQty * incomingUnitCost
    return Math.round((currentValue + incomingValue) / newQty)
  }

  private applyLevel(variantId: number, warehouseId: number, delta: number): number {
    this.db
      .prepare(
        `INSERT INTO stock_levels (variant_id, warehouse_id, quantity, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(variant_id, warehouse_id)
         DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = datetime('now')`
      )
      .run(variantId, warehouseId, delta)
    const after = this.stockAt(variantId, warehouseId)
    // تنظيف أخطاء الفاصلة العائمة المتراكمة
    this.db
      .prepare('UPDATE stock_levels SET quantity = ? WHERE variant_id = ? AND warehouse_id = ?')
      .run(after, variantId, warehouseId)
    return after
  }

  private insertMovement(params: {
    date: string
    variantId: number
    warehouseId: number
    movementType: MovementType
    qtyIn: number
    qtyOut: number
    unitCost: Rate
    value: Minor
    balanceAfter: number
    avgCostAfter: Rate
    ref: MovementRef
  }): number {
    const info = this.db
      .prepare(
        `INSERT INTO stock_movements
          (date, variant_id, warehouse_id, movement_type, qty_in, qty_out, unit_cost, value,
           balance_after, avg_cost_after, ref_type, ref_id, ref_number, notes, user_id)
         VALUES (@date, @variantId, @warehouseId, @movementType, @qtyIn, @qtyOut, @unitCost, @value,
                 @balanceAfter, @avgCostAfter, @refType, @refId, @refNumber, @notes, @userId)`
      )
      .run({
        date: params.date,
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        movementType: params.movementType,
        qtyIn: params.qtyIn,
        qtyOut: params.qtyOut,
        unitCost: params.unitCost,
        value: params.value,
        balanceAfter: params.balanceAfter,
        avgCostAfter: params.avgCostAfter,
        refType: params.ref.refType,
        refId: params.ref.refId ?? null,
        refNumber: params.ref.refNumber ?? null,
        notes: params.ref.notes ?? null,
        userId: actorId(this.ctx)
      })
    return Number(info.lastInsertRowid)
  }

  /** إدخال كمية للمخزون وتحديث المتوسط المرجَّح */
  receive(input: ReceiveInput): MovementResult {
    const quantity = normalizeQty(input.quantity)
    if (quantity <= 0) throw ERRORS.validation('كمية الإدخال يجب أن تكون أكبر من صفر.')
    const variant = this.variant(input.variantId)
    if (variant.track_inventory === 0) {
      return { movementId: 0, quantity, unitCost: input.unitCost, value: 0, balanceAfter: 0, avgCostAfter: 0 }
    }

    const avgCostAfter = this.recomputeAvgCost(input.variantId, quantity, input.unitCost)
    this.db.prepare("UPDATE product_variants SET avg_cost = ?, updated_at = datetime('now') WHERE id = ?")
      .run(avgCostAfter, input.variantId)

    const balanceAfter = this.applyLevel(input.variantId, input.warehouseId, quantity)
    const value = lineAmount(quantity, input.unitCost)
    const movementId = this.insertMovement({
      date: input.date,
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      movementType: input.movementType,
      qtyIn: quantity,
      qtyOut: 0,
      unitCost: input.unitCost,
      value,
      balanceAfter,
      avgCostAfter,
      ref: input
    })
    return { movementId, quantity, unitCost: input.unitCost, value, balanceAfter, avgCostAfter }
  }

  /** إخراج كمية من المخزون بتكلفة المتوسط الحالي */
  issue(input: IssueInput): MovementResult {
    const quantity = normalizeQty(input.quantity)
    if (quantity <= 0) throw ERRORS.validation('كمية الإخراج يجب أن تكون أكبر من صفر.')
    const variant = this.variant(input.variantId)
    if (variant.track_inventory === 0) {
      return { movementId: 0, quantity, unitCost: 0, value: 0, balanceAfter: 0, avgCostAfter: 0 }
    }

    const available = this.stockAt(input.variantId, input.warehouseId)
    const allowNegative = input.allowNegative || this.settings.getSection('inventory').allowNegativeStock
    if (!allowNegative && qtyGreater(quantity, available)) {
      throw ERRORS.insufficientStock(this.variantLabel(input.variantId), available, quantity)
    }

    const unitCost = input.unitCostOverride ?? variant.avg_cost
    const balanceAfter = this.applyLevel(input.variantId, input.warehouseId, -quantity)
    const value = -lineAmount(quantity, unitCost)
    const movementId = this.insertMovement({
      date: input.date,
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      movementType: input.movementType,
      qtyIn: 0,
      qtyOut: quantity,
      unitCost,
      value,
      balanceAfter,
      avgCostAfter: variant.avg_cost,
      ref: input
    })
    return { movementId, quantity, unitCost, value, balanceAfter, avgCostAfter: variant.avg_cost }
  }

  /** حركة تسوية: الكمية الموجبة زيادة والسالبة نقص */
  adjust(input: {
    date: string
    variantId: number
    warehouseId: number
    quantity: number
    unitCost?: Rate
    movementType?: MovementType
  } & MovementRef): MovementResult {
    const quantity = normalizeQty(input.quantity)
    if (quantity === 0) throw ERRORS.validation('كمية التسوية لا يمكن أن تكون صفرًا.')
    if (quantity > 0) {
      return this.receive({
        ...input,
        quantity,
        unitCost: input.unitCost ?? this.avgCost(input.variantId),
        movementType: input.movementType ?? 'adjustment'
      })
    }
    return this.issue({
      ...input,
      quantity: -quantity,
      movementType: input.movementType ?? 'adjustment',
      unitCostOverride: input.unitCost,
      allowNegative: true
    })
  }

  // ------------------------- استعلامات -------------------------

  /** قيمة المخزون الحالية = Σ (الكمية × متوسط التكلفة) */
  inventoryValue(warehouseId?: number): Minor {
    const rows = this.db
      .prepare(
        `SELECT sl.quantity AS q, v.avg_cost AS cost
         FROM stock_levels sl JOIN product_variants v ON v.id = sl.variant_id
         WHERE sl.quantity <> 0 AND (? IS NULL OR sl.warehouse_id = ?)`
      )
      .all(warehouseId ?? null, warehouseId ?? null) as { q: number; cost: number }[]
    return rows.reduce((sum, r) => sum + lineAmount(r.q, r.cost), 0)
  }

  /** قيمة المخزون في تاريخ سابق — مُشتقّة من قيم الحركات التاريخية */
  inventoryValueAsOf(date: string): Minor {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(value),0) AS v FROM stock_movements WHERE date <= ?')
      .get(date) as { v: number }
    return row.v
  }

  stockList(filters: { warehouseId?: number; search?: string; lowOnly?: boolean; productType?: string } = {}): {
    variantId: number
    productId: number
    sku: string
    name: string
    size: string | null
    color: string | null
    unit: string
    productType: string
    quantity: number
    avgCost: number
    value: number
    minStock: number
    isLow: number
  }[] {
    const where: string[] = ['v.is_active = 1', 'p.track_inventory = 1']
    const params: Record<string, unknown> = {}
    if (filters.search) {
      where.push('(p.name LIKE @search OR v.sku LIKE @search OR v.barcode LIKE @search OR p.sku LIKE @search)')
      params.search = `%${filters.search}%`
    }
    if (filters.productType) { where.push('p.product_type = @productType'); params.productType = filters.productType }

    const levelJoin = filters.warehouseId
      ? 'LEFT JOIN stock_levels sl ON sl.variant_id = v.id AND sl.warehouse_id = @warehouseId'
      : 'LEFT JOIN (SELECT variant_id, SUM(quantity) AS quantity FROM stock_levels GROUP BY variant_id) sl ON sl.variant_id = v.id'
    if (filters.warehouseId) params.warehouseId = filters.warehouseId

    const rows = this.db
      .prepare(
        `SELECT v.id AS variantId, p.id AS productId, v.sku, p.name, v.size, v.color, p.unit,
                p.product_type AS productType,
                COALESCE(sl.quantity, 0) AS quantity, v.avg_cost AS avgCost, v.min_stock AS minStock
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         ${levelJoin}
         WHERE ${where.join(' AND ')}
         ORDER BY p.name, v.size, v.color`
      )
      .all(params) as { variantId: number; productId: number; sku: string; name: string; size: string | null; color: string | null; unit: string; productType: string; quantity: number; avgCost: number; minStock: number }[]

    return rows
      .map((r) => ({
        ...r,
        quantity: normalizeQty(r.quantity),
        value: lineAmount(r.quantity, r.avgCost),
        isLow: r.minStock > 0 && r.quantity <= r.minStock ? 1 : 0
      }))
      .filter((r) => (filters.lowOnly ? r.isLow === 1 : true))
  }

  movements(filters: {
    variantId?: number
    warehouseId?: number
    from?: string
    to?: string
    movementType?: string
    refType?: string
    page?: number
    pageSize?: number
  } = {}): { rows: Record<string, unknown>[]; total: number } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.variantId) { where.push('m.variant_id = @variantId'); params.variantId = filters.variantId }
    if (filters.warehouseId) { where.push('m.warehouse_id = @warehouseId'); params.warehouseId = filters.warehouseId }
    if (filters.from) { where.push('m.date >= @from'); params.from = filters.from }
    if (filters.to) { where.push('m.date <= @to'); params.to = filters.to }
    if (filters.movementType) { where.push('m.movement_type = @movementType'); params.movementType = filters.movementType }
    if (filters.refType) { where.push('m.ref_type = @refType'); params.refType = filters.refType }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(1000, Math.max(1, filters.pageSize ?? 100))

    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM stock_movements m ${clause}`).get(params) as { n: number }).n
    const rows = this.db
      .prepare(
        `SELECT m.*, p.name AS product_name, v.sku, v.size, v.color, w.name AS warehouse_name, u.full_name AS user_name
         FROM stock_movements m
         JOIN product_variants v ON v.id = m.variant_id
         JOIN products p ON p.id = v.product_id
         JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN users u ON u.id = m.user_id
         ${clause}
         ORDER BY m.date DESC, m.id DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[]
    return { rows, total }
  }

  /** المنتجات التي بلغت أو تجاوزت حد إعادة الطلب */
  lowStock(): { variantId: number; name: string; sku: string; quantity: number; minStock: number }[] {
    return this.stockList({ lowOnly: true }).map((r) => ({
      variantId: r.variantId,
      name: [r.name, [r.size, r.color].filter(Boolean).join('/')].filter(Boolean).join(' - '),
      sku: r.sku,
      quantity: r.quantity,
      minStock: r.minStock
    }))
  }

  /** حساب تكلفة الوحدة من مبلغ إجمالي وكمية */
  static unitCostOf(totalValue: Minor, quantity: number): Rate {
    return rateFromAmount(totalValue, quantity)
  }
}
