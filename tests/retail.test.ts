import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACC } from '@main/accounting/chart'
import { LedgerService } from '@main/accounting/ledger'
import { InventoryService } from '@main/inventory/inventory.service'
import { PartyService } from '@main/services/party.service'
import { ProductService } from '@main/services/product.service'
import { SalesService } from '@main/services/sales.service'
import { StockService } from '@main/services/stock.service'
import { ImportService } from '@main/services/import.service'
import { ReportsService } from '@main/reports/reports.service'
import { toMinor, toRate } from '@shared/money'
import type { Ctx } from '@main/core/context'
import { cashAccountId, cashMethodId, createCtx, defaultWarehouseId, removeDir } from './helpers'

let ctx: Ctx
let warehouseId: number
let customerId: number
let courierId: number
let variantId: number
let sku: string
let tmpDir: string

beforeEach(() => {
  ctx = createCtx()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-retail-'))
  warehouseId = defaultWarehouseId(ctx.db)
  const parties = new PartyService(ctx)
  customerId = parties.create({ partyType: 'customer', name: 'عميل تجزئة' })
  courierId = parties.create({ partyType: 'supplier', name: 'شركة الشحن السريع' })

  const productId = new ProductService(ctx).create({ name: 'بلوزة صيفي', unit: 'قطعة' })
  const variant = ctx.db.prepare('SELECT id, sku FROM product_variants WHERE product_id = ?').get(productId) as { id: number; sku: string }
  variantId = variant.id
  sku = variant.sku

  new StockService(ctx).createAdjustment({
    date: '2026-01-01',
    warehouseId,
    adjustmentType: 'opening',
    reason: 'رصيد افتتاحي',
    items: [{ variantId, quantity: 500, unitCost: toRate(60) }]
  })
})

afterEach(() => {
  removeDir(tmpDir)
})

describe('البيع للمستهلك وتكلفة التوصيل', () => {
  it('تُسجَّل قناة البيع على الفاتورة', () => {
    const sales = new SalesService(ctx)
    const { id } = sales.create({
      date: '2026-03-01',
      customerId,
      saleChannel: 'online',
      items: [{ variantId, quantity: 2, unitPrice: toRate(150) }]
    })
    expect(sales.get(id).sale_channel).toBe('online')
  })

  it('العميل يدفع الشحن: إيراد شحن ومصروف توصيل معًا', () => {
    const sales = new SalesService(ctx)
    sales.create({
      date: '2026-03-01',
      customerId,
      saleChannel: 'online',
      items: [{ variantId, quantity: 2, unitPrice: toRate(150) }],
      shippingAmount: toMinor(60),      // حصّلناه من العميل
      deliveryCost: toMinor(45),        // دفعناه لشركة الشحن
      deliveryPaymentAccountId: cashAccountId(ctx.db)
    })

    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.SHIPPING_REVENUE)).toBe(toMinor(60))
    expect(ledger.balanceByKey(ACC.DELIVERY_EXPENSE)).toBe(toMinor(45))
    // الإجمالي على العميل = 300 + 60 شحن ، وتكلفة التوصيل ليست جزءًا منه
    expect(ledger.partyBalance(customerId)).toBe(toMinor(360))
    expect(ledger.balanceByKey(ACC.CASH)).toBe(toMinor(-45))
  })

  it('الشركة تتحمّل الشحن: مصروف توصيل بلا إيراد شحن', () => {
    const sales = new SalesService(ctx)
    sales.create({
      date: '2026-03-01',
      customerId,
      saleChannel: 'retail',
      items: [{ variantId, quantity: 2, unitPrice: toRate(150) }],
      deliveryCost: toMinor(45),
      deliveryPaymentAccountId: cashAccountId(ctx.db)
    })

    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.SHIPPING_REVENUE)).toBe(0)
    expect(ledger.balanceByKey(ACC.DELIVERY_EXPENSE)).toBe(toMinor(45))
    expect(ledger.partyBalance(customerId)).toBe(toMinor(300))
  })

  it('تكلفة التوصيل الآجلة تُسجَّل على حساب شركة الشحن', () => {
    const sales = new SalesService(ctx)
    sales.create({
      date: '2026-03-01',
      customerId,
      items: [{ variantId, quantity: 1, unitPrice: toRate(150) }],
      deliveryCost: toMinor(40),
      deliveryPartyId: courierId
    })
    const ledger = new LedgerService(ctx)
    expect(ledger.partyBalance(courierId)).toBe(toMinor(40))
    expect(ledger.balanceByKey(ACC.DELIVERY_EXPENSE)).toBe(toMinor(40))
  })

  it('ترفض تكلفة توصيل بلا شركة شحن ولا حساب دفع', () => {
    const sales = new SalesService(ctx)
    expect(() =>
      sales.create({
        date: '2026-03-01',
        customerId,
        items: [{ variantId, quantity: 1, unitPrice: toRate(150) }],
        deliveryCost: toMinor(40)
      })
    ).toThrowError(/حدّد شركة الشحن/)
  })

  it('تكلفة التوصيل تُخفّض ربح الطلب وتظهر في الأرباح والخسائر', () => {
    const sales = new SalesService(ctx)
    sales.create({
      date: '2026-03-01',
      customerId,
      items: [{ variantId, quantity: 2, unitPrice: toRate(150) }],
      shippingAmount: toMinor(60),
      deliveryCost: toMinor(45),
      deliveryPaymentAccountId: cashAccountId(ctx.db)
    })

    const pl = new ReportsService(ctx).profitAndLoss({ from: '2026-03-01', to: '2026-03-31' })
    expect(pl.totalRevenue).toBe(toMinor(360))      // 300 بضاعة + 60 شحن
    expect(pl.totalCogs).toBe(toMinor(120))         // 2 × 60
    expect(pl.grossProfit).toBe(toMinor(240))
    expect(pl.totalExpenses).toBe(toMinor(45))      // تكلفة التوصيل
    expect(pl.netProfit).toBe(toMinor(195))
  })

  it('الإلغاء يعكس تكلفة التوصيل أيضًا', () => {
    const sales = new SalesService(ctx)
    const { id } = sales.create({
      date: '2026-03-01',
      customerId,
      items: [{ variantId, quantity: 2, unitPrice: toRate(150) }],
      deliveryCost: toMinor(45),
      deliveryPartyId: courierId
    })
    sales.void(id, 'طلب ملغى من العميل')

    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.DELIVERY_EXPENSE)).toBe(0)
    expect(ledger.partyBalance(courierId)).toBe(0)
    expect(ledger.partyBalance(customerId)).toBe(0)
  })
})

describe('المرتجعات غير الصالحة للبيع', () => {
  function sell(): number {
    return new SalesService(ctx).create({
      date: '2026-03-01',
      customerId,
      saleChannel: 'online',
      items: [{ variantId, quantity: 10, unitPrice: toRate(150) }],
      shippingAmount: toMinor(60),
      deliveryCost: toMinor(45),
      deliveryPaymentAccountId: cashAccountId(ctx.db)
    }).id
  }

  it('المرتجع الصالح يعود للمخزون ويُخفّض التكلفة', () => {
    const saleId = sell()
    const itemId = (ctx.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId) as { id: number }).id
    const inventory = new InventoryService(ctx)
    expect(inventory.stockAt(variantId, warehouseId)).toBe(490)

    new SalesService(ctx).createReturn({
      date: '2026-03-05',
      saleId,
      customerId,
      restock: true,
      items: [{ saleItemId: itemId, variantId, quantity: 3, unitPrice: toRate(150) }]
    })

    expect(inventory.stockAt(variantId, warehouseId)).toBe(493)
    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.COGS)).toBe(toMinor(420))            // 600 − 180
    expect(ledger.balanceByKey(ACC.INVENTORY_ADJUSTMENT)).toBe(0)
  })

  it('المرتجع التالف لا يعود للمخزون وتُحمَّل تكلفته على التلف', () => {
    const saleId = sell()
    const itemId = (ctx.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId) as { id: number }).id

    new SalesService(ctx).createReturn({
      date: '2026-03-05',
      saleId,
      customerId,
      restock: false,
      reason: 'وصلت متسخة وغير صالحة للبيع',
      items: [{ saleItemId: itemId, variantId, quantity: 3, unitPrice: toRate(150) }]
    })

    const inventory = new InventoryService(ctx)
    expect(inventory.stockAt(variantId, warehouseId)).toBe(490)          // لم تعد للمخزون
    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.COGS)).toBe(toMinor(420))             // خرجت من تكلفة المبيعات
    expect(ledger.balanceByKey(ACC.INVENTORY_ADJUSTMENT)).toBe(toMinor(180)) // وحُمِّلت على التلف
    expect(ledger.partyBalance(customerId)).toBe(toMinor(1110))          // 1560 − 450
  })

  it('يمكن خلط أصناف صالحة وتالفة في مردود واحد', () => {
    const saleId = sell()
    const itemId = (ctx.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId) as { id: number }).id

    new SalesService(ctx).createReturn({
      date: '2026-03-05',
      saleId,
      customerId,
      restock: true,
      items: [
        { saleItemId: itemId, variantId, quantity: 2, unitPrice: toRate(150), restock: true },
        { saleItemId: itemId, variantId, quantity: 1, unitPrice: toRate(150), restock: false }
      ]
    })

    expect(new InventoryService(ctx).stockAt(variantId, warehouseId)).toBe(492)
    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.INVENTORY_ADJUSTMENT)).toBe(toMinor(60))
  })

  it('ردّ الشحن للعميل يُخصم من إيراد الشحن', () => {
    const saleId = sell()
    const itemId = (ctx.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId) as { id: number }).id

    new SalesService(ctx).createReturn({
      date: '2026-03-05',
      saleId,
      customerId,
      refundedShipping: toMinor(60),
      items: [{ saleItemId: itemId, variantId, quantity: 10, unitPrice: toRate(150) }]
    })

    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.SHIPPING_REVENUE)).toBe(0)
    expect(ledger.partyBalance(customerId)).toBe(0)   // رُدّ كل شيء
  })

  it('يمنع ردّ شحن أكبر مما حُصِّل', () => {
    const saleId = sell()
    const itemId = (ctx.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId) as { id: number }).id
    expect(() =>
      new SalesService(ctx).createReturn({
        date: '2026-03-05',
        saleId,
        customerId,
        refundedShipping: toMinor(200),
        items: [{ saleItemId: itemId, variantId, quantity: 1, unitPrice: toRate(150) }]
      })
    ).toThrowError(/أكبر مما حُصِّل/)
  })

  it('تكلفة إرجاع الشحنة تُسجَّل مصروف توصيل', () => {
    const saleId = sell()
    const itemId = (ctx.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId) as { id: number }).id

    new SalesService(ctx).createReturn({
      date: '2026-03-05',
      saleId,
      customerId,
      deliveryCost: toMinor(35),
      deliveryPartyId: courierId,
      items: [{ saleItemId: itemId, variantId, quantity: 2, unitPrice: toRate(150) }]
    })

    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.DELIVERY_EXPENSE)).toBe(toMinor(80))  // 45 إرسال + 35 إرجاع
    expect(ledger.partyBalance(courierId)).toBe(toMinor(35))
  })

  it('ميزان المراجعة يبقى متوازنًا بعد كل ذلك', () => {
    const saleId = sell()
    const itemId = (ctx.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId) as { id: number }).id
    new SalesService(ctx).createReturn({
      date: '2026-03-05',
      saleId,
      customerId,
      restock: false,
      refundedShipping: toMinor(60),
      deliveryCost: toMinor(35),
      deliveryPartyId: courierId,
      items: [{ saleItemId: itemId, variantId, quantity: 4, unitPrice: toRate(150) }]
    })
    const tb = new ReportsService(ctx).trialBalance('2026-12-31')
    expect(tb.totalDebit).toBe(tb.totalCredit)
  })
})

describe('استيراد فواتير البيع من ملف', () => {
  function writeCsv(content: string): string {
    const file = path.join(tmpDir, 'sales.csv')
    fs.writeFileSync(file, content, 'utf8')
    return file
  }

  it('يجمع الأسطر في فواتير ويحفظها بأرقامها الأصلية', async () => {
    const file = writeCsv(
      'رقم الفاتورة,التاريخ,العميل,قناة البيع,كود الصنف,الكمية,سعر الوحدة,المبلغ المحصَّل\n' +
        `S-1001,01/03/2026,محل الورد,تجزئة,${sku},3,150,450\n` +
        `S-1001,01/03/2026,محل الورد,تجزئة,${sku},2,140,\n` +
        `S-1002,02/03/2026,أحمد علي,أونلاين,${sku},1,160,160\n`
    )

    const service = new ImportService(ctx)
    const preview = await service.preview('sales', file)
    expect(preview.rows).toHaveLength(3)
    expect(preview.errorCount).toBe(0)

    const result = service.commit('sales', preview.rows)
    expect(result.imported).toBe(2)

    const sales = new SalesService(ctx)
    const list = sales.list({ pageSize: 50 })
    expect(list.total).toBe(2)

    const first = list.rows.find((r) => r.invoice_number === 'S-1001') as Record<string, unknown>
    expect(Number(first.total)).toBe(toMinor(730))      // 3×150 + 2×140
    expect(Number(first.paid_amount)).toBe(toMinor(450))
    expect(Number(first.item_count)).toBe(2)

    const detail = sales.get(Number(first.id))
    expect(detail.sale_channel).toBe('retail')
  })

  it('ينشئ العملاء غير الموجودين تلقائيًا', async () => {
    const file = writeCsv(
      `رقم الفاتورة,التاريخ,العميل,هاتف العميل,كود الصنف,الكمية,سعر الوحدة\nS-2001,05/03/2026,عميل جديد تمامًا,01099887766,${sku},1,150\n`
    )
    const service = new ImportService(ctx)
    const preview = await service.preview('sales', file)
    service.commit('sales', preview.rows)

    const created = ctx.db.prepare("SELECT * FROM parties WHERE name = 'عميل جديد تمامًا'").get() as Record<string, unknown>
    expect(created).toBeTruthy()
    expect(created.phone).toBe('01099887766')
  })

  it('يستورد الشحن وتكلفة التوصيل مرة واحدة لكل فاتورة', async () => {
    const file = writeCsv(
      'رقم الفاتورة,التاريخ,العميل,كود الصنف,الكمية,سعر الوحدة,الشحن المحصَّل من العميل,تكلفة التوصيل علينا\n' +
        `S-3001,07/03/2026,عميل تجزئة,${sku},2,150,50,35\n` +
        `S-3001,07/03/2026,عميل تجزئة,${sku},1,150,,\n`
    )
    const service = new ImportService(ctx)
    const preview = await service.preview('sales', file)
    service.commit('sales', preview.rows)

    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.SHIPPING_REVENUE)).toBe(toMinor(50))
    expect(ledger.balanceByKey(ACC.DELIVERY_EXPENSE)).toBe(toMinor(35))
  })

  it('يخصم المخزون ويحتسب التكلفة تمامًا كالإدخال اليدوي', async () => {
    const file = writeCsv(
      `رقم الفاتورة,التاريخ,العميل,كود الصنف,الكمية,سعر الوحدة\nS-4001,09/03/2026,عميل تجزئة,${sku},25,150\n`
    )
    const service = new ImportService(ctx)
    service.commit('sales', (await service.preview('sales', file)).rows)

    expect(new InventoryService(ctx).stockAt(variantId, warehouseId)).toBe(475)
    const ledger = new LedgerService(ctx)
    expect(ledger.balanceByKey(ACC.COGS)).toBe(toMinor(1500))   // 25 × 60
    expect(ledger.balanceByKey(ACC.SALES_REVENUE)).toBe(toMinor(3750))
  })

  it('يرفض الأصناف غير الموجودة والفواتير المكرّرة', async () => {
    const existing = writeCsv(`رقم الفاتورة,التاريخ,العميل,كود الصنف,الكمية,سعر الوحدة\nS-5001,10/03/2026,عميل تجزئة,${sku},1,150\n`)
    const service = new ImportService(ctx)
    service.commit('sales', (await service.preview('sales', existing)).rows)

    const bad = writeCsv(
      'رقم الفاتورة,التاريخ,العميل,كود الصنف,الكمية,سعر الوحدة\n' +
        `S-5001,10/03/2026,عميل تجزئة,${sku},1,150\n` +
        'S-5002,10/03/2026,عميل تجزئة,SKU-NOT-EXIST,1,150\n'
    )
    const preview = await service.preview('sales', bad)
    expect(preview.errorCount).toBe(2)
    expect(preview.rows[0].errors[0]).toContain('مسجَّلة من قبل')
    expect(preview.rows[1].errors[0]).toContain('لا يوجد صنف')
  })

  it('لا يحفظ فاتورة تتجاوز الرصيد المتاح ويبلّغ عنها', async () => {
    const file = writeCsv(
      `رقم الفاتورة,التاريخ,العميل,كود الصنف,الكمية,سعر الوحدة\nS-6001,11/03/2026,عميل تجزئة,${sku},9999,150\n`
    )
    const service = new ImportService(ctx)
    const result = service.commit('sales', (await service.preview('sales', file)).rows)
    expect(result.imported).toBe(0)
    expect(result.failures[0].message).toContain('الكمية المتاحة')
    expect(new SalesService(ctx).list({ pageSize: 10 }).total).toBe(0)
  })

  it('يولّد قالب Excel لفواتير البيع', async () => {
    const target = path.join(tmpDir, 'sales-template.xlsx')
    await new ImportService(ctx).writeTemplate('sales', target)
    expect(fs.statSync(target).size).toBeGreaterThan(1000)
  })
})
