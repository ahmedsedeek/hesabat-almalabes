import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Ban, CreditCard, Paperclip, RotateCcw } from 'lucide-react'
import { PERMISSIONS } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Spinner, StatCard, cn, useConfirm } from '../../components/ui'
import { DocumentActions, PageHeader } from '../../components/common/page'
import { date, money, rate } from '../../lib/format'
import { PaymentFormModal } from '../payments/PaymentForm'
import { SaleReturnModal } from './SaleReturn'
import { AttachmentsPanel } from '../../components/common/attachments'

export function SaleDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const saleId = Number(id)
  const navigate = useNavigate()
  const ui = useUi()
  const { can, settings } = useSession()
  const { confirm, dialog } = useConfirm()
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)

  const { data, loading, error, reload } = useQuery<Record<string, unknown>>('sales:get', { id: saleId }, [saleId])

  if (loading && !data) return <div className="flex h-96 items-center justify-center"><Spinner className="h-8 w-8" /></div>
  if (error || !data) return <Card><EmptyState title="تعذّر تحميل الفاتورة" description={error ?? undefined} /></Card>

  const items = (data.items ?? []) as Record<string, unknown>[]
  const payments = (data.payments ?? []) as Record<string, unknown>[]
  const returns = (data.returns ?? []) as Record<string, unknown>[]
  const total = Number(data.total)
  const paid = Number(data.paid_amount)
  const returned = Number(data.returned_amount)
  const due = total - paid - returned
  const cogs = Number(data.cogs_amount)
  const deliveryCost = Number(data.delivery_cost ?? 0)
  const isVoid = data.status === 'void'
  // ربح الطلب الحقيقي يطرح تكلفة التوصيل التي تحمّلتها الشركة
  const orderProfit = total - cogs - deliveryCost

  const CHANNEL: Record<string, { label: string; tone: 'blue' | 'violet' | 'green' }> = {
    wholesale: { label: 'جملة', tone: 'blue' },
    retail: { label: 'تجزئة', tone: 'green' },
    online: { label: 'أونلاين', tone: 'violet' }
  }
  const channel = CHANNEL[String(data.sale_channel ?? 'wholesale')] ?? CHANNEL.wholesale

  const voidSale = async (): Promise<void> => {
    const reason = await confirm({
      title: 'إلغاء الفاتورة',
      message: 'سيُعاد المخزون إلى المخازن ويُعكس القيد المحاسبي. تبقى الفاتورة في السجل بحالة «ملغاة» ولا تُحذف نهائيًا.',
      confirmLabel: 'إلغاء الفاتورة',
      requireReason: true
    })
    if (reason === null) return
    try {
      await invoke('sales:void', { id: saleId, reason })
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
          <button type="button" onClick={() => navigate('/sales')} className="inline-flex items-center gap-1 text-slate-500 hover:text-brand-600">
            <ArrowRight className="h-3.5 w-3.5" />
            المبيعات
          </button>
        }
        title={<span className="num">{String(data.invoice_number)}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span>{String(data.customer_name)}</span>
            <span className="num text-slate-400">·</span>
            <span className="num">{date(String(data.date))}</span>
            <span className="num text-slate-400">·</span>
            <span>{String(data.warehouse_name)}</span>
            <Badge tone={channel.tone}>{channel.label}</Badge>
            {isVoid && <Badge tone="slate">ملغاة</Badge>}
          </span>
        }
        actions={
          <>
            <DocumentActions docType="sale" id={saleId} fileName={`فاتورة ${data.invoice_number}`} />
            {!isVoid && due > 0 && can(PERMISSIONS.PAYMENTS_CREATE) && (
              <button type="button" className="btn-primary" onClick={() => setPaymentOpen(true)}>
                <CreditCard className="h-4 w-4" />
                تحصيل دفعة
              </button>
            )}
            {!isVoid && can(PERMISSIONS.SALES_CREATE) && (
              <button type="button" className="btn-secondary" onClick={() => setReturnOpen(true)}>
                <RotateCcw className="h-4 w-4" />
                تسجيل مردود
              </button>
            )}
            {!isVoid && can(PERMISSIONS.SALES_VOID) && (
              <button type="button" className="btn-ghost text-rose-600 hover:bg-rose-50" onClick={() => void voidSale()}>
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

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="إجمالي الفاتورة" value={money(total)} tone="brand" />
        <StatCard label="المحصَّل" value={money(paid)} tone="positive" />
        <StatCard label="المرتجع" value={money(returned)} tone={returned > 0 ? 'warning' : 'default'} />
        <StatCard label="المتبقي" value={money(due)} tone={due > 0 ? 'negative' : 'positive'} />
        <StatCard
          label="صافي ربح الطلب"
          value={money(orderProfit)}
          tone={orderProfit >= 0 ? 'positive' : 'negative'}
          hint={deliveryCost > 0 ? `التكلفة ${money(cogs)} + توصيل ${money(deliveryCost)}` : `التكلفة ${money(cogs)}`}
        />
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
                { key: 'discount', header: 'الخصم', align: 'left', render: (row) => <span className="num text-slate-500">{money(Number(row.discount_amount), false)}</span> },
                ...(settings?.tax.enabled ? [{ key: 'tax', header: 'الضريبة', align: 'left' as const, render: (row: Record<string, unknown>) => <span className="num">{money(Number(row.tax_amount), false)}</span> }] : []),
                { key: 'total', header: 'الإجمالي', align: 'left', render: (row) => <span className="num font-bold">{money(Number(row.line_total) + Number(row.tax_amount), false)}</span> },
                { key: 'returned', header: 'مرتجع', align: 'center', render: (row) => (Number(row.returned_qty) > 0 ? <Badge tone="amber">{String(row.returned_qty)}</Badge> : <span className="text-slate-300">—</span>) }
              ]}
            />
          </Card>

          {payments.length > 0 && (
            <Card title="المدفوعات على هذه الفاتورة" noPadding>
              <DataTable
                rows={payments}
                rowKey={(row) => String(row.id)}
                onRowClick={(row) => navigate(`/payments/${row.id}`)}
                columns={[
                  { key: 'number', header: 'رقم السند', render: (row) => <span className="num font-semibold text-brand-700">{String(row.payment_number)}</span> },
                  { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
                  { key: 'method', header: 'طريقة الدفع', render: (row) => String(row.method_name) },
                  { key: 'amount', header: 'المبلغ المخصَّص', align: 'left', render: (row) => <span className="num font-semibold text-emerald-700">{money(Number(row.allocated))}</span> }
                ]}
              />
            </Card>
          )}

          {returns.length > 0 && (
            <Card title="المردودات" noPadding>
              <DataTable
                rows={returns}
                rowKey={(row) => String(row.id)}
                columns={[
                  { key: 'number', header: 'رقم المردود', render: (row) => <span className="num font-semibold">{String(row.return_number)}</span> },
                  { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
                  { key: 'total', header: 'القيمة', align: 'left', render: (row) => <span className="num font-semibold text-rose-700">{money(Number(row.total))}</span> }
                ]}
              />
            </Card>
          )}

          <AttachmentsPanel refType="sale" refId={saleId} title="مرفقات الفاتورة" />
        </div>

        <div className="space-y-4">
          <Card title="ملخص مالي">
            <dl className="space-y-2 text-[13.5px]">
              <Row label="الإجمالي قبل الخصم" value={money(Number(data.subtotal))} />
              {Number(data.discount_amount) > 0 && <Row label="الخصم" value={`- ${money(Number(data.discount_amount))}`} />}
              {Number(data.tax_amount) > 0 && <Row label={settings?.tax.label ?? 'الضريبة'} value={money(Number(data.tax_amount))} />}
              {Number(data.shipping_amount) > 0 && <Row label="الشحن المحصَّل" value={money(Number(data.shipping_amount))} />}
              <div className="border-t border-slate-200 pt-2">
                <Row label="الإجمالي" value={money(total)} strong />
              </div>
              <Row label="المحصَّل" value={money(paid)} tone="positive" />
              {returned > 0 && <Row label="المرتجع" value={money(returned)} tone="warning" />}
              <Row label="المتبقي" value={money(due)} tone={due > 0 ? 'negative' : 'positive'} strong />
              {deliveryCost > 0 && (
                <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
                  تكلفة توصيل <span className="num font-bold">{money(deliveryCost)}</span> تحمّلتها الشركة — مصروف خارج فاتورة العميل.
                </div>
              )}
            </dl>
          </Card>

          <Card title="تفاصيل">
            <dl className="space-y-2 text-[13px]">
              <Row label="العميل" value={String(data.customer_name)} />
              {data.customer_phone ? <Row label="الهاتف" value={String(data.customer_phone)} /> : null}
              <Row label="التاريخ" value={date(String(data.date))} />
              {data.due_date ? <Row label="تاريخ الاستحقاق" value={date(String(data.due_date))} /> : null}
              <Row label="المخزن" value={String(data.warehouse_name)} />
              <Row label="قناة البيع" value={channel.label} />
              {data.delivery_address ? <Row label="عنوان التوصيل" value={String(data.delivery_address)} /> : null}
              {data.tracking_number ? <Row label="رقم البوليصة" value={String(data.tracking_number)} /> : null}
              <Row label="أنشأها" value={String(data.created_by_name ?? '—')} />
              {data.notes ? <Row label="ملاحظات" value={String(data.notes)} /> : null}
            </dl>
          </Card>
        </div>
      </div>

      <PaymentFormModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        direction="in"
        partyId={Number(data.customer_id)}
        partyType="customer"
        docId={saleId}
        docType="sale"
        suggestedAmount={due}
        onSaved={reload}
      />

      <SaleReturnModal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        saleId={saleId}
        customerId={Number(data.customer_id)}
        shippingCharged={Number(data.shipping_amount ?? 0)}
        onSaved={reload}
      />

      {dialog}
    </div>
  )
}

function Row({
  label,
  value,
  strong,
  tone
}: {
  label: string
  value: string
  strong?: boolean
  tone?: 'positive' | 'negative' | 'warning'
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className={cn('shrink-0 text-slate-500', strong && 'font-bold text-slate-700')}>{label}</dt>
      <dd
        className={cn(
          'num text-left font-semibold text-slate-800',
          strong && 'text-[16px] font-bold',
          tone === 'positive' && 'text-emerald-700',
          tone === 'negative' && 'text-rose-700',
          tone === 'warning' && 'text-amber-700'
        )}
      >
        {value}
      </dd>
    </div>
  )
}

export { Paperclip }
