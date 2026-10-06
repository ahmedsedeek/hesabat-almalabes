import type { Database } from 'better-sqlite3'
import { isoDate, todayIso } from '@shared/date'
import type { Minor } from '@shared/money'
import type { DateRange } from '@shared/types'
import type { Ctx } from '../core/context'
import { LedgerService } from '../accounting/ledger'
import { ACC } from '../accounting/chart'
import { InventoryService } from '../inventory/inventory.service'
import { ReportsService } from './reports.service'

export type PeriodPreset =
  | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'custom'

export interface DashboardData {
  range: DateRange
  kpis: {
    salesToday: Minor
    salesMonth: Minor
    salesPeriod: Minor
    salesCount: Minor
    purchasesPeriod: Minor
    expensesPeriod: Minor
    grossProfit: Minor
    netProfit: Minor
    cashBalance: Minor
    bankBalance: Minor
    receivables: Minor
    payables: Minor
    factoryPayables: Minor
    inventoryValue: Minor
    wipValue: Minor
    customerCount: number
    supplierCount: number
    factoryCount: number
    productCount: number
    overdueReceivables: Minor
    overduePayables: Minor
  }
  charts: {
    salesOverTime: { label: string; sales: Minor; profit: Minor; cost: Minor }[]
    expensesOverTime: { label: string; amount: Minor }[]
    topCustomers: { label: string; amount: Minor }[]
    topProducts: { label: string; quantity: number; amount: Minor }[]
    topSuppliers: { label: string; amount: Minor }[]
    expensesByCategory: { label: string; amount: Minor }[]
    salesByChannel: { label: string; amount: Minor; profit: Minor }[]
    receivablesAging: { label: string; amount: Minor }[]
    payablesAging: { label: string; amount: Minor }[]
  }
  alerts: {
    lowStock: { name: string; sku: string; quantity: number; minStock: number }[]
    overdueCustomers: { id: number; name: string; phone: string | null; due: Minor; days: number }[]
    openProductionOrders: { id: number; orderNumber: string; factory: string; expectedDate: string | null; lateDays: number }[]
    negativeStock: { name: string; sku: string; quantity: number; warehouse: string }[]
  }
  recent: {
    sales: Record<string, unknown>[]
    payments: Record<string, unknown>[]
  }
}

function iso(d: Date): string {
  return isoDate(d)
}

/** تحويل فترة مختصرة إلى مدى تواريخ */
export function resolvePeriod(preset: PeriodPreset, custom?: DateRange, today = new Date()): DateRange {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const startOfMonth = new Date(base.getFullYear(), base.getMonth(), 1)
  switch (preset) {
    case 'today':
      return { from: isoDate(base), to: isoDate(base) }
    case 'yesterday': {
      const y = new Date(base); y.setDate(y.getDate() - 1)
      return { from: isoDate(y), to: isoDate(y) }
    }
    case 'this_week': {
      // الأسبوع يبدأ من السبت في معظم دول المنطقة
      const day = base.getDay() // 0=الأحد .. 6=السبت
      const diff = (day + 1) % 7
      const start = new Date(base); start.setDate(start.getDate() - diff)
      return { from: isoDate(start), to: isoDate(base) }
    }
    case 'last_month': {
      const start = new Date(base.getFullYear(), base.getMonth() - 1, 1)
      const end = new Date(base.getFullYear(), base.getMonth(), 0)
      return { from: isoDate(start), to: isoDate(end) }
    }
    case 'this_quarter': {
      const q = Math.floor(base.getMonth() / 3)
      return { from: iso(new Date(base.getFullYear(), q * 3, 1)), to: isoDate(base) }
    }
    case 'this_year':
      return { from: iso(new Date(base.getFullYear(), 0, 1)), to: isoDate(base) }
    case 'custom':
      return custom ?? { from: isoDate(startOfMonth), to: isoDate(base) }
    case 'this_month':
    default:
      return { from: isoDate(startOfMonth), to: isoDate(base) }
  }
}

/** لوحة المعلومات — تجمع مؤشرات الأداء والرسوم البيانية والتنبيهات في استدعاء واحد */
export class DashboardService {
  private readonly db: Database
  private readonly ledger: LedgerService
  private readonly inventory: InventoryService
  private readonly reports: ReportsService

  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db
    this.ledger = new LedgerService(ctx)
    this.inventory = new InventoryService(ctx)
    this.reports = new ReportsService(ctx)
  }

  load(preset: PeriodPreset = 'this_month', custom?: DateRange, overdueDays = 30): DashboardData {
    const range = resolvePeriod(preset, custom)
    const today = todayIso()
    const monthStart = today.slice(0, 8) + '01'

    const sum = (sql: string, params: Record<string, unknown> | DateRange = {}): number =>
      ((this.db.prepare(sql).get(params as Record<string, unknown>) as { v: number | null })?.v ?? 0)

    const salesToday = sum(
      "SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE status = 'confirmed' AND date = @d", { d: today }
    )
    const salesMonth = sum(
      "SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE status = 'confirmed' AND date >= @from AND date <= @to",
      { from: monthStart, to: today }
    )
    const salesPeriod = sum(
      "SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE status = 'confirmed' AND date >= @from AND date <= @to", range
    )
    const salesCount = sum(
      "SELECT COUNT(*) AS v FROM sales WHERE status = 'confirmed' AND date >= @from AND date <= @to", range
    )
    const purchasesPeriod = sum(
      "SELECT COALESCE(SUM(total),0) AS v FROM purchases WHERE status = 'confirmed' AND date >= @from AND date <= @to", range
    )
    const expensesPeriod = sum(
      "SELECT COALESCE(SUM(total),0) AS v FROM expenses WHERE status = 'confirmed' AND date >= @from AND date <= @to", range
    )

    const pl = this.reports.profitAndLoss(range)
    const cash = this.ledger.cashBalances()
    const cashBalance = cash.filter((a) => a.subtype === 'cash').reduce((s, a) => s + a.balance, 0)
    const bankBalance = cash.filter((a) => a.subtype === 'bank').reduce((s, a) => s + a.balance, 0)

    const counts = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM parties WHERE party_type = 'customer' AND is_active = 1) AS customers,
           (SELECT COUNT(*) FROM parties WHERE party_type = 'supplier' AND is_active = 1) AS suppliers,
           (SELECT COUNT(*) FROM parties WHERE party_type = 'factory' AND is_active = 1) AS factories,
           (SELECT COUNT(*) FROM products WHERE is_active = 1) AS products`
      )
      .get() as { customers: number; suppliers: number; factories: number; products: number }

    const overdueLimit = new Date()
    overdueLimit.setDate(overdueLimit.getDate() - overdueDays)
    const overdueDate = isoDate(overdueLimit)

    const overdueReceivables = sum(
      `SELECT COALESCE(SUM(total - paid_amount - returned_amount),0) AS v FROM sales
       WHERE status = 'confirmed' AND total - paid_amount - returned_amount > 0
         AND COALESCE(due_date, date) <= @d`,
      { d: overdueDate }
    )
    const overduePayables = sum(
      `SELECT COALESCE(SUM(total - paid_amount - returned_amount),0) AS v FROM purchases
       WHERE status = 'confirmed' AND total - paid_amount - returned_amount > 0
         AND COALESCE(due_date, date) <= @d`,
      { d: overdueDate }
    )

    const salesOverTime = (
      this.db
        .prepare(
          `SELECT strftime(@fmt, date) AS label, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(cogs_amount),0) AS cost
           FROM sales WHERE status = 'confirmed' AND date >= @from AND date <= @to
           GROUP BY label ORDER BY label`
        )
        .all({ ...range, fmt: this.bucketFormat(range) }) as { label: string; sales: number; cost: number }[]
    ).map((r) => ({ label: r.label, sales: r.sales, cost: r.cost, profit: r.sales - r.cost }))

    const expensesOverTime = this.db
      .prepare(
        `SELECT strftime(@fmt, date) AS label, COALESCE(SUM(total),0) AS amount
         FROM expenses WHERE status = 'confirmed' AND date >= @from AND date <= @to
         GROUP BY label ORDER BY label`
      )
      .all({ ...range, fmt: this.bucketFormat(range) }) as { label: string; amount: number }[]

    const topCustomers = this.db
      .prepare(
        `SELECT p.name AS label, COALESCE(SUM(s.total),0) AS amount
         FROM sales s JOIN parties p ON p.id = s.customer_id
         WHERE s.status = 'confirmed' AND s.date >= @from AND s.date <= @to
         GROUP BY p.id ORDER BY amount DESC LIMIT 8`
      )
      .all(range) as { label: string; amount: number }[]

    const topProducts = this.db
      .prepare(
        `SELECT pr.name || COALESCE(' - ' || v.size, '') || COALESCE(' ' || v.color, '') AS label,
                COALESCE(SUM(si.quantity),0) AS quantity, COALESCE(SUM(si.line_total),0) AS amount
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         JOIN product_variants v ON v.id = si.variant_id JOIN products pr ON pr.id = v.product_id
         WHERE s.status = 'confirmed' AND s.date >= @from AND s.date <= @to
         GROUP BY v.id ORDER BY amount DESC LIMIT 8`
      )
      .all(range) as { label: string; quantity: number; amount: number }[]

    const topSuppliers = this.db
      .prepare(
        `SELECT p.name AS label, COALESCE(SUM(pu.total),0) AS amount
         FROM purchases pu JOIN parties p ON p.id = pu.supplier_id
         WHERE pu.status = 'confirmed' AND pu.date >= @from AND pu.date <= @to
         GROUP BY p.id ORDER BY amount DESC LIMIT 8`
      )
      .all(range) as { label: string; amount: number }[]

    const expensesByCategory = this.db
      .prepare(
        `SELECT c.name AS label, COALESCE(SUM(e.total),0) AS amount
         FROM expenses e JOIN expense_categories c ON c.id = e.category_id
         WHERE e.status = 'confirmed' AND e.date >= @from AND e.date <= @to
         GROUP BY c.id HAVING amount > 0 ORDER BY amount DESC LIMIT 10`
      )
      .all(range) as { label: string; amount: number }[]

    const CHANNEL_LABELS: Record<string, string> = { wholesale: 'جملة', retail: 'تجزئة', online: 'أونلاين' }
    const salesByChannel = (
      this.db
        .prepare(
          `SELECT sale_channel AS channel, COALESCE(SUM(total),0) AS amount,
                  COALESCE(SUM(total - cogs_amount - delivery_cost),0) AS profit
           FROM sales WHERE status = 'confirmed' AND date >= @from AND date <= @to
           GROUP BY sale_channel ORDER BY amount DESC`
        )
        .all(range) as { channel: string; amount: number; profit: number }[]
    ).map((row) => ({ label: CHANNEL_LABELS[row.channel] ?? row.channel, amount: row.amount, profit: row.profit }))

    const agingBuckets = (kind: 'sales' | 'purchases'): { label: string; amount: number }[] => {
      const table = kind === 'sales' ? 'sales' : 'purchases'
      const row = this.db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN julianday(@today) - julianday(date) <= 30 THEN due ELSE 0 END),0) AS b0,
             COALESCE(SUM(CASE WHEN julianday(@today) - julianday(date) > 30 AND julianday(@today) - julianday(date) <= 60 THEN due ELSE 0 END),0) AS b1,
             COALESCE(SUM(CASE WHEN julianday(@today) - julianday(date) > 60 AND julianday(@today) - julianday(date) <= 90 THEN due ELSE 0 END),0) AS b2,
             COALESCE(SUM(CASE WHEN julianday(@today) - julianday(date) > 90 THEN due ELSE 0 END),0) AS b3
           FROM (SELECT date, total - paid_amount - returned_amount AS due FROM ${table}
                 WHERE status = 'confirmed' AND total - paid_amount - returned_amount > 0)`
        )
        .get({ today }) as { b0: number; b1: number; b2: number; b3: number }
      return [
        { label: 'حتى ٣٠ يومًا', amount: row.b0 },
        { label: '٣١ – ٦٠ يومًا', amount: row.b1 },
        { label: '٦١ – ٩٠ يومًا', amount: row.b2 },
        { label: 'أكثر من ٩٠ يومًا', amount: row.b3 }
      ]
    }

    const overdueCustomers = this.db
      .prepare(
        `SELECT p.id, p.name, p.phone,
                SUM(s.total - s.paid_amount - s.returned_amount) AS due,
                CAST(MAX(julianday(@today) - julianday(s.date)) AS INTEGER) AS days
         FROM sales s JOIN parties p ON p.id = s.customer_id
         WHERE s.status = 'confirmed' AND s.total - s.paid_amount - s.returned_amount > 0
           AND julianday(@today) - julianday(COALESCE(s.due_date, s.date)) > @overdueDays
         GROUP BY p.id ORDER BY due DESC LIMIT 10`
      )
      .all({ today, overdueDays }) as { id: number; name: string; phone: string | null; due: number; days: number }[]

    const openProductionOrders = this.db
      .prepare(
        `SELECT o.id, o.order_number AS orderNumber, f.name AS factory, o.expected_date AS expectedDate,
                CAST(julianday(@today) - julianday(o.expected_date) AS INTEGER) AS lateDays
         FROM production_orders o JOIN parties f ON f.id = o.factory_id
         WHERE o.status NOT IN ('completed','cancelled')
         ORDER BY COALESCE(o.expected_date, o.date) LIMIT 10`
      )
      .all({ today }) as { id: number; orderNumber: string; factory: string; expectedDate: string | null; lateDays: number }[]

    const negativeStock = this.db
      .prepare(
        `SELECT p.name || COALESCE(' - ' || v.size, '') AS name, v.sku, sl.quantity, w.name AS warehouse
         FROM stock_levels sl JOIN product_variants v ON v.id = sl.variant_id
         JOIN products p ON p.id = v.product_id JOIN warehouses w ON w.id = sl.warehouse_id
         WHERE sl.quantity < 0 LIMIT 20`
      )
      .all() as { name: string; sku: string; quantity: number; warehouse: string }[]

    const recentSales = this.db
      .prepare(
        `SELECT s.id, s.invoice_number, s.date, s.total, s.paid_amount, s.status, p.name AS customer_name
         FROM sales s JOIN parties p ON p.id = s.customer_id
         WHERE s.status = 'confirmed' ORDER BY s.date DESC, s.id DESC LIMIT 8`
      )
      .all() as Record<string, unknown>[]

    const recentPayments = this.db
      .prepare(
        `SELECT p.id, p.payment_number, p.date, p.direction, p.amount, pa.name AS party_name, pm.name AS method_name
         FROM payments p LEFT JOIN parties pa ON pa.id = p.party_id
         JOIN payment_methods pm ON pm.id = p.method_id
         WHERE p.status = 'confirmed' ORDER BY p.date DESC, p.id DESC LIMIT 8`
      )
      .all() as Record<string, unknown>[]

    return {
      range,
      kpis: {
        salesToday,
        salesMonth,
        salesPeriod,
        salesCount,
        purchasesPeriod,
        expensesPeriod,
        grossProfit: pl.grossProfit,
        netProfit: pl.netProfit,
        cashBalance,
        bankBalance,
        receivables: this.ledger.balanceByKey(ACC.RECEIVABLE),
        payables: this.ledger.balanceByKey(ACC.PAYABLE),
        factoryPayables: this.ledger.balanceByKey(ACC.FACTORY_PAYABLE),
        inventoryValue: this.inventory.inventoryValue(),
        wipValue: this.ledger.balanceByKey(ACC.WIP_FACTORY),
        customerCount: counts.customers,
        supplierCount: counts.suppliers,
        factoryCount: counts.factories,
        productCount: counts.products,
        overdueReceivables,
        overduePayables
      },
      charts: {
        salesOverTime,
        expensesOverTime,
        topCustomers,
        topProducts,
        topSuppliers,
        expensesByCategory,
        salesByChannel,
        receivablesAging: agingBuckets('sales'),
        payablesAging: agingBuckets('purchases')
      },
      alerts: {
        lowStock: this.inventory.lowStock().slice(0, 10),
        overdueCustomers,
        openProductionOrders,
        negativeStock
      },
      recent: { sales: recentSales, payments: recentPayments }
    }
  }

  /** اختيار تجميع يومي أو شهري حسب طول الفترة */
  private bucketFormat(range: DateRange): string {
    const days = (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000
    return days > 92 ? '%Y-%m' : '%Y-%m-%d'
  }
}
