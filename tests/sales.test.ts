import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerService } from '@main/accounting/ledger'
import { ACC } from '@main/accounting/chart'
import { InventoryService } from '@main/inventory/inventory.service'
import { PartyService } from '@main/services/party.service'
import { ProductService } from '@main/services/product.service'
import { SalesService } from '@main/services/sales.service'
import { PaymentService } from '@main/services/payment.service'
import { toMinor, toRate } from '@shared/money'
import type { Ctx } from '@main/core/context'
import { cashMethodId, createCtx, defaultWarehouseId } from './helpers'

let ctx: Ctx
let warehouseId: number
let customerId: number
let variantId: number

/** مخزون افتتاحي: حركة مخزنية + قيد محاسبي مقابل حساب الأرصدة الافتتاحية */
function seedStock(qty: number, unitCost: number): void {
  const movement = new InventoryService(ctx).receive({
    date: '2026-01-01',
    variantId,
    warehouseId,
    quantity: qty,
    unitCost: toRate(unitCost),
    movementType: 'opening',
    refType: 'opening'
  })
  new LedgerService(ctx).post({
    date: '2026-01-01',
    refType: 'opening',
    description: 'مخزون افتتاحي',
    lines: [
      { accountKey: ACC.INVENTORY_FINISHED, debit: movement.value },
      { accountKey: ACC.OPENING_BALANCE_EQUITY, credit: movement.value }
    ]
  })
}

beforeEach(() => {
  ctx = createCtx()
  warehouseId = defaultWarehouseId(ctx.db)
  customerId = new PartyService(ctx).create({ partyType: 'customer', name: 'محل الأمانة' })
  const productId = new ProductService(ctx).create({
    name: 'تيشيرت موديل A',
    unit: 'قطعة',
    variants: [{ size: 'L', color: 'أسود', salePrice: toRate(150), purchasePrice: toRate(90) }]
  })
  variantId = (ctx.db.prepare('SELECT id FROM product_variants WHERE product_id = ?').get(productId) as { id: number }).id
})

describe('فاتورة البيع', () => {
  it('تخصم المخزون وتحدّث رصيد العميل وتسجّل تكلفة البضاعة المباعة', () => {
    seedStock(100, 90)
    const sales = new SalesService(ctx)
    const ledger = new LedgerService(ctx)
    const inventory = new InventoryService(ctx)

    const { id } = sales.create({
      date: '2026-02-01',
      customerId,
      items: [{ variantId, quantity: 10, unitPrice: toRate(150) }]
    })

    expect(inventory.stockAt(variantId, warehouseId)).toBe(90)
    expect(ledger.partyBalance(customerId)).toBe(toMinor(1500))
    expect(ledger.balanceByKey(ACC.SALES_REVENUE)).toBe(toMinor(1500))
    expect(ledger.balanceByKey(ACC.COGS)).toBe(toMinor(900))
    expect(ledger.balanceByKey(ACC.INVENTORY_FINISHED)).toBe(toMinor(100 * 90 - 900))

    const sale = sales.get(id)
    expect(sale.total).toBe(toMinor(1500))
    expect(sale.cogs_amount).toBe(toMinor(900))
  })

  it('ترفض البيع عند عدم كفاية المخزون ولا تترك أي أثر', () => {
    seedStock(5, 90)
    const entriesBefore = (ctx.db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get() as { n: number }).n
    const sales = new SalesService(ctx)
    expect(() =>
      sales.create({ date: '2026-02-01', customerId, items: [{ variantId, quantity: 10, unitPrice: toRate(150) }] })
    ).toThrowError(/الكمية المتاحة/)
    expect(new InventoryService(ctx).stockAt(variantId, warehouseId)).toBe(5)
    const sales_count = ctx.db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }
    expect(sales_count.n).toBe(0)
    const entries = ctx.db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get() as { n: number }
    expect(entries.n).toBe(entriesBefore)
  })

  it('تحسب الخصم والضريبة والشحن بدقة', () => {
    seedStock(100, 50)
    const sales = new SalesService(ctx)
    const { id } = sales.create({
      date: '2026-02-01',
      customerId,
      items: [
        { variantId, quantity: 3, unitPrice: toRate(100), taxRate: 14 },
        { variantId, quantity: 2, unitPrice: toRate(50), taxRate: 14 }
      ],
      discountAmount: toMinor(40),
      shippingAmount: toMinor(25)
    })
    const sale = sales.get(id)
    // الإجمالي قبل الخصم = 300 + 100 = 400 ، بعد الخصم = 360 ، الضريبة 14% = 50.40 ، + شحن 25
    expect(sale.subtotal).toBe(toMinor(400))
    expect(sale.discount_amount).toBe(toMinor(40))
    expect(sale.tax_amount).toBe(toMinor(50.4))
    expect(sale.total).toBe(toMinor(435.4))
    const items = sale.items as Record<string, number>[]
    expect(items.reduce((s, i) => s + i.discount_amount, 0)).toBe(toMinor(40))
  })

  it('تسجّل الدفعة الفورية وتُخفّض رصيد العميل', () => {
    seedStock(100, 90)
    const sales = new SalesService(ctx)
    const { id } = sales.create({
      date: '2026-02-01',
      customerId,
      items: [{ variantId, quantity: 10, unitPrice: toRate(150) }],
      payment: { amount: toMinor(1000), methodId: cashMethodId(ctx.db) }
    })
    const ledger = new LedgerService(ctx)
    expect(ledger.partyBalance(customerId)).toBe(toMinor(500))
    expect(ledger.balanceByKey(ACC.CASH)).toBe(toMinor(1000))
    const sale = sales.get(id)
    expect(sale.paid_amount).toBe(toMinor(1000))
  })
})

describe('إلغاء فاتورة البيع', () => {
  it('يعيد المخزون ويعكس القيد ويُبقي السجل', () => {
    seedStock(100, 90)
    const sales = new SalesService(ctx)
    const { id } = sales.create({ date: '2026-02-01', customerId, items: [{ variantId, quantity: 10, unitPrice: toRate(150) }] })
    sales.void(id, 'خطأ في إدخال العميل')

    const ledger = new LedgerService(ctx)
    expect(new InventoryService(ctx).stockAt(variantId, warehouseId)).toBe(100)
    expect(ledger.partyBalance(customerId)).toBe(0)
    expect(ledger.balanceByKey(ACC.SALES_REVENUE)).toBe(0)
    expect(ledger.balanceByKey(ACC.COGS)).toBe(0)
    const sale = sales.get(id)
    expect(sale.status).toBe('void')
  })

  it('يمنع الإلغاء إذا كانت هناك مدفوعات مخصَّصة', () => {
    seedStock(100, 90)
    const sales = new SalesService(ctx)
    const { id } = sales.create({
      date: '2026-02-01',
      customerId,
      items: [{ variantId, quantity: 10, unitPrice: toRate(150) }],
      payment: { amount: toMinor(500), methodId: cashMethodId(ctx.db) }
    })
    expect(() => sales.void(id, 'سبب')).toThrowError(/مدفوعات/)
  })
})

describe('مردود المبيعات', () => {
  it('يعيد الكمية بنفس التكلفة ويعكس الإيراد والتكلفة جزئيًا', () => {
    seedStock(100, 90)
    const sales = new SalesService(ctx)
    const { id } = sales.create({ date: '2026-02-01', customerId, items: [{ variantId, quantity: 10, unitPrice: toRate(150) }] })
    const saleItemId = (ctx.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(id) as { id: number }).id

    sales.createReturn({
      date: '2026-02-05',
      saleId: id,
      customerId,
      items: [{ saleItemId, variantId, quantity: 4, unitPrice: toRate(150) }]
    })

    const ledger = new LedgerService(ctx)
    expect(new InventoryService(ctx).stockAt(variantId, warehouseId)).toBe(94)
    expect(ledger.partyBalance(customerId)).toBe(toMinor(900))
    // حساب مردودات المبيعات حساب مقابل للإيراد، لذا رصيده مدين (سالب بالاتجاه الدائن)
    expect(ledger.balanceByKey(ACC.SALES_RETURNS)).toBe(toMinor(-600))
    expect(ledger.balanceByKey(ACC.COGS)).toBe(toMinor(540))
    const sale = sales.get(id)
    expect(sale.returned_amount).toBe(toMinor(600))
  })

  it('يمنع إرجاع كمية أكبر من المباعة', () => {
    seedStock(100, 90)
    const sales = new SalesService(ctx)
    const { id } = sales.create({ date: '2026-02-01', customerId, items: [{ variantId, quantity: 5, unitPrice: toRate(150) }] })
    const saleItemId = (ctx.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(id) as { id: number }).id
    expect(() =>
      sales.createReturn({ date: '2026-02-05', saleId: id, customerId, items: [{ saleItemId, variantId, quantity: 9, unitPrice: toRate(150) }] })
    ).toThrowError(/أكبر من المتبقي/)
  })
})

describe('المتوسط المرجَّح للتكلفة', () => {
  it('يُحدَّث عند كل إدخال بتكلفة مختلفة', () => {
    const inventory = new InventoryService(ctx)
    seedStock(100, 90)   // 100 × 90 = 9000
    seedStock(100, 110)  // 100 × 110 = 11000  ⇒ المتوسط = 100
    expect(inventory.avgCost(variantId)).toBe(toRate(100))

    const sales = new SalesService(ctx)
    sales.create({ date: '2026-02-01', customerId, items: [{ variantId, quantity: 50, unitPrice: toRate(150) }] })
    expect(new LedgerService(ctx).balanceByKey(ACC.COGS)).toBe(toMinor(5000))
    expect(inventory.avgCost(variantId)).toBe(toRate(100))
    expect(inventory.inventoryValue()).toBe(toMinor(15000))
  })
})

describe('كشف حساب العميل', () => {
  it('يعرض الرصيد الافتتاحي والحركات والرصيد الختامي بترتيب صحيح', () => {
    const parties = new PartyService(ctx)
    const id = parties.create({
      partyType: 'customer',
      name: 'عميل برصيد افتتاحي',
      openingBalance: toMinor(5000),
      openingDate: '2026-01-01'
    })
    seedStock(100, 90)
    const sales = new SalesService(ctx)
    sales.create({ date: '2026-09-03', customerId: id, items: [{ variantId, quantity: 10, unitPrice: toRate(200) }] })
    new PaymentService(ctx).create({
      date: '2026-09-05',
      direction: 'in',
      partyId: id,
      amount: toMinor(1500),
      methodId: cashMethodId(ctx.db)
    })

    const statement = parties.statement(id, '2026-09-01', '2026-09-30')
    expect(statement.openingBalance).toBe(toMinor(5000))
    expect(statement.lines).toHaveLength(2)
    expect(statement.lines[0].debit).toBe(toMinor(2000))
    expect(statement.lines[0].balance).toBe(toMinor(7000))
    expect(statement.lines[1].credit).toBe(toMinor(1500))
    expect(statement.lines[1].balance).toBe(toMinor(5500))
    expect(statement.closingBalance).toBe(toMinor(5500))
  })
})
