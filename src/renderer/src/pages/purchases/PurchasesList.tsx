import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RotateCcw } from 'lucide-react'
import { PERMISSIONS } from '@shared/permissions'
import { useDebounced, useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { Badge, Card, DataTable, EmptyState, Pagination, SearchInput, Select, StatCard, Tabs, cn } from '../../components/ui'
import { DateRangePicker, ExportButtons, PageHeader } from '../../components/common/page'
import { date, money, monthStart, today } from '../../lib/format'

export function PurchasesListPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { can } = useSession()
  const [tab, setTab] = useState('invoices')
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [search, setSearch] = useState('')
  const [purchaseType, setPurchaseType] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search, 300)
  const pageSize = 50

  const purchases = useQuery<{ rows: Record<string, unknown>[]; total: number; summary: Record<string, number> }>(
    tab === 'invoices' ? 'purchases:list' : null,
    { from: range.from, to: range.to, search: debounced || undefined, purchaseType: purchaseType || undefined, paymentStatus: paymentStatus || undefined, page, pageSize },
    [tab, range.from, range.to, debounced, purchaseType, paymentStatus, page]
  )
  const returns = useQuery<Record<string, unknown>[]>(tab === 'returns' ? 'purchases:returns' : null, { from: range.from, to: range.to }, [tab, range.from, range.to])

  const summary = purchases.data?.summary ?? { total: 0, paid: 0, due: 0, count: 0 }

  return (
    <div>
      <PageHeader
        title="المشتريات"
        subtitle="فواتير شراء البضاعة الجاهزة والخامات"
        actions={
          <>
            <ExportButtons
              title="تقرير المشتريات"
              subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
              columns={[
                { key: 'invoice_number', label: 'رقم الفاتورة' },
                { key: 'date', label: 'التاريخ', type: 'date' },
                { key: 'supplier_name', label: 'المورد' },
                { key: 'total', label: 'الإجمالي', type: 'money' },
                { key: 'paid_amount', label: 'المدفوع', type: 'money' },
                { key: 'due_amount', label: 'المتبقي', type: 'money' }
              ]}
              rows={purchases.data?.rows ?? []}
              totals={{ total: summary.total, paid_amount: summary.paid, due_amount: summary.due }}
              disabled={!purchases.data?.rows.length}
            />
            {can(PERMISSIONS.PURCHASES_CREATE) && (
              <button type="button" className="btn-primary" onClick={() => navigate('/purchases/new')}>
                <Plus className="h-4 w-4" />
                فاتورة شراء جديدة
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="عدد الفواتير" value={summary.count ?? 0} />
        <StatCard label="إجمالي المشتريات" value={money(summary.total)} tone="brand" />
        <StatCard label="المدفوع" value={money(summary.paid)} tone="positive" />
        <StatCard label="المستحق للموردين" value={money(summary.due)} tone="negative" />
      </div>

      <Card noPadding>
        <div className="px-3 pt-1">
          <Tabs tabs={[{ key: 'invoices', label: 'فواتير الشراء' }, { key: 'returns', label: 'المردودات' }]} active={tab} onChange={setTab} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <DateRangePicker value={range} onChange={(value) => { setRange(value); setPage(1) }} />
          {tab === 'invoices' && (
            <>
              <SearchInput className="w-full max-w-xs" value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="رقم الفاتورة أو اسم المورد…" />
              <Select className="h-10 w-40" value={purchaseType} onChange={(e) => { setPurchaseType(e.target.value); setPage(1) }}>
                <option value="">كل الأنواع</option>
                <option value="goods">بضاعة جاهزة</option>
                <option value="materials">خامات</option>
              </Select>
              <Select className="h-10 w-40" value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setPage(1) }}>
                <option value="">كل حالات السداد</option>
                <option value="paid">مسددة</option>
                <option value="partial">جزئي</option>
                <option value="unpaid">غير مسددة</option>
              </Select>
            </>
          )}
        </div>

        {tab === 'invoices' ? (
          <>
            <DataTable
              rows={purchases.data?.rows ?? []}
              loading={purchases.loading}
              error={purchases.error}
              onRetry={purchases.reload}
              rowKey={(row) => String(row.id)}
              onRowClick={(row) => navigate(`/purchases/${row.id}`)}
              empty={
                <EmptyState
                  title="لا توجد فواتير شراء في هذه الفترة"
                  action={
                    can(PERMISSIONS.PURCHASES_CREATE) ? (
                      <button type="button" className="btn-primary" onClick={() => navigate('/purchases/new')}>
                        <Plus className="h-4 w-4" />
                        فاتورة شراء جديدة
                      </button>
                    ) : undefined
                  }
                />
              }
              columns={[
                { key: 'number', header: 'رقم الفاتورة', render: (row) => <span className="num font-semibold text-brand-700">{String(row.invoice_number)}</span> },
                { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
                { key: 'supplier', header: 'المورد', render: (row) => <span className="font-semibold text-slate-800">{String(row.supplier_name)}</span> },
                {
                  key: 'type',
                  header: 'النوع',
                  align: 'center',
                  render: (row) => (row.purchase_type === 'materials' ? <Badge tone="violet">خامات</Badge> : <Badge tone="blue">بضاعة</Badge>)
                },
                { key: 'ref', header: 'فاتورة المورد', render: (row) => <span className="num text-[12.5px] text-slate-500">{String(row.supplier_invoice_number ?? '—')}</span> },
                { key: 'total', header: 'الإجمالي', align: 'left', render: (row) => <span className="num font-semibold">{money(Number(row.total))}</span> },
                { key: 'paid', header: 'المدفوع', align: 'left', render: (row) => <span className="num text-emerald-700">{money(Number(row.paid_amount))}</span> },
                { key: 'due', header: 'المتبقي', align: 'left', render: (row) => <span className={cn('num font-semibold', Number(row.due_amount) > 0 ? 'text-rose-700' : 'text-slate-300')}>{money(Number(row.due_amount))}</span> },
                {
                  key: 'status',
                  header: 'الحالة',
                  align: 'center',
                  render: (row) =>
                    row.status === 'void' ? <Badge tone="slate">ملغاة</Badge> : Number(row.due_amount) <= 0 ? <Badge tone="green">مسددة</Badge> : Number(row.paid_amount) > 0 ? <Badge tone="amber">جزئي</Badge> : <Badge tone="red">آجلة</Badge>
                }
              ]}
            />
            <div className="px-3">
              <Pagination page={page} pageSize={pageSize} total={purchases.data?.total ?? 0} onChange={setPage} />
            </div>
          </>
        ) : (
          <DataTable
            rows={returns.data ?? []}
            loading={returns.loading}
            error={returns.error}
            rowKey={(row) => String(row.id)}
            empty={<EmptyState icon={<RotateCcw className="h-7 w-7" />} title="لا توجد مردودات مشتريات" />}
            columns={[
              { key: 'number', header: 'رقم المردود', render: (row) => <span className="num font-semibold text-brand-700">{String(row.return_number)}</span> },
              { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
              { key: 'supplier', header: 'المورد', render: (row) => String(row.supplier_name) },
              { key: 'reason', header: 'السبب', render: (row) => String(row.reason ?? '—') },
              { key: 'total', header: 'القيمة', align: 'left', render: (row) => <span className="num font-semibold text-emerald-700">{money(Number(row.total))}</span> }
            ]}
          />
        )}
      </Card>
    </div>
  )
}
