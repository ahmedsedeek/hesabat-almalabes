import type { Database } from 'better-sqlite3'
import type { Minor } from '@shared/money'
import type { DateRange } from '@shared/types'
import type { Ctx } from '../core/context'
import { LedgerService } from '../accounting/ledger'
import { ACC } from '../accounting/chart'
import { InventoryService } from '../inventory/inventory.service'

export interface ProfitAndLoss {
  from: string
  to: string
  revenue: { accountId: number; code: string; name: string; amount: Minor }[]
  totalRevenue: Minor
  cogs: { accountId: number; code: string; name: string; amount: Minor }[]
  totalCogs: Minor
  grossProfit: Minor
  grossMarginPercent: number
  expenses: { accountId: number; code: string; name: string; amount: Minor }[]
  totalExpenses: Minor
  netProfit: Minor
  netMarginPercent: number
}

/**
 * التقارير المالية والتشغيلية.
 * كل الأرقام مُشتقّة من القيود والحركات الفعلية — لا توجد قيمة مُدخلة يدويًا في أي تقرير.
 */
export class ReportsService {
  private readonly db: Database
  private readonly ledger: LedgerService
  private readonly inventory: InventoryService

  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db
    this.ledger = new LedgerService(ctx)
    this.inventory = new InventoryService(ctx)
  }

  /** حركة الحسابات خلال فترة مُجمَّعة حسب نوع الحساب */
  private periodMovement(types: string[], range: DateRange, subtypes?: string[]): { accountId: number; code: string; name: string; amount: Minor }[] {
    const typeList = types.map((t) => `'${t}'`).join(',')
    const subtypeClause = subtypes?.length ? `AND COALESCE(a.subtype,'') IN (${subtypes.map((s) => `'${s}'`).join(',')})` : ''
    const notSubtype = subtypes?.length ? '' : ''
    return this.db
      .prepare(
        `SELECT a.id AS accountId, a.code, a.name,
                COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c, a.type
         FROM accounts a
         JOIN journal_lines jl ON jl.account_id = a.id
         JOIN journal_entries je ON je.id = jl.entry_id
         WHERE a.type IN (${typeList}) ${subtypeClause} ${notSubtype}
           AND je.date >= @from AND je.date <= @to AND a.is_group = 0
         GROUP BY a.id ORDER BY a.code`
      )
      .all({ from: range.from, to: range.to })
      .map((r) => {
        const row = r as { accountId: number; code: string; name: string; d: number; c: number; type: string }
        const amount = row.type === 'revenue' || row.type === 'liability' || row.type === 'equity' ? row.c - row.d : row.d - row.c
        return { accountId: row.accountId, code: row.code, name: row.name, amount }
      })
      .filter((r) => r.amount !== 0)
  }

  /**
   * قائمة الأرباح والخسائر.
   *   مجمل الربح = صافي الإيرادات − تكلفة البضاعة المباعة
   *   صافي الربح = مجمل الربح − المصروفات التشغيلية
   */
  profitAndLoss(range: DateRange): ProfitAndLoss {
    const revenue = this.periodMovement(['revenue'], range)
    const cogsAccounts = this.db
      .prepare("SELECT id FROM accounts WHERE subtype = 'cogs'")
      .all() as { id: number }[]
    const cogsIds = new Set(cogsAccounts.map((a) => a.id))

    const allExpenses = this.periodMovement(['expense'], range)
    const cogs = allExpenses.filter((a) => cogsIds.has(a.accountId))
    const expenses = allExpenses.filter((a) => !cogsIds.has(a.accountId))

    const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0)
    const totalCogs = cogs.reduce((s, r) => s + r.amount, 0)
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0)
    const grossProfit = totalRevenue - totalCogs
    const netProfit = grossProfit - totalExpenses

    return {
      from: range.from,
      to: range.to,
      revenue,
      totalRevenue,
      cogs,
      totalCogs,
      grossProfit,
      grossMarginPercent: totalRevenue ? (grossProfit / totalRevenue) * 100 : 0,
      expenses,
      totalExpenses,
      netProfit,
      netMarginPercent: totalRevenue ? (netProfit / totalRevenue) * 100 : 0
    }
  }

  /** الميزانية العمومية المبسّطة في تاريخ محدد */
  balanceSheet(asOf: string): {
    assets: { code: string; name: string; amount: Minor }[]
    liabilities: { code: string; name: string; amount: Minor }[]
    equity: { code: string; name: string; amount: Minor }[]
    totalAssets: Minor
    totalLiabilities: Minor
    totalEquity: Minor
    retainedProfit: Minor
  } {
    const balances = (type: string): { code: string; name: string; amount: Minor }[] =>
      this.db
        .prepare(
          `SELECT a.code, a.name, a.type,
                  COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
           FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id = a.id
           LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.date <= @asOf
           WHERE a.type = @type AND a.is_group = 0
           GROUP BY a.id ORDER BY a.code`
        )
        .all({ type, asOf })
        .map((r) => {
          const row = r as { code: string; name: string; type: string; d: number; c: number }
          return {
            code: row.code,
            name: row.name,
            amount: row.type === 'asset' ? row.d - row.c : row.c - row.d
          }
        })
        .filter((r) => r.amount !== 0)

    const assets = balances('asset')
    const liabilities = balances('liability')
    const equity = balances('equity')
    const pl = this.profitAndLoss({ from: '0000-01-01', to: asOf })

    const totalAssets = assets.reduce((s, r) => s + r.amount, 0)
    const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0)
    const totalEquity = equity.reduce((s, r) => s + r.amount, 0)

    return {
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      retainedProfit: pl.netProfit
    }
  }

  /** تقرير المبيعات مُجمَّعًا حسب اليوم أو الشهر أو العميل أو المنتج */
  salesReport(
    range: DateRange,
    groupBy: 'day' | 'month' | 'customer' | 'product' | 'invoice' | 'channel' = 'day'
  ): Record<string, unknown>[] {
    const params = { from: range.from, to: range.to }
    if (groupBy === 'channel') {
      const LABELS: Record<string, string> = { wholesale: 'جملة', retail: 'تجزئة', online: 'أونلاين' }
      return (
        this.db
          .prepare(
            `SELECT s.sale_channel AS channel, COUNT(*) AS invoices,
                    COALESCE(SUM(s.total),0) AS total,
                    COALESCE(SUM(s.cogs_amount),0) AS cogs,
                    COALESCE(SUM(s.delivery_cost),0) AS deliveryCost,
                    COALESCE(SUM(s.total - s.cogs_amount - s.delivery_cost),0) AS profit
             FROM sales s
             WHERE s.status = 'confirmed' AND s.date >= @from AND s.date <= @to
             GROUP BY s.sale_channel ORDER BY total DESC`
          )
          .all(params) as Record<string, unknown>[]
      ).map((row) => ({ ...row, label: LABELS[String(row.channel)] ?? String(row.channel) }))
    }
    if (groupBy === 'customer') {
      return this.db
        .prepare(
          `SELECT p.id AS id, p.name AS label, p.phone,
                  COUNT(DISTINCT s.id) AS invoices, COALESCE(SUM(s.total),0) AS total,
                  COALESCE(SUM(s.cogs_amount),0) AS cogs,
                  COALESCE(SUM(s.delivery_cost),0) AS deliveryCost,
                  COALESCE(SUM(s.total - s.cogs_amount - s.delivery_cost),0) AS profit,
                  COALESCE(SUM(s.paid_amount),0) AS paid,
                  COALESCE(SUM(s.total - s.paid_amount - s.returned_amount),0) AS due
           FROM sales s JOIN parties p ON p.id = s.customer_id
           WHERE s.status = 'confirmed' AND s.date >= @from AND s.date <= @to
           GROUP BY p.id ORDER BY total DESC`
        )
        .all(params) as Record<string, unknown>[]
    }
    if (groupBy === 'product') {
      return this.db
        .prepare(
          `SELECT v.id AS id, pr.name AS label, v.sku, v.size, v.color, pr.unit,
                  COALESCE(SUM(si.quantity),0) AS quantity,
                  COALESCE(SUM(si.line_total),0) AS total,
                  COALESCE(SUM(si.cogs_amount),0) AS cogs,
                  COALESCE(SUM(si.line_total - si.cogs_amount),0) AS profit
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
           JOIN product_variants v ON v.id = si.variant_id JOIN products pr ON pr.id = v.product_id
           WHERE s.status = 'confirmed' AND s.date >= @from AND s.date <= @to
           GROUP BY v.id ORDER BY total DESC`
        )
        .all(params) as Record<string, unknown>[]
    }
    if (groupBy === 'invoice') {
      return this.db
        .prepare(
          `SELECT s.id, s.invoice_number AS label, s.date, p.name AS customer_name, s.sale_channel,
                  s.total, s.cogs_amount AS cogs, s.delivery_cost AS deliveryCost,
                  s.total - s.cogs_amount - s.delivery_cost AS profit,
                  s.paid_amount AS paid, s.total - s.paid_amount - s.returned_amount AS due
           FROM sales s JOIN parties p ON p.id = s.customer_id
           WHERE s.status = 'confirmed' AND s.date >= @from AND s.date <= @to
           ORDER BY s.date DESC, s.id DESC`
        )
        .all(params) as Record<string, unknown>[]
    }
    const format = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d'
    return this.db
      .prepare(
        `SELECT strftime('${format}', s.date) AS label,
                COUNT(*) AS invoices, COALESCE(SUM(s.total),0) AS total,
                COALESCE(SUM(s.cogs_amount),0) AS cogs,
                COALESCE(SUM(s.delivery_cost),0) AS deliveryCost,
                COALESCE(SUM(s.total - s.cogs_amount - s.delivery_cost),0) AS profit
         FROM sales s WHERE s.status = 'confirmed' AND s.date >= @from AND s.date <= @to
         GROUP BY label ORDER BY label`
      )
      .all(params) as Record<string, unknown>[]
  }

  purchasesReport(range: DateRange, groupBy: 'day' | 'month' | 'supplier' | 'product' | 'invoice' = 'day'): Record<string, unknown>[] {
    const params = { from: range.from, to: range.to }
    if (groupBy === 'supplier') {
      return this.db
        .prepare(
          `SELECT p.id, p.name AS label, p.phone, COUNT(DISTINCT pu.id) AS invoices,
                  COALESCE(SUM(pu.total),0) AS total, COALESCE(SUM(pu.paid_amount),0) AS paid,
                  COALESCE(SUM(pu.total - pu.paid_amount - pu.returned_amount),0) AS due
           FROM purchases pu JOIN parties p ON p.id = pu.supplier_id
           WHERE pu.status = 'confirmed' AND pu.date >= @from AND pu.date <= @to
           GROUP BY p.id ORDER BY total DESC`
        )
        .all(params) as Record<string, unknown>[]
    }
    if (groupBy === 'product') {
      return this.db
        .prepare(
          `SELECT v.id, pr.name AS label, v.sku, v.size, v.color, pr.unit,
                  COALESCE(SUM(pi.quantity),0) AS quantity,
                  COALESCE(SUM(pi.line_total + pi.landed_cost),0) AS total
           FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
           JOIN product_variants v ON v.id = pi.variant_id JOIN products pr ON pr.id = v.product_id
           WHERE pu.status = 'confirmed' AND pu.date >= @from AND pu.date <= @to
           GROUP BY v.id ORDER BY total DESC`
        )
        .all(params) as Record<string, unknown>[]
    }
    if (groupBy === 'invoice') {
      return this.db
        .prepare(
          `SELECT pu.id, pu.invoice_number AS label, pu.date, p.name AS supplier_name, pu.purchase_type,
                  pu.total, pu.paid_amount AS paid, pu.total - pu.paid_amount - pu.returned_amount AS due
           FROM purchases pu JOIN parties p ON p.id = pu.supplier_id
           WHERE pu.status = 'confirmed' AND pu.date >= @from AND pu.date <= @to
           ORDER BY pu.date DESC, pu.id DESC`
        )
        .all(params) as Record<string, unknown>[]
    }
    const format = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d'
    return this.db
      .prepare(
        `SELECT strftime('${format}', pu.date) AS label, COUNT(*) AS invoices, COALESCE(SUM(pu.total),0) AS total
         FROM purchases pu WHERE pu.status = 'confirmed' AND pu.date >= @from AND pu.date <= @to
         GROUP BY label ORDER BY label`
      )
      .all(params) as Record<string, unknown>[]
  }

  /** ربحية المنتجات — الإيراد مقابل التكلفة لكل صنف */
  productProfitability(range: DateRange): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT v.id AS variantId, pr.name AS productName, v.sku, v.size, v.color, pr.unit,
                COALESCE(SUM(si.quantity),0) AS soldQty,
                COALESCE(SUM(si.line_total),0) AS revenue,
                COALESCE(SUM(si.cogs_amount),0) AS cost,
                COALESCE(SUM(si.line_total - si.cogs_amount),0) AS profit,
                CASE WHEN SUM(si.line_total) > 0
                     THEN ROUND((SUM(si.line_total - si.cogs_amount) * 100.0) / SUM(si.line_total), 2)
                     ELSE 0 END AS marginPercent
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         JOIN product_variants v ON v.id = si.variant_id JOIN products pr ON pr.id = v.product_id
         WHERE s.status = 'confirmed' AND s.date >= ? AND s.date <= ?
         GROUP BY v.id ORDER BY profit DESC`
      )
      .all(range.from, range.to) as Record<string, unknown>[]
  }

  /** تقييم المخزون الحالي */
  inventoryValuation(warehouseId?: number): { rows: Record<string, unknown>[]; totalValue: Minor; totalQty: number } {
    const rows = this.inventory.stockList({ warehouseId })
    return {
      rows: rows as unknown as Record<string, unknown>[],
      totalValue: rows.reduce((s, r) => s + r.value, 0),
      totalQty: rows.reduce((s, r) => s + r.quantity, 0)
    }
  }

  /** التدفق النقدي خلال فترة من واقع حركة حسابات الصندوق والبنك */
  cashFlow(range: DateRange): {
    opening: Minor
    inflows: { label: string; amount: Minor }[]
    outflows: { label: string; amount: Minor }[]
    totalIn: Minor
    totalOut: Minor
    closing: Minor
    daily: { date: string; inflow: Minor; outflow: Minor; net: Minor }[]
  } {
    const cashAccounts = this.ledger.listCashAccounts().map((a) => a.id)
    if (cashAccounts.length === 0) {
      return { opening: 0, inflows: [], outflows: [], totalIn: 0, totalOut: 0, closing: 0, daily: [] }
    }
    const ids = cashAccounts.join(',')
    const openingRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.account_id IN (${ids}) AND je.date < ?`
      )
      .get(range.from) as { d: number; c: number }
    const opening = openingRow.d - openingRow.c

    const byRef = this.db
      .prepare(
        `SELECT je.ref_type AS refType,
                COALESCE(SUM(jl.debit),0) AS inflow, COALESCE(SUM(jl.credit),0) AS outflow
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.account_id IN (${ids}) AND je.date >= @from AND je.date <= @to
         GROUP BY je.ref_type`
      )
      .all({ from: range.from, to: range.to }) as { refType: string; inflow: number; outflow: number }[]

    const LABELS: Record<string, string> = {
      payment: 'سندات القبض والصرف',
      sale: 'مبيعات نقدية',
      purchase: 'مشتريات نقدية',
      expense: 'مصروفات',
      production: 'تكاليف الإنتاج',
      cash: 'حركات الخزينة',
      opening: 'أرصدة افتتاحية',
      manual: 'قيود يدوية'
    }
    const inflows = byRef.filter((r) => r.inflow > 0).map((r) => ({ label: LABELS[r.refType] ?? r.refType, amount: r.inflow }))
    const outflows = byRef.filter((r) => r.outflow > 0).map((r) => ({ label: LABELS[r.refType] ?? r.refType, amount: r.outflow }))

    const daily = (
      this.db
        .prepare(
          `SELECT je.date AS date, COALESCE(SUM(jl.debit),0) AS inflow, COALESCE(SUM(jl.credit),0) AS outflow
           FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
           WHERE jl.account_id IN (${ids}) AND je.date >= @from AND je.date <= @to
           GROUP BY je.date ORDER BY je.date`
        )
        .all({ from: range.from, to: range.to }) as { date: string; inflow: number; outflow: number }[]
    ).map((r) => ({ ...r, net: r.inflow - r.outflow }))

    const totalIn = inflows.reduce((s, r) => s + r.amount, 0)
    const totalOut = outflows.reduce((s, r) => s + r.amount, 0)
    return { opening, inflows, outflows, totalIn, totalOut, closing: opening + totalIn - totalOut, daily }
  }

  /** الفواتير المستحقة (مبيعات أو مشتريات) */
  outstandingInvoices(kind: 'sales' | 'purchases', asOf: string): Record<string, unknown>[] {
    if (kind === 'sales') {
      return this.db
        .prepare(
          `SELECT s.id, s.invoice_number AS number, s.date, s.due_date, p.name AS party_name, p.phone,
                  s.total, s.paid_amount AS paid, s.total - s.paid_amount - s.returned_amount AS due,
                  CAST(julianday(?) - julianday(s.date) AS INTEGER) AS age_days
           FROM sales s JOIN parties p ON p.id = s.customer_id
           WHERE s.status = 'confirmed' AND s.date <= ? AND s.total - s.paid_amount - s.returned_amount > 0
           ORDER BY s.date`
        )
        .all(asOf, asOf) as Record<string, unknown>[]
    }
    return this.db
      .prepare(
        `SELECT pu.id, pu.invoice_number AS number, pu.date, pu.due_date, p.name AS party_name, p.phone,
                pu.total, pu.paid_amount AS paid, pu.total - pu.paid_amount - pu.returned_amount AS due,
                CAST(julianday(?) - julianday(pu.date) AS INTEGER) AS age_days
         FROM purchases pu JOIN parties p ON p.id = pu.supplier_id
         WHERE pu.status = 'confirmed' AND pu.date <= ? AND pu.total - pu.paid_amount - pu.returned_amount > 0
         ORDER BY pu.date`
      )
      .all(asOf, asOf) as Record<string, unknown>[]
  }

  /** تقرير الإنتاج وتكاليف المصانع */
  productionReport(range: DateRange): {
    orders: Record<string, unknown>[]
    byFactory: Record<string, unknown>[]
    totals: { orders: number; producedQty: number; totalCost: Minor; materialsCost: Minor; factoryCost: Minor; otherCost: Minor }
  } {
    const orders = this.db
      .prepare(
        `SELECT o.id, o.order_number, o.date, o.completion_date, o.status, o.expected_qty, o.produced_qty,
                o.materials_cost, o.factory_cost, o.other_cost, o.total_cost, o.unit_cost,
                f.name AS factory_name, p.name AS product_name, v.size, v.color, pr.unit
         FROM production_orders o JOIN parties f ON f.id = o.factory_id
         JOIN product_variants v ON v.id = o.output_variant_id
         JOIN products p ON p.id = v.product_id JOIN products pr ON pr.id = v.product_id
         WHERE o.date >= ? AND o.date <= ? AND o.status <> 'cancelled'
         ORDER BY o.date DESC`
      )
      .all(range.from, range.to) as Record<string, unknown>[]

    const byFactory = this.db
      .prepare(
        `SELECT f.id, f.name AS label, COUNT(o.id) AS orders,
                COALESCE(SUM(o.produced_qty),0) AS producedQty,
                COALESCE(SUM(o.materials_cost),0) AS materialsCost,
                COALESCE(SUM(o.factory_cost),0) AS factoryCost,
                COALESCE(SUM(o.other_cost),0) AS otherCost,
                COALESCE(SUM(o.total_cost),0) AS totalCost
         FROM production_orders o JOIN parties f ON f.id = o.factory_id
         WHERE o.date >= ? AND o.date <= ? AND o.status <> 'cancelled'
         GROUP BY f.id ORDER BY totalCost DESC`
      )
      .all(range.from, range.to) as Record<string, unknown>[]

    type ProductionTotals = { orders: number; producedQty: number; totalCost: number; materialsCost: number; factoryCost: number; otherCost: number }
    const totals = orders.reduce<ProductionTotals>(
      (acc, o) => ({
        orders: acc.orders + 1,
        producedQty: acc.producedQty + Number(o.produced_qty ?? 0),
        totalCost: acc.totalCost + Number(o.total_cost ?? 0),
        materialsCost: acc.materialsCost + Number(o.materials_cost ?? 0),
        factoryCost: acc.factoryCost + Number(o.factory_cost ?? 0),
        otherCost: acc.otherCost + Number(o.other_cost ?? 0)
      }),
      { orders: 0, producedQty: 0, totalCost: 0, materialsCost: 0, factoryCost: 0, otherCost: 0 }
    )

    return { orders, byFactory, totals }
  }

  /** أرصدة الأطراف (عملاء/موردين/مصانع) */
  partyBalances(partyType: 'customer' | 'supplier' | 'factory'): Record<string, unknown>[] {
    const sign = partyType === 'customer' ? 'SUM(jl.debit) - SUM(jl.credit)' : 'SUM(jl.credit) - SUM(jl.debit)'
    return this.db
      .prepare(
        `SELECT p.id, p.code, p.name, p.phone, p.whatsapp, p.credit_limit,
                COALESCE((SELECT ${sign} FROM journal_lines jl WHERE jl.party_id = p.id), 0) AS balance,
                (SELECT MAX(je.date) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE jl.party_id = p.id) AS last_activity
         FROM parties p WHERE p.party_type = ?
         ORDER BY balance DESC`
      )
      .all(partyType)
      .filter((r) => (r as { balance: number }).balance !== 0) as Record<string, unknown>[]
  }

  /** المدفوعات والمقبوضات خلال فترة */
  paymentsReport(range: DateRange, direction?: 'in' | 'out'): Record<string, unknown>[] {
    const clause = direction ? 'AND p.direction = @direction' : ''
    return this.db
      .prepare(
        `SELECT p.id, p.payment_number, p.date, p.direction, p.amount, pa.name AS party_name,
                pm.name AS method_name, a.name AS account_name, p.reference, p.notes
         FROM payments p LEFT JOIN parties pa ON pa.id = p.party_id
         JOIN payment_methods pm ON pm.id = p.method_id JOIN accounts a ON a.id = p.account_id
         WHERE p.status = 'confirmed' AND p.date >= @from AND p.date <= @to ${clause}
         ORDER BY p.date DESC, p.id DESC`
      )
      .all({ from: range.from, to: range.to, direction }) as Record<string, unknown>[]
  }

  /** ميزان المراجعة */
  trialBalance(asOf: string): { rows: ReturnType<LedgerService['trialBalance']>; totalDebit: Minor; totalCredit: Minor } {
    const rows = this.ledger.trialBalance(asOf)
    return {
      rows,
      totalDebit: rows.reduce((s, r) => s + r.debit, 0),
      totalCredit: rows.reduce((s, r) => s + r.credit, 0)
    }
  }
}
