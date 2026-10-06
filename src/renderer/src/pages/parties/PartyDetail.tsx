import React, { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Ban, CreditCard, Mail, MapPin, Pencil, Phone, Plus, ShoppingCart } from 'lucide-react'
import type { PartyType, PartyWithBalance, Statement } from '@shared/types'
import { PERMISSIONS } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Spinner, StatCard, Tabs, cn, useConfirm } from '../../components/ui'
import { DateRangePicker, DocumentActions, ExportButtons, PageHeader } from '../../components/common/page'
import { date, money, monthStart, today, yearStart } from '../../lib/format'
import { PartyFormModal, PARTY_META } from './PartyForm'
import { PaymentFormModal } from '../payments/PaymentForm'

const ROUTE: Record<PartyType, string> = { customer: 'customers', supplier: 'suppliers', factory: 'factories' }

export function PartyDetailPage({ partyType }: { partyType: PartyType }): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const partyId = Number(id)
  const meta = PARTY_META[partyType]
  const navigate = useNavigate()
  const ui = useUi()
  const { can } = useSession()
  const { confirm, dialog } = useConfirm()

  const [tab, setTab] = useState('statement')
  const [range, setRange] = useState({ from: yearStart(), to: today() })
  const [editOpen, setEditOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)

  const party = useQuery<PartyWithBalance>('parties:get', { id: partyId }, [partyId])
  const statement = useQuery<Statement>('parties:statement', { partyId, from: range.from, to: range.to }, [partyId, range.from, range.to])
  const documents = useQuery<{ rows: Record<string, unknown>[] }>(
    tab === 'documents' ? (partyType === 'customer' ? 'sales:list' : 'purchases:list') : null,
    partyType === 'customer' ? { customerId: partyId, pageSize: 200 } : { supplierId: partyId, pageSize: 200 },
    [tab, partyId]
  )
  const payments = useQuery<{ rows: Record<string, unknown>[] }>(
    tab === 'payments' ? 'payments:list' : null,
    { partyId, pageSize: 200 },
    [tab, partyId]
  )
  const orders = useQuery<{ rows: Record<string, unknown>[] }>(
    tab === 'production' && partyType === 'factory' ? 'production:list' : null,
    { factoryId: partyId, pageSize: 200 },
    [tab, partyId]
  )

  if (party.loading && !party.data) {
    return <div className="flex h-96 items-center justify-center"><Spinner className="h-8 w-8" /></div>
  }
  if (party.error || !party.data) {
    return <Card><EmptyState title="تعذّر تحميل البيانات" description={party.error ?? undefined} /></Card>
  }

  const p = party.data
  const balancePositive = p.balance > 0
  const overCredit = partyType === 'customer' && p.creditLimit > 0 && p.balance > p.creditLimit

  const deactivate = async (): Promise<void> => {
    const reason = await confirm({
      title: `تعطيل ${meta.singular}`,
      message: `سيتم تعطيل «${p.name}» فلا يظهر في الفواتير الجديدة. تبقى كل معاملاته وسجلاته كما هي.`,
      confirmLabel: 'تعطيل',
      requireReason: true
    })
    if (reason === null) return
    try {
      await invoke('parties:deactivate', { id: partyId, reason })
      ui.success('تم التعطيل')
      party.reload()
    } catch (error) {
      ui.error('تعذّر التعطيل', errorMessage(error))
    }
  }

  const tabs = [
    { key: 'statement', label: 'كشف الحساب' },
    ...(partyType !== 'factory' ? [{ key: 'documents', label: partyType === 'customer' ? 'الفواتير' : 'فواتير الشراء' }] : []),
    { key: 'payments', label: 'المدفوعات' },
    ...(partyType === 'factory' ? [{ key: 'production', label: 'أوامر الإنتاج' }] : [])
  ]

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link to={`/${ROUTE[partyType]}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-brand-600">
            <ArrowRight className="h-3.5 w-3.5" />
            {meta.plural}
          </Link>
        }
        title={p.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-3 text-[13px]">
            <span className="num text-slate-500">{p.code}</span>
            {p.companyName && <span>{p.companyName}</span>}
            {p.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /><span className="num">{p.phone}</span></span>}
            {p.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{p.email}</span>}
            {p.address && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{p.address}</span>}
            {!p.isActive && <Badge tone="slate">غير نشط</Badge>}
          </span>
        }
        actions={
          <>
            {can(PERMISSIONS.PAYMENTS_CREATE) && (
              <button type="button" className="btn-secondary" onClick={() => setPaymentOpen(true)}>
                <CreditCard className="h-4 w-4" />
                {partyType === 'customer' ? 'تسجيل تحصيل' : 'تسجيل دفعة'}
              </button>
            )}
            {partyType === 'customer' && can(PERMISSIONS.SALES_CREATE) && (
              <button type="button" className="btn-primary" onClick={() => navigate(`/sales/new?customerId=${partyId}`)}>
                <ShoppingCart className="h-4 w-4" />
                فاتورة بيع
              </button>
            )}
            {partyType === 'supplier' && can(PERMISSIONS.PURCHASES_CREATE) && (
              <button type="button" className="btn-primary" onClick={() => navigate(`/purchases/new?supplierId=${partyId}`)}>
                <Plus className="h-4 w-4" />
                فاتورة شراء
              </button>
            )}
            {can(PERMISSIONS.PARTIES_EDIT) && (
              <button type="button" className="btn-secondary" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                تعديل
              </button>
            )}
            {can(PERMISSIONS.PARTIES_DELETE) && p.isActive && (
              <button type="button" className="btn-ghost" onClick={() => void deactivate()}>
                <Ban className="h-4 w-4" />
                تعطيل
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={partyType === 'customer' ? 'الرصيد المستحق علينا تحصيله' : `الرصيد المستحق لل${meta.singular}`}
          value={money(Math.abs(p.balance))}
          tone={p.balance === 0 ? 'default' : balancePositive ? (partyType === 'customer' ? 'warning' : 'negative') : 'positive'}
          hint={p.balance < 0 ? 'رصيد دائن لصالح الطرف الآخر' : undefined}
        />
        <StatCard label={partyType === 'customer' ? 'إجمالي المبيعات' : 'إجمالي المشتريات'} value={money(p.totalInvoiced)} />
        <StatCard label="إجمالي المدفوعات" value={money(p.totalPaid)} tone="positive" />
        <StatCard
          label="الرصيد الافتتاحي"
          value={money(p.openingBalance)}
          hint={p.openingDate ? `بتاريخ ${date(p.openingDate)}` : undefined}
        />
      </div>

      {overCredit && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-800">
          تجاوز رصيد العميل حد الائتمان المحدد ({money(p.creditLimit)}). راجع المستحقات قبل البيع الآجل.
        </div>
      )}

      <Card noPadding>
        <div className="px-3 pt-1">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>

        {tab === 'statement' && (
          <div className="p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <DateRangePicker value={range} onChange={setRange} />
              <div className="flex items-center gap-2">
                <DocumentActions
                  docType="statement"
                  params={{ partyId, from: range.from, to: range.to }}
                  fileName={`كشف حساب - ${p.name}`}
                  compact
                />
                <ExportButtons
                  title={`كشف حساب ${p.name}`}
                  subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
                  meta={[
                    { label: 'الرصيد الافتتاحي', value: money(statement.data?.openingBalance ?? 0) },
                    { label: 'الرصيد الختامي', value: money(statement.data?.closingBalance ?? 0) }
                  ]}
                  columns={[
                    { key: 'date', label: 'التاريخ', type: 'date' },
                    { key: 'refNumber', label: 'رقم المستند' },
                    { key: 'description', label: 'البيان' },
                    { key: 'debit', label: 'مدين', type: 'money' },
                    { key: 'credit', label: 'دائن', type: 'money' },
                    { key: 'balance', label: 'الرصيد', type: 'money' }
                  ]}
                  rows={(statement.data?.lines ?? []) as unknown as Record<string, unknown>[]}
                  totals={{
                    debit: statement.data?.totalDebit ?? 0,
                    credit: statement.data?.totalCredit ?? 0,
                    balance: statement.data?.closingBalance ?? 0
                  }}
                  disabled={!statement.data?.lines.length}
                />
              </div>
            </div>

            {statement.data && (
              <div className="mb-3 grid gap-3 sm:grid-cols-4">
                <StatCard label="رصيد افتتاحي" value={money(statement.data.openingBalance)} />
                <StatCard label="إجمالي المدين" value={money(statement.data.totalDebit)} />
                <StatCard label="إجمالي الدائن" value={money(statement.data.totalCredit)} />
                <StatCard label="الرصيد الختامي" value={money(statement.data.closingBalance)} tone={statement.data.closingBalance > 0 ? 'warning' : 'positive'} />
              </div>
            )}

            <DataTable
              rows={statement.data?.lines ?? []}
              loading={statement.loading}
              error={statement.error}
              onRetry={statement.reload}
              rowKey={(_, index) => index}
              empty={<EmptyState title="لا توجد حركات في هذه الفترة" />}
              columns={[
                { key: 'date', header: 'التاريخ', width: '110px', render: (line) => <span className="num">{date(line.date)}</span> },
                { key: 'ref', header: 'رقم المستند', width: '150px', render: (line) => <span className="num text-[13px] font-semibold text-brand-700">{line.refNumber}</span> },
                { key: 'description', header: 'البيان', render: (line) => <span className="text-[13px]">{line.description}</span> },
                { key: 'debit', header: 'مدين', align: 'left', render: (line) => (line.debit ? <span className="num">{money(line.debit, false)}</span> : <span className="text-slate-300">—</span>) },
                { key: 'credit', header: 'دائن', align: 'left', render: (line) => (line.credit ? <span className="num">{money(line.credit, false)}</span> : <span className="text-slate-300">—</span>) },
                { key: 'balance', header: 'الرصيد', align: 'left', render: (line) => <span className="num font-bold">{money(line.balance, false)}</span> }
              ]}
            />
          </div>
        )}

        {tab === 'documents' && (
          <DataTable
            rows={documents.data?.rows ?? []}
            loading={documents.loading}
            error={documents.error}
            rowKey={(row) => String(row.id)}
            onRowClick={(row) => navigate(`/${partyType === 'customer' ? 'sales' : 'purchases'}/${row.id}`)}
            empty={<EmptyState title="لا توجد فواتير" />}
            columns={[
              { key: 'number', header: 'رقم الفاتورة', render: (row) => <span className="num font-semibold text-brand-700">{String(row.invoice_number)}</span> },
              { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
              { key: 'total', header: 'الإجمالي', align: 'left', render: (row) => <span className="num">{money(Number(row.total))}</span> },
              { key: 'paid', header: 'المدفوع', align: 'left', render: (row) => <span className="num text-emerald-700">{money(Number(row.paid_amount))}</span> },
              { key: 'due', header: 'المتبقي', align: 'left', render: (row) => <span className={cn('num font-semibold', Number(row.due_amount) > 0 ? 'text-rose-700' : 'text-slate-400')}>{money(Number(row.due_amount))}</span> },
              { key: 'status', header: 'الحالة', align: 'center', render: (row) => (row.status === 'void' ? <Badge tone="slate">ملغاة</Badge> : Number(row.due_amount) <= 0 ? <Badge tone="green">مسددة</Badge> : <Badge tone="amber">مستحقة</Badge>) }
            ]}
          />
        )}

        {tab === 'payments' && (
          <DataTable
            rows={payments.data?.rows ?? []}
            loading={payments.loading}
            error={payments.error}
            rowKey={(row) => String(row.id)}
            onRowClick={(row) => navigate(`/payments/${row.id}`)}
            empty={<EmptyState title="لا توجد سندات" />}
            columns={[
              { key: 'number', header: 'رقم السند', render: (row) => <span className="num font-semibold text-brand-700">{String(row.payment_number)}</span> },
              { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
              { key: 'method', header: 'طريقة الدفع', render: (row) => String(row.method_name) },
              { key: 'amount', header: 'المبلغ', align: 'left', render: (row) => <span className={cn('num font-semibold', row.direction === 'in' ? 'text-emerald-700' : 'text-rose-700')}>{money(Number(row.amount))}</span> },
              { key: 'status', header: 'الحالة', align: 'center', render: (row) => (row.status === 'void' ? <Badge tone="slate">ملغى</Badge> : <Badge tone="green">مؤكد</Badge>) }
            ]}
          />
        )}

        {tab === 'production' && (
          <DataTable
            rows={orders.data?.rows ?? []}
            loading={orders.loading}
            error={orders.error}
            rowKey={(row) => String(row.id)}
            onRowClick={(row) => navigate(`/production/${row.id}`)}
            empty={<EmptyState title="لا توجد أوامر إنتاج" />}
            columns={[
              { key: 'number', header: 'رقم الأمر', render: (row) => <span className="num font-semibold text-brand-700">{String(row.order_number)}</span> },
              { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
              { key: 'product', header: 'المنتج', render: (row) => String(row.product_name) },
              { key: 'qty', header: 'الكمية', align: 'left', render: (row) => <span className="num">{String(row.produced_qty)} / {String(row.expected_qty)}</span> },
              { key: 'cost', header: 'التكلفة', align: 'left', render: (row) => <span className="num">{money(Number(row.total_cost))}</span> },
              { key: 'status', header: 'الحالة', align: 'center', render: (row) => <Badge tone={row.status === 'completed' ? 'green' : row.status === 'cancelled' ? 'slate' : 'blue'}>{String(row.status_label)}</Badge> }
            ]}
          />
        )}
      </Card>

      <PartyFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        partyType={partyType}
        partyId={partyId}
        onSaved={() => {
          party.reload()
          statement.reload()
        }}
      />

      <PaymentFormModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        direction={partyType === 'customer' ? 'in' : 'out'}
        partyId={partyId}
        partyType={partyType}
        onSaved={() => {
          party.reload()
          statement.reload()
          payments.reload()
        }}
      />

      {dialog}
    </div>
  )
}

export { monthStart }
