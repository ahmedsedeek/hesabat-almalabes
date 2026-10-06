import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Ban, CreditCard, RotateCcw } from 'lucide-react'
import { PERMISSIONS } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Field, Input, Modal, QtyInput, Spinner, StatCard, cn, useConfirm } from '../../components/ui'
import { DocumentActions, PageHeader } from '../../components/common/page'
import { date, money, rate, today } from '../../lib/format'
import { PaymentFormModal } from '../payments/PaymentForm'
import { AttachmentsPanel } from '../../components/common/attachments'

export function PurchaseDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const purchaseId = Number(id)
  const navigate = useNavigate()
  const ui = useUi()
  const { can, settings } = useSession()
  const { confirm, dialog } = useConfirm()
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)

  const { data, loading, error, reload } = useQuery<Record<string, unknown>>('purchases:get', { id: purchaseId }, [purchaseId])

  if (loading && !data) return <div className="flex h-96 items-center justify-center"><Spinner className="h-8 w-8" /></div>
  if (error || !data) return <Card><EmptyState title="تعذّر تحميل الفاتورة" description={error ?? undefined} /></Card>

  const items = (data.items ?? []) as Record<string, unknown>[]
  const payments = (data.payments ?? []) as Record<string, unknown>[]
  const total = Number(data.total)
  const paid = Number(data.paid_amount)
  const returned = Number(data.returned_amount)
  const due = total - paid - returned
  const isVoid = data.status === 'void'

  const voidPurchase = async (): Promise<void> => {
    const reason = await confirm({
      title: 'إلغاء فاتورة الشراء',
      message: 'ستُخرَج الكميات من المخزون ويُعكس القيد المحاسبي. لن تنجح العملية إذا كانت الكميات قد بيعت بالفعل.',
      confirmLabel: 'إلغاء الفاتورة',
      requireReason: true
    })
    if (reason === null) return
    try {
      await invoke('purchases:void', { id: purchaseId, reason })
      ui.success('تم إلغاء الفاتورة')
      reload()
    } catch (err) {
      ui.error('تعذّر إلغاء الفاتورة', errorMessage(err))
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumb={
          <button type="button" onClick={() => navigate('/purchases')} className="inline-flex items-center gap-1 text-slate-500 hover:text-brand-600">
            <ArrowRight className="h-3.5 w-3.5" />
            المشتريات
          </button>
        }
        title={<span className="num">{String(data.invoice_number)}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span>{String(data.supplier_name)}</span>
            <span className="text-slate-400">·</span>
            <span className="num">{date(String(data.date))}</span>
            <span className="text-slate-400">·</span>
            <span>{String(data.warehouse_name)}</span>
            {data.purchase_type === 'materials' ? <Badge tone="violet">خامات</Badge> : <Badge tone="blue">بضاعة جاهزة</Badge>}
            {isVoid && <Badge tone="slate">ملغاة</Badge>}
          </span>
        }
        actions={
          <>
            <DocumentActions docType="purchase" id={purchaseId} fileName={`شراء ${data.invoice_number}`} />
            {!isVoid && due > 0 && can(PERMISSIONS.PAYMENTS_CREATE) && (
              <button type="button" className="btn-primary" onClick={() => setPaymentOpen(true)}>
                <CreditCard className="h-4 w-4" />
                دفع للمورد
              </button>
            )}
            {!isVoid && can(PERMISSIONS.PURCHASES_CREATE) && (
              <button type="button" className="btn-secondary" onClick={() => setReturnOpen(true)}>
                <RotateCcw className="h-4 w-4" />
                تسجيل مردود
              </button>
            )}
            {!isVoid && can(PERMISSIONS.PURCHASES_VOID) && (
              <button type="button" className="btn-ghost text-rose-600 hover:bg-rose-50" onClick={() => void voidPurchase()}>
                <Ban className="h-4 w-4" />
                إلغاء
              </button>
            )}
          </>
        }
      />

      {isVoid && (
        <div className="mb-4 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-[13px] text-slate-700">
          <strong>هذه الفاتورة ملغاة.</strong> السبب: {String(data.void_reason ?? '—')}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="إجمالي الفاتورة" value={money(total)} tone="brand" />
        <StatCard label="المدفوع" value={money(paid)} tone="positive" />
        <StatCard label="المرتجع" value={money(returned)} tone={returned > 0 ? 'warning' : 'default'} />
        <StatCard label="المتبقي للمورد" value={money(due)} tone={due > 0 ? 'negative' : 'positive'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr,22rem]">
        <div className="space-y-4">
          <Card title="الأصناف" noPadding>
            <DataTable
              rows={items}
              rowKey={(row) => String(row.id)}
              columns={[
                { key: 'index', header: '#', width: '40px', align: 'center', render: (_, index) => <span className="text-slate-400">{index + 1}</span> },
                {
                  key: 'product',
                  header: 'الصنف',
                  render: (row) => (
                    <div>
                      <p className="font-semibold text-slate-800">
                        {String(row.product_name)}
                        {row.size || row.color ? <span className="mr-1 text-[12px] text-slate-500">({[row.size, row.color].filter(Boolean).join(' / ')})</span> : null}
                      </p>
                      <p className="num text-[12px] text-slate-500">{String(row.sku)}</p>
                    </div>
                  )
                },
                { key: 'qty', header: 'الكمية', align: 'center', render: (row) => <span className="num">{String(row.quantity)} {String(row.unit)}</span> },
                { key: 'price', header: 'سعر الوحدة', align: 'left', render: (row) => <span className="num">{rate(Number(row.unit_price))}</span> },
                { key: 'landed', header: 'نصيب التكاليف', align: 'left', render: (row) => (Number(row.landed_cost) ? <span className="num text-slate-500">{money(Number(row.landed_cost), false)}</span> : <span className="text-slate-300">—</span>) },
                { key: 'unitCost', header: 'التكلفة النهائية', align: 'left', render: (row) => <span className="num font-bold text-brand-700">{rate(Number(row.unit_cost))}</span> },
                { key: 'total', header: 'الإجمالي', align: 'left', render: (row) => <span className="num font-bold">{money(Number(row.line_total) + Number(row.tax_amount), false)}</span> },
                { key: 'returned', header: 'مرتجع', align: 'center', render: (row) => (Number(row.returned_qty) > 0 ? <Badge tone="amber">{String(row.returned_qty)}</Badge> : <span className="text-slate-300">—</span>) }
              ]}
            />
          </Card>

          {payments.length > 0 && (
            <Card title="المدفوعات" noPadding>
              <DataTable
                rows={payments}
                rowKey={(row) => String(row.id)}
                onRowClick={(row) => navigate(`/payments/${row.id}`)}
                columns={[
                  { key: 'number', header: 'رقم السند', render: (row) => <span className="num font-semibold text-brand-700">{String(row.payment_number)}</span> },
                  { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
                  { key: 'method', header: 'طريقة الدفع', render: (row) => String(row.method_name) },
                  { key: 'amount', header: 'المبلغ', align: 'left', render: (row) => <span className="num font-semibold text-rose-700">{money(Number(row.allocated))}</span> }
                ]}
              />
            </Card>
          )}

          <AttachmentsPanel refType="purchase" refId={purchaseId} title="مرفقات الفاتورة" />
        </div>

        <div className="space-y-4">
          <Card title="ملخص مالي">
            <dl className="space-y-2 text-[13.5px]">
              <Row label="الإجمالي قبل الخصم" value={money(Number(data.subtotal))} />
              {Number(data.discount_amount) > 0 && <Row label="الخصم" value={`- ${money(Number(data.discount_amount))}`} />}
              {Number(data.tax_amount) > 0 && <Row label={settings?.tax.label ?? 'الضريبة'} value={money(Number(data.tax_amount))} />}
              {Number(data.shipping_amount) > 0 && <Row label="الشحن" value={money(Number(data.shipping_amount))} />}
              {Number(data.other_cost_amount) > 0 && <Row label="تكاليف أخرى" value={money(Number(data.other_cost_amount))} />}
              <div className="border-t border-slate-200 pt-2">
                <Row label="الإجمالي" value={money(total)} strong />
              </div>
              <Row label="المدفوع" value={money(paid)} tone="positive" />
              <Row label="المتبقي" value={money(due)} tone={due > 0 ? 'negative' : 'positive'} strong />
            </dl>
          </Card>

          <Card title="تفاصيل">
            <dl className="space-y-2 text-[13px]">
              <Row label="المورد" value={String(data.supplier_name)} />
              <Row label="رقم فاتورة المورد" value={String(data.supplier_invoice_number ?? '—')} />
              <Row label="التاريخ" value={date(String(data.date))} />
              {data.due_date ? <Row label="تاريخ الاستحقاق" value={date(String(data.due_date))} /> : null}
              <Row label="المخزن" value={String(data.warehouse_name)} />
              <Row label="أنشأها" value={String(data.created_by_name ?? '—')} />
              {data.notes ? <Row label="ملاحظات" value={String(data.notes)} /> : null}
            </dl>
          </Card>
        </div>
      </div>

      <PaymentFormModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        direction="out"
        partyId={Number(data.supplier_id)}
        partyType="supplier"
        docId={purchaseId}
        docType="purchase"
        suggestedAmount={due}
        onSaved={reload}
      />

      <PurchaseReturnModal open={returnOpen} onClose={() => setReturnOpen(false)} purchaseId={purchaseId} supplierId={Number(data.supplier_id)} onSaved={reload} />

      {dialog}
    </div>
  )
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'positive' | 'negative' | 'warning' }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className={cn('shrink-0 text-slate-500', strong && 'font-bold text-slate-700')}>{label}</dt>
      <dd className={cn('num text-left font-semibold text-slate-800', strong && 'text-[16px] font-bold', tone === 'positive' && 'text-emerald-700', tone === 'negative' && 'text-rose-700', tone === 'warning' && 'text-amber-700')}>
        {value}
      </dd>
    </div>
  )
}

function PurchaseReturnModal({
  open,
  onClose,
  purchaseId,
  supplierId,
  onSaved
}: {
  open: boolean
  onClose: () => void
  purchaseId: number
  supplierId: number
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [returnDate, setReturnDate] = useState(today())
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQuantities({})
    setReason('')
    setError(null)
    invoke<Record<string, unknown>[]>('purchases:returnableItems', { purchaseId }).then(setItems).catch(() => setItems([]))
  }, [open, purchaseId])

  const selected = items.filter((item) => (quantities[Number(item.purchaseItemId)] ?? 0) > 0)

  const save = async (): Promise<void> => {
    if (!selected.length) return setError('حدّد كمية صنف واحد على الأقل.')
    setSaving(true)
    setError(null)
    try {
      await invoke('purchases:createReturn', {
        date: returnDate,
        purchaseId,
        supplierId,
        reason: reason || null,
        items: selected.map((item) => ({
          purchaseItemId: Number(item.purchaseItemId),
          variantId: Number(item.variantId),
          quantity: quantities[Number(item.purchaseItemId)],
          unitPrice: Number(item.unitPrice),
          taxRate: Number(item.taxRate ?? 0)
        }))
      })
      ui.success('تم تسجيل مردود المشتريات')
      onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="مردود مشتريات"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving || !selected.length}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            حفظ المردود
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>}
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label="تاريخ المردود" required><Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></Field>
        <Field label="السبب"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>الصنف</th>
            <th className="text-center">المشترى</th>
            <th className="text-center">المتاح</th>
            <th style={{ width: '120px' }}>كمية الإرجاع</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={String(item.purchaseItemId)}>
              <td>
                <p className="font-semibold text-slate-800">{String(item.productName)}</p>
                <p className="num text-[12px] text-slate-500">{String(item.sku)}</p>
              </td>
              <td className="text-center"><span className="num">{String(item.quantity)}</span></td>
              <td className="text-center"><span className="num font-semibold text-emerald-700">{String(item.remainingQty)}</span></td>
              <td>
                <QtyInput
                  value={quantities[Number(item.purchaseItemId)] ?? 0}
                  max={Number(item.remainingQty)}
                  onChange={(value) => setQuantities({ ...quantities, [Number(item.purchaseItemId)]: Math.min(value, Number(item.remainingQty)) })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
