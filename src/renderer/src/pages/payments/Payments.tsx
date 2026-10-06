import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Ban, Plus } from 'lucide-react'
import { PERMISSIONS } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useDebounced, useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Modal, Pagination, SearchInput, Select, Spinner, StatCard, cn, useConfirm } from '../../components/ui'
import { DateRangePicker, DocumentActions, ExportButtons, PageHeader } from '../../components/common/page'
import { date, dateTime, money, monthStart, today } from '../../lib/format'
import { PaymentFormModal } from './PaymentForm'

export function PaymentsPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { can } = useSession()
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [formDirection, setFormDirection] = useState<'in' | 'out'>('in')
  const [detailId, setDetailId] = useState<number | null>(id ? Number(id) : null)
  const debounced = useDebounced(search, 300)
  const pageSize = 50

  const payments = useQuery<{ rows: Record<string, unknown>[]; total: number; summary: Record<string, number> }>(
    'payments:list',
    { from: range.from, to: range.to, search: debounced || undefined, direction: direction || undefined, status: status || undefined, page, pageSize },
    [range.from, range.to, debounced, direction, status, page]
  )

  useEffect(() => {
    if (id) setDetailId(Number(id))
  }, [id])

  const summary = payments.data?.summary ?? { totalIn: 0, totalOut: 0, count: 0 }

  return (
    <div>
      <PageHeader
        title="المقبوضات والمدفوعات"
        subtitle="سندات القبض من العملاء وسندات الصرف للموردين والمصانع"
        actions={
          <>
            <ExportButtons
              title="تقرير السندات"
              subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
              columns={[
                { key: 'payment_number', label: 'رقم السند' },
                { key: 'date', label: 'التاريخ', type: 'date' },
                { key: 'party_name', label: 'الطرف' },
                { key: 'method_name', label: 'طريقة الدفع' },
                { key: 'amount', label: 'المبلغ', type: 'money' }
              ]}
              rows={payments.data?.rows ?? []}
              disabled={!payments.data?.rows.length}
            />
            {can(PERMISSIONS.PAYMENTS_CREATE) && (
              <>
                <button type="button" className="btn-secondary" onClick={() => { setFormDirection('out'); setFormOpen(true) }}>
                  <ArrowUpRight className="h-4 w-4" />
                  سند صرف
                </button>
                <button type="button" className="btn-primary" onClick={() => { setFormDirection('in'); setFormOpen(true) }}>
                  <ArrowDownLeft className="h-4 w-4" />
                  سند قبض
                </button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="إجمالي المقبوضات" value={money(summary.totalIn)} tone="positive" icon={<ArrowDownLeft className="h-5 w-5" />} />
        <StatCard label="إجمالي المدفوعات" value={money(summary.totalOut)} tone="negative" icon={<ArrowUpRight className="h-5 w-5" />} />
        <StatCard label="صافي الحركة" value={money(summary.totalIn - summary.totalOut)} tone={summary.totalIn - summary.totalOut >= 0 ? 'positive' : 'negative'} />
      </div>

      <Card noPadding>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <DateRangePicker value={range} onChange={(value) => { setRange(value); setPage(1) }} />
          <SearchInput className="w-full max-w-xs" value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="رقم السند أو الطرف أو المرجع…" />
          <Select className="h-10 w-36" value={direction} onChange={(e) => { setDirection(e.target.value); setPage(1) }}>
            <option value="">كل السندات</option>
            <option value="in">قبض</option>
            <option value="out">صرف</option>
          </Select>
          <Select className="h-10 w-32" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
            <option value="">الكل</option>
            <option value="confirmed">المؤكدة</option>
            <option value="void">الملغاة</option>
          </Select>
        </div>

        <DataTable
          rows={payments.data?.rows ?? []}
          loading={payments.loading}
          error={payments.error}
          onRetry={payments.reload}
          rowKey={(row) => String(row.id)}
          onRowClick={(row) => setDetailId(Number(row.id))}
          empty={<EmptyState title="لا توجد سندات في هذه الفترة" />}
          columns={[
            { key: 'number', header: 'رقم السند', render: (row) => <span className="num font-semibold text-brand-700">{String(row.payment_number)}</span> },
            { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
            {
              key: 'type',
              header: 'النوع',
              align: 'center',
              render: (row) => (row.direction === 'in' ? <Badge tone="green">قبض</Badge> : <Badge tone="red">صرف</Badge>)
            },
            { key: 'party', header: 'الطرف', render: (row) => <span className="font-semibold text-slate-800">{String(row.party_name ?? '—')}</span> },
            { key: 'method', header: 'طريقة الدفع', render: (row) => String(row.method_name) },
            { key: 'account', header: 'الحساب', render: (row) => <span className="text-[12.5px] text-slate-600">{String(row.account_name)}</span> },
            {
              key: 'amount',
              header: 'المبلغ',
              align: 'left',
              render: (row) => (
                <span className={cn('num font-bold', row.status === 'void' ? 'text-slate-400 line-through' : row.direction === 'in' ? 'text-emerald-700' : 'text-rose-700')}>
                  {money(Number(row.amount))}
                </span>
              )
            },
            {
              key: 'allocated',
              header: 'الموزَّع على فواتير',
              align: 'left',
              render: (row) => (Number(row.allocated) > 0 ? <span className="num text-slate-600">{money(Number(row.allocated))}</span> : <span className="text-slate-300">على الحساب</span>)
            },
            { key: 'status', header: '', align: 'center', render: (row) => (row.status === 'void' ? <Badge tone="slate">ملغى</Badge> : null) }
          ]}
        />
        <div className="px-3">
          <Pagination page={page} pageSize={pageSize} total={payments.data?.total ?? 0} onChange={setPage} />
        </div>
      </Card>

      <PaymentFormModal open={formOpen} onClose={() => setFormOpen(false)} direction={formDirection} onSaved={() => payments.reload()} />

      <PaymentDetailModal
        id={detailId}
        onClose={() => {
          setDetailId(null)
          if (id) navigate('/payments')
        }}
        onChanged={() => payments.reload()}
      />
    </div>
  )
}

function PaymentDetailModal({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }): React.JSX.Element {
  const ui = useUi()
  const { can } = useSession()
  const { confirm, dialog } = useConfirm()
  const { data, loading, reload } = useQuery<Record<string, unknown>>(id ? 'payments:get' : null, { id }, [id])

  const voidPayment = async (): Promise<void> => {
    const reason = await confirm({
      title: 'إلغاء السند',
      message: 'سيُعكس القيد المحاسبي وتُعاد الفواتير المرتبطة إلى حالتها السابقة. يبقى السند في السجل بحالة «ملغى».',
      confirmLabel: 'إلغاء السند',
      requireReason: true
    })
    if (reason === null) return
    try {
      await invoke('payments:void', { id, reason })
      ui.success('تم إلغاء السند')
      reload()
      onChanged()
    } catch (error) {
      ui.error('تعذّر إلغاء السند', errorMessage(error))
    }
  }

  const allocations = (data?.allocations ?? []) as Record<string, unknown>[]

  return (
    <>
      <Modal
        open={Boolean(id)}
        onClose={onClose}
        size="md"
        title={data ? `${data.direction === 'in' ? 'سند قبض' : 'سند صرف'} ${data.payment_number}` : 'السند'}
        footer={
          data ? (
            <>
              {data.status !== 'void' && can(PERMISSIONS.PAYMENTS_VOID) && (
                <button type="button" className="btn-ghost mr-0 text-rose-600 hover:bg-rose-50" onClick={() => void voidPayment()}>
                  <Ban className="h-4 w-4" />
                  إلغاء السند
                </button>
              )}
              <DocumentActions docType="payment" id={Number(data.id)} fileName={`سند ${data.payment_number}`} compact />
              <button type="button" className="btn-secondary" onClick={onClose}>إغلاق</button>
            </>
          ) : undefined
        }
      >
        {loading || !data ? (
          <div className="flex justify-center py-10"><Spinner className="h-7 w-7" /></div>
        ) : (
          <>
            {data.status === 'void' && (
              <div className="mb-4 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-[13px] text-slate-700">
                <strong>هذا السند ملغى.</strong> السبب: {String(data.void_reason ?? '—')}
              </div>
            )}

            <div className="mb-4 rounded-xl bg-brand-50 px-4 py-5 text-center">
              <p className="text-[13px] font-semibold text-brand-900">المبلغ</p>
              <p className={cn('num mt-1 text-3xl font-bold', data.direction === 'in' ? 'text-emerald-700' : 'text-rose-700')}>{money(Number(data.amount))}</p>
            </div>

            <dl className="space-y-2 text-[13.5px]">
              <Row label="الطرف" value={String(data.party_name ?? '—')} />
              <Row label="التاريخ" value={date(String(data.date))} />
              <Row label="طريقة الدفع" value={String(data.method_name)} />
              <Row label="الحساب المتأثر" value={String(data.account_name)} />
              {data.reference ? <Row label="المرجع" value={String(data.reference)} /> : null}
              {data.notes ? <Row label="ملاحظات" value={String(data.notes)} /> : null}
              <Row label="سجّله" value={String(data.created_by_name ?? '—')} />
              <Row label="وقت التسجيل" value={dateTime(String(data.created_at))} />
            </dl>

            {allocations.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-[13px] font-bold text-slate-700">توزيع المبلغ على الفواتير</h3>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>الفاتورة</th>
                      <th>التاريخ</th>
                      <th className="text-left">المبلغ المخصَّص</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.map((alloc) => (
                      <tr key={String(alloc.id)}>
                        <td><span className="num font-semibold text-brand-700">{String(alloc.doc_number)}</span></td>
                        <td><span className="num">{date(String(alloc.doc_date))}</span></td>
                        <td className="text-left"><span className="num font-semibold">{money(Number(alloc.amount))}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Modal>
      {dialog}
    </>
  )
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="num text-left font-semibold text-slate-800">{value}</dd>
    </div>
  )
}
