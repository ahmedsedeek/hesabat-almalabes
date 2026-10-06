import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'
import { lineAmount, type Rate } from '@shared/money'
import type { ProductType } from '@shared/types'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { AuditService } from './audit.service'

export interface VariantInput {
  id?: number
  sku?: string
  size?: string | null
  color?: string | null
  barcode?: string | null
  purchasePrice?: Rate
  salePrice?: Rate
  minStock?: number
  isActive?: boolean
}

export interface ProductInput {
  sku?: string
  name: string
  productType?: ProductType
  categoryId?: number | null
  brand?: string | null
  unit?: string
  description?: string | null
  imagePath?: string | null
  trackInventory?: boolean
  notes?: string | null
  isActive?: boolean
  variants?: VariantInput[]
}

export interface ProductFilters {
  search?: string
  categoryId?: number
  productType?: ProductType
  activeOnly?: boolean
  page?: number
  pageSize?: number
}

/** المنتجات ومتغيّراتها (مقاس × لون). كل منتج له متغيّر افتراضي واحد على الأقل. */
export class ProductService {
  private readonly db: Database
  private readonly audit: AuditService

  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db
    this.audit = new AuditService(ctx)
  }

  // ------------------------- التصنيفات -------------------------

  listCategories(): { id: number; name: string; parentId: number | null; productCount: number }[] {
    return this.db
      .prepare(
        `SELECT c.id, c.name, c.parent_id AS parentId,
                (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS productCount
         FROM product_categories c ORDER BY c.name`
      )
      .all() as { id: number; name: string; parentId: number | null; productCount: number }[]
  }

  createCategory(name: string, parentId?: number | null): number {
    if (!name.trim()) throw ERRORS.validation('اسم التصنيف مطلوب.', 'name')
    const exists = this.db.prepare('SELECT id FROM product_categories WHERE name = ?').get(name.trim())
    if (exists) throw ERRORS.conflict('يوجد تصنيف بنفس الاسم.')
    const info = this.db
      .prepare('INSERT INTO product_categories (name, parent_id) VALUES (?, ?)')
      .run(name.trim(), parentId ?? null)
    return Number(info.lastInsertRowid)
  }

  updateCategory(id: number, name: string): void {
    if (!name.trim()) throw ERRORS.validation('اسم التصنيف مطلوب.', 'name')
    this.db.prepare('UPDATE product_categories SET name = ? WHERE id = ?').run(name.trim(), id)
  }

  deleteCategory(id: number): void {
    const used = this.db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(id) as { n: number }
    if (used.n > 0) throw ERRORS.conflict('لا يمكن حذف تصنيف مرتبط بمنتجات.')
    this.db.prepare('DELETE FROM product_categories WHERE id = ?').run(id)
  }

  // ------------------------- المنتجات -------------------------

  nextSku(productType: ProductType): string {
    const prefix = productType === 'raw' ? 'RM' : productType === 'service' ? 'SV' : 'PR'
    const row = this.db
      .prepare(`SELECT sku FROM products WHERE sku GLOB ? ORDER BY LENGTH(sku) DESC, sku DESC LIMIT 1`)
      .get(`${prefix}[0-9]*`) as { sku: string } | undefined
    const last = row ? Number(row.sku.slice(prefix.length)) : 0
    return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(5, '0')}`
  }

  get(id: number): Record<string, unknown> {
    const product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!product) throw ERRORS.notFound('المنتج')
    const variants = this.db
      .prepare(
        `SELECT v.*, COALESCE((SELECT SUM(quantity) FROM stock_levels s WHERE s.variant_id = v.id), 0) AS stock
         FROM product_variants v WHERE v.product_id = ? ORDER BY v.id`
      )
      .all(id) as Record<string, unknown>[]
    return { ...product, variants }
  }

  list(filters: ProductFilters = {}): { rows: Record<string, unknown>[]; total: number } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.search) {
      where.push('(p.name LIKE @search OR p.sku LIKE @search OR p.brand LIKE @search OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.sku LIKE @search OR v.barcode LIKE @search)))')
      params.search = `%${filters.search}%`
    }
    if (filters.categoryId) { where.push('p.category_id = @categoryId'); params.categoryId = filters.categoryId }
    if (filters.productType) { where.push('p.product_type = @productType'); params.productType = filters.productType }
    if (filters.activeOnly) where.push('p.is_active = 1')
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 50))

    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM products p ${clause}`).get(params) as { n: number }).n
    const rows = this.db
      .prepare(
        `SELECT p.*, c.name AS category_name,
                (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
                COALESCE((SELECT SUM(s.quantity) FROM stock_levels s
                          JOIN product_variants v ON v.id = s.variant_id WHERE v.product_id = p.id), 0) AS stock,
                COALESCE((SELECT AVG(v.sale_price) FROM product_variants v WHERE v.product_id = p.id), 0) AS avg_sale_price,
                COALESCE((SELECT AVG(v.avg_cost) FROM product_variants v WHERE v.product_id = p.id), 0) AS avg_cost
         FROM products p LEFT JOIN product_categories c ON c.id = p.category_id
         ${clause} ORDER BY p.name LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[]
    return { rows, total }
  }

  /** بحث سريع على مستوى المتغيّرات — المستخدم في شاشات الفواتير */
  searchVariants(term: string, options: { warehouseId?: number; productType?: ProductType; limit?: number } = {}): {
    variantId: number
    productId: number
    sku: string
    name: string
    size: string | null
    color: string | null
    unit: string
    salePrice: number
    purchasePrice: number
    avgCost: number
    stock: number
  }[] {
    const params: Record<string, unknown> = { t: `%${term}%`, limit: options.limit ?? 25 }
    const typeClause = options.productType ? 'AND p.product_type = @productType' : ''
    if (options.productType) params.productType = options.productType
    const stockExpr = options.warehouseId
      ? 'COALESCE((SELECT s.quantity FROM stock_levels s WHERE s.variant_id = v.id AND s.warehouse_id = @warehouseId), 0)'
      : 'COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.variant_id = v.id), 0)'
    if (options.warehouseId) params.warehouseId = options.warehouseId

    return this.db
      .prepare(
        `SELECT v.id AS variantId, p.id AS productId, v.sku, p.name, v.size, v.color, p.unit,
                v.sale_price AS salePrice, v.purchase_price AS purchasePrice, v.avg_cost AS avgCost,
                ${stockExpr} AS stock
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.is_active = 1 AND p.is_active = 1 ${typeClause}
           AND (p.name LIKE @t OR v.sku LIKE @t OR v.barcode LIKE @t OR p.sku LIKE @t OR p.brand LIKE @t)
         ORDER BY p.name, v.size, v.color LIMIT @limit`
      )
      .all(params) as never
  }

  create(input: ProductInput): number {
    const name = input.name?.trim()
    if (!name) throw ERRORS.validation('اسم المنتج مطلوب.', 'name')
    const productType = input.productType ?? 'finished'
    const sku = (input.sku?.trim() || this.nextSku(productType)).toUpperCase()
    if (this.db.prepare('SELECT id FROM products WHERE sku = ?').get(sku)) {
      throw ERRORS.conflict(`كود المنتج «${sku}» مستخدم بالفعل.`)
    }

    const variants = input.variants?.length ? input.variants : [{ size: null, color: null }]

    const run = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO products (sku, name, product_type, category_id, brand, unit, description, image_path,
                                 track_inventory, has_variants, is_active, notes, created_by)
           VALUES (@sku, @name, @productType, @categoryId, @brand, @unit, @description, @imagePath,
                   @trackInventory, @hasVariants, @isActive, @notes, @createdBy)`
        )
        .run({
          sku,
          name,
          productType,
          categoryId: input.categoryId ?? null,
          brand: input.brand ?? null,
          unit: input.unit?.trim() || 'قطعة',
          description: input.description ?? null,
          imagePath: input.imagePath ?? null,
          trackInventory: input.trackInventory === false || productType === 'service' ? 0 : 1,
          hasVariants: variants.length > 1 ? 1 : 0,
          isActive: input.isActive === false ? 0 : 1,
          notes: input.notes ?? null,
          createdBy: actorId(this.ctx)
        })
      const productId = Number(info.lastInsertRowid)
      variants.forEach((v, index) => this.insertVariant(productId, sku, v, index, variants.length === 1))
      return productId
    })
    const id = run.immediate()
    this.audit.log({ action: 'create', entityType: 'product', entityId: id, entityLabel: `${sku} - ${name}`, newValue: input })
    return id
  }

  private insertVariant(productId: number, productSku: string, v: VariantInput, index: number, isDefault: boolean): number {
    const suffix = [v.size, v.color].filter(Boolean).join('-') || String(index + 1)
    let sku = (v.sku?.trim() || `${productSku}-${suffix}`).toUpperCase()
    // ضمان التفرّد حتى عند تكرار التركيبات
    let attempt = 1
    while (this.db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(sku)) {
      sku = `${productSku}-${suffix}-${++attempt}`.toUpperCase()
    }
    const info = this.db
      .prepare(
        `INSERT INTO product_variants (product_id, sku, size, color, barcode, purchase_price, sale_price, min_stock, is_active, is_default)
         VALUES (@productId, @sku, @size, @color, @barcode, @purchasePrice, @salePrice, @minStock, @isActive, @isDefault)`
      )
      .run({
        productId,
        sku,
        size: v.size ?? null,
        color: v.color ?? null,
        barcode: v.barcode?.trim() || null,
        purchasePrice: Math.round(v.purchasePrice ?? 0),
        salePrice: Math.round(v.salePrice ?? 0),
        minStock: v.minStock ?? 0,
        isActive: v.isActive === false ? 0 : 1,
        isDefault: isDefault || index === 0 ? 1 : 0
      })
    return Number(info.lastInsertRowid)
  }

  update(id: number, input: ProductInput): void {
    const current = this.get(id)
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE products SET
             name = COALESCE(@name, name), product_type = COALESCE(@productType, product_type),
             category_id = @categoryId, brand = @brand, unit = COALESCE(@unit, unit),
             description = @description, image_path = @imagePath,
             track_inventory = COALESCE(@trackInventory, track_inventory),
             is_active = COALESCE(@isActive, is_active), notes = @notes,
             updated_at = datetime('now')
           WHERE id = @id`
        )
        .run({
          id,
          name: input.name?.trim() ?? null,
          productType: input.productType ?? null,
          categoryId: input.categoryId ?? null,
          brand: input.brand ?? null,
          unit: input.unit?.trim() ?? null,
          description: input.description ?? null,
          imagePath: input.imagePath ?? (current.image_path as string | null),
          trackInventory: input.trackInventory === undefined ? null : input.trackInventory ? 1 : 0,
          isActive: input.isActive === undefined ? null : input.isActive ? 1 : 0,
          notes: input.notes ?? null
        })

      if (input.variants) {
        const productSku = String(current.sku)
        const keepIds: number[] = []
        input.variants.forEach((v, index) => {
          if (v.id) {
            this.db
              .prepare(
                `UPDATE product_variants SET size = @size, color = @color, barcode = @barcode,
                   purchase_price = @purchasePrice, sale_price = @salePrice, min_stock = @minStock,
                   is_active = @isActive, updated_at = datetime('now')
                 WHERE id = @id AND product_id = @productId`
              )
              .run({
                id: v.id,
                productId: id,
                size: v.size ?? null,
                color: v.color ?? null,
                barcode: v.barcode?.trim() || null,
                purchasePrice: Math.round(v.purchasePrice ?? 0),
                salePrice: Math.round(v.salePrice ?? 0),
                minStock: v.minStock ?? 0,
                isActive: v.isActive === false ? 0 : 1
              })
            keepIds.push(v.id)
          } else {
            keepIds.push(this.insertVariant(id, productSku, v, index, false))
          }
        })
        // المتغيّرات المحذوفة من الواجهة تُعطَّل فقط إذا كان لها حركة مخزون
        const existing = this.db.prepare('SELECT id FROM product_variants WHERE product_id = ?').all(id) as { id: number }[]
        for (const row of existing) {
          if (keepIds.includes(row.id)) continue
          const used = this.db.prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE variant_id = ?').get(row.id) as { n: number }
          if (used.n > 0) this.db.prepare('UPDATE product_variants SET is_active = 0 WHERE id = ?').run(row.id)
          else this.db.prepare('DELETE FROM product_variants WHERE id = ?').run(row.id)
        }
        this.db.prepare('UPDATE products SET has_variants = ? WHERE id = ?').run(input.variants.length > 1 ? 1 : 0, id)
      }
    })
    run.immediate()
    this.audit.log({ action: 'update', entityType: 'product', entityId: id, entityLabel: String(current.name), oldValue: current, newValue: input })
  }

  remove(id: number): void {
    const product = this.get(id)
    const used = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM stock_movements m
         JOIN product_variants v ON v.id = m.variant_id WHERE v.product_id = ?`
      )
      .get(id) as { n: number }
    if (used.n > 0) throw ERRORS.conflict('لا يمكن حذف منتج له حركات مخزون. يمكنك تعطيله بدلًا من ذلك.')
    this.db.prepare('DELETE FROM products WHERE id = ?').run(id)
    this.audit.log({ action: 'delete', entityType: 'product', entityId: id, entityLabel: String(product.name), oldValue: product, severity: 'warning' })
  }

  /** توليد تركيبات المقاسات والألوان — أداة مساعدة لشاشة إنشاء المنتج */
  static buildVariantMatrix(sizes: string[], colors: string[], base: Partial<VariantInput> = {}): VariantInput[] {
    const s = sizes.length ? sizes : [null as unknown as string]
    const c = colors.length ? colors : [null as unknown as string]
    const out: VariantInput[] = []
    for (const size of s) for (const color of c) out.push({ ...base, size: size ?? null, color: color ?? null })
    return out
  }

  /** قيمة المخزون لمنتج واحد بكل متغيّراته */
  productStockValue(productId: number): number {
    const rows = this.db
      .prepare(
        `SELECT COALESCE(SUM(s.quantity),0) AS q, v.avg_cost AS cost
         FROM product_variants v LEFT JOIN stock_levels s ON s.variant_id = v.id
         WHERE v.product_id = ? GROUP BY v.id`
      )
      .all(productId) as { q: number; cost: number }[]
    return rows.reduce((sum, r) => sum + lineAmount(r.q, r.cost), 0)
  }
}
