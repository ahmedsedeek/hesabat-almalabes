import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type DB } from '@main/db/connection'
import { DashboardService } from '@main/reports/dashboard.service'
import { ReportsService } from '@main/reports/reports.service'
import { PartyService } from '@main/services/party.service'
import { SalesService } from '@main/services/sales.service'
import { InventoryService } from '@main/inventory/inventory.service'
import { LedgerService } from '@main/accounting/ledger'
import { ACC } from '@main/accounting/chart'
import type { Ctx } from '@main/core/context'
import { createAdmin } from './helpers'

/**
 * اختبار الأداء على حجم بيانات واقعي لعدة سنوات من العمل:
 * ١٠٠٬٠٠٠ فاتورة بيع · ٢٠٠٬٠٠٠ سطر · ٣٠٠٬٠٠٠ قيد محاسبي · ٥٬٠٠٠ عميل · ٢٬٠٠٠ صنف
 * الهدف: التأكد أن الفهارس تجعل الشاشات والتقارير تستجيب في أجزاء من الثانية.
 */
const CUSTOMERS = 5_000
const PRODUCTS = 2_000
const SALES = 100_000

let tmpDir: string
let db: DB
let ctx: Ctx

function seconds(label: string, fn: () => unknown): number {
  const start = performance.now()
  fn()
  const ms = performance.now() - start
  console.log(`   ⏱ ${label}: ${ms.toFixed(0)} مللي ثانية`)
  return ms
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-perf-'))
  db = openDatabase({ file: path.join(tmpDir, 'perf.db'), seed: true })
  const user = createAdmin(db)
  ctx = { db, user, device: 'perf' }

  const warehouseId = (db.prepare('SELECT id FROM warehouses LIMIT 1').get() as { id: number }).id
  const receivableId = (db.prepare("SELECT id FROM accounts WHERE system_key = 'receivable'").get() as { id: number }).id
  const revenueId = (db.prepare("SELECT id FROM accounts WHERE system_key = 'sales_revenue'").get() as { id: number }).id
  const cogsId = (db.prepare("SELECT id FROM accounts WHERE system_key = 'cogs'").get() as { id: number }).id
  const inventoryId = (db.prepare("SELECT id FROM accounts WHERE system_key = 'inventory_finished'").get() as { id: number }).id

  // الإدراج المباشر أسرع بكثير من المرور بالخدمات، والهدف هنا قياس أداء الاستعلامات لا الكتابة
  db.pragma('synchronous = OFF')

  const seed = db.transaction(() => {
    const insertParty = db.prepare(
      "INSERT INTO parties (party_type, code, name, phone) VALUES ('customer', ?, ?, ?)"
    )
    for (let i = 1; i <= CUSTOMERS; i++) insertParty.run(`C${String(i).padStart(5, '0')}`, `عميل رقم ${i}`, `0100000${i}`)

    const insertProduct = db.prepare("INSERT INTO products (sku, name, unit) VALUES (?, ?, 'قطعة')")
    const insertVariant = db.prepare(
      'INSERT INTO product_variants (product_id, sku, size, color, sale_price, purchase_price, avg_cost) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (let i = 1; i <= PRODUCTS; i++) {
      const productId = Number(insertProduct.run(`PR${String(i).padStart(5, '0')}`, `منتج رقم ${i}`).lastInsertRowid)
      insertVariant.run(productId, `PR${String(i).padStart(5, '0')}-1`, 'L', 'أسود', 1_000_000, 600_000, 600_000)
    }

    const insertLevel = db.prepare('INSERT INTO stock_levels (variant_id, warehouse_id, quantity) VALUES (?, ?, 100000)')
    const variantIds = (db.prepare('SELECT id FROM product_variants').all() as { id: number }[]).map((r) => r.id)
    for (const id of variantIds) insertLevel.run(id, warehouseId)

    const insertSale = db.prepare(
      `INSERT INTO sales (invoice_number, date, customer_id, warehouse_id, subtotal, discount_amount, tax_amount,
                          shipping_amount, total, paid_amount, cogs_amount, status)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 'confirmed')`
    )
    const insertItem = db.prepare(
      `INSERT INTO sale_items (sale_id, line_no, variant_id, quantity, unit_price, line_total, unit_cost, cogs_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertEntry = db.prepare(
      "INSERT INTO journal_entries (entry_number, date, ref_type, ref_id, ref_number) VALUES (?, ?, 'sale', ?, ?)"
    )
    const insertLine = db.prepare(
      'INSERT INTO journal_lines (entry_id, line_no, account_id, party_id, debit, credit) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const insertMovement = db.prepare(
      `INSERT INTO stock_movements (date, variant_id, warehouse_id, movement_type, qty_in, qty_out, unit_cost, value,
                                    balance_after, avg_cost_after, ref_type, ref_id, ref_number)
       VALUES (?, ?, ?, 'sale', 0, ?, ?, ?, 0, ?, 'sale', ?, ?)`
    )

    const start = new Date('2023-01-01').getTime()
    for (let i = 1; i <= SALES; i++) {
      const date = new Date(start + (i % 1000) * 86_400_000).toISOString().slice(0, 10)
      const customerId = ((i % CUSTOMERS) + 1)
      const variantId = variantIds[i % variantIds.length]
      const quantity = (i % 5) + 1
      const total = quantity * 10_000
      const cogs = quantity * 6_000
      const paid = i % 3 === 0 ? 0 : total
      const number = `INV-2026-${String(i).padStart(6, '0')}`

      const saleId = Number(insertSale.run(number, date, customerId, warehouseId, total, total, paid, cogs).lastInsertRowid)
      insertItem.run(saleId, 1, variantId, quantity, 1_000_000, total, 600_000, cogs)
      insertItem.run(saleId, 2, variantIds[(i + 7) % variantIds.length], 1, 1_000_000, 0, 600_000, 0)

      const entryId = Number(insertEntry.run(`JV-2026-${String(i).padStart(6, '0')}`, date, saleId, number).lastInsertRowid)
      insertLine.run(entryId, 1, receivableId, customerId, total, 0)
      insertLine.run(entryId, 2, revenueId, null, 0, total)
      insertLine.run(entryId, 3, cogsId, null, cogs, 0)
      insertLine.run(entryId, 4, inventoryId, null, 0, cogs)

      insertMovement.run(date, variantId, warehouseId, quantity, 600_000, -cogs, 600_000, saleId, number)
    }
  })

  console.log(`\n   تهيئة بيانات الاختبار: ${SALES.toLocaleString('en-US')} فاتورة…`)
  const t0 = performance.now()
  seed.immediate()
  db.pragma('synchronous = FULL')
  db.exec('ANALYZE')
  console.log(`   اكتملت التهيئة في ${((performance.now() - t0) / 1000).toFixed(1)} ثانية`)
}, 600_000)

afterAll(() => {
  db.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('الأداء على حجم بيانات كبير', () => {
  it('حجم البيانات كما هو متوقع', () => {
    expect((db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n).toBe(SALES)
    expect((db.prepare('SELECT COUNT(*) AS n FROM journal_lines').get() as { n: number }).n).toBe(SALES * 4)
    expect((db.prepare('SELECT COUNT(*) AS n FROM sale_items').get() as { n: number }).n).toBe(SALES * 2)
  })

  it('قائمة المبيعات المُقسَّمة إلى صفحات تستجيب فورًا', () => {
    const ms = seconds('قائمة المبيعات (صفحة ٥٠)', () => {
      const result = new SalesService(ctx).list({ page: 1, pageSize: 50 })
      expect(result.rows).toHaveLength(50)
    })
    expect(ms).toBeLessThan(1500)
  })

  it('البحث في الفواتير سريع', () => {
    const ms = seconds('البحث برقم فاتورة', () => {
      const result = new SalesService(ctx).list({ search: 'INV-2026-050000', pageSize: 20 })
      expect(result.rows.length).toBeGreaterThan(0)
    })
    expect(ms).toBeLessThan(2000)
  })

  it('قائمة العملاء مع أرصدتهم سريعة', () => {
    const ms = seconds('قائمة العملاء مع الأرصدة', () => {
      const result = new PartyService(ctx).list({ partyType: 'customer', page: 1, pageSize: 50 })
      expect(result.rows).toHaveLength(50)
    })
    expect(ms).toBeLessThan(3000)
  })

  it('كشف حساب عميل سريع', () => {
    const ms = seconds('كشف حساب عميل لسنة كاملة', () => {
      const statement = new PartyService(ctx).statement(1, '2023-01-01', '2026-12-31')
      expect(statement.lines.length).toBeGreaterThan(0)
    })
    expect(ms).toBeLessThan(2000)
  })

  it('رصيد الطرف يُحسب فورًا', () => {
    const ms = seconds('رصيد عميل', () => {
      new LedgerService(ctx).partyBalance(1)
    })
    expect(ms).toBeLessThan(500)
  })

  it('لوحة المعلومات تُحمَّل في زمن مقبول', () => {
    const ms = seconds('تحميل لوحة المعلومات (شهر)', () => {
      const data = new DashboardService(ctx).load('custom', { from: '2024-01-01', to: '2024-01-31' })
      expect(data.kpis.salesPeriod).toBeGreaterThan(0)
    })
    expect(ms).toBeLessThan(6000)
  })

  it('قائمة الأرباح والخسائر لسنة كاملة سريعة', () => {
    const ms = seconds('الأرباح والخسائر (سنة)', () => {
      const pl = new ReportsService(ctx).profitAndLoss({ from: '2024-01-01', to: '2024-12-31' })
      expect(pl.totalRevenue).toBeGreaterThan(0)
      expect(pl.grossProfit).toBe(pl.totalRevenue - pl.totalCogs)
    })
    expect(ms).toBeLessThan(4000)
  })

  it('تقرير ربحية المنتجات على ٢٬٠٠٠ صنف سريع', () => {
    const ms = seconds('ربحية المنتجات', () => {
      const rows = new ReportsService(ctx).productProfitability({ from: '2023-01-01', to: '2026-12-31' })
      expect(rows.length).toBeGreaterThan(100)
    })
    expect(ms).toBeLessThan(6000)
  })

  it('تقييم المخزون على ٢٬٠٠٠ صنف سريع', () => {
    const ms = seconds('تقييم المخزون', () => {
      const result = new ReportsService(ctx).inventoryValuation()
      expect(result.rows.length).toBe(PRODUCTS)
    })
    expect(ms).toBeLessThan(4000)
  })

  it('حركة المخزون لصنف واحد سريعة رغم ضخامة السجل', () => {
    const ms = seconds('حركة صنف واحد', () => {
      const result = new InventoryService(ctx).movements({ variantId: 1, pageSize: 100 })
      expect(result.rows.length).toBeGreaterThan(0)
    })
    expect(ms).toBeLessThan(2000)
  })

  it('تقرير أعمار الديون على ٥٬٠٠٠ عميل سريع', () => {
    const ms = seconds('أعمار الذمم المدينة', () => {
      const rows = new PartyService(ctx).aging('customer', '2026-12-31')
      expect(rows.length).toBeGreaterThan(0)
    })
    expect(ms).toBeLessThan(6000)
  })

  it('رصيد حساب رقابي يُحسب فورًا', () => {
    const ms = seconds('رصيد حساب الذمم المدينة', () => {
      const balance = new LedgerService(ctx).balanceByKey(ACC.RECEIVABLE)
      expect(balance).toBeGreaterThan(0)
    })
    expect(ms).toBeLessThan(1500)
  })
})
