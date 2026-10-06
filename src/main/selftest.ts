import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { formatMoney, toMinor, toRate } from '@shared/money'
import { AppContainer } from './core/container'
import { ROUTES } from './ipc'
import { ACC } from './accounting/chart'
import { LedgerService } from './accounting/ledger'
import type { AppPaths } from './core/paths'

/**
 * فحص ذاتي شامل يعمل داخل بيئة Electron الحقيقية.
 * يمرّ على نفس طبقة الاستدعاءات التي تستخدمها الواجهة (بما فيها فحص الصلاحيات)،
 * وينفّذ دورة عمل كاملة ثم يتحقق من الأرقام وينتج ملفات PDF فعلية.
 *
 * الاستخدام: تشغيل التطبيق بمُعامل ‎--self-test‎ — يُستخدم للتأكد من سلامة التثبيت.
 */
interface Check {
  name: string
  ok: boolean
  detail: string
}

const checks: Check[] = []
const lines: string[] = []

const money = (minor: number): string => formatMoney(minor, { showSymbol: false })

/** يُكتب التقرير إلى الطرفية وإلى ملف معًا، لأن مخرجات العملية الرئيسية
 *  قد لا تصل إلى الطرفية عند تشغيل التطبيق من حزمة مثبَّتة على macOS */
let reportFile = path.join(os.tmpdir(), 'hesabat-selftest.txt')

function say(text: string): void {
  lines.push(text)
  console.log(text)
  try {
    fs.writeFileSync(reportFile, lines.join('\n'))
  } catch {
    // تجاهل فشل الكتابة
  }
}

function record(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail })
  say(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function expect(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  record(name, ok, ok ? String(actual) : `المتوقع ${String(expected)} والفعلي ${String(actual)}`)
}

export async function runSelfTest(): Promise<number> {
  const argIndex = process.argv.indexOf('--report')
  const keepArtifacts = argIndex !== -1
  if (argIndex !== -1 && process.argv[argIndex + 1]) reportFile = process.argv[argIndex + 1]
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-selftest-'))
  const paths: AppPaths = {
    userData: root,
    databaseFile: path.join(root, 'data', 'business.db'),
    backupsDir: path.join(root, 'backups'),
    attachmentsDir: path.join(root, 'attachments'),
    logsDir: path.join(root, 'logs'),
    exportsDir: path.join(root, 'exports'),
    resourcesDir: app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')
  }
  for (const dir of [path.dirname(paths.databaseFile), paths.backupsDir, paths.attachmentsDir, paths.logsDir, paths.exportsDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const container = new AppContainer(paths, app.getVersion())

  const call = async <T = unknown>(channel: string, payload?: unknown): Promise<T> => {
    const route = ROUTES[channel]
    if (!route) throw new Error(`قناة غير معروفة: ${channel}`)
    if (!route.public && !container.currentUser) throw new Error(`القناة ${channel} تتطلب تسجيل الدخول`)
    if (route.permission && !container.currentUser?.permissions.includes(route.permission)) {
      throw new Error(`القناة ${channel} تتطلب صلاحية ${route.permission}`)
    }
    return (await route.handler(container, payload)) as T
  }

  say('\n═══ الفحص الذاتي لنظام إدارة الأعمال ═══\n')

  try {
    // ١) الإعداد الأولي
    const info = await call<{ setupCompleted: boolean; hasUsers: boolean }>('app:info')
    expect('قاعدة بيانات جديدة بلا إعداد', info.setupCompleted, false)

    await call('setup:run', {
      company: { name: 'مصنع النور للملابس الجاهزة', phone: '01000000000', address: 'القاهرة' },
      currency: { code: 'EGP', symbol: 'ج.م', name: 'جنيه مصري', decimals: 2 },
      admin: { username: 'admin', fullName: 'محمد أحمد', password: 'Admin1234' },
      warehouse: { code: 'MAIN', name: 'المخزن الرئيسي' },
      backup: { frequency: 'daily', localEnabled: true, encrypt: true, retentionCount: 5 }
    })
    record('تنفيذ معالج الإعداد الأولي', true)

    // ٢) منع الوصول قبل تسجيل الدخول
    let blocked = false
    try {
      await call('sales:list', {})
    } catch {
      blocked = true
    }
    expect('رفض الاستدعاءات قبل تسجيل الدخول', blocked, true)

    // ٣) تسجيل الدخول
    let wrongRejected = false
    try {
      await call('auth:login', { username: 'admin', password: 'wrong' })
    } catch {
      wrongRejected = true
    }
    expect('رفض كلمة المرور الخاطئة', wrongRejected, true)

    const session = await call<{ fullName: string; permissions: string[] }>('auth:login', {
      username: 'admin',
      password: 'Admin1234'
    })
    expect('تسجيل الدخول بنجاح', session.fullName, 'محمد أحمد')
    record('عدد الصلاحيات', session.permissions.length > 25, `${session.permissions.length} صلاحية`)

    // ٤) البيانات الأساسية
    const supplierId = await call<number>('parties:create', { partyType: 'supplier', name: 'مورد الأقمشة' })
    const factoryId = await call<number>('parties:create', { partyType: 'factory', name: 'مصنع الإتقان' })
    const customerId = await call<number>('parties:create', { partyType: 'customer', name: 'محل الأمانة', openingBalance: toMinor(2000) })
    record('إنشاء مورد ومصنع وعميل', supplierId > 0 && factoryId > 0 && customerId > 0)

    const fabricId = await call<number>('products:create', { name: 'قماش قطن', productType: 'raw', unit: 'متر' })
    const buttonId = await call<number>('products:create', { name: 'أزرار', productType: 'raw', unit: 'حبة' })
    const shirtId = await call<number>('products:create', {
      name: 'قميص رجالي',
      unit: 'قطعة',
      variants: [{ size: 'L', color: 'أبيض', salePrice: toRate(180) }]
    })
    const variantOf = (productId: number): number =>
      (container.db.prepare('SELECT id FROM product_variants WHERE product_id = ?').get(productId) as { id: number }).id
    const fabric = variantOf(fabricId)
    const button = variantOf(buttonId)
    const shirt = variantOf(shirtId)
    record('إنشاء المنتجات والخامات', true, '٣ منتجات')

    // ٥) شراء خامات مع شحن يُوزَّع على التكلفة
    const purchase = await call<{ id: number; invoiceNumber: string }>('purchases:create', {
      date: '2026-01-10',
      supplierId,
      purchaseType: 'materials',
      items: [
        { variantId: fabric, quantity: 1000, unitPrice: toRate(10) },
        { variantId: button, quantity: 2000, unitPrice: toRate(0.5) }
      ],
      shippingAmount: toMinor(1100)
    })
    record('تسجيل فاتورة شراء خامات', Boolean(purchase.invoiceNumber), purchase.invoiceNumber)

    const ledger = new LedgerService(container.ctx())
    expect('رصيد المورد بعد الشراء', ledger.partyBalance(supplierId), toMinor(12_100))
    expect('قيمة مخزون الخامات', ledger.balanceByKey(ACC.INVENTORY_RAW), toMinor(12_100))

    // ٦) أمر إنتاج كامل
    const order = await call<{ id: number; orderNumber: string }>('production:create', {
      date: '2026-02-01',
      factoryId,
      outputVariantId: shirt,
      expectedQty: 500
    })
    await call('production:issueMaterials', {
      orderId: order.id,
      date: '2026-02-02',
      items: [
        { variantId: fabric, quantity: 800 },
        { variantId: button, quantity: 1000 }
      ]
    })
    await call('production:addCost', { orderId: order.id, date: '2026-02-10', costType: 'factory', amount: toMinor(3000), description: 'أجر تصنيع' })
    const output = await call<{ unitCost: number; totalCost: number }>('production:receiveOutput', {
      orderId: order.id,
      date: '2026-02-20',
      quantity: 500,
      isFinal: true
    })
    // الخامات: 800 × 11 + 1000 × 0.55 = 9350 ، + أجر 3000 = 12350 ⇒ تكلفة القطعة 24.70
    expect('إجمالي تكلفة الإنتاج', output.totalCost, toMinor(12_350))
    expect('تكلفة القطعة المنتجة', output.unitCost, toRate(24.7))
    expect('رصيد بضاعة لدى المصانع بعد الإقفال', ledger.balanceByKey(ACC.WIP_FACTORY), 0)
    expect('مستحقات المصنع', ledger.partyBalance(factoryId), toMinor(3000))

    // ٧) بيع مع تحصيل جزئي
    const sale = await call<{ id: number; invoiceNumber: string }>('sales:create', {
      date: '2026-03-01',
      customerId,
      items: [{ variantId: shirt, quantity: 300, unitPrice: toRate(180) }],
      payment: { amount: toMinor(30_000), methodId: 1 }
    })
    record('تسجيل فاتورة بيع مع تحصيل', Boolean(sale.invoiceNumber), sale.invoiceNumber)

    const saleDoc = await call<Record<string, number>>('sales:get', { id: sale.id })
    expect('إجمالي الفاتورة', saleDoc.total, toMinor(54_000))
    expect('تكلفة البضاعة المباعة', saleDoc.cogs_amount, toMinor(7410))
    expect('المحصَّل من الفاتورة', saleDoc.paid_amount, toMinor(30_000))
    expect('رصيد العميل', ledger.partyBalance(customerId), toMinor(26_000)) // 2000 افتتاحي + 54000 − 30000

    // ٨) منع البيع بأكثر من الرصيد
    let stockBlocked = false
    try {
      await call('sales:create', { date: '2026-03-02', customerId, items: [{ variantId: shirt, quantity: 5000, unitPrice: toRate(180) }] })
    } catch (error) {
      stockBlocked = /الكمية المتاحة/.test(error instanceof Error ? error.message : '')
    }
    expect('منع البيع عند نفاد المخزون', stockBlocked, true)

    // ٩) التقارير
    const pl = await call<{ totalRevenue: number; totalCogs: number; grossProfit: number }>('reports:profitAndLoss', {
      from: '2026-01-01',
      to: '2026-12-31'
    })
    expect('إيراد قائمة الأرباح', pl.totalRevenue, toMinor(54_000))
    expect('تكلفة المبيعات', pl.totalCogs, toMinor(7410))
    expect('مجمل الربح', pl.grossProfit, toMinor(46_590))

    const trial = await call<{ totalDebit: number; totalCredit: number }>('reports:trialBalance', { asOf: '2026-12-31' })
    expect('توازن ميزان المراجعة', trial.totalDebit, trial.totalCredit)

    const dashboard = await call<{ kpis: Record<string, number> }>('dashboard:load', { preset: 'custom', custom: { from: '2026-01-01', to: '2026-12-31' } })
    expect('مبيعات لوحة المعلومات', dashboard.kpis.salesPeriod, toMinor(54_000))
    expect('قيمة المخزون', dashboard.kpis.inventoryValue, toMinor(200 * 24.7 + 200 * 11 + 1000 * 0.55))

    // ١٠) كشف الحساب
    const statement = await call<{ lines: unknown[]; closingBalance: number }>('parties:statement', {
      partyId: customerId,
      from: '2026-01-01',
      to: '2026-12-31'
    })
    expect('الرصيد الختامي في كشف الحساب', statement.closingBalance, toMinor(26_000))
    record('عدد حركات كشف الحساب', statement.lines.length === 3, `${statement.lines.length} حركة`)

    // ١١) توليد ملفات PDF فعلية (يتحقق من ظهور العربية والخط المضمَّن)
    const invoicePdf = await call<{ path: string }>('print:pdf', { docType: 'sale', id: sale.id, savePath: path.join(root, 'invoice.pdf') })
    const statementPdf = await call<{ path: string }>('print:pdf', {
      docType: 'statement',
      params: { partyId: customerId, from: '2026-01-01', to: '2026-12-31' },
      savePath: path.join(root, 'statement.pdf')
    })
    const orderPdf = await call<{ path: string }>('print:pdf', { docType: 'production_order', id: order.id, savePath: path.join(root, 'order.pdf') })
    for (const [label, file] of [['فاتورة البيع', invoicePdf.path], ['كشف الحساب', statementPdf.path], ['أمر الإنتاج', orderPdf.path]] as const) {
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0
      record(`توليد PDF — ${label}`, size > 20_000, `${Math.round(size / 1024)} ك.ب`)
    }

    // ١٢) التصدير إلى Excel
    const excel = await call<{ path: string }>('export:excel', {
      savePath: path.join(root, 'report.xlsx'),
      table: {
        title: 'تقرير المبيعات',
        columns: [
          { key: 'invoice_number', label: 'رقم الفاتورة' },
          { key: 'total', label: 'الإجمالي', type: 'money' }
        ],
        rows: [{ invoice_number: sale.invoiceNumber, total: toMinor(54_000) }]
      }
    })
    record('تصدير Excel', fs.statSync(excel.path).size > 3000, `${Math.round(fs.statSync(excel.path).size / 1024)} ك.ب`)

    // ١٣) سلامة البيانات
    const integrity = await call<{ ok: boolean; issues: unknown[] }>('integrity:check')
    expect('فحص سلامة البيانات', integrity.ok, true)

    // ١٤) النسخ الاحتياطي والتحقق منه
    const backup = await call<{ filePath: string; encrypted: boolean; sizeBytes: number }>('backup:create')
    record('إنشاء نسخة احتياطية مشفّرة', backup.encrypted && backup.sizeBytes > 0, `${Math.round(backup.sizeBytes / 1024)} ك.ب`)
    const verification = await call<{ ok: boolean }>('backup:verify', { filePath: backup.filePath })
    expect('التحقق من سلامة النسخة الاحتياطية', verification.ok, true)

    // ١٥) الإلغاء يُنشئ قيدًا عكسيًا ولا يحذف
    const payment = await call<{ id: number }>('payments:create', {
      date: '2026-03-05',
      direction: 'in',
      partyId: customerId,
      amount: toMinor(5000),
      methodId: 1
    })
    await call('payments:void', { id: payment.id, reason: 'خطأ في المبلغ' })
    expect('رصيد العميل بعد إلغاء السند', ledger.partyBalance(customerId), toMinor(26_000))
    const paymentRow = container.db.prepare('SELECT status FROM payments WHERE id = ?').get(payment.id) as { status: string }
    expect('السند الملغى يبقى في السجل', paymentRow.status, 'void')

    // ١٦) البيع للمستهلك: الشحن المحصَّل مقابل تكلفة التوصيل
    const cashId = (container.db.prepare("SELECT id FROM accounts WHERE system_key = 'cash'").get() as { id: number }).id
    const courierId = await call<number>('parties:create', { partyType: 'supplier', name: 'شركة شحن' })
    const revenueBefore = ledger.balanceByKey(ACC.SHIPPING_REVENUE)

    const retailSale = await call<{ id: number }>('sales:create', {
      date: '2026-03-20',
      customerId,
      saleChannel: 'online',
      items: [{ variantId: shirt, quantity: 2, unitPrice: toRate(200) }],
      shippingAmount: toMinor(50),
      deliveryCost: toMinor(35),
      deliveryPaymentAccountId: cashId
    })
    expect('إيراد الشحن المحصَّل', ledger.balanceByKey(ACC.SHIPPING_REVENUE) - revenueBefore, toMinor(50))
    expect('مصروف تكلفة التوصيل', ledger.balanceByKey(ACC.DELIVERY_EXPENSE), toMinor(35))
    const retailDoc = await call<Record<string, unknown>>('sales:get', { id: retailSale.id })
    expect('قناة البيع محفوظة', String(retailDoc.sale_channel), 'online')
    expect('تكلفة التوصيل خارج إجمالي الفاتورة', Number(retailDoc.total), toMinor(450))

    // ١٧) مرتجع غير صالح للبيع مع تكلفة إرجاع
    const retailItemId = (container.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(retailSale.id) as { id: number }).id
    const stockBefore = container.db
      .prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM stock_levels WHERE variant_id = ?')
      .get(shirt) as { q: number }

    await call('sales:createReturn', {
      date: '2026-03-25',
      saleId: retailSale.id,
      customerId,
      restock: false,
      reason: 'وصلت تالفة',
      deliveryCost: toMinor(25),
      deliveryPartyId: courierId,
      items: [{ saleItemId: retailItemId, variantId: shirt, quantity: 1, unitPrice: toRate(200) }]
    })
    const stockAfter = container.db
      .prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM stock_levels WHERE variant_id = ?')
      .get(shirt) as { q: number }
    expect('المرتجع التالف لا يعود للمخزون', stockAfter.q, stockBefore.q)
    expect('تكلفة إرجاع الشحنة على حساب شركة الشحن', ledger.partyBalance(courierId), toMinor(25))
    record('تكلفة المرتجع التالف حُمِّلت على التلف', ledger.balanceByKey(ACC.INVENTORY_ADJUSTMENT) > 0, money(ledger.balanceByKey(ACC.INVENTORY_ADJUSTMENT)))

    // ١٨) الميزان يبقى متوازنًا بعد كل عمليات البيع للمستهلك
    const finalTrial = await call<{ totalDebit: number; totalCredit: number }>('reports:trialBalance', { asOf: '2026-12-31' })
    expect('توازن ميزان المراجعة النهائي', finalTrial.totalDebit, finalTrial.totalCredit)

    // ١٩) المبيعات حسب القناة
    const byChannel = await call<Record<string, unknown>[]>('reports:sales', { from: '2026-01-01', to: '2026-12-31', groupBy: 'channel' })
    record('تقرير المبيعات حسب القناة', byChannel.length >= 2, `${byChannel.length} قناة`)

    // ٢٠) سجل المراجعة
    const audit = await call<{ total: number }>('audit:query', { pageSize: 10 })
    record('سجل المراجعة يحتوي على الحركات', audit.total > 10, `${audit.total} سجل`)
  } catch (error) {
    record('اكتمال الفحص دون أخطاء', false, error instanceof Error ? error.message : String(error))
    say(String(error instanceof Error ? error.stack : error))
  } finally {
    container.close()
  }

  const failed = checks.filter((c) => !c.ok)
  say('\n─────────────────────────────────────────')
  say(`الإجمالي: ${checks.length} فحص · نجح ${checks.length - failed.length} · فشل ${failed.length}`)
  if (failed.length) {
    say('\nالفحوصات الفاشلة:')
    for (const check of failed) say(`  ✘ ${check.name} — ${check.detail}`)
  } else {
    say('النتيجة: النظام سليم وجاهز للعمل ✔')
  }
  say('─────────────────────────────────────────')
  say(`تقرير الفحص محفوظ في: ${reportFile}`)

  // عند طلب تقرير صريح تُحفظ الملفات المولَّدة بجواره لفحصها يدويًا
  if (keepArtifacts) {
    const artifacts = path.join(path.dirname(reportFile), 'selftest-artifacts')
    fs.rmSync(artifacts, { recursive: true, force: true })
    fs.mkdirSync(artifacts, { recursive: true })
    for (const name of fs.readdirSync(root)) {
      const source = path.join(root, name)
      if (fs.statSync(source).isFile()) fs.copyFileSync(source, path.join(artifacts, name))
    }
    say(`الملفات المولَّدة محفوظة في: ${artifacts}`)
  }
  fs.rmSync(root, { recursive: true, force: true })
  return failed.length === 0 ? 0 : 1
}
