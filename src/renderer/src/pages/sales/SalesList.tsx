import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RotateCcw } from 'lucide-react'
import { PERMISSIONS } from '@shared/permissions'
import { useDebounced, useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { Badge, Card, DataTable, EmptyState, Pagination, SearchInput, Select, StatCard, Tabs, cn } from '../../components/ui'
import { DateRangePicker, ExportButtons, PageHeader } from '../../components/common/page'
import { date, money, monthStart, today } from '../../lib/format'

export function SalesListPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { can } = useSession()
  const [tab, setTab] = useState('invoices')
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [search, setSearch] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('')
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search, 300)
  const pageSize = 50

  const sales = useQuery<{ rows: Record<string, unknown>[]; total: number; summary: Record<string, number> }>(
    tab === 'invoices' ? 'sales:list' : null,
    {
      from: range.from,
      to: range.to,
      search: debounced || undefined,
      paymentStatus: paymentStatus || undefined,
      status: status || undefined,
      saleChannel: channel || undefined,
      page,
      pageSize
    },
    [tab, range.from, range.to, debounced, paymentStatus, status, channel, page]
  )

  const returns = useQuery<Record<string, unknown>[]>(
    tab === 'returns' ? 'sales:returns' : null,
    { from: range.from, to: range.to },
    [tab, range.from, range.to]
  )

  const summary = sales.data?.summary ?? { total: 0, paid: 0, due: 0, cogs: 0, count: 0 }
  const profit = summary.total - summary.cogs

  return (
    <div>
      <PageHeader
        title="المبيعات"
        subtitle="فواتير البيع والمردودات"
        actions={
          <>
            <ExportButtons
              title="تقرير المبيعات"
              subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
              columns={[
                { key: 'invoice_number', label: 'رقم الفاتورة' },
                { key: 'date', label: 'التاريخ', type: 'date' },
                { key: 'customer_name', label: 'العميل' },
                { key: 'total', label: 'الإجمالي', type: 'money' },
                { key: 'paid_amount', label: 'المدفوع', type: 'money' },
                { key: 'due_amount', label: 'المتبقي', type: 'money' }
              ]}
              rows={sales.data?.rows ?? []}
              totals={{ total: summary.total, paid_amount: summary.paid, due_amount: summary.due }}
              disabled={!sales.data?.rows.length}
            />
            {can(PERMISSIONS.SALES_CREATE) && (
              <button type="button" className="btn-primary" onClick={() => navigate('/sales/new')}>
                <Plus className="h-4 w-4" />
                فاتورة بيع جديدة
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="عدد الفواتير" value={summary.count ?? 0} />
        <StatCard label="إجمالي المبيعات" value={money(summary.total)} tone="brand" />
        <StatCard label="المحصَّل" value={money(summary.paid)} tone="positive" />
        <StatCard label="المستحق" value={money(summary.due)} tone="negative" />
        <StatCard label="مجمل الربح" value={money(profit)} tone={profit >= 0 ? 'positive' : 'negative'} />
      </div>

      <Card noPadding>
        <div className="px-3 pt-1">
          <Tabs
            tabs={[
              { key: 'invoices', label: 'فواتير البيع' },
              { key: 'returns', label: 'المردودات' }
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <DateRangePicker value={range} onChange={(value) => { setRange(value); setPage(1) }} />
          {tab === 'invoices' && (
            <>
              <SearchInput className="w-full max-w-xs" value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="رقم الفاتورة أو اسم العميل…" />
              <Select className="h-10 w-40" value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setPage(1) }}>
                <option value="">كل حالات السداد</option>
                <option value="paid">مسددة بالكامل</option>
                <option value="partial">مسددة جزئيًا</option>
                <option value="unpaid">غير مسددة</option>
              </Select>
              <Select className="h-10 w-40" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1) }}>
                <option value="">كل القنوات</option>
                <option value="wholesale">جملة</option>
                <option value="retail">تجزئة</option>
                <option value="online">أونلاين</option>
              </Select>
              <Select className="h-10 w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
                <option value="">المؤكدة</option>
                <option value="void">الملغاة</option>
              </Select>
            </>
          )}
        </div>

        {tab === 'invoices' ? (
          <>
            <DataTable
              rows={sales.data?.rows ?? []}
              loading={sales.loading}
              error={sales.error}
              onRetry={sales.reload}
              rowKey={(row) => String(row.id)}
              onRowClick={(row) => navigate(`/sales/${row.id}`)}
              empty={
                <EmptyState
                  title="لا توجد فواتير في هذه الفترة"
                  description="جرّب توسيع نطاق التاريخ أو أنشئ فاتورة جديدة."
                  action={
                    can(PERMISSIONS.SALES_CREATE) ? (
                      <button type="button" className="btn-primary" onClick={() => navigate('/sales/new')}>
                        <Plus className="h-4 w-4" />
                        فاتورة بيع جديدة
                      </button>
                    ) : undefined
                  }
                />
              }
              columns={[
                { key: 'number', header: 'رقم الفاتورة', render: (row) => <span className="num font-semibold text-brand-700">{String(row.invoice_number)}</span> },
                { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
                {
                  key: 'customer',
                  header: 'العميل',
                  render: (row) => (
                    <div>
                      <p className="font-semibold text-slate-800">{String(row.customer_name)}</p>
                      {row.customer_phone ? <p className="num text-[12px] text-slate-500">{String(row.customer_phone)}</p> : null}
                    </div>
                  )
                },
                {
                  key: 'channel',
                  header: 'القناة',
                  align: 'center',
                  render: (row) => {
                    const map: Record<string, { label: string; tone: 'blue' | 'green' | 'violet' }> = {
                      wholesale: { label: 'جملة', tone: 'blue' },
                      retail: { label: 'تجزئة', tone: 'green' },
                      online: { label: 'أونلاين', tone: 'violet' }
                    }
                    const c = map[String(row.sale_channel ?? 'wholesale')] ?? map.wholesale
                    return <Badge tone={c.tone}>{c.label}</Badge>
                  }
                },
                { key: 'items', header: 'الأصناف', align: 'center', render: (row) => <span className="num text-slate-500">{String(row.item_count)}</span> },
                { key: 'total', header: 'الإجمالي', align: 'left', render: (row) => <span className="num font-semibold">{money(Number(row.total))}</span> },
                { key: 'paid', header: 'المدفوع', align: 'left', render: (row) => <span className="num text-emerald-700">{money(Number(row.paid_amount))}</span> },
                { key: 'due', header: 'المتبقي', align: 'left', render: (row) => <span className={cn('num font-semibold', Number(row.due_amount) > 0 ? 'text-rose-700' : 'text-slate-300')}>{money(Number(row.due_amount))}</span> },
                {
                  key: 'status',
                  header: 'الحالة',
                  align: 'center',
                  render: (row) =>
                    row.status === 'void' ? (
                      <Badge tone="slate">ملغاة</Badge>
                    ) : Number(row.due_amount) <= 0 ? (
                      <Badge tone="green">مسددة</Badge>
                    ) : Number(row.paid_amount) > 0 ? (
                      <Badge tone="amber">جزئي</Badge>
                    ) : (
                      <Badge tone="red">آجلة</Badge>
                    )
                }
              ]}
            />
            <div className="px-3">
              <Pagination page={page} pageSize={pageSize} total={sales.data?.total ?? 0} onChange={setPage} />
            </div>
          </>
        ) : (
          <DataTable
            rows={returns.data ?? []}
            loading={returns.loading}
            error={returns.error}
            rowKey={(row) => String(row.id)}
            empty={<EmptyState icon={<RotateCcw className="h-7 w-7" />} title="لا توجد مردودات" description="المردودات تُسجَّل من صفحة الفاتورة." />}
            columns={[
              { key: 'number', header: 'رقم المردود', render: (row) => <span className="num font-semibold text-brand-700">{String(row.return_number)}</span> },
              { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
              { key: 'customer', header: 'العميل', render: (row) => String(row.customer_name) },
              { key: 'reason', header: 'السبب', render: (row) => String(row.reason ?? '—') },
              { key: 'total', header: 'القيمة', align: 'left', render: (row) => <span className="num font-semibold text-rose-700">{money(Number(row.total))}</span> },
              { key: 'status', header: 'الحالة', align: 'center', render: (row) => (row.status === 'void' ? <Badge tone="slate">ملغى</Badge> : <Badge tone="green">مؤكد</Badge>) }
            ]}
          />
        )}
      </Card>
    </div>
  )
}
