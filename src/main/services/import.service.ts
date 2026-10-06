import { isoDate, todayIso } from '@shared/date'
import fs from 'node:fs'
import ExcelJS from 'exceljs'
import { AppError, ERRORS } from '@shared/errors'
import { toMinor, toRate } from '@shared/money'
import type { Ctx } from '../core/context'
import { PartyService } from './party.service'
import { ProductService } from './product.service'
import { StockService } from './stock.service'
import { SalesService } from './sales.service'
import { AuditService } from './audit.service'

export type ImportEntity = 'customers' | 'suppliers' | 'factories' | 'products' | 'opening_stock' | 'sales'

export interface ColumnSpec {
  key: string
  label: string
  required?: boolean
  type?: 'text' | 'number' | 'date'
  hint?: string
}

export interface ImportPreviewRow {
  rowNumber: number
  values: Record<string, string>
  errors: string[]
  warnings: string[]
  valid: boolean
}

export interface ImportPreview {
  entity: ImportEntity
  columns: ColumnSpec[]
  detectedHeaders: string[]
  mapping: Record<string, string>
  rows: ImportPreviewRow[]
  validCount: number
  errorCount: number
}

/** الأعمدة المتوقعة لكل نوع استيراد — بأسماء عربية مألوفة للمستخدم */
export const IMPORT_SCHEMAS: Record<ImportEntity, { title: string; columns: ColumnSpec[] }> = {
  customers: {
    title: 'العملاء',
    columns: [
      { key: 'name', label: 'الاسم', required: true },
      { key: 'code', label: 'الكود' },
      { key: 'companyName', label: 'اسم الشركة' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'whatsapp', label: 'واتساب' },
      { key: 'email', label: 'البريد الإلكتروني' },
      { key: 'address', label: 'العنوان' },
      { key: 'city', label: 'المدينة' },
      { key: 'taxNumber', label: 'الرقم الضريبي' },
      { key: 'openingBalance', label: 'الرصيد الافتتاحي', type: 'number', hint: 'موجب = مستحق على العميل' },
      { key: 'openingDate', label: 'تاريخ الرصيد الافتتاحي', type: 'date' },
      { key: 'creditLimit', label: 'حد الائتمان', type: 'number' },
      { key: 'notes', label: 'ملاحظات' }
    ]
  },
  suppliers: {
    title: 'الموردون',
    columns: [
      { key: 'name', label: 'الاسم', required: true },
      { key: 'code', label: 'الكود' },
      { key: 'companyName', label: 'اسم الشركة' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'whatsapp', label: 'واتساب' },
      { key: 'email', label: 'البريد الإلكتروني' },
      { key: 'address', label: 'العنوان' },
      { key: 'taxNumber', label: 'الرقم الضريبي' },
      { key: 'openingBalance', label: 'الرصيد الافتتاحي', type: 'number', hint: 'موجب = مستحق للمورد' },
      { key: 'openingDate', label: 'تاريخ الرصيد الافتتاحي', type: 'date' },
      { key: 'notes', label: 'ملاحظات' }
    ]
  },
  factories: {
    title: 'المصانع',
    columns: [
      { key: 'name', label: 'الاسم', required: true },
      { key: 'code', label: 'الكود' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'address', label: 'العنوان' },
      { key: 'contactPerson', label: 'مسؤول التواصل' },
      { key: 'openingBalance', label: 'الرصيد الافتتاحي', type: 'number' },
      { key: 'openingDate', label: 'تاريخ الرصيد الافتتاحي', type: 'date' },
      { key: 'notes', label: 'ملاحظات' }
    ]
  },
  products: {
    title: 'المنتجات',
    columns: [
      { key: 'name', label: 'اسم المنتج', required: true },
      { key: 'sku', label: 'كود المنتج' },
      { key: 'productType', label: 'النوع', hint: 'جاهز / خام / خدمة' },
      { key: 'category', label: 'التصنيف' },
      { key: 'brand', label: 'الماركة' },
      { key: 'unit', label: 'الوحدة' },
      { key: 'size', label: 'المقاس' },
      { key: 'color', label: 'اللون' },
      { key: 'barcode', label: 'الباركود' },
      { key: 'purchasePrice', label: 'سعر الشراء', type: 'number' },
      { key: 'salePrice', label: 'سعر البيع', type: 'number' },
      { key: 'minStock', label: 'حد إعادة الطلب', type: 'number' }
    ]
  },
  opening_stock: {
    title: 'أرصدة المخزون الافتتاحية',
    columns: [
      { key: 'sku', label: 'كود الصنف', required: true },
      { key: 'quantity', label: 'الكمية', required: true, type: 'number' },
      { key: 'unitCost', label: 'تكلفة الوحدة', required: true, type: 'number' },
      { key: 'warehouse', label: 'المخزن' }
    ]
  },
  sales: {
    title: 'فواتير البيع',
    columns: [
      { key: 'invoiceNumber', label: 'رقم الفاتورة', required: true, hint: 'كرّر الرقم في كل سطر من نفس الفاتورة' },
      { key: 'date', label: 'التاريخ', required: true, type: 'date' },
      { key: 'customer', label: 'العميل', hint: 'الاسم أو الكود — يُنشأ تلقائيًا إن لم يوجد' },
      { key: 'customerPhone', label: 'هاتف العميل' },
      { key: 'channel', label: 'قناة البيع', hint: 'جملة / تجزئة / أونلاين' },
      { key: 'sku', label: 'كود الصنف', required: true },
      { key: 'quantity', label: 'الكمية', required: true, type: 'number' },
      { key: 'unitPrice', label: 'سعر الوحدة', required: true, type: 'number' },
      { key: 'discount', label: 'خصم السطر', type: 'number' },
      { key: 'taxRate', label: 'نسبة الضريبة٪', type: 'number' },
      { key: 'shippingCharged', label: 'الشحن المحصَّل من العميل', type: 'number', hint: 'مرة واحدة لكل فاتورة' },
      { key: 'deliveryCost', label: 'تكلفة التوصيل علينا', type: 'number', hint: 'مرة واحدة لكل فاتورة' },
      { key: 'paidAmount', label: 'المبلغ المحصَّل', type: 'number', hint: 'مرة واحدة لكل فاتورة' },
      { key: 'paymentMethod', label: 'طريقة الدفع' },
      { key: 'warehouse', label: 'المخزن' },
      { key: 'notes', label: 'ملاحظات' }
    ]
  }
}

const CHANNEL_MAP: Record<string, 'wholesale' | 'retail' | 'online'> = {
  جملة: 'wholesale', 'بيع جملة': 'wholesale', wholesale: 'wholesale',
  تجزئة: 'retail', 'بيع تجزئة': 'retail', retail: 'retail', 'محل': 'retail',
  أونلاين: 'online', اونلاين: 'online', 'اون لاين': 'online', online: 'online', 'متجر إلكتروني': 'online'
}

const PRODUCT_TYPE_MAP: Record<string, 'finished' | 'raw' | 'service'> = {
  جاهز: 'finished', 'بضاعة جاهزة': 'finished', منتج: 'finished', finished: 'finished',
  خام: 'raw', 'مواد خام': 'raw', خامة: 'raw', raw: 'raw',
  خدمة: 'service', service: 'service'
}

function parseNumber(value: string): number | null {
  if (!value?.trim()) return null
  // دعم الأرقام العربية والفواصل الألفية
  const normalized = value
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,\s]/g, '')
    .replace(/[٫]/g, '.')
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

function parseDate(value: string): string | null {
  if (!value?.trim()) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  const match = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (match) {
    const [, d, m, y] = match
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : isoDate(parsed)
}

/** قارئ CSV يدعم علامات الاقتباس والفواصل داخل النص */
export function parseCsv(content: string): string[][] {
  const text = content.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += char
    } else if (char === '"') inQuotes = true
    else if (char === ',' || char === ';' || char === '\t') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (char !== '\r') field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * استيراد البيانات من Excel أو CSV.
 * العملية على مرحلتين: معاينة وتحقق أولًا، ثم تنفيذ — ولا تُستورد أي بيانات غير صالحة.
 */
export class ImportService {
  constructor(private readonly ctx: Ctx) {}

  async readFile(filePath: string): Promise<string[][]> {
    if (!fs.existsSync(filePath)) throw ERRORS.notFound('الملف')
    const lower = filePath.toLowerCase()
    if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
      return parseCsv(fs.readFileSync(filePath, 'utf8'))
    }
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(filePath)
      const sheet = workbook.worksheets[0]
      if (!sheet) throw new AppError('IMPORT_FAILED', 'الملف لا يحتوي على أي ورقة بيانات.')
      const rows: string[][] = []
      sheet.eachRow((row) => {
        const values: string[] = []
        row.eachCell({ includeEmpty: true }, (cell) => {
          const v = cell.value
          if (v === null || v === undefined) values.push('')
          else if (typeof v === 'object' && 'text' in v) values.push(String((v as { text: string }).text))
          else if (v instanceof Date) values.push(isoDate(v))
          else if (typeof v === 'object' && 'result' in v) values.push(String((v as { result: unknown }).result ?? ''))
          else values.push(String(v))
        })
        if (values.some((c) => c.trim() !== '')) rows.push(values)
      })
      return rows
    }
    throw new AppError('IMPORT_FAILED', 'صيغة الملف غير مدعومة. استخدم ملف Excel أو CSV.')
  }

  /**
   * مطابقة تلقائية لعناوين الأعمدة مع الحقول المتوقعة.
   * المطابقة التامة أولًا ثم التقريبية، حتى لا يختطف عمود «الرصيد الافتتاحي»
   * عنوانَ «تاريخ الرصيد الافتتاحي» أو العكس.
   */
  private autoMap(entity: ImportEntity, headers: string[]): Record<string, string> {
    const spec = IMPORT_SCHEMAS[entity].columns
    const mapping: Record<string, string> = {}
    const usedHeaders = new Set<number>()
    const clean = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, ' ')

    // المرحلة الأولى: تطابق تام للاسم أو المفتاح
    headers.forEach((header, index) => {
      const value = clean(header)
      const match = spec.find((c) => clean(c.label) === value || c.key.toLowerCase() === value)
      if (match && mapping[match.key] === undefined) {
        mapping[match.key] = String(index)
        usedHeaders.add(index)
      }
    })

    // المرحلة الثانية: تطابق تقريبي، مع تفضيل أطول تسمية مطابقة لتفادي الالتباس
    headers.forEach((header, index) => {
      if (usedHeaders.has(index)) return
      const value = clean(header)
      const candidates = spec
        .filter((c) => mapping[c.key] === undefined && (value.includes(clean(c.label)) || clean(c.label).includes(value)))
        .sort((a, b) => b.label.length - a.label.length)
      const match = candidates[0]
      if (match) {
        mapping[match.key] = String(index)
        usedHeaders.add(index)
      }
    })

    return mapping
  }

  async preview(entity: ImportEntity, filePath: string, mappingOverride?: Record<string, string>): Promise<ImportPreview> {
    const raw = await this.readFile(filePath)
    if (raw.length < 2) throw new AppError('IMPORT_FAILED', 'الملف لا يحتوي على بيانات كافية (صف عناوين وصف بيانات على الأقل).')
    const headers = raw[0].map((h) => h.trim())
    const mapping = mappingOverride ?? this.autoMap(entity, headers)
    const columns = IMPORT_SCHEMAS[entity].columns

    const rows: ImportPreviewRow[] = raw.slice(1, 2001).map((cells, index) => {
      const values: Record<string, string> = {}
      for (const [key, colIndex] of Object.entries(mapping)) {
        values[key] = (cells[Number(colIndex)] ?? '').trim()
      }
      const errors: string[] = []
      const warnings: string[] = []
      for (const column of columns) {
        const value = values[column.key] ?? ''
        if (column.required && !value) errors.push(`«${column.label}» مطلوب.`)
        if (value && column.type === 'number' && parseNumber(value) === null) {
          errors.push(`«${column.label}» يجب أن يكون رقمًا.`)
        }
        if (value && column.type === 'date' && parseDate(value) === null) {
          warnings.push(`تعذّرت قراءة «${column.label}» كتاريخ، سيُستخدم تاريخ اليوم.`)
        }
      }
      if ((entity === 'opening_stock' || entity === 'sales') && values.sku) {
        const exists = this.ctx.db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(values.sku.toUpperCase())
        if (!exists) errors.push(`لا يوجد صنف بالكود «${values.sku}». استورد المنتجات أولًا.`)
      }
      if (entity === 'sales') {
        if (values.channel && !CHANNEL_MAP[values.channel.trim()]) {
          warnings.push('قناة البيع غير معروفة، ستُسجَّل «جملة».')
        }
        if (values.invoiceNumber) {
          const duplicate = this.ctx.db
            .prepare("SELECT id FROM sales WHERE invoice_number = ? AND status <> 'void'")
            .get(values.invoiceNumber.trim())
          if (duplicate) errors.push(`الفاتورة «${values.invoiceNumber}» مسجَّلة من قبل.`)
        }
        if (values.paymentMethod) {
          const method = this.ctx.db.prepare('SELECT id FROM payment_methods WHERE name = ?').get(values.paymentMethod.trim())
          if (!method) warnings.push('طريقة الدفع غير معروفة، ستُستخدم الطريقة الافتراضية.')
        }
      }
      return { rowNumber: index + 2, values, errors, warnings, valid: errors.length === 0 }
    })

    return {
      entity,
      columns,
      detectedHeaders: headers,
      mapping,
      rows,
      validCount: rows.filter((r) => r.valid).length,
      errorCount: rows.filter((r) => !r.valid).length
    }
  }

  /** تنفيذ الاستيراد — الصفوف غير الصالحة تُتخطّى ويُبلَّغ عنها */
  commit(entity: ImportEntity, rows: ImportPreviewRow[], options: { skipInvalid?: boolean } = {}): {
    imported: number
    skipped: number
    failures: { rowNumber: number; message: string }[]
  } {
    const valid = rows.filter((r) => r.valid)
    if (!options.skipInvalid && valid.length !== rows.length) {
      throw new AppError('IMPORT_FAILED', `يوجد ${rows.length - valid.length} صفًا غير صالح. صحّح الأخطاء أو فعّل «تخطّي الصفوف غير الصالحة».`)
    }

    const failures: { rowNumber: number; message: string }[] = []
    let imported = 0
    const parties = new PartyService(this.ctx)
    const products = new ProductService(this.ctx)
    const stock = new StockService(this.ctx)

    const openingStockItems: { variantId: number; quantity: number; unitCost: number; warehouseId: number }[] = []

    // فواتير البيع تُجمَّع أولًا حسب رقم الفاتورة ثم تُحفظ فاتورة واحدة لكل مجموعة
    if (entity === 'sales') {
      return this.commitSales(valid, rows.length - valid.length)
    }

    for (const row of valid) {
      try {
        const v = row.values
        if (entity === 'customers' || entity === 'suppliers' || entity === 'factories') {
          const partyType = entity === 'customers' ? 'customer' : entity === 'suppliers' ? 'supplier' : 'factory'
          parties.create({
            partyType,
            name: v.name,
            code: v.code || undefined,
            companyName: v.companyName || null,
            phone: v.phone || null,
            whatsapp: v.whatsapp || null,
            email: v.email || null,
            address: v.address || null,
            city: v.city || null,
            taxNumber: v.taxNumber || null,
            contactPerson: v.contactPerson || null,
            openingBalance: toMinor(parseNumber(v.openingBalance ?? '') ?? 0),
            openingDate: parseDate(v.openingDate ?? '') ?? todayIso(),
            creditLimit: toMinor(parseNumber(v.creditLimit ?? '') ?? 0),
            notes: v.notes || null
          })
        } else if (entity === 'products') {
          let categoryId: number | null = null
          if (v.category) {
            const existing = this.ctx.db.prepare('SELECT id FROM product_categories WHERE name = ?').get(v.category) as
              | { id: number }
              | undefined
            categoryId = existing?.id ?? products.createCategory(v.category)
          }
          products.create({
            name: v.name,
            sku: v.sku || undefined,
            productType: PRODUCT_TYPE_MAP[(v.productType ?? '').trim()] ?? 'finished',
            categoryId,
            brand: v.brand || null,
            unit: v.unit || 'قطعة',
            variants: [
              {
                size: v.size || null,
                color: v.color || null,
                barcode: v.barcode || null,
                purchasePrice: toRate(parseNumber(v.purchasePrice ?? '') ?? 0),
                salePrice: toRate(parseNumber(v.salePrice ?? '') ?? 0),
                minStock: parseNumber(v.minStock ?? '') ?? 0
              }
            ]
          })
        } else if (entity === 'opening_stock') {
          const variant = this.ctx.db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(v.sku.toUpperCase()) as
            | { id: number }
            | undefined
          if (!variant) throw ERRORS.notFound(`الصنف ${v.sku}`)
          const warehouse = v.warehouse
            ? (this.ctx.db.prepare('SELECT id FROM warehouses WHERE name = ? OR code = ?').get(v.warehouse, v.warehouse) as { id: number } | undefined)
            : (this.ctx.db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get() as { id: number })
          if (!warehouse) throw ERRORS.notFound(`المخزن ${v.warehouse}`)
          openingStockItems.push({
            variantId: variant.id,
            quantity: parseNumber(v.quantity) ?? 0,
            unitCost: toRate(parseNumber(v.unitCost) ?? 0),
            warehouseId: warehouse.id
          })
        }
        imported++
      } catch (error) {
        failures.push({
          rowNumber: row.rowNumber,
          message: error instanceof AppError ? error.userMessage : 'تعذّر استيراد هذا الصف.'
        })
      }
    }

    // أرصدة المخزون الافتتاحية تُسجَّل كتسوية واحدة لكل مخزن حتى يكون لها قيد محاسبي واحد واضح
    if (openingStockItems.length) {
      const byWarehouse = new Map<number, typeof openingStockItems>()
      for (const item of openingStockItems) {
        byWarehouse.set(item.warehouseId, [...(byWarehouse.get(item.warehouseId) ?? []), item])
      }
      for (const [warehouseId, items] of byWarehouse) {
        stock.createAdjustment({
          date: todayIso(),
          warehouseId,
          adjustmentType: 'opening',
          reason: 'أرصدة مخزون افتتاحية مستوردة',
          items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, unitCost: i.unitCost }))
        })
      }
    }

    new AuditService(this.ctx).log({
      action: 'import',
      entityType: entity,
      entityLabel: IMPORT_SCHEMAS[entity].title,
      newValue: { imported, failed: failures.length },
      severity: 'warning'
    })

    return { imported: imported - failures.length, skipped: rows.length - valid.length + failures.length, failures }
  }

  /**
   * استيراد فواتير البيع: كل سطر في الملف = سطر صنف، والأسطر التي تحمل نفس رقم الفاتورة
   * تُجمَّع في فاتورة واحدة. تُحفظ كل فاتورة عبر خدمة المبيعات نفسها،
   * فتُخصم من المخزون وتُحتسب تكلفتها ويُرحَّل قيدها تمامًا كالفاتورة المُدخلة يدويًا.
   */
  private commitSales(
    rows: ImportPreviewRow[],
    skipped: number
  ): { imported: number; skipped: number; failures: { rowNumber: number; message: string }[] } {
    const failures: { rowNumber: number; message: string }[] = []
    const parties = new PartyService(this.ctx)
    const sales = new SalesService(this.ctx)

    const defaultWarehouse = (this.ctx.db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get() as { id: number }).id
    const defaultMethod = (this.ctx.db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 ORDER BY sort_order LIMIT 1').get() as
      | { id: number }
      | undefined)?.id

    interface Grouped {
      invoiceNumber: string
      firstRow: number
      rowNumbers: number[]
      values: Record<string, string>
      items: { variantId: number; quantity: number; unitPrice: number; discountAmount: number; taxRate: number }[]
    }

    const groups = new Map<string, Grouped>()
    for (const row of rows) {
      const key = row.values.invoiceNumber.trim()
      let group = groups.get(key)
      if (!group) {
        group = { invoiceNumber: key, firstRow: row.rowNumber, rowNumbers: [], values: row.values, items: [] }
        groups.set(key, group)
      }
      group.rowNumbers.push(row.rowNumber)

      const variant = this.ctx.db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(row.values.sku.toUpperCase()) as
        | { id: number }
        | undefined
      if (!variant) {
        failures.push({ rowNumber: row.rowNumber, message: `الصنف «${row.values.sku}» غير موجود.` })
        continue
      }
      group.items.push({
        variantId: variant.id,
        quantity: parseNumber(row.values.quantity) ?? 0,
        unitPrice: toRate(parseNumber(row.values.unitPrice) ?? 0),
        discountAmount: toMinor(parseNumber(row.values.discount ?? '') ?? 0),
        taxRate: parseNumber(row.values.taxRate ?? '') ?? 0
      })
      // القيم على مستوى الفاتورة تُؤخذ من أول سطر يحملها
      for (const key2 of ['shippingCharged', 'deliveryCost', 'paidAmount', 'paymentMethod', 'customer', 'customerPhone', 'channel', 'warehouse', 'notes', 'date']) {
        if (!group.values[key2] && row.values[key2]) group.values[key2] = row.values[key2]
      }
    }

    let imported = 0
    for (const group of groups.values()) {
      if (!group.items.length) continue
      try {
        const customerName = group.values.customer?.trim() || 'عميل نقدي'
        let customer = this.ctx.db
          .prepare("SELECT id FROM parties WHERE party_type = 'customer' AND (name = ? OR code = ?)")
          .get(customerName, customerName.toUpperCase()) as { id: number } | undefined
        if (!customer) {
          customer = { id: parties.create({ partyType: 'customer', name: customerName, phone: group.values.customerPhone || null }) }
        }

        const warehouse = group.values.warehouse
          ? ((this.ctx.db.prepare('SELECT id FROM warehouses WHERE name = ? OR code = ?').get(group.values.warehouse, group.values.warehouse) as
              | { id: number }
              | undefined)?.id ?? defaultWarehouse)
          : defaultWarehouse

        const methodId = group.values.paymentMethod
          ? ((this.ctx.db.prepare('SELECT id FROM payment_methods WHERE name = ?').get(group.values.paymentMethod.trim()) as
              | { id: number }
              | undefined)?.id ?? defaultMethod)
          : defaultMethod

        const paid = toMinor(parseNumber(group.values.paidAmount ?? '') ?? 0)
        const deliveryCost = toMinor(parseNumber(group.values.deliveryCost ?? '') ?? 0)

        sales.create({
          date: parseDate(group.values.date) ?? todayIso(),
          customerId: customer.id,
          warehouseId: warehouse,
          saleChannel: CHANNEL_MAP[(group.values.channel ?? '').trim()] ?? 'wholesale',
          items: group.items,
          shippingAmount: toMinor(parseNumber(group.values.shippingCharged ?? '') ?? 0),
          deliveryCost,
          deliveryPaymentAccountId: deliveryCost > 0 ? this.cashAccountId() : null,
          notes: group.values.notes || null,
          invoiceNumber: group.invoiceNumber,
          payment: paid > 0 && methodId ? { amount: paid, methodId } : undefined
        })
        imported++
      } catch (error) {
        failures.push({
          rowNumber: group.firstRow,
          message: `الفاتورة ${group.invoiceNumber}: ${error instanceof AppError ? error.userMessage : 'تعذّر الاستيراد.'}`
        })
      }
    }

    new AuditService(this.ctx).log({
      action: 'import',
      entityType: 'sales',
      entityLabel: 'فواتير البيع',
      newValue: { imported, failed: failures.length },
      severity: 'warning'
    })

    return { imported, skipped: skipped + failures.length, failures }
  }

  private cashAccountId(): number {
    return (this.ctx.db.prepare("SELECT id FROM accounts WHERE system_key = 'cash'").get() as { id: number }).id
  }

  /** توليد ملف قالب فارغ بالأعمدة المتوقعة */
  async writeTemplate(entity: ImportEntity, filePath: string): Promise<void> {
    const spec = IMPORT_SCHEMAS[entity]
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(spec.title, { views: [{ rightToLeft: true }] })
    sheet.columns = spec.columns.map((c) => ({ header: c.label, key: c.key, width: 22 }))
    sheet.getRow(1).font = { bold: true }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } }
    const hints = spec.columns.map((c) => c.hint ?? (c.required ? 'مطلوب' : ''))
    if (hints.some(Boolean)) sheet.addRow(hints)
    await workbook.xlsx.writeFile(filePath)
  }
}
