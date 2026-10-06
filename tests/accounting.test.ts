import { beforeEach, describe, expect, it } from 'vitest'
import { ACC } from '@main/accounting/chart'
import { LedgerService } from '@main/accounting/ledger'
import { InventoryService } from '@main/inventory/inventory.service'
import { PartyService } from '@main/services/party.service'
import { ProductService } from '@main/services/product.service'
import { PurchaseService } from '@main/services/purchase.service'
import { SalesService } from '@main/services/sales.service'
import { PaymentService } from '@main/services/payment.service'
import { ExpenseService } from '@main/services/expense.service'
import { StockService } from '@main/services/stock.service'
import { ReportsService } from '@main/reports/reports.service'
import { DashboardService, resolvePeriod } from '@main/reports/dashboard.service'
import { IntegrityService } from '@main/services/integrity.service'
import { AuthService } from '@main/services/auth.service'
import { toMinor, toRate } from '@shared/money'
import type { Ctx } from '@main/core/context'
import { cashAccountId, cashMethodId, createCtx, defaultWarehouseId } from './helpers'

let ctx: Ctx
let warehouseId: number
let customerId: number
let supplierId: number
let variantId: number

beforeEach(() => {
  ctx = createCtx()
  warehouseId = defaultWarehouseId(ctx.db)
  const parties = new PartyService(ctx)
  customerId = parties.create({ partyType: 'customer', name: 'عميل تجريبي' })
  supplierId = parties.create({ partyType: 'supplier', name: 'مورد تجريبي' })
  const productId = new ProductService(ctx).create({ name: 'بنطلون جينز', unit: 'قطعة' })
  variantId = (ctx.db.prepare('SELECT id FROM product_variants WHERE product_id = ?').get(productId) as { id: number }).id
})

function buySell(): void {
  new PurchaseService(ctx).create({
    date: '2026-03-01',
    supplierId,
    items: [{ variantId, quantity: 100, unitPrice: toRate(60) }]
  })
  new SalesService(ctx).create({
    date: '2026-03-10',
    customerId,
    items: [{ variantId, quantity: 40, unitPrice: toRate(100) }]
  })
}

describe('قائمة الأرباح والخسائر', () => {
  it('تحسب مجمل الربح وصافي الربح من المعاملات الفعلية', () => {
    buySell()
    const rentCategory = (ctx.db.prepare("SELECT id FROM expense_categories WHERE name = 'إيجار'").get() as { id: number }).id
    new ExpenseService(ctx).create({
      date: '2026-03-15',
      categoryId: rentCategory,
      amount: toMinor(800),
      paymentAccountId: cashAccountId(ctx.db)
    })

    const pl = new ReportsService(ctx).profitAndLoss({ from: '2026-03-01', to: '2026-03-31' })
    expect(pl.totalRevenue).toBe(toMinor(4000))   // 40 × 100
    expect(pl.totalCogs).toBe(toMinor(2400))      // 40 × 60
    expect(pl.grossProfit).toBe(toMinor(1600))
    expect(pl.totalExpenses).toBe(toMinor(800))
    expect(pl.netProfit).toBe(toMinor(800))
    expect(pl.grossMarginPercent).toBeCloseTo(40, 5)
  })

  it('تستبعد المعاملات خارج الفترة', () => {
    buySell()
    const pl = new ReportsService(ctx).profitAndLoss({ from: '2026-04-01', to: '2026-04-30' })
    expect(pl.totalRevenue).toBe(0)
    expect(pl.netProfit).toBe(0)
  })

  it('تعكس أثر مردود المبيعات على الإيراد والتكلفة', () => {
    buySell()
    const saleId = (ctx.db.prepare('SELECT id FROM sales LIMIT 1').get() as { id: number }).id
    const itemId = (ctx.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId) as { id: number }).id
    new SalesService(ctx).createReturn({
      date: '2026-03-20',
      saleId,
      customerId,
      items: [{ saleItemId: itemId, variantId, quantity: 10, unitPrice: toRate(100) }]
    })
    const pl = new ReportsService(ctx).profitAndLoss({ from: '2026-03-01', to: '2026-03-31' })
    expect(pl.totalRevenue).toBe(toMinor(3000))   // 4000 − 1000
    expect(pl.totalCogs).toBe(toMinor(1800))      // 2400 − 600
    expect(pl.grossProfit).toBe(toMinor(1200))
  })
})

describe('الميزانية العمومية', () => {
  it('تتوازن: الأصول = الخصوم + حقوق الملكية', () => {
    buySell()
    new PaymentService(ctx).create({
      date: '2026-03-12',
      direction: 'in',
      partyId: customerId,
      amount: toMinor(1500),
      methodId: cashMethodId(ctx.db)
    })
    const reports = new ReportsService(ctx)
    const bs = reports.balanceSheet('2026-12-31')
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity + bs.retainedProfit)
  })
})

describe('ميزان المراجعة', () => {
  it('يتوازن بعد سلسلة عمليات متنوعة', () => {
    buySell()
    new PaymentService(ctx).create({ date: '2026-03-12', direction: 'in', partyId: customerId, amount: toMinor(1000), methodId: cashMethodId(ctx.db) })
    new PaymentService(ctx).create({ date: '2026-03-13', direction: 'out', partyId: supplierId, amount: toMinor(2000), methodId: cashMethodId(ctx.db) })
    new StockService(ctx).createAdjustment({
      date: '2026-03-14',
      warehouseId,
      adjustmentType: 'damage',
      reason: 'تلف أثناء النقل',
      items: [{ variantId, quantity: 5 }]
    })

    const tb = new ReportsService(ctx).trialBalance('2026-12-31')
    expect(tb.totalDebit).toBe(tb.totalCredit)
    expect(tb.totalDebit).toBeGreaterThan(0)
  })
})

describe('تسويات المخزون', () => {
  it('تسوية الجرد تحسب الفرق وتُعدّل الرصيد والقيمة', () => {
    buySell()
    const inventory = new InventoryService(ctx)
    expect(inventory.stockAt(variantId, warehouseId)).toBe(60)

    new StockService(ctx).createAdjustment({
      date: '2026-03-25',
      warehouseId,
      adjustmentType: 'count',
      reason: 'جرد نهاية الشهر',
      items: [{ variantId, quantity: 57 }]
    })

    expect(inventory.stockAt(variantId, warehouseId)).toBe(57)
    const ledger = new LedgerService(ctx)
    // نقص 3 قطع × 60 = 180 تُحمَّل على حساب فروقات المخزون
    expect(ledger.balanceByKey(ACC.INVENTORY_ADJUSTMENT)).toBe(toMinor(180))
  })

  it('تسوية الرصيد الافتتاحي تُقابل حساب الأرصدة الافتتاحية', () => {
    new StockService(ctx).createAdjustment({
      date: '2026-01-01',
      warehouseId,
      adjustmentType: 'opening',
      reason: 'أرصدة بداية التشغيل',
      items: [{ variantId, quantity: 200, unitCost: toRate(45) }]
    })
    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.INVENTORY_FINISHED)).toBe(toMinor(9000))
    expect(ledger.balanceByKey(ACC.OPENING_BALANCE_EQUITY)).toBe(toMinor(9000))
    expect(new InventoryService(ctx).stockAt(variantId, warehouseId)).toBe(200)
  })
})

describe('التحويل بين المخازن', () => {
  it('ينقل الكمية دون أثر محاسبي', () => {
    buySell()
    const second = ctx.db.prepare("INSERT INTO warehouses (code, name) VALUES ('W2','مخزن فرعي')").run()
    const secondId = Number(second.lastInsertRowid)
    const before = new LedgerService(ctx).balanceByKey(ACC.INVENTORY_FINISHED)

    new StockService(ctx).createTransfer({
      date: '2026-03-30',
      fromWarehouseId: warehouseId,
      toWarehouseId: secondId,
      items: [{ variantId, quantity: 20 }]
    })

    const inventory = new InventoryService(ctx)
    expect(inventory.stockAt(variantId, warehouseId)).toBe(40)
    expect(inventory.stockAt(variantId, secondId)).toBe(20)
    expect(inventory.totalStock(variantId)).toBe(60)
    expect(new LedgerService(ctx).balanceByKey(ACC.INVENTORY_FINISHED)).toBe(before)
  })
})

describe('أعمار الديون', () => {
  it('تصنّف الفواتير حسب عمرها', () => {
    const sales = new SalesService(ctx)
    new StockService(ctx).createAdjustment({
      date: '2026-01-01',
      warehouseId,
      adjustmentType: 'opening',
      reason: 'رصيد افتتاحي',
      items: [{ variantId, quantity: 1000, unitCost: toRate(50) }]
    })
    sales.create({ date: '2026-06-01', customerId, items: [{ variantId, quantity: 1, unitPrice: toRate(100) }] })
    sales.create({ date: '2026-08-20', customerId, items: [{ variantId, quantity: 1, unitPrice: toRate(200) }] })

    const aging = new PartyService(ctx).aging('customer', '2026-09-01')
    const row = aging.find((r) => r.partyId === customerId)
    expect(row).toBeDefined()
    expect(row!.total).toBe(toMinor(300))
    expect(row!.current).toBe(toMinor(200))   // فاتورة 20 أغسطس عمرها 12 يومًا
    expect(row!.d90).toBe(toMinor(100))       // فاتورة 1 يونيو عمرها 92 يومًا
  })
})

describe('لوحة المعلومات', () => {
  it('تحسب المؤشرات من البيانات الفعلية', () => {
    buySell()
    const dashboard = new DashboardService(ctx).load('custom', { from: '2026-03-01', to: '2026-03-31' })
    expect(dashboard.kpis.salesPeriod).toBe(toMinor(4000))
    expect(dashboard.kpis.purchasesPeriod).toBe(toMinor(6000))
    expect(dashboard.kpis.grossProfit).toBe(toMinor(1600))
    expect(dashboard.kpis.receivables).toBe(toMinor(4000))
    expect(dashboard.kpis.payables).toBe(toMinor(6000))
    expect(dashboard.kpis.inventoryValue).toBe(toMinor(3600))
    expect(dashboard.charts.topCustomers[0].amount).toBe(toMinor(4000))
  })

  it('تحوّل الفترات المختصرة إلى مدى تواريخ صحيح', () => {
    const today = new Date('2026-09-15T10:00:00')
    expect(resolvePeriod('today', undefined, today)).toEqual({ from: '2026-09-15', to: '2026-09-15' })
    expect(resolvePeriod('this_month', undefined, today)).toEqual({ from: '2026-09-01', to: '2026-09-15' })
    expect(resolvePeriod('last_month', undefined, today)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(resolvePeriod('this_year', undefined, today)).toEqual({ from: '2026-01-01', to: '2026-09-15' })
  })
})

describe('فحص سلامة البيانات', () => {
  it('لا يجد مشاكل في قاعدة بيانات سليمة', () => {
    buySell()
    new PaymentService(ctx).create({ date: '2026-03-12', direction: 'in', partyId: customerId, amount: toMinor(1000), methodId: cashMethodId(ctx.db) })
    const result = new IntegrityService(ctx).run()
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('يكتشف اختلاف المبالغ المحصَّلة ويُصلحه', () => {
    buySell()
    const saleId = (ctx.db.prepare('SELECT id FROM sales LIMIT 1').get() as { id: number }).id
    // محاكاة تلف بيانات: تعديل مباشر لحقل المدفوع
    ctx.db.prepare('UPDATE sales SET paid_amount = 99999 WHERE id = ?').run(saleId)

    const integrity = new IntegrityService(ctx)
    const before = integrity.run()
    expect(before.ok).toBe(false)
    expect(before.issues.some((i) => i.code === 'sale_paid_mismatch')).toBe(true)

    integrity.repair()
    const after = integrity.run()
    expect(after.issues.some((i) => i.code === 'sale_paid_mismatch')).toBe(false)
  })
})

describe('المصادقة والصلاحيات', () => {
  it('ترفض كلمة المرور الخاطئة وتقفل الحساب بعد محاولات متكررة', () => {
    const auth = new AuthService(ctx)
    for (let i = 0; i < 4; i++) {
      expect(() => auth.login('admin', 'wrong-password')).toThrowError(/غير صحيحة/)
    }
    expect(() => auth.login('admin', 'wrong-password')).toThrowError(/قفل الحساب/)
  })

  it('تقبل بيانات الدخول الصحيحة وتُرجع الصلاحيات', () => {
    const session = new AuthService(ctx).login('admin', 'Admin@123')
    expect(session.roleCode).toBe('admin')
    expect(session.permissions.length).toBeGreaterThan(20)
  })

  it('ترفض كلمة مرور ضعيفة عند إنشاء مستخدم', () => {
    const auth = new AuthService(ctx)
    const roleId = (ctx.db.prepare("SELECT id FROM roles WHERE code = 'sales'").get() as { id: number }).id
    expect(() => auth.createUser({ username: 'ali', fullName: 'علي', password: '123', roleId })).toThrowError(/٨ أحرف/)
    expect(() => auth.createUser({ username: 'ali', fullName: 'علي', password: 'password', roleId })).toThrowError(/حروف وأرقام/)
    expect(auth.createUser({ username: 'ali', fullName: 'علي', password: 'Pass1234', roleId })).toBeGreaterThan(0)
  })

  it('تمنع تعطيل آخر حساب مدير نشط', () => {
    const auth = new AuthService(ctx)
    const adminId = (ctx.db.prepare("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin'").get() as { id: number }).id
    expect(() => auth.updateUser(adminId, { isActive: false })).toThrowError(/آخر حساب مدير/)
  })
})

describe('سجل المراجعة', () => {
  it('يسجّل كل عملية مالية مع اسم المستخدم', () => {
    buySell()
    const rows = ctx.db.prepare("SELECT * FROM audit_logs WHERE entity_type IN ('sale','purchase')").all() as Record<string, unknown>[]
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.user_name === 'مدير النظام')).toBe(true)
  })

  it('يسجّل سبب الإلغاء', () => {
    buySell()
    const saleId = (ctx.db.prepare('SELECT id FROM sales LIMIT 1').get() as { id: number }).id
    new SalesService(ctx).void(saleId, 'خطأ في الكمية')
    const row = ctx.db.prepare("SELECT * FROM audit_logs WHERE action = 'void' AND entity_type = 'sale'").get() as Record<string, unknown>
    expect(row.reason).toBe('خطأ في الكمية')
    expect(row.severity).toBe('critical')
  })
})
