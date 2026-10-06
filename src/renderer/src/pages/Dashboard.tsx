import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import {
  AlertTriangle, ArrowLeftRight, Banknote, Boxes, Clock, Factory, Landmark,
  PackageMinus, Receipt, ShoppingCart, TrendingDown, TrendingUp, Users, Wallet
} from 'lucide-react'
import { useQuery } from '../lib/hooks'
import { Badge, Card, DataTable, EmptyState, MiniBar, Spinner, StatCard, cn } from '../components/ui'
import { PageHeader } from '../components/common/page'
import { date, money, moneyShort, number, percent, qty } from '../lib/format'
import { useSession } from '../store/session'

interface DashboardData {
  range: { from: string; to: string }
  kpis: Record<string, number>
  charts: {
    salesOverTime: { label: string; sales: number; profit: number; cost: number }[]
    expensesOverTime: { label: string; amount: number }[]
    topCustomers: { label: string; amount: number }[]
    topProducts: { label: string; quantity: number; amount: number }[]
    topSuppliers: { label: string; amount: number }[]
    expensesByCategory: { label: string; amount: number }[]
    salesByChannel: { label: string; amount: number; profit: number }[]
    receivablesAging: { label: string; amount: number }[]
    payablesAging: { label: string; amount: number }[]
  }
  alerts: {
    lowStock: { name: string; sku: string; quantity: number; minStock: number }[]
    overdueCustomers: { id: number; name: string; phone: string | null; due: number; days: number }[]
    openProductionOrders: { id: number; orderNumber: string; factory: string; expectedDate: string | null; lateDays: number }[]
    negativeStock: { name: string; sku: string; quantity: number; warehouse: string }[]
  }
  recent: { sales: Record<string, unknown>[]; payments: Record<string, unknown>[] }
}

const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'this_week', label: 'هذا الأسبوع' },
  { key: 'this_month', label: 'هذا الشهر' },
  { key: 'last_month', label: 'الشهر الماضي' },
  { key: 'this_quarter', label: 'هذا الربع' },
  { key: 'this_year', label: 'هذه السنة' }
]

const PIE_COLORS = ['#2f8ff5', '#16a34a', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#f97316']

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }): React.JSX.Element | null {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] shadow-lg">
      {label && <p className="mb-1 font-bold text-slate-700">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-slate-600">{entry.name}:</span>
          <span className="num font-semibold text-slate-800">{money(entry.value)}</span>
        </p>
      ))}
    </div>
  )
}

export function Dashboard(): React.JSX.Element {
  const [preset, setPreset] = useState('this_month')
  const navigate = useNavigate()
  const { settings } = useSession()
  const { data, loading, error, reload } = useQuery<DashboardData>('dashboard:load', { preset }, [preset])

  if (loading && !data) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }
  if (error) {
    return (
      <Card>
        <EmptyState title="تعذّر تحميل لوحة المعلومات" description={error} action={<button type="button" className="btn-primary" onClick={reload}>إعادة المحاولة</button>} />
      </Card>
    )
  }
  if (!data) return <></>

  const k = data.kpis
  const netProfitTone = k.netProfit >= 0 ? 'positive' : 'negative'
  const maxCustomer = Math.max(...data.charts.topCustomers.map((c) => c.amount), 1)
  const alertCount =
    data.alerts.lowStock.length + data.alerts.overdueCustomers.length + data.alerts.negativeStock.length +
    data.alerts.openProductionOrders.filter((o) => o.lateDays > 0).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="لوحة المعلومات"
        subtitle={
          <>
            الفترة من <span className="num">{date(data.range.from)}</span> إلى <span className="num">{date(data.range.to)}</span>
          </>
        }
        actions={
          <div className="flex flex-wrap gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors',
                  preset === p.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {/* المؤشرات الأساسية */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="مبيعات اليوم" value={moneyShort(k.salesToday)} icon={<ShoppingCart className="h-5 w-5" />} tone="brand" hint={`مبيعات الشهر: ${moneyShort(k.salesMonth)}`} onClick={() => navigate('/sales')} />
        <StatCard label="مبيعات الفترة" value={moneyShort(k.salesPeriod)} icon={<TrendingUp className="h-5 w-5" />} hint={`${number(k.salesCount)} فاتورة`} onClick={() => navigate('/sales')} />
        <StatCard label="مجمل الربح" value={moneyShort(k.grossProfit)} icon={<TrendingUp className="h-5 w-5" />} tone={k.grossProfit >= 0 ? 'positive' : 'negative'} hint={k.salesPeriod ? `هامش ${percent((k.grossProfit / k.salesPeriod) * 100)}` : undefined} />
        <StatCard label="صافي الربح" value={moneyShort(k.netProfit)} icon={k.netProfit >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />} tone={netProfitTone} hint={`بعد مصروفات ${moneyShort(k.expensesPeriod)}`} onClick={() => navigate('/reports/profit')} />
        <StatCard label="المصروفات" value={moneyShort(k.expensesPeriod)} icon={<Receipt className="h-5 w-5" />} tone="warning" onClick={() => navigate('/expenses')} />

        <StatCard label="رصيد الصندوق" value={moneyShort(k.cashBalance)} icon={<Wallet className="h-5 w-5" />} tone={k.cashBalance >= 0 ? 'positive' : 'negative'} onClick={() => navigate('/treasury')} />
        <StatCard label="رصيد البنك" value={moneyShort(k.bankBalance)} icon={<Landmark className="h-5 w-5" />} tone={k.bankBalance >= 0 ? 'positive' : 'negative'} onClick={() => navigate('/treasury')} />
        <StatCard label="مستحقات العملاء" value={moneyShort(k.receivables)} icon={<Users className="h-5 w-5" />} tone="warning" hint={k.overdueReceivables > 0 ? `متأخر منها ${moneyShort(k.overdueReceivables)}` : undefined} onClick={() => navigate('/reports/receivables')} />
        <StatCard label="مستحقات الموردين" value={moneyShort(k.payables)} icon={<Banknote className="h-5 w-5" />} tone="negative" hint={k.factoryPayables ? `ومستحقات مصانع ${moneyShort(k.factoryPayables)}` : undefined} onClick={() => navigate('/reports/payables')} />
        <StatCard label="قيمة المخزون" value={moneyShort(k.inventoryValue)} icon={<Boxes className="h-5 w-5" />} hint={k.wipValue ? `ولدى المصانع ${moneyShort(k.wipValue)}` : undefined} onClick={() => navigate('/inventory')} />
      </div>

      {/* تنبيهات تحتاج إجراءً */}
      {alertCount > 0 && (
        <Card
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              تنبيهات تحتاج انتباهك
            </span>
          }
          bodyClassName="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <AlertBlock
            title="مستحقات متأخرة"
            empty="لا توجد مستحقات متأخرة"
            items={data.alerts.overdueCustomers.map((c) => ({
              key: String(c.id),
              main: c.name,
              sub: `متأخر ${number(c.days)} يومًا`,
              value: money(c.due),
              onClick: () => navigate(`/customers/${c.id}`)
            }))}
            icon={<Clock className="h-4 w-4" />}
            tone="amber"
          />
          <AlertBlock
            title="نقص في المخزون"
            empty="جميع الأصناف فوق حد الطلب"
            items={data.alerts.lowStock.map((s) => ({
              key: s.sku,
              main: s.name,
              sub: `الحد ${qty(s.minStock)}`,
              value: qty(s.quantity),
              onClick: () => navigate('/inventory')
            }))}
            icon={<PackageMinus className="h-4 w-4" />}
            tone="rose"
          />
          <AlertBlock
            title="أوامر إنتاج مفتوحة"
            empty="لا توجد أوامر مفتوحة"
            items={data.alerts.openProductionOrders.map((o) => ({
              key: String(o.id),
              main: o.orderNumber,
              sub: o.factory,
              value: o.lateDays > 0 ? `متأخر ${number(o.lateDays)} يوم` : date(o.expectedDate),
              tone: o.lateDays > 0 ? 'danger' : undefined,
              onClick: () => navigate(`/production/${o.id}`)
            }))}
            icon={<Factory className="h-4 w-4" />}
            tone="violet"
          />
          <AlertBlock
            title="أرصدة مخزون سالبة"
            empty="لا توجد أرصدة سالبة"
            items={data.alerts.negativeStock.map((s) => ({
              key: `${s.sku}-${s.warehouse}`,
              main: s.name,
              sub: s.warehouse,
              value: qty(s.quantity),
              tone: 'danger' as const,
              onClick: () => navigate('/inventory')
            }))}
            icon={<AlertTriangle className="h-4 w-4" />}
            tone="rose"
          />
        </Card>
      )}

      {/* الرسوم البيانية */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="المبيعات والأرباح عبر الزمن" className="xl:col-span-2">
          {data.charts.salesOverTime.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.charts.salesOverTime} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2f8ff5" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#2f8ff5" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#16a34a" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} reversed axisLine={false} tickLine={false} />
                <YAxis orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => moneyShort(v).replace(settings?.currency.symbol ?? '', '')} axisLine={false} tickLine={false} width={70} />
                <Tooltip content={<ChartTooltip />} />
                <Legend formatter={(value) => <span className="text-[12.5px] text-slate-600">{value}</span>} />
                <Area type="monotone" dataKey="sales" name="المبيعات" stroke="#2f8ff5" strokeWidth={2} fill="url(#salesFill)" />
                <Area type="monotone" dataKey="profit" name="مجمل الربح" stroke="#16a34a" strokeWidth={2} fill="url(#profitFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="لا توجد مبيعات في هذه الفترة" />
          )}
        </Card>

        <Card title="توزيع المصروفات">
          {data.charts.expensesByCategory.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={data.charts.expensesByCategory} dataKey="amount" nameKey="label" cx="50%" cy="45%" outerRadius={85} innerRadius={45} paddingAngle={2}>
                  {data.charts.expensesByCategory.map((entry, index) => (
                    <Cell key={entry.label} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend formatter={(value) => <span className="text-[12px] text-slate-600">{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="لا توجد مصروفات مسجّلة" />
          )}
        </Card>

        <Card title="المبيعات حسب القناة" subtitle="صافي الربح بعد خصم التكلفة والتوصيل">
          {data.charts.salesByChannel?.length ? (
            <ul className="space-y-3">
              {data.charts.salesByChannel.map((row) => (
                <li key={row.label}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-[13px]">
                    <span className="font-semibold text-slate-700">{row.label}</span>
                    <span className="num shrink-0 font-bold text-slate-800">{money(row.amount)}</span>
                  </div>
                  <MiniBar value={row.amount} max={Math.max(...data.charts.salesByChannel.map((c) => c.amount), 1)} />
                  <p className={cn('mt-1 text-[12px]', row.profit >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                    صافي الربح: <span className="num font-semibold">{money(row.profit)}</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="لا توجد مبيعات في هذه الفترة" />
          )}
        </Card>

        <Card title="أفضل العملاء">
          {data.charts.topCustomers.length ? (
            <ul className="space-y-3">
              {data.charts.topCustomers.map((customer) => (
                <li key={customer.label}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-[13px]">
                    <span className="truncate font-semibold text-slate-700">{customer.label}</span>
                    <span className="num shrink-0 font-bold text-slate-800">{money(customer.amount)}</span>
                  </div>
                  <MiniBar value={customer.amount} max={maxCustomer} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="لا توجد مبيعات" />
          )}
        </Card>

        <Card title="الأصناف الأكثر مبيعًا" className="xl:col-span-2">
          {data.charts.topProducts.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.charts.topProducts} layout="vertical" margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => moneyShort(v).replace(settings?.currency.symbol ?? '', '')} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" orientation="right" tick={{ fontSize: 11, fill: '#475569' }} width={150} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="amount" name="قيمة المبيعات" fill="#2f8ff5" radius={[0, 5, 5, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="لا توجد بيانات" />
          )}
        </Card>

        <Card title="أعمار الذمم المدينة">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data.charts.receivablesAging}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: '#64748b' }} reversed axisLine={false} tickLine={false} />
              <YAxis orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => moneyShort(v).replace(settings?.currency.symbol ?? '', '')} axisLine={false} tickLine={false} width={65} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="amount" name="المستحق" radius={[5, 5, 0, 0]} barSize={38}>
                {data.charts.receivablesAging.map((entry, index) => (
                  <Cell key={entry.label} fill={['#16a34a', '#f59e0b', '#f97316', '#ef4444'][index] ?? '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="المصروفات عبر الزمن" className="xl:col-span-2">
          {data.charts.expensesOverTime.length ? (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={data.charts.expensesOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} reversed axisLine={false} tickLine={false} />
                <YAxis orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => moneyShort(v).replace(settings?.currency.symbol ?? '', '')} axisLine={false} tickLine={false} width={65} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="amount" name="المصروفات" fill="#f59e0b" radius={[5, 5, 0, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="لا توجد مصروفات" />
          )}
        </Card>

        <Card title="أكبر الموردين">
          {data.charts.topSuppliers.length ? (
            <ul className="space-y-3">
              {data.charts.topSuppliers.map((supplier) => (
                <li key={supplier.label}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-[13px]">
                    <span className="truncate font-semibold text-slate-700">{supplier.label}</span>
                    <span className="num shrink-0 font-bold text-slate-800">{money(supplier.amount)}</span>
                  </div>
                  <MiniBar value={supplier.amount} max={Math.max(...data.charts.topSuppliers.map((s) => s.amount), 1)} tone="rose" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="لا توجد مشتريات" />
          )}
        </Card>
      </div>

      {/* أحدث الحركات */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="أحدث فواتير البيع" noPadding actions={<button type="button" className="btn-ghost btn-sm" onClick={() => navigate('/sales')}>عرض الكل</button>}>
          <DataTable
            rows={data.recent.sales}
            rowKey={(row) => String(row.id)}
            onRowClick={(row) => navigate(`/sales/${row.id}`)}
            empty={<EmptyState title="لا توجد فواتير بعد" />}
            columns={[
              { key: 'number', header: 'رقم الفاتورة', render: (row) => <span className="num font-semibold text-brand-700">{String(row.invoice_number)}</span> },
              { key: 'customer', header: 'العميل', render: (row) => String(row.customer_name) },
              { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
              { key: 'total', header: 'الإجمالي', align: 'left', render: (row) => <span className="num font-semibold">{money(Number(row.total))}</span> },
              {
                key: 'status',
                header: 'السداد',
                align: 'center',
                render: (row) => {
                  const due = Number(row.total) - Number(row.paid_amount)
                  return due <= 0 ? <Badge tone="green">مسددة</Badge> : Number(row.paid_amount) > 0 ? <Badge tone="amber">جزئي</Badge> : <Badge tone="red">آجلة</Badge>
                }
              }
            ]}
          />
        </Card>

        <Card title="أحدث الحركات المالية" noPadding actions={<button type="button" className="btn-ghost btn-sm" onClick={() => navigate('/payments')}>عرض الكل</button>}>
          <DataTable
            rows={data.recent.payments}
            rowKey={(row) => String(row.id)}
            onRowClick={(row) => navigate(`/payments/${row.id}`)}
            empty={<EmptyState title="لا توجد سندات بعد" />}
            columns={[
              { key: 'number', header: 'رقم السند', render: (row) => <span className="num font-semibold text-brand-700">{String(row.payment_number)}</span> },
              { key: 'party', header: 'الطرف', render: (row) => String(row.party_name ?? '—') },
              { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
              {
                key: 'amount',
                header: 'المبلغ',
                align: 'left',
                render: (row) => (
                  <span className={cn('num font-semibold', row.direction === 'in' ? 'text-emerald-700' : 'text-rose-700')}>
                    {row.direction === 'in' ? '+' : '−'} {money(Number(row.amount))}
                  </span>
                )
              },
              {
                key: 'type',
                header: 'النوع',
                align: 'center',
                render: (row) => (row.direction === 'in' ? <Badge tone="green">قبض</Badge> : <Badge tone="red">صرف</Badge>)
              }
            ]}
          />
        </Card>
      </div>
    </div>
  )
}

function AlertBlock({
  title,
  items,
  empty,
  icon,
  tone
}: {
  title: string
  items: { key: string; main: string; sub: string; value: string; tone?: 'danger'; onClick?: () => void }[]
  empty: string
  icon: React.ReactNode
  tone: 'amber' | 'rose' | 'violet'
}): React.JSX.Element {
  const tones = {
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    violet: 'bg-violet-50 text-violet-600'
  }
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('rounded-lg p-1.5', tones[tone])}>{icon}</span>
        <h3 className="text-[13px] font-bold text-slate-700">{title}</h3>
        {items.length > 0 && <span className="mr-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-center text-[12.5px] text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 5).map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={item.onClick}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-right hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-slate-700">{item.main}</span>
                  <span className="block truncate text-[11.5px] text-slate-500">{item.sub}</span>
                </span>
                <span className={cn('num shrink-0 text-[12.5px] font-bold', item.tone === 'danger' ? 'text-rose-600' : 'text-slate-700')}>
                  {item.value}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { ArrowLeftRight }
