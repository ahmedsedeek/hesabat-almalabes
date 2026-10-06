import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  BarChart3, Boxes, Building2, Calculator, ChevronLeft, Coins, CreditCard, Factory,
  FileBarChart, Package, Receipt, ShoppingCart, Store, TrendingUp, Users, Wallet
} from 'lucide-react'
import { useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { Badge, Card, DataTable, EmptyState, Select, Spinner, StatCard, cn } from '../../components/ui'
import { DateRangePicker, ExportButtons, PageHeader } from '../../components/common/page'
import { date, money, monthStart, percent, qty, rate, today, yearStart } from '../../lib/format'

interface ReportDef {
  key: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  group: string
}

const REPORTS: ReportDef[] = [
  { key: 'profit', title: 'الأرباح والخسائر', description: 'الإيرادات وتكلفة المبيعات والمصروفات وصافي الربح', icon: TrendingUp, group: 'مالية' },
  { key: 'balance', title: 'الميزانية العمومية', description: 'الأصول والخصوم وحقوق الملكية في تاريخ محدد', icon: Building2, group: 'مالية' },
  { key: 'trial', title: 'ميزان المراجعة', description: 'أرصدة كل الحسابات مدين ودائن', icon: Calculator, group: 'مالية' },
  { key: 'cashflow', title: 'التدفق النقدي', description: 'مصادر النقد وأوجه إنفاقه خلال الفترة', icon: Wallet, group: 'مالية' },

  { key: 'sales', title: 'تقرير المبيعات', description: 'المبيعات حسب اليوم أو العميل أو المنتج', icon: ShoppingCart, group: 'المبيعات والمشتريات' },
  { key: 'purchases', title: 'تقرير المشتريات', description: 'المشتريات حسب اليوم أو المورد أو الصنف', icon: Store, group: 'المبيعات والمشتريات' },
  { key: 'profitability', title: 'ربحية المنتجات', description: 'الإيراد والتكلفة وهامش الربح لكل صنف', icon: BarChart3, group: 'المبيعات والمشتريات' },

  { key: 'receivables', title: 'أعمار الذمم المدينة', description: 'المستحق على العملاء مصنّفًا حسب عمر الدين', icon: Users, group: 'الذمم' },
  { key: 'payables', title: 'أعمار الذمم الدائنة', description: 'المستحق للموردين مصنّفًا حسب عمر الدين', icon: CreditCard, group: 'الذمم' },
  { key: 'customer-balances', title: 'أرصدة العملاء', description: 'رصيد كل عميل في تاريخه', icon: Users, group: 'الذمم' },
  { key: 'supplier-balances', title: 'أرصدة الموردين', description: 'رصيد كل مورد', icon: Store, group: 'الذمم' },
  { key: 'factory-balances', title: 'أرصدة المصانع', description: 'مستحقات المصانع', icon: Factory, group: 'الذمم' },

  { key: 'inventory', title: 'تقييم المخزون', description: 'الكميات والقيمة بمتوسط التكلفة', icon: Boxes, group: 'المخزون والتصنيع' },
  { key: 'production', title: 'تقرير الإنتاج', description: 'أوامر الإنتاج وتكاليف المصانع', icon: Factory, group: 'المخزون والتصنيع' },

  { key: 'expenses', title: 'تقرير المصروفات', description: 'المصروفات حسب الفئة', icon: Receipt, group: 'أخرى' },
  { key: 'payments', title: 'المقبوضات والمدفوعات', description: 'كل سندات القبض والصرف', icon: Coins, group: 'أخرى' }
]

export function ReportsPage(): React.JSX.Element {
  const { reportKey } = useParams<{ reportKey: string }>()
  const navigate = useNavigate()

  if (!reportKey) {
    const groups = [...new Set(REPORTS.map((r) => r.group))]
    return (
      <div>
        <PageHeader title="التقارير" subtitle="كل الأرقام مُشتقّة من المعاملات الفعلية المسجّلة في النظام" />
        {groups.map((group) => (
          <div key={group} className="mb-6">
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-slate-500">{group}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {REPORTS.filter((r) => r.group === group).map((report) => (
                <button
                  key={report.key}
                  type="button"
                  onClick={() => navigate(`/reports/${report.key}`)}
                  className="card flex items-start gap-3 p-4 text-right transition-shadow hover:shadow-md"
                >
                  <span className="rounded-xl bg-brand-50 p-2.5 text-brand-600">
                    <report.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-slate-800">{report.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-slate-500">{report.description}</span>
                  </span>
                  <ChevronLeft className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const report = REPORTS.find((r) => r.key === reportKey)
  return (
    <div>
      <PageHeader
        breadcrumb={
          <button type="button" onClick={() => navigate('/reports')} className="inline-flex items-center gap-1 text-slate-500 hover:text-brand-600">
            التقارير
          </button>
        }
        title={report?.title ?? 'تقرير'}
        subtitle={report?.description}
      />
      <ReportView reportKey={reportKey} />
    </div>
  )
}

function ReportView({ reportKey }: { reportKey: string }): React.JSX.Element {
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [groupBy, setGroupBy] = useState('day')

  switch (reportKey) {
    case 'profit':
      return <ProfitReport range={range} setRange={setRange} />
    case 'balance':
      return <BalanceSheetReport />
    case 'trial':
      return <TrialBalanceReport />
    case 'cashflow':
      return <CashFlowReport range={range} setRange={setRange} />
    case 'sales':
      return <SalesReport range={range} setRange={setRange} groupBy={groupBy} setGroupBy={setGroupBy} />
    case 'purchases':
      return <PurchasesReport range={range} setRange={setRange} groupBy={groupBy} setGroupBy={setGroupBy} />
    case 'profitability':
      return <ProfitabilityReport range={range} setRange={setRange} />
    case 'receivables':
      return <AgingReport partyType="customer" />
    case 'payables':
      return <AgingReport partyType="supplier" />
    case 'customer-balances':
      return <BalancesReport partyType="customer" />
    case 'supplier-balances':
      return <BalancesReport partyType="supplier" />
    case 'factory-balances':
      return <BalancesReport partyType="factory" />
    case 'inventory':
      return <InventoryReport />
    case 'production':
      return <ProductionReport range={range} setRange={setRange} />
    case 'expenses':
      return <ExpensesReport range={range} setRange={setRange} />
    case 'payments':
      return <PaymentsReport range={range} setRange={setRange} />
    default:
      return <Card><EmptyState title="التقرير غير متاح" /></Card>
  }
}

type RangeProps = { range: { from: string; to: string }; setRange: (value: { from: string; to: string }) => void }

function ProfitReport({ range, setRange }: RangeProps): React.JSX.Element {
  const { data, loading, error } = useQuery<{
    revenue: { code: string; name: string; amount: number }[]
    totalRevenue: number
    cogs: { code: string; name: string; amount: number }[]
    totalCogs: number
    grossProfit: number
    grossMarginPercent: number
    expenses: { code: string; name: string; amount: number }[]
    totalExpenses: number
    netProfit: number
    netMarginPercent: number
  }>('reports:profitAndLoss', range, [range.from, range.to])

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>
  if (error || !data) return <Card><EmptyState title="تعذّر تحميل التقرير" description={error ?? undefined} /></Card>

  const rows = [
    { section: 'الإيرادات', ...Object.fromEntries([]) },
    ...data.revenue.map((r) => ({ label: r.name, code: r.code, amount: r.amount, kind: 'revenue' })),
    { label: 'إجمالي الإيرادات', amount: data.totalRevenue, kind: 'total' },
    ...data.cogs.map((r) => ({ label: r.name, code: r.code, amount: -r.amount, kind: 'cogs' })),
    { label: 'مجمل الربح', amount: data.grossProfit, kind: 'total' },
    ...data.expenses.map((r) => ({ label: r.name, code: r.code, amount: -r.amount, kind: 'expense' })),
    { label: 'صافي الربح', amount: data.netProfit, kind: 'total' }
  ].filter((r) => 'label' in r) as { label: string; code?: string; amount: number; kind: string }[]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <ExportButtons
          title="قائمة الأرباح والخسائر"
          subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
          cards={[
            { label: 'الإيرادات', value: money(data.totalRevenue) },
            { label: 'تكلفة المبيعات', value: money(data.totalCogs) },
            { label: 'مجمل الربح', value: money(data.grossProfit), tone: data.grossProfit >= 0 ? 'pos' : 'neg' },
            { label: 'صافي الربح', value: money(data.netProfit), tone: data.netProfit >= 0 ? 'pos' : 'neg' }
          ]}
          columns={[
            { key: 'label', label: 'البند' },
            { key: 'amount', label: 'المبلغ', type: 'money' }
          ]}
          rows={rows as unknown as Record<string, unknown>[]}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="إجمالي الإيرادات" value={money(data.totalRevenue)} tone="brand" />
        <StatCard label="تكلفة البضاعة المباعة" value={money(data.totalCogs)} tone="warning" />
        <StatCard label="مجمل الربح" value={money(data.grossProfit)} tone={data.grossProfit >= 0 ? 'positive' : 'negative'} hint={`هامش ${percent(data.grossMarginPercent)}`} />
        <StatCard label="صافي الربح" value={money(data.netProfit)} tone={data.netProfit >= 0 ? 'positive' : 'negative'} hint={`هامش ${percent(data.netMarginPercent)}`} />
      </div>

      <Card noPadding>
        <table className="tbl">
          <tbody>
            <SectionRow title="الإيرادات" />
            {data.revenue.map((row) => (
              <LineRow key={row.code} code={row.code} label={row.name} amount={row.amount} />
            ))}
            <TotalRow label="إجمالي الإيرادات" amount={data.totalRevenue} />

            <SectionRow title="تكلفة المبيعات" />
            {data.cogs.map((row) => (
              <LineRow key={row.code} code={row.code} label={row.name} amount={row.amount} negative />
            ))}
            <TotalRow label="إجمالي تكلفة المبيعات" amount={data.totalCogs} negative />

            <TotalRow label="مجمل الربح" amount={data.grossProfit} strong />

            <SectionRow title="المصروفات التشغيلية" />
            {data.expenses.length ? (
              data.expenses.map((row) => <LineRow key={row.code} code={row.code} label={row.name} amount={row.amount} negative />)
            ) : (
              <tr><td colSpan={3} className="py-3 text-center text-[13px] text-slate-400">لا توجد مصروفات في هذه الفترة</td></tr>
            )}
            <TotalRow label="إجمالي المصروفات" amount={data.totalExpenses} negative />

            <TotalRow label="صافي الربح" amount={data.netProfit} strong highlight />
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function SectionRow({ title }: { title: string }): React.JSX.Element {
  return (
    <tr className="bg-slate-100">
      <td colSpan={3} className="px-3 py-2 text-[13px] font-bold text-slate-700">{title}</td>
    </tr>
  )
}

function LineRow({ code, label, amount, negative }: { code?: string; label: string; amount: number; negative?: boolean }): React.JSX.Element {
  return (
    <tr>
      <td className="num w-24 text-[12px] text-slate-400">{code}</td>
      <td className="pr-6 text-[13px]">{label}</td>
      <td className="w-44 text-left"><span className={cn('num font-semibold', negative ? 'text-rose-700' : 'text-slate-800')}>{negative ? '(' : ''}{money(Math.abs(amount))}{negative ? ')' : ''}</span></td>
    </tr>
  )
}

function TotalRow({ label, amount, strong, negative, highlight }: { label: string; amount: number; strong?: boolean; negative?: boolean; highlight?: boolean }): React.JSX.Element {
  return (
    <tr className={cn(highlight ? 'bg-brand-50' : 'bg-slate-50')}>
      <td />
      <td className={cn('py-2.5 text-[13.5px] font-bold', highlight ? 'text-brand-900' : 'text-slate-700')}>{label}</td>
      <td className="text-left">
        <span className={cn('num font-bold', strong && 'text-[16px]', amount < 0 ? 'text-rose-700' : negative ? 'text-rose-700' : highlight ? 'text-brand-800' : 'text-slate-800')}>
          {money(Math.abs(amount))}
          {amount < 0 && ' −'}
        </span>
      </td>
    </tr>
  )
}

function BalanceSheetReport(): React.JSX.Element {
  const [asOf, setAsOf] = useState(today())
  const { data, loading } = useQuery<{
    assets: { code: string; name: string; amount: number }[]
    liabilities: { code: string; name: string; amount: number }[]
    equity: { code: string; name: string; amount: number }[]
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
    retainedProfit: number
  }>('reports:balanceSheet', { asOf }, [asOf])

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>
  if (!data) return <Card><EmptyState title="لا توجد بيانات" /></Card>

  const equityTotal = data.totalEquity + data.retainedProfit
  const balanced = Math.abs(data.totalAssets - (data.totalLiabilities + equityTotal)) < 100

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-600">
          حتى تاريخ
          <input type="date" className="input h-9 w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <ExportButtons
          title="الميزانية العمومية"
          subtitle={`حتى ${date(asOf)}`}
          columns={[
            { key: 'code', label: 'الحساب' },
            { key: 'name', label: 'البيان' },
            { key: 'amount', label: 'الرصيد', type: 'money' }
          ]}
          rows={[...data.assets, ...data.liabilities, ...data.equity] as unknown as Record<string, unknown>[]}
        />
      </div>

      {!balanced && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          الميزانية غير متوازنة. شغّل «فحص سلامة البيانات» من الإعدادات لمعرفة السبب.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="الأصول" noPadding>
          <table className="tbl">
            <tbody>
              {data.assets.map((row) => <LineRow key={row.code} code={row.code} label={row.name} amount={row.amount} />)}
              <TotalRow label="إجمالي الأصول" amount={data.totalAssets} strong highlight />
            </tbody>
          </table>
        </Card>

        <div className="space-y-4">
          <Card title="الخصوم" noPadding>
            <table className="tbl">
              <tbody>
                {data.liabilities.length ? data.liabilities.map((row) => <LineRow key={row.code} code={row.code} label={row.name} amount={row.amount} />) : (
                  <tr><td colSpan={3} className="py-3 text-center text-[13px] text-slate-400">لا توجد خصوم</td></tr>
                )}
                <TotalRow label="إجمالي الخصوم" amount={data.totalLiabilities} />
              </tbody>
            </table>
          </Card>

          <Card title="حقوق الملكية" noPadding>
            <table className="tbl">
              <tbody>
                {data.equity.map((row) => <LineRow key={row.code} code={row.code} label={row.name} amount={row.amount} />)}
                <LineRow label="أرباح الفترة" amount={data.retainedProfit} />
                <TotalRow label="إجمالي حقوق الملكية" amount={equityTotal} />
                <TotalRow label="إجمالي الخصوم وحقوق الملكية" amount={data.totalLiabilities + equityTotal} strong highlight />
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  )
}

function TrialBalanceReport(): React.JSX.Element {
  const [asOf, setAsOf] = useState(today())
  const { data, loading, error } = useQuery<{ rows: { code: string; name: string; debit: number; credit: number }[]; totalDebit: number; totalCredit: number }>(
    'reports:trialBalance',
    { asOf },
    [asOf]
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-600">
          حتى تاريخ
          <input type="date" className="input h-9 w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <ExportButtons
          title="ميزان المراجعة"
          subtitle={`حتى ${date(asOf)}`}
          columns={[
            { key: 'code', label: 'رقم الحساب' },
            { key: 'name', label: 'اسم الحساب' },
            { key: 'debit', label: 'مدين', type: 'money' },
            { key: 'credit', label: 'دائن', type: 'money' }
          ]}
          rows={(data?.rows ?? []) as unknown as Record<string, unknown>[]}
          totals={{ debit: data?.totalDebit ?? 0, credit: data?.totalCredit ?? 0 }}
          disabled={!data?.rows.length}
        />
      </div>

      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="إجمالي المدين" value={money(data.totalDebit)} />
          <StatCard label="إجمالي الدائن" value={money(data.totalCredit)} />
          <StatCard
            label="الفرق"
            value={money(data.totalDebit - data.totalCredit)}
            tone={data.totalDebit === data.totalCredit ? 'positive' : 'negative'}
            hint={data.totalDebit === data.totalCredit ? 'الميزان متوازن' : 'يوجد خلل — راجع فحص سلامة البيانات'}
          />
        </div>
      )}

      <Card noPadding>
        <DataTable
          rows={data?.rows ?? []}
          loading={loading}
          error={error}
          rowKey={(row) => row.code}
          empty={<EmptyState title="لا توجد قيود بعد" />}
          columns={[
            { key: 'code', header: 'رقم الحساب', width: '120px', render: (row) => <span className="num text-slate-500">{row.code}</span> },
            { key: 'name', header: 'اسم الحساب', render: (row) => <span className="font-semibold text-slate-800">{row.name}</span> },
            { key: 'debit', header: 'مدين', align: 'left', render: (row) => (row.debit ? <span className="num font-semibold">{money(row.debit, false)}</span> : <span className="text-slate-300">—</span>), footer: <span className="num">{money(data?.totalDebit ?? 0, false)}</span> },
            { key: 'credit', header: 'دائن', align: 'left', render: (row) => (row.credit ? <span className="num font-semibold">{money(row.credit, false)}</span> : <span className="text-slate-300">—</span>), footer: <span className="num">{money(data?.totalCredit ?? 0, false)}</span> }
          ]}
          footer
        />
      </Card>
    </div>
  )
}

function CashFlowReport({ range, setRange }: RangeProps): React.JSX.Element {
  const { data, loading } = useQuery<{
    opening: number
    inflows: { label: string; amount: number }[]
    outflows: { label: string; amount: number }[]
    totalIn: number
    totalOut: number
    closing: number
    daily: { date: string; inflow: number; outflow: number; net: number }[]
  }>('reports:cashFlow', range, [range.from, range.to])

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>
  if (!data) return <Card><EmptyState title="لا توجد بيانات" /></Card>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <ExportButtons
          title="تقرير التدفق النقدي"
          subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
          columns={[
            { key: 'date', label: 'التاريخ', type: 'date' },
            { key: 'inflow', label: 'وارد', type: 'money' },
            { key: 'outflow', label: 'صادر', type: 'money' },
            { key: 'net', label: 'الصافي', type: 'money' }
          ]}
          rows={data.daily as unknown as Record<string, unknown>[]}
          totals={{ inflow: data.totalIn, outflow: data.totalOut, net: data.totalIn - data.totalOut }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="الرصيد الافتتاحي" value={money(data.opening)} />
        <StatCard label="إجمالي الوارد" value={money(data.totalIn)} tone="positive" />
        <StatCard label="إجمالي الصادر" value={money(data.totalOut)} tone="negative" />
        <StatCard label="الرصيد الختامي" value={money(data.closing)} tone="brand" />
      </div>

      <Card title="الحركة اليومية" noPadding>
        <DataTable
          rows={data.daily}
          rowKey={(row) => row.date}
          empty={<EmptyState title="لا توجد حركة نقدية في هذه الفترة" />}
          columns={[
            { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(row.date)}</span> },
            { key: 'in', header: 'وارد', align: 'left', render: (row) => <span className="num text-emerald-700">{money(row.inflow, false)}</span> },
            { key: 'out', header: 'صادر', align: 'left', render: (row) => <span className="num text-rose-700">{money(row.outflow, false)}</span> },
            { key: 'net', header: 'الصافي', align: 'left', render: (row) => <span className={cn('num font-bold', row.net >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{money(row.net, false)}</span> }
          ]}
        />
      </Card>
    </div>
  )
}

function SalesReport({ range, setRange, groupBy, setGroupBy }: RangeProps & { groupBy: string; setGroupBy: (value: string) => void }): React.JSX.Element {
  const { data, loading, error } = useQuery<Record<string, unknown>[]>('reports:sales', { ...range, groupBy }, [range.from, range.to, groupBy])
  const rows = data ?? []
  const totals = rows.reduce<{ total: number; cogs: number; profit: number }>(
    (acc, row) => ({ total: acc.total + Number(row.total ?? 0), cogs: acc.cogs + Number(row.cogs ?? 0), profit: acc.profit + Number(row.profit ?? 0) }),
    { total: 0, cogs: 0, profit: 0 }
  )

  const columns =
    groupBy === 'product'
      ? [
          { key: 'label', header: 'الصنف', render: (row: Record<string, unknown>) => <span className="font-semibold text-slate-800">{String(row.label)}{row.size || row.color ? ` (${[row.size, row.color].filter(Boolean).join(' / ')})` : ''}</span> },
          { key: 'quantity', header: 'الكمية', align: 'center' as const, render: (row: Record<string, unknown>) => <span className="num">{qty(Number(row.quantity))} {String(row.unit ?? '')}</span> },
          { key: 'total', header: 'الإيراد', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num font-semibold">{money(Number(row.total))}</span> },
          { key: 'cogs', header: 'التكلفة', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num text-slate-600">{money(Number(row.cogs))}</span> },
          { key: 'profit', header: 'الربح', align: 'left' as const, render: (row: Record<string, unknown>) => <span className={cn('num font-bold', Number(row.profit) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{money(Number(row.profit))}</span> }
        ]
      : groupBy === 'customer'
        ? [
            { key: 'label', header: 'العميل', render: (row: Record<string, unknown>) => <span className="font-semibold text-slate-800">{String(row.label)}</span> },
            { key: 'invoices', header: 'عدد الفواتير', align: 'center' as const, render: (row: Record<string, unknown>) => <span className="num">{String(row.invoices)}</span> },
            { key: 'total', header: 'المبيعات', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num font-semibold">{money(Number(row.total))}</span> },
            { key: 'paid', header: 'المحصَّل', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num text-emerald-700">{money(Number(row.paid))}</span> },
            { key: 'due', header: 'المستحق', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num text-rose-700">{money(Number(row.due))}</span> },
            { key: 'profit', header: 'مجمل الربح', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num font-bold text-emerald-700">{money(Number(row.profit))}</span> }
          ]
        : groupBy === 'channel'
          ? [
              { key: 'label', header: 'قناة البيع', render: (row: Record<string, unknown>) => <span className="font-semibold text-slate-800">{String(row.label)}</span> },
              { key: 'invoices', header: 'عدد الفواتير', align: 'center' as const, render: (row: Record<string, unknown>) => <span className="num">{String(row.invoices)}</span> },
              { key: 'total', header: 'المبيعات', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num font-semibold">{money(Number(row.total))}</span> },
              { key: 'cogs', header: 'التكلفة', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num text-slate-600">{money(Number(row.cogs))}</span> },
              { key: 'deliveryCost', header: 'تكلفة التوصيل', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num text-amber-700">{money(Number(row.deliveryCost ?? 0))}</span> },
              { key: 'profit', header: 'صافي الربح', align: 'left' as const, render: (row: Record<string, unknown>) => <span className={cn('num font-bold', Number(row.profit) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{money(Number(row.profit))}</span> }
            ]
        : groupBy === 'invoice'
          ? [
              { key: 'label', header: 'رقم الفاتورة', render: (row: Record<string, unknown>) => <span className="num font-semibold text-brand-700">{String(row.label)}</span> },
              { key: 'date', header: 'التاريخ', render: (row: Record<string, unknown>) => <span className="num">{date(String(row.date))}</span> },
              { key: 'customer', header: 'العميل', render: (row: Record<string, unknown>) => String(row.customer_name) },
              { key: 'total', header: 'الإجمالي', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num font-semibold">{money(Number(row.total))}</span> },
              { key: 'profit', header: 'الربح', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num font-bold text-emerald-700">{money(Number(row.profit))}</span> },
              { key: 'due', header: 'المتبقي', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num text-rose-700">{money(Number(row.due))}</span> }
            ]
          : [
              { key: 'label', header: groupBy === 'month' ? 'الشهر' : 'اليوم', render: (row: Record<string, unknown>) => <span className="num font-semibold">{String(row.label)}</span> },
              { key: 'invoices', header: 'عدد الفواتير', align: 'center' as const, render: (row: Record<string, unknown>) => <span className="num">{String(row.invoices)}</span> },
              { key: 'total', header: 'المبيعات', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num font-semibold">{money(Number(row.total))}</span> },
              { key: 'cogs', header: 'التكلفة', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num text-slate-600">{money(Number(row.cogs))}</span> },
              { key: 'profit', header: 'مجمل الربح', align: 'left' as const, render: (row: Record<string, unknown>) => <span className={cn('num font-bold', Number(row.profit) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{money(Number(row.profit))}</span> }
            ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          <Select className="h-10 w-40" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="day">يوميًا</option>
            <option value="month">شهريًا</option>
            <option value="customer">حسب العميل</option>
            <option value="product">حسب الصنف</option>
            <option value="channel">حسب قناة البيع</option>
            <option value="invoice">تفصيلي بالفواتير</option>
          </Select>
        </div>
        <ExportButtons
          title="تقرير المبيعات"
          subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
          columns={columns.map((c) => ({ key: c.key === 'label' ? 'label' : c.key, label: String(c.header), type: ['total', 'cogs', 'profit', 'paid', 'due'].includes(c.key) ? 'money' : c.key === 'quantity' ? 'qty' : 'text' }))}
          rows={rows}
          totals={{ total: totals.total, cogs: totals.cogs, profit: totals.profit }}
          disabled={!rows.length}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="إجمالي المبيعات" value={money(totals.total)} tone="brand" />
        <StatCard label="تكلفة البضاعة المباعة" value={money(totals.cogs)} tone="warning" />
        <StatCard label="مجمل الربح" value={money(totals.profit)} tone={totals.profit >= 0 ? 'positive' : 'negative'} hint={totals.total ? `هامش ${percent((totals.profit / totals.total) * 100)}` : undefined} />
      </div>

      <Card noPadding>
        <DataTable rows={rows} loading={loading} error={error} rowKey={(_, index) => index} empty={<EmptyState title="لا توجد مبيعات في هذه الفترة" />} columns={columns} />
      </Card>
    </div>
  )
}

function PurchasesReport({ range, setRange, groupBy, setGroupBy }: RangeProps & { groupBy: string; setGroupBy: (value: string) => void }): React.JSX.Element {
  const { data, loading, error } = useQuery<Record<string, unknown>[]>('reports:purchases', { ...range, groupBy }, [range.from, range.to, groupBy])
  const rows = data ?? []
  const total = rows.reduce((s, row) => s + Number(row.total ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          <Select className="h-10 w-40" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="day">يوميًا</option>
            <option value="month">شهريًا</option>
            <option value="supplier">حسب المورد</option>
            <option value="product">حسب الصنف</option>
            <option value="invoice">تفصيلي بالفواتير</option>
          </Select>
        </div>
        <ExportButtons
          title="تقرير المشتريات"
          subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
          columns={[
            { key: 'label', label: 'البيان' },
            { key: 'quantity', label: 'الكمية', type: 'qty' },
            { key: 'total', label: 'الإجمالي', type: 'money' }
          ]}
          rows={rows}
          totals={{ total }}
          disabled={!rows.length}
        />
      </div>

      <StatCard label="إجمالي المشتريات" value={money(total)} tone="brand" />

      <Card noPadding>
        <DataTable
          rows={rows}
          loading={loading}
          error={error}
          rowKey={(_, index) => index}
          empty={<EmptyState title="لا توجد مشتريات في هذه الفترة" />}
          columns={[
            { key: 'label', header: 'البيان', render: (row) => <span className="font-semibold text-slate-800">{String(row.label)}</span> },
            ...(groupBy === 'product' ? [{ key: 'quantity', header: 'الكمية', align: 'center' as const, render: (row: Record<string, unknown>) => <span className="num">{qty(Number(row.quantity))} {String(row.unit ?? '')}</span> }] : []),
            ...(groupBy === 'supplier' || groupBy === 'day' || groupBy === 'month' ? [{ key: 'invoices', header: 'عدد الفواتير', align: 'center' as const, render: (row: Record<string, unknown>) => <span className="num">{String(row.invoices ?? '—')}</span> }] : []),
            ...(groupBy === 'invoice' ? [{ key: 'date', header: 'التاريخ', render: (row: Record<string, unknown>) => <span className="num">{date(String(row.date))}</span> }, { key: 'supplier', header: 'المورد', render: (row: Record<string, unknown>) => String(row.supplier_name) }] : []),
            { key: 'total', header: 'الإجمالي', align: 'left', render: (row) => <span className="num font-semibold">{money(Number(row.total))}</span> },
            ...(groupBy === 'supplier' || groupBy === 'invoice' ? [{ key: 'due', header: 'المستحق', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num text-rose-700">{money(Number(row.due ?? 0))}</span> }] : [])
          ]}
        />
      </Card>
    </div>
  )
}

function ProfitabilityReport({ range, setRange }: RangeProps): React.JSX.Element {
  const { data, loading, error } = useQuery<Record<string, unknown>[]>('reports:productProfitability', range, [range.from, range.to])
  const rows = data ?? []
  const totals = rows.reduce<{ revenue: number; cost: number; profit: number }>(
    (acc, row) => ({ revenue: acc.revenue + Number(row.revenue), cost: acc.cost + Number(row.cost), profit: acc.profit + Number(row.profit) }),
    { revenue: 0, cost: 0, profit: 0 }
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <ExportButtons
          title="تقرير ربحية المنتجات"
          subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
          columns={[
            { key: 'sku', label: 'الكود' },
            { key: 'productName', label: 'المنتج' },
            { key: 'soldQty', label: 'الكمية المباعة', type: 'qty' },
            { key: 'revenue', label: 'الإيراد', type: 'money' },
            { key: 'cost', label: 'التكلفة', type: 'money' },
            { key: 'profit', label: 'الربح', type: 'money' },
            { key: 'marginPercent', label: 'الهامش٪', type: 'number' }
          ]}
          rows={rows}
          totals={{ revenue: totals.revenue, cost: totals.cost, profit: totals.profit }}
          disabled={!rows.length}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="إجمالي الإيراد" value={money(totals.revenue)} tone="brand" />
        <StatCard label="إجمالي التكلفة" value={money(totals.cost)} tone="warning" />
        <StatCard label="إجمالي الربح" value={money(totals.profit)} tone={totals.profit >= 0 ? 'positive' : 'negative'} />
      </div>

      <Card noPadding>
        <DataTable
          rows={rows}
          loading={loading}
          error={error}
          rowKey={(row) => String(row.variantId)}
          empty={<EmptyState title="لا توجد مبيعات في هذه الفترة" />}
          columns={[
            { key: 'sku', header: 'الكود', width: '110px', render: (row) => <span className="num text-[13px] text-slate-500">{String(row.sku)}</span> },
            {
              key: 'name',
              header: 'المنتج',
              render: (row) => (
                <span className="font-semibold text-slate-800">
                  {String(row.productName)}
                  {Boolean(row.size || row.color) && <span className="mr-1 text-[12px] font-normal text-slate-500">({[row.size, row.color].filter(Boolean).join(' / ')})</span>}
                </span>
              )
            },
            { key: 'qty', header: 'الكمية المباعة', align: 'center', render: (row) => <span className="num">{qty(Number(row.soldQty))} {String(row.unit)}</span> },
            { key: 'revenue', header: 'الإيراد', align: 'left', render: (row) => <span className="num font-semibold">{money(Number(row.revenue))}</span> },
            { key: 'cost', header: 'التكلفة', align: 'left', render: (row) => <span className="num text-slate-600">{money(Number(row.cost))}</span> },
            { key: 'profit', header: 'الربح', align: 'left', render: (row) => <span className={cn('num font-bold', Number(row.profit) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{money(Number(row.profit))}</span> },
            {
              key: 'margin',
              header: 'الهامش',
              align: 'center',
              render: (row) => (
                <Badge tone={Number(row.marginPercent) >= 25 ? 'green' : Number(row.marginPercent) >= 10 ? 'amber' : 'red'}>{percent(Number(row.marginPercent))}</Badge>
              )
            }
          ]}
        />
      </Card>
    </div>
  )
}

function AgingReport({ partyType }: { partyType: 'customer' | 'supplier' }): React.JSX.Element {
  const [asOf, setAsOf] = useState(today())
  const { data, loading, error } = useQuery<Record<string, unknown>[]>('parties:aging', { partyType, asOf }, [partyType, asOf])
  const rows = data ?? []
  const totals = rows.reduce<{ total: number; current: number; d30: number; d60: number; d90: number; d90plus: number }>(
    (acc, row) => ({
      total: acc.total + Number(row.total),
      current: acc.current + Number(row.current),
      d30: acc.d30 + Number(row.d30),
      d60: acc.d60 + Number(row.d60),
      d90: acc.d90 + Number(row.d90),
      d90plus: acc.d90plus + Number(row.d90plus)
    }),
    { total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 }
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-600">
          حتى تاريخ
          <input type="date" className="input h-9 w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <ExportButtons
          title={partyType === 'customer' ? 'أعمار الذمم المدينة' : 'أعمار الذمم الدائنة'}
          subtitle={`حتى ${date(asOf)}`}
          columns={[
            { key: 'code', label: 'الكود' },
            { key: 'name', label: partyType === 'customer' ? 'العميل' : 'المورد' },
            { key: 'phone', label: 'الهاتف' },
            { key: 'current', label: 'حتى ٣٠ يوم', type: 'money' },
            { key: 'd30', label: '٣١-٦٠', type: 'money' },
            { key: 'd60', label: '٦١-٩٠', type: 'money' },
            { key: 'd90', label: '٩١-١٢٠', type: 'money' },
            { key: 'd90plus', label: 'أكثر من ١٢٠', type: 'money' },
            { key: 'total', label: 'الإجمالي', type: 'money' }
          ]}
          rows={rows}
          totals={totals as unknown as Record<string, unknown>}
          disabled={!rows.length}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="الإجمالي" value={money(totals.total)} tone="brand" />
        <StatCard label="حتى ٣٠ يومًا" value={money(totals.current)} tone="positive" />
        <StatCard label="٣١ – ٦٠" value={money(totals.d30)} />
        <StatCard label="٦١ – ٩٠" value={money(totals.d60)} tone="warning" />
        <StatCard label="٩١ – ١٢٠" value={money(totals.d90)} tone="warning" />
        <StatCard label="أكثر من ١٢٠" value={money(totals.d90plus)} tone="negative" />
      </div>

      <Card noPadding>
        <DataTable
          rows={rows}
          loading={loading}
          error={error}
          rowKey={(row) => String(row.partyId)}
          empty={<EmptyState title="لا توجد ذمم مستحقة" />}
          footer
          columns={[
            { key: 'name', header: partyType === 'customer' ? 'العميل' : 'المورد', render: (row) => <div><span className="font-semibold text-slate-800">{String(row.name)}</span><p className="num text-[12px] text-slate-500">{String(row.code)}{row.phone ? ` · ${row.phone}` : ''}</p></div>, footer: 'الإجمالي' },
            { key: 'current', header: 'حتى ٣٠ يوم', align: 'left', render: (row) => <span className="num text-emerald-700">{money(Number(row.current), false)}</span>, footer: <span className="num">{money(totals.current, false)}</span> },
            { key: 'd30', header: '٣١ – ٦٠', align: 'left', render: (row) => <span className="num">{money(Number(row.d30), false)}</span>, footer: <span className="num">{money(totals.d30, false)}</span> },
            { key: 'd60', header: '٦١ – ٩٠', align: 'left', render: (row) => <span className="num text-amber-700">{money(Number(row.d60), false)}</span>, footer: <span className="num">{money(totals.d60, false)}</span> },
            { key: 'd90', header: '٩١ – ١٢٠', align: 'left', render: (row) => <span className="num text-amber-800">{money(Number(row.d90), false)}</span>, footer: <span className="num">{money(totals.d90, false)}</span> },
            { key: 'd90plus', header: 'أكثر من ١٢٠', align: 'left', render: (row) => <span className="num font-semibold text-rose-700">{money(Number(row.d90plus), false)}</span>, footer: <span className="num">{money(totals.d90plus, false)}</span> },
            { key: 'total', header: 'الإجمالي', align: 'left', render: (row) => <span className="num font-bold">{money(Number(row.total), false)}</span>, footer: <span className="num">{money(totals.total, false)}</span> }
          ]}
        />
      </Card>
    </div>
  )
}

function BalancesReport({ partyType }: { partyType: 'customer' | 'supplier' | 'factory' }): React.JSX.Element {
  const { data, loading, error } = useQuery<Record<string, unknown>[]>('reports:partyBalances', { partyType }, [partyType])
  const rows = data ?? []
  const total = rows.reduce((s, row) => s + Number(row.balance), 0)
  const label = partyType === 'customer' ? 'العملاء' : partyType === 'supplier' ? 'الموردون' : 'المصانع'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatCard label={`إجمالي أرصدة ${label}`} value={money(total)} tone={partyType === 'customer' ? 'warning' : 'negative'} />
        <ExportButtons
          title={`أرصدة ${label}`}
          columns={[
            { key: 'code', label: 'الكود' },
            { key: 'name', label: 'الاسم' },
            { key: 'phone', label: 'الهاتف' },
            { key: 'balance', label: 'الرصيد', type: 'money' },
            { key: 'last_activity', label: 'آخر حركة', type: 'date' }
          ]}
          rows={rows}
          totals={{ balance: total }}
          disabled={!rows.length}
        />
      </div>

      <Card noPadding>
        <DataTable
          rows={rows}
          loading={loading}
          error={error}
          rowKey={(row) => String(row.id)}
          empty={<EmptyState title="لا توجد أرصدة" />}
          footer
          columns={[
            { key: 'code', header: 'الكود', width: '100px', render: (row) => <span className="num text-slate-500">{String(row.code)}</span>, footer: '' },
            { key: 'name', header: 'الاسم', render: (row) => <span className="font-semibold text-slate-800">{String(row.name)}</span>, footer: 'الإجمالي' },
            { key: 'phone', header: 'الهاتف', render: (row) => <span className="num text-[13px]">{String(row.phone ?? '—')}</span> },
            { key: 'last', header: 'آخر حركة', render: (row) => <span className="num">{date(String(row.last_activity))}</span> },
            {
              key: 'balance',
              header: 'الرصيد',
              align: 'left',
              render: (row) => <span className={cn('num font-bold', Number(row.balance) > 0 ? 'text-rose-700' : 'text-emerald-700')}>{money(Number(row.balance))}</span>,
              footer: <span className="num">{money(total)}</span>
            }
          ]}
        />
      </Card>
    </div>
  )
}

function InventoryReport(): React.JSX.Element {
  const [warehouseId, setWarehouseId] = useState('')
  const warehouses = useQuery<Record<string, unknown>[]>('warehouses:list', { activeOnly: true })
  const { data, loading, error } = useQuery<{ rows: Record<string, unknown>[]; totalValue: number; totalQty: number }>(
    'reports:inventoryValuation',
    { warehouseId: warehouseId ? Number(warehouseId) : undefined },
    [warehouseId]
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select className="h-10 w-52" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">كل المخازن</option>
          {(warehouses.data ?? []).map((w) => (
            <option key={String(w.id)} value={String(w.id)}>{String(w.name)}</option>
          ))}
        </Select>
        <ExportButtons
          title="تقرير تقييم المخزون"
          columns={[
            { key: 'sku', label: 'الكود' },
            { key: 'name', label: 'الصنف' },
            { key: 'size', label: 'المقاس' },
            { key: 'color', label: 'اللون' },
            { key: 'quantity', label: 'الكمية', type: 'qty' },
            { key: 'unit', label: 'الوحدة' },
            { key: 'value', label: 'القيمة', type: 'money' }
          ]}
          rows={data?.rows ?? []}
          totals={{ value: data?.totalValue ?? 0 }}
          disabled={!data?.rows.length}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="قيمة المخزون" value={money(data?.totalValue ?? 0)} tone="brand" icon={<Boxes className="h-5 w-5" />} />
        <StatCard label="إجمالي الكميات" value={qty(data?.totalQty ?? 0)} />
        <StatCard label="عدد الأصناف" value={data?.rows.length ?? 0} />
      </div>

      <Card noPadding>
        <DataTable
          rows={data?.rows ?? []}
          loading={loading}
          error={error}
          rowKey={(row) => String(row.variantId)}
          empty={<EmptyState title="لا يوجد مخزون" />}
          footer
          columns={[
            { key: 'sku', header: 'الكود', width: '120px', render: (row) => <span className="num text-slate-500">{String(row.sku)}</span>, footer: '' },
            {
              key: 'name',
              header: 'الصنف',
              render: (row) => (
                <span className="font-semibold text-slate-800">
                  {String(row.name)}
                  {Boolean(row.size || row.color) && <span className="mr-1 text-[12px] font-normal text-slate-500">({[row.size, row.color].filter(Boolean).join(' / ')})</span>}
                </span>
              ),
              footer: 'الإجمالي'
            },
            { key: 'qty', header: 'الكمية', align: 'center', render: (row) => <span className="num font-semibold">{qty(Number(row.quantity))} {String(row.unit)}</span> },
            { key: 'cost', header: 'متوسط التكلفة', align: 'left', render: (row) => <span className="num text-slate-600">{rate(Number(row.avgCost))}</span> },
            { key: 'value', header: 'القيمة', align: 'left', render: (row) => <span className="num font-bold">{money(Number(row.value))}</span>, footer: <span className="num">{money(data?.totalValue ?? 0)}</span> }
          ]}
        />
      </Card>
    </div>
  )
}

function ProductionReport({ range, setRange }: RangeProps): React.JSX.Element {
  const { data, loading, error } = useQuery<{
    orders: Record<string, unknown>[]
    byFactory: Record<string, unknown>[]
    totals: { orders: number; producedQty: number; totalCost: number; materialsCost: number; factoryCost: number; otherCost: number }
  }>('reports:production', range, [range.from, range.to])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <ExportButtons
          title="تقرير الإنتاج"
          subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
          columns={[
            { key: 'order_number', label: 'رقم الأمر' },
            { key: 'date', label: 'التاريخ', type: 'date' },
            { key: 'factory_name', label: 'المصنع' },
            { key: 'product_name', label: 'المنتج' },
            { key: 'produced_qty', label: 'الكمية المنتجة', type: 'qty' },
            { key: 'materials_cost', label: 'تكلفة الخامات', type: 'money' },
            { key: 'factory_cost', label: 'أجر التصنيع', type: 'money' },
            { key: 'other_cost', label: 'تكاليف أخرى', type: 'money' },
            { key: 'total_cost', label: 'إجمالي التكلفة', type: 'money' }
          ]}
          rows={data?.orders ?? []}
          totals={{ total_cost: data?.totals.totalCost ?? 0, materials_cost: data?.totals.materialsCost ?? 0, factory_cost: data?.totals.factoryCost ?? 0 }}
          disabled={!data?.orders.length}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="عدد الأوامر" value={data?.totals.orders ?? 0} />
        <StatCard label="الكميات المنتجة" value={qty(data?.totals.producedQty ?? 0)} />
        <StatCard label="تكلفة الخامات" value={money(data?.totals.materialsCost ?? 0)} />
        <StatCard label="أجور التصنيع" value={money(data?.totals.factoryCost ?? 0)} tone="warning" />
        <StatCard label="إجمالي التكلفة" value={money(data?.totals.totalCost ?? 0)} tone="brand" />
      </div>

      <Card title="حسب المصنع" noPadding>
        <DataTable
          rows={data?.byFactory ?? []}
          rowKey={(row) => String(row.id)}
          empty={<EmptyState title="لا توجد بيانات" />}
          columns={[
            { key: 'label', header: 'المصنع', render: (row) => <span className="font-semibold text-slate-800">{String(row.label)}</span> },
            { key: 'orders', header: 'الأوامر', align: 'center', render: (row) => <span className="num">{String(row.orders)}</span> },
            { key: 'qty', header: 'الكميات', align: 'center', render: (row) => <span className="num">{qty(Number(row.producedQty))}</span> },
            { key: 'materials', header: 'الخامات', align: 'left', render: (row) => <span className="num">{money(Number(row.materialsCost))}</span> },
            { key: 'factory', header: 'أجر التصنيع', align: 'left', render: (row) => <span className="num">{money(Number(row.factoryCost))}</span> },
            { key: 'total', header: 'الإجمالي', align: 'left', render: (row) => <span className="num font-bold">{money(Number(row.totalCost))}</span> }
          ]}
        />
      </Card>

      <Card title="تفاصيل الأوامر" noPadding>
        <DataTable
          rows={data?.orders ?? []}
          loading={loading}
          error={error}
          rowKey={(row) => String(row.id)}
          empty={<EmptyState title="لا توجد أوامر إنتاج" />}
          columns={[
            { key: 'number', header: 'رقم الأمر', render: (row) => <span className="num font-semibold text-brand-700">{String(row.order_number)}</span> },
            { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
            { key: 'factory', header: 'المصنع', render: (row) => String(row.factory_name) },
            { key: 'product', header: 'المنتج', render: (row) => String(row.product_name) },
            { key: 'qty', header: 'المنتج', align: 'center', render: (row) => <span className="num">{qty(Number(row.produced_qty))} / {qty(Number(row.expected_qty))}</span> },
            { key: 'cost', header: 'إجمالي التكلفة', align: 'left', render: (row) => <span className="num font-semibold">{money(Number(row.total_cost))}</span> },
            { key: 'unit', header: 'تكلفة الوحدة', align: 'left', render: (row) => <span className="num font-bold text-brand-700">{rate(Number(row.unit_cost))}</span> }
          ]}
        />
      </Card>
    </div>
  )
}

function ExpensesReport({ range, setRange }: RangeProps): React.JSX.Element {
  const { data, loading, error } = useQuery<{ categoryId: number; name: string; total: number; count: number }[]>('expenses:byCategory', range, [range.from, range.to])
  const rows = data ?? []
  const total = rows.reduce((s, row) => s + row.total, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <ExportButtons
          title="تقرير المصروفات حسب الفئة"
          subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
          columns={[
            { key: 'name', label: 'الفئة' },
            { key: 'count', label: 'عدد المصروفات', type: 'number' },
            { key: 'total', label: 'الإجمالي', type: 'money' }
          ]}
          rows={rows as unknown as Record<string, unknown>[]}
          totals={{ total }}
          disabled={!rows.length}
        />
      </div>

      <StatCard label="إجمالي المصروفات" value={money(total)} tone="warning" />

      <Card noPadding>
        <DataTable
          rows={rows}
          loading={loading}
          error={error}
          rowKey={(row) => String(row.categoryId)}
          empty={<EmptyState title="لا توجد مصروفات في هذه الفترة" />}
          footer
          columns={[
            { key: 'name', header: 'الفئة', render: (row) => <span className="font-semibold text-slate-800">{row.name}</span>, footer: 'الإجمالي' },
            { key: 'count', header: 'عدد المصروفات', align: 'center', render: (row) => <span className="num">{row.count}</span> },
            { key: 'percent', header: 'النسبة', align: 'center', render: (row) => <Badge tone="slate">{percent(total ? (row.total / total) * 100 : 0)}</Badge> },
            { key: 'total', header: 'الإجمالي', align: 'left', render: (row) => <span className="num font-bold text-rose-700">{money(row.total)}</span>, footer: <span className="num">{money(total)}</span> }
          ]}
        />
      </Card>
    </div>
  )
}

function PaymentsReport({ range, setRange }: RangeProps): React.JSX.Element {
  const [direction, setDirection] = useState('')
  const { data, loading, error } = useQuery<Record<string, unknown>[]>('reports:payments', { ...range, direction: direction || undefined }, [range.from, range.to, direction])
  const rows = data ?? []
  const totalIn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + Number(r.amount), 0)
  const totalOut = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          <Select className="h-10 w-36" value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="">الكل</option>
            <option value="in">مقبوضات</option>
            <option value="out">مدفوعات</option>
          </Select>
        </div>
        <ExportButtons
          title="تقرير المقبوضات والمدفوعات"
          subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
          columns={[
            { key: 'payment_number', label: 'رقم السند' },
            { key: 'date', label: 'التاريخ', type: 'date' },
            { key: 'party_name', label: 'الطرف' },
            { key: 'method_name', label: 'طريقة الدفع' },
            { key: 'amount', label: 'المبلغ', type: 'money' }
          ]}
          rows={rows}
          disabled={!rows.length}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="إجمالي المقبوضات" value={money(totalIn)} tone="positive" />
        <StatCard label="إجمالي المدفوعات" value={money(totalOut)} tone="negative" />
        <StatCard label="الصافي" value={money(totalIn - totalOut)} tone={totalIn - totalOut >= 0 ? 'positive' : 'negative'} />
      </div>

      <Card noPadding>
        <DataTable
          rows={rows}
          loading={loading}
          error={error}
          rowKey={(row) => String(row.id)}
          empty={<EmptyState title="لا توجد سندات في هذه الفترة" />}
          columns={[
            { key: 'number', header: 'رقم السند', render: (row) => <span className="num font-semibold text-brand-700">{String(row.payment_number)}</span> },
            { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
            { key: 'type', header: 'النوع', align: 'center', render: (row) => (row.direction === 'in' ? <Badge tone="green">قبض</Badge> : <Badge tone="red">صرف</Badge>) },
            { key: 'party', header: 'الطرف', render: (row) => String(row.party_name ?? '—') },
            { key: 'method', header: 'طريقة الدفع', render: (row) => String(row.method_name) },
            { key: 'account', header: 'الحساب', render: (row) => <span className="text-[12.5px] text-slate-600">{String(row.account_name)}</span> },
            { key: 'amount', header: 'المبلغ', align: 'left', render: (row) => <span className={cn('num font-bold', row.direction === 'in' ? 'text-emerald-700' : 'text-rose-700')}>{money(Number(row.amount))}</span> }
          ]}
        />
      </Card>
    </div>
  )
}

export { FileBarChart, Package, yearStart }
