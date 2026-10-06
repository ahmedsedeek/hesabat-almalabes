import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerService } from '@main/accounting/ledger'
import { ACC } from '@main/accounting/chart'
import { InventoryService } from '@main/inventory/inventory.service'
import { PartyService } from '@main/services/party.service'
import { ProductService } from '@main/services/product.service'
import { PurchaseService } from '@main/services/purchase.service'
import { ProductionService } from '@main/services/production.service'
import { SalesService } from '@main/services/sales.service'
import { PaymentService } from '@main/services/payment.service'
import { ExpenseService } from '@main/services/expense.service'
import { toMinor, toRate, fromRate } from '@shared/money'
import type { Ctx } from '@main/core/context'
import { cashAccountId, cashMethodId, createCtx, defaultWarehouseId } from './helpers'

let ctx: Ctx
let warehouseId: number
let supplierId: number
let factoryId: number
let customerId: number
let fabricVariant: number
let buttonVariant: number
let shirtVariant: number

function variantOf(productId: number): number {
  return (ctx.db.prepare('SELECT id FROM product_variants WHERE product_id = ?').get(productId) as { id: number }).id
}

beforeEach(() => {
  ctx = createCtx()
  warehouseId = defaultWarehouseId(ctx.db)
  const parties = new PartyService(ctx)
  supplierId = parties.create({ partyType: 'supplier', name: 'مورد الأقمشة' })
  factoryId = parties.create({ partyType: 'factory', name: 'مصنع النور' })
  customerId = parties.create({ partyType: 'customer', name: 'عميل الجملة' })

  const products = new ProductService(ctx)
  fabricVariant = variantOf(products.create({ name: 'قماش قطن', productType: 'raw', unit: 'متر' }))
  buttonVariant = variantOf(products.create({ name: 'أزرار', productType: 'raw', unit: 'حبة' }))
  shirtVariant = variantOf(products.create({ name: 'قميص موديل X', unit: 'قطعة', variants: [{ size: 'L', color: 'أبيض' }] }))
})

describe('فاتورة الشراء', () => {
  it('تُدخل المخزون وتزيد رصيد المورد وتوزّع الشحن على تكلفة الوحدة', () => {
    const purchases = new PurchaseService(ctx)
    const ledger = new LedgerService(ctx)
    const inventory = new InventoryService(ctx)

    purchases.create({
      date: '2026-01-10',
      supplierId,
      purchaseType: 'materials',
      items: [
        { variantId: fabricVariant, quantity: 800, unitPrice: toRate(10) },   // 8000
        { variantId: buttonVariant, quantity: 1000, unitPrice: toRate(0.5) }  // 500
      ],
      shippingAmount: toMinor(850)
    })

    expect(inventory.stockAt(fabricVariant, warehouseId)).toBe(800)
    // نصيب القماش من الشحن = 850 × (8000/8500) = 800 ⇒ التكلفة = 8800/800 = 11
    expect(fromRate(inventory.avgCost(fabricVariant))).toBeCloseTo(11, 4)
    // نصيب الأزرار = 50 ⇒ (500+50)/1000 = 0.55
    expect(fromRate(inventory.avgCost(buttonVariant))).toBeCloseTo(0.55, 4)

    expect(ledger.partyBalance(supplierId)).toBe(toMinor(9350))
    expect(ledger.balanceByKey(ACC.INVENTORY_RAW)).toBe(toMinor(9350))
    expect(inventory.inventoryValue()).toBe(toMinor(9350))
  })

  it('ترفض تكرار رقم فاتورة المورد', () => {
    const purchases = new PurchaseService(ctx)
    const base = {
      date: '2026-01-10',
      supplierId,
      supplierInvoiceNumber: 'A-1001',
      items: [{ variantId: fabricVariant, quantity: 10, unitPrice: toRate(10) }]
    }
    purchases.create(base)
    expect(() => purchases.create(base)).toThrowError(/مسجَّل من قبل/)
  })

  it('تسجّل الدفعة الفورية وتُخفّض رصيد المورد والنقدية', () => {
    const purchases = new PurchaseService(ctx)
    purchases.create({
      date: '2026-01-10',
      supplierId,
      items: [{ variantId: fabricVariant, quantity: 100, unitPrice: toRate(10) }],
      payment: { amount: toMinor(600), methodId: cashMethodId(ctx.db) }
    })
    const ledger = new LedgerService(ctx)
    expect(ledger.partyBalance(supplierId)).toBe(toMinor(400))
    expect(ledger.balanceByKey(ACC.CASH)).toBe(toMinor(-600))
  })

  it('ترتجع الكمية وتُخفّض المخزون ورصيد المورد', () => {
    const purchases = new PurchaseService(ctx)
    const { id } = purchases.create({
      date: '2026-01-10',
      supplierId,
      items: [{ variantId: fabricVariant, quantity: 100, unitPrice: toRate(10) }]
    })
    const itemId = (ctx.db.prepare('SELECT id FROM purchase_items WHERE purchase_id = ?').get(id) as { id: number }).id
    purchases.createReturn({
      date: '2026-01-15',
      purchaseId: id,
      supplierId,
      items: [{ purchaseItemId: itemId, variantId: fabricVariant, quantity: 20, unitPrice: toRate(10) }]
    })
    expect(new InventoryService(ctx).stockAt(fabricVariant, warehouseId)).toBe(80)
    expect(new LedgerService(ctx).partyBalance(supplierId)).toBe(toMinor(800))
  })
})

describe('أمر الإنتاج', () => {
  function buyMaterials(): void {
    new PurchaseService(ctx).create({
      date: '2026-01-05',
      supplierId,
      purchaseType: 'materials',
      items: [
        { variantId: fabricVariant, quantity: 1000, unitPrice: toRate(10) },
        { variantId: buttonVariant, quantity: 2000, unitPrice: toRate(0.5) }
      ]
    })
  }

  it('يصرف الخامات للمصنع فتخرج من المخزن ولا يمكن استخدامها مرتين', () => {
    buyMaterials()
    const production = new ProductionService(ctx)
    const inventory = new InventoryService(ctx)
    const { id } = production.create({
      date: '2026-02-01',
      factoryId,
      outputVariantId: shirtVariant,
      expectedQty: 500,
      materials: [
        { variantId: fabricVariant, plannedQty: 800 },
        { variantId: buttonVariant, plannedQty: 1000 }
      ]
    })
    production.issueMaterials({
      orderId: id,
      date: '2026-02-02',
      items: [
        { variantId: fabricVariant, quantity: 800 },
        { variantId: buttonVariant, quantity: 1000 }
      ]
    })

    expect(inventory.stockAt(fabricVariant, warehouseId)).toBe(200)
    const ledger = new LedgerService(ctx)
    // 800×10 + 1000×0.5 = 8500 انتقلت إلى «بضاعة لدى المصانع»
    expect(ledger.balanceByKey(ACC.WIP_FACTORY)).toBe(toMinor(8500))
    // المتبقي: 200 متر × 10 + 1000 زر × 0.5 = 2500
    expect(ledger.balanceByKey(ACC.INVENTORY_RAW)).toBe(toMinor(2500))

    // محاولة صرف أكثر من المتاح تُرفض
    expect(() =>
      production.issueMaterials({ orderId: id, date: '2026-02-03', items: [{ variantId: fabricVariant, quantity: 500 }] })
    ).toThrowError(/الكمية المتاحة/)
  })

  it('يحسب تكلفة القطعة المنتجة من الخامات وأجر التصنيع والتكاليف الأخرى', () => {
    buyMaterials()
    const production = new ProductionService(ctx)
    const { id } = production.create({ date: '2026-02-01', factoryId, outputVariantId: shirtVariant, expectedQty: 500 })
    production.issueMaterials({
      orderId: id,
      date: '2026-02-02',
      items: [
        { variantId: fabricVariant, quantity: 800 },
        { variantId: buttonVariant, quantity: 1000 }
      ]
    })
    production.addCost({ orderId: id, date: '2026-02-10', costType: 'factory', amount: toMinor(2500), description: 'أجر تصنيع' })
    production.addCost({ orderId: id, date: '2026-02-10', costType: 'other', amount: toMinor(300), description: 'نقل' })

    const result = production.receiveOutput({ orderId: id, date: '2026-02-20', quantity: 500, isFinal: true })
    // الإجمالي = 8500 + 2500 + 300 = 11300 ⇒ تكلفة القطعة = 22.6
    expect(result.totalCost).toBe(toMinor(11300))
    expect(fromRate(result.unitCost)).toBeCloseTo(22.6, 4)

    const inventory = new InventoryService(ctx)
    expect(inventory.stockAt(shirtVariant, warehouseId)).toBe(500)
    expect(fromRate(inventory.avgCost(shirtVariant))).toBeCloseTo(22.6, 4)

    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.WIP_FACTORY)).toBe(0)
    expect(ledger.balanceByKey(ACC.INVENTORY_FINISHED)).toBe(toMinor(11300))
    // أجر التصنيع غير المدفوع يظهر كمستحق للمصنع
    expect(ledger.partyBalance(factoryId)).toBe(toMinor(2800))

    const order = production.get(id)
    expect(order.status).toBe('completed')
    expect(order.wip_remaining).toBe(0)
  })

  it('يستوعب فروق التكلفة عند إنتاج كمية أقل من المتوقع', () => {
    buyMaterials()
    const production = new ProductionService(ctx)
    const { id } = production.create({ date: '2026-02-01', factoryId, outputVariantId: shirtVariant, expectedQty: 500 })
    production.issueMaterials({ orderId: id, date: '2026-02-02', items: [{ variantId: fabricVariant, quantity: 800 }] })
    production.addCost({ orderId: id, date: '2026-02-10', costType: 'factory', amount: toMinor(2000) })

    production.receiveOutput({ orderId: id, date: '2026-02-20', quantity: 480, isFinal: true })
    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.WIP_FACTORY)).toBe(0)
    expect(ledger.balanceByKey(ACC.INVENTORY_FINISHED)).toBe(toMinor(10000))
  })

  it('يمنع إلغاء أمر صُرفت له خامات', () => {
    buyMaterials()
    const production = new ProductionService(ctx)
    const { id } = production.create({ date: '2026-02-01', factoryId, outputVariantId: shirtVariant, expectedQty: 100 })
    production.issueMaterials({ orderId: id, date: '2026-02-02', items: [{ variantId: fabricVariant, quantity: 100 }] })
    expect(() => production.cancel(id, 'تغيّر الطلب')).toThrowError(/صُرفت له خامات/)
  })
})

describe('الدورة الكاملة: شراء ← تصنيع ← بيع ← تحصيل ← ربح', () => {
  it('تحافظ على اتساق الأرقام في كل الخطوات', () => {
    const purchases = new PurchaseService(ctx)
    const production = new ProductionService(ctx)
    const sales = new SalesService(ctx)
    const payments = new PaymentService(ctx)
    const expenses = new ExpenseService(ctx)
    const ledger = new LedgerService(ctx)

    // 1) شراء خامات بالآجل
    purchases.create({
      date: '2026-01-05',
      supplierId,
      purchaseType: 'materials',
      items: [
        { variantId: fabricVariant, quantity: 1000, unitPrice: toRate(10) },
        { variantId: buttonVariant, quantity: 2000, unitPrice: toRate(0.5) }
      ]
    })

    // 2) تصنيع 500 قميص
    const { id: orderId } = production.create({ date: '2026-02-01', factoryId, outputVariantId: shirtVariant, expectedQty: 500 })
    production.issueMaterials({
      orderId,
      date: '2026-02-02',
      items: [
        { variantId: fabricVariant, quantity: 800 },
        { variantId: buttonVariant, quantity: 1000 }
      ]
    })
    production.addCost({ orderId, date: '2026-02-10', costType: 'factory', amount: toMinor(2500) })
    production.receiveOutput({ orderId, date: '2026-02-20', quantity: 500, isFinal: true })
    // تكلفة القطعة = (8500 + 2500) / 500 = 22

    // 3) بيع 300 قطعة بسعر 40
    const { id: saleId } = sales.create({
      date: '2026-03-01',
      customerId,
      items: [{ variantId: shirtVariant, quantity: 300, unitPrice: toRate(40) }]
    })

    // 4) تحصيل جزئي
    payments.create({
      date: '2026-03-10',
      direction: 'in',
      partyId: customerId,
      amount: toMinor(8000),
      methodId: cashMethodId(ctx.db),
      allocations: [{ docType: 'sale', docId: saleId, amount: toMinor(8000) }]
    })

    // 5) مصروف تشغيلي
    const rentCategory = (ctx.db.prepare("SELECT id FROM expense_categories WHERE name = 'إيجار'").get() as { id: number }).id
    expenses.create({ date: '2026-03-15', categoryId: rentCategory, amount: toMinor(1500), paymentAccountId: cashAccountId(ctx.db) })

    // ---- التحقق ----
    const inventory = new InventoryService(ctx)
    expect(inventory.stockAt(shirtVariant, warehouseId)).toBe(200)
    expect(inventory.stockAt(fabricVariant, warehouseId)).toBe(200)

    expect(ledger.balanceByKey(ACC.SALES_REVENUE)).toBe(toMinor(12000))
    expect(ledger.balanceByKey(ACC.COGS)).toBe(toMinor(6600))          // 300 × 22
    expect(ledger.partyBalance(customerId)).toBe(toMinor(4000))         // 12000 − 8000
    expect(ledger.partyBalance(supplierId)).toBe(toMinor(11000))        // فاتورة الخامات
    expect(ledger.partyBalance(factoryId)).toBe(toMinor(2500))          // أجر التصنيع
    expect(ledger.balanceByKey(ACC.CASH)).toBe(toMinor(6500))           // 8000 − 1500

    // مخزون البضاعة الجاهزة = 200 × 22 = 4400 ، الخامات = 200×10 + 1000×0.5 = 2500
    expect(ledger.balanceByKey(ACC.INVENTORY_FINISHED)).toBe(toMinor(4400))
    expect(ledger.balanceByKey(ACC.INVENTORY_RAW)).toBe(toMinor(2500))
    expect(inventory.inventoryValue()).toBe(toMinor(6900))

    // ميزان المراجعة متوازن
    const tb = ledger.trialBalance()
    const totalDebit = tb.reduce((s, r) => s + r.debit, 0)
    const totalCredit = tb.reduce((s, r) => s + r.credit, 0)
    expect(totalDebit).toBe(totalCredit)
  })
})
