import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Ban, Coins, PackageCheck, PackagePlus, Trash2 } from 'lucide-react'
import { PERMISSIONS } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Field, Input, Modal, MoneyInput, QtyInput, Select, Spinner, StatCard, Switch, Textarea, cn, useConfirm } from '../../components/ui'
import { DocumentActions, PageHeader } from '../../components/common/page'
import { ProductSearch, variantLabel } from '../../components/common/pickers'
import { AttachmentsPanel } from '../../components/common/attachments'
import { date, money, qty, rate, today } from '../../lib/format'
import { STATUS_TONE } from './ProductionList'

export function ProductionDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const orderId = Number(id)
  const navigate = useNavigate()
  const ui = useUi()
  const { can } = useSession()
  const { confirm, dialog } = useConfirm()
  const [issueOpen, setIssueOpen] = useState(false)
  const [costOpen, setCostOpen] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)

  const { data, loading, error, reload } = useQuery<Record<string, unknown>>('production:get', { id: orderId }, [orderId])

  if (loading && !data) return <div className="flex h-96 items-center justify-center"><Spinner className="h-8 w-8" /></div>
  if (error || !data) return <Card><EmptyState title="تعذّر تحميل أمر الإنتاج" description={error ?? undefined} /></Card>

  const materials = (data.materials ?? []) as Record<string, unknown>[]
  const costs = (data.costs ?? []) as Record<string, unknown>[]
  const outputs = (data.outputs ?? []) as Record<string, unknown>[]
  const status = String(data.status)
  const closed = status === 'completed' || status === 'cancelled'
  const producedQty = Number(data.produced_qty)
  const expectedQty = Number(data.expected_qty)
  const totalCost = Number(data.total_cost)
  const wipRemaining = Number(data.wip_remaining)

  const complete = async (): Promise<void> => {
    const answer = await confirm({
      title: 'إقفال أمر الإنتاج',
      message: 'سيُقفل الأمر ويُرحَّل أي فرق متبقٍ في التكلفة إلى حساب فروقات الإنتاج. لا يمكن التراجع.',
      confirmLabel: 'إقفال الأمر',
      tone: 'primary'
    })
    if (answer === null) return
    try {
      await invoke('production:setStatus', { id: orderId, status: 'completed' })
      ui.success('تم إقفال الأمر')
      reload()
    } catch (err) {
      ui.error('تعذّر الإقفال', errorMessage(err))
    }
  }

  const cancel = async (): Promise<void> => {
    const reason = await confirm({
      title: 'إلغاء أمر الإنتاج',
      message: 'لا يمكن إلغاء أمر صُرفت له خامات أو استُلم منه إنتاج.',
      confirmLabel: 'إلغاء الأمر',
      requireReason: true
    })
    if (reason === null) return
    try {
      await invoke('production:setStatus', { id: orderId, status: 'cancelled', reason })
      ui.success('تم إلغاء الأمر')
      reload()
    } catch (err) {
      ui.error('تعذّر الإلغاء', errorMessage(err))
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumb={
          <button type="button" onClick={() => navigate('/production')} className="inline-flex items-center gap-1 text-slate-500 hover:text-brand-600">
            <ArrowRight className="h-3.5 w-3.5" />
            التصنيع
          </button>
        }
        title={<span className="num">{String(data.order_number)}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-semibold">{String(data.factory_name)}</span>
            <span className="text-slate-400">·</span>
            <span>{String(data.product_name)}{data.size || data.color ? ` (${[data.size, data.color].filter(Boolean).join(' / ')})` : ''}</span>
            <span className="text-slate-400">·</span>
            <span className="num">{date(String(data.date))}</span>
            <Badge tone={STATUS_TONE[status]}>{String(data.status_label)}</Badge>
          </span>
        }
        actions={
          <>
            <DocumentActions docType="production_order" id={orderId} fileName={`أمر إنتاج ${data.order_number}`} />
            {!closed && can(PERMISSIONS.PRODUCTION_MANAGE) && (
              <>
                <button type="button" className="btn-secondary" onClick={() => setIssueOpen(true)}>
                  <PackagePlus className="h-4 w-4" />
                  صرف خامات
                </button>
                <button type="button" className="btn-secondary" onClick={() => setCostOpen(true)}>
                  <Coins className="h-4 w-4" />
                  إضافة تكلفة
                </button>
                <button type="button" className="btn-primary" onClick={() => setReceiveOpen(true)}>
                  <PackageCheck className="h-4 w-4" />
                  استلام إنتاج
                </button>
                <button type="button" className="btn-ghost" onClick={() => void complete()}>إقفال</button>
                <button type="button" className="btn-ghost text-rose-600 hover:bg-rose-50" onClick={() => void cancel()}>
                  <Ban className="h-4 w-4" />
                </button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="تكلفة الخامات" value={money(Number(data.materials_cost))} tone="brand" />
        <StatCard label="أجر التصنيع" value={money(Number(data.factory_cost))} />
        <StatCard label="تكاليف أخرى" value={money(Number(data.other_cost))} />
        <StatCard label="إجمالي التكلفة" value={money(totalCost)} tone="warning" />
        <StatCard
          label="تكلفة الوحدة المنتجة"
          value={Number(data.unit_cost) ? rate(Number(data.unit_cost)) : '—'}
          tone="positive"
          hint={`${qty(producedQty)} من ${qty(expectedQty)}`}
        />
      </div>

      {wipRemaining !== 0 && !closed && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          تكلفة تحت التشغيل لم تُستوعب بعد في منتج نهائي: <strong className="num">{money(wipRemaining)}</strong>.
          سيُوزَّع هذا المبلغ على الكميات التي ستُستلم، وأي فرق متبقٍ عند الإقفال يُرحَّل إلى حساب فروقات الإنتاج.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr,22rem]">
        <div className="space-y-4">
          <Card title="الخامات" subtitle="المخطط مقابل المصروف فعليًا للمصنع" noPadding>
            <DataTable
              rows={materials}
              rowKey={(row) => String(row.id)}
              empty={<EmptyState title="لم تُحدَّد خامات بعد" description="اضغط «صرف خامات» لتسجيل ما أُرسل إلى المصنع." />}
              columns={[
                {
                  key: 'name',
                  header: 'الخامة',
                  render: (row) => (
                    <div>
                      <span className="font-semibold text-slate-800">{String(row.product_name)}</span>
                      {Boolean(row.size || row.color) && <span className="mr-1 text-[12px] text-slate-500">({[row.size, row.color].filter(Boolean).join(' / ')})</span>}
                      <p className="num text-[12px] text-slate-500">{String(row.sku)}</p>
                    </div>
                  )
                },
                { key: 'planned', header: 'المخطط', align: 'center', render: (row) => <span className="num">{qty(Number(row.planned_qty))} {String(row.unit)}</span> },
                { key: 'issued', header: 'المصروف', align: 'center', render: (row) => <span className={cn('num font-semibold', Number(row.issued_qty) > Number(row.planned_qty) && Number(row.planned_qty) > 0 ? 'text-amber-700' : 'text-slate-800')}>{qty(Number(row.issued_qty))}</span> },
                { key: 'available', header: 'المتاح بالمخزن', align: 'center', render: (row) => <span className="num text-slate-500">{qty(Number(row.available))}</span> },
                { key: 'cost', header: 'تكلفة المصروف', align: 'left', render: (row) => <span className="num font-semibold">{money(Number(row.issued_cost))}</span> }
              ]}
            />
          </Card>

          <Card title="تكاليف التصنيع" noPadding>
            <DataTable
              rows={costs}
              rowKey={(row) => String(row.id)}
              empty={<EmptyState title="لم تُسجَّل تكاليف بعد" description="سجّل أجر التصنيع والتكاليف الأخرى ليُحتسب سعر التكلفة بدقة." />}
              columns={[
                { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
                { key: 'type', header: 'النوع', align: 'center', render: (row) => <Badge tone={row.cost_type === 'factory' ? 'violet' : 'slate'}>{row.cost_type === 'factory' ? 'أجر تصنيع' : 'تكلفة أخرى'}</Badge> },
                { key: 'desc', header: 'البيان', render: (row) => String(row.description ?? '—') },
                { key: 'amount', header: 'المبلغ', align: 'left', render: (row) => <span className={cn('num font-semibold', row.status === 'void' && 'text-slate-400 line-through')}>{money(Number(row.amount))}</span> },
                { key: 'paid', header: 'السداد', align: 'center', render: (row) => (row.payment_account_id ? <Badge tone="green">مدفوعة</Badge> : <Badge tone="amber">على حساب المصنع</Badge>) },
                { key: 'status', header: '', align: 'center', render: (row) => (row.status === 'void' ? <Badge tone="slate">ملغاة</Badge> : null) }
              ]}
            />
          </Card>

          <Card title="الاستلامات من المصنع" noPadding>
            <DataTable
              rows={outputs}
              rowKey={(row) => String(row.id)}
              empty={<EmptyState title="لم يُستلم إنتاج بعد" />}
              columns={[
                { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
                { key: 'qty', header: 'الكمية', align: 'center', render: (row) => <span className="num font-semibold">{qty(Number(row.quantity))}</span> },
                { key: 'unitCost', header: 'تكلفة الوحدة', align: 'left', render: (row) => <span className="num font-semibold text-brand-700">{rate(Number(row.unit_cost))}</span> },
                { key: 'total', header: 'إجمالي التكلفة', align: 'left', render: (row) => <span className="num">{money(Number(row.total_cost))}</span> }
              ]}
            />
          </Card>

          <AttachmentsPanel refType="production_order" refId={orderId} title="مرفقات الأمر" />
        </div>

        <div className="space-y-4">
          <Card title="تفاصيل الأمر">
            <dl className="space-y-2 text-[13px]">
              <Row label="المصنع" value={String(data.factory_name)} />
              {data.factory_phone ? <Row label="هاتف المصنع" value={String(data.factory_phone)} /> : null}
              <Row label="المنتج" value={String(data.product_name)} />
              <Row label="الكمية المتوقعة" value={`${qty(expectedQty)} ${String(data.unit)}`} />
              <Row label="الكمية المنتجة" value={`${qty(producedQty)} ${String(data.unit)}`} />
              <Row label="تاريخ الأمر" value={date(String(data.date))} />
              <Row label="التسليم المتوقع" value={date(String(data.expected_date))} />
              {data.completion_date ? <Row label="تاريخ الإتمام" value={date(String(data.completion_date))} /> : null}
              <Row label="مخزن الاستلام" value={String(data.warehouse_name)} />
              <Row label="أنشأه" value={String(data.created_by_name ?? '—')} />
              {data.notes ? <Row label="ملاحظات" value={String(data.notes)} /> : null}
            </dl>
          </Card>

          <Card title="نسبة الإنجاز">
            <div className="mb-2 flex items-center justify-between text-[13px]">
              <span className="text-slate-600">المنتج من المتوقع</span>
              <span className="num font-bold text-slate-800">{expectedQty > 0 ? Math.round((producedQty / expectedQty) * 100) : 0}٪</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, expectedQty > 0 ? (producedQty / expectedQty) * 100 : 0)}%` }} />
            </div>
          </Card>
        </div>
      </div>

      <IssueMaterialsModal open={issueOpen} onClose={() => setIssueOpen(false)} orderId={orderId} warehouseId={Number(data.warehouse_id)} materials={materials} onSaved={reload} />
      <AddCostModal open={costOpen} onClose={() => setCostOpen(false)} orderId={orderId} onSaved={reload} />
      <ReceiveOutputModal open={receiveOpen} onClose={() => setReceiveOpen(false)} orderId={orderId} remaining={Math.max(expectedQty - producedQty, 0)} wipRemaining={wipRemaining} onSaved={reload} />

      {dialog}
    </div>
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

function IssueMaterialsModal({
  open,
  onClose,
  orderId,
  warehouseId,
  materials,
  onSaved
}: {
  open: boolean
  onClose: () => void
  orderId: number
  warehouseId: number
  materials: Record<string, unknown>[]
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const [issueDate, setIssueDate] = useState(today())
  const [items, setItems] = useState<{ variantId: number; name: string; sku: string; unit: string; available: number; quantity: number }[]>([])
  const [isReturn, setIsReturn] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setNotes('')
    setIsReturn(false)
    setIssueDate(today())
    setItems(
      materials
        .filter((m) => Number(m.planned_qty) - Number(m.issued_qty) > 0)
        .map((m) => ({
          variantId: Number(m.variant_id),
          name: `${String(m.product_name)}${m.size || m.color ? ` (${[m.size, m.color].filter(Boolean).join(' / ')})` : ''}`,
          sku: String(m.sku),
          unit: String(m.unit),
          available: Number(m.available),
          quantity: Math.max(Number(m.planned_qty) - Number(m.issued_qty), 0)
        }))
    )
  }, [open, materials])

  const save = async (): Promise<void> => {
    const active = items.filter((i) => i.quantity > 0)
    if (!active.length) return setError('حدّد كمية صنف واحد على الأقل.')
    setSaving(true)
    setError(null)
    try {
      await invoke('production:issueMaterials', {
        orderId,
        date: issueDate,
        warehouseId,
        notes: notes || null,
        items: active.map((i) => ({ variantId: i.variantId, quantity: isReturn ? -i.quantity : i.quantity }))
      })
      ui.success(isReturn ? 'تم تسجيل ارتجاع الخامات' : 'تم صرف الخامات للمصنع')
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
      title={isReturn ? 'ارتجاع خامات من المصنع' : 'صرف خامات للمصنع'}
      description="الخامات المصروفة تخرج من المخزن فورًا فلا يمكن استخدامها في عملية أخرى."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            حفظ
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>}

      <div className="mb-4 grid items-end gap-4 sm:grid-cols-2">
        <Field label="التاريخ" required>
          <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>
        <Switch checked={isReturn} onChange={setIsReturn} label="ارتجاع من المصنع" description="فعّل الخيار لإعادة خامات لم تُستخدم إلى المخزن." />
      </div>

      <ProductSearch
        productType="raw"
        warehouseId={warehouseId}
        onPick={(option) => {
          if (items.some((i) => i.variantId === option.variantId)) return
          setItems([...items, { variantId: option.variantId, name: variantLabel(option), sku: option.sku, unit: option.unit, available: option.stock, quantity: 0 }])
        }}
        placeholder="أضف خامة غير مخططة…"
      />

      {items.length > 0 && (
        <table className="tbl mt-4">
          <thead>
            <tr>
              <th>الخامة</th>
              <th className="text-center">المتاح بالمخزن</th>
              <th style={{ width: '130px' }}>الكمية</th>
              <th style={{ width: '44px' }} />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.variantId}>
                <td>
                  <p className="font-semibold text-slate-800">{item.name}</p>
                  <p className="num text-[12px] text-slate-500">{item.sku}</p>
                </td>
                <td className="text-center"><span className={cn('num', item.quantity > item.available && !isReturn && 'font-bold text-rose-600')}>{qty(item.available)} {item.unit}</span></td>
                <td><QtyInput value={item.quantity} onChange={(value) => setItems(items.map((i, idx) => (idx === index ? { ...i, quantity: value } : i)))} invalid={!isReturn && item.quantity > item.available} /></td>
                <td>
                  <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => setItems(items.filter((_, i) => i !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Field label="ملاحظات" className="mt-4">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  )
}

function AddCostModal({ open, onClose, orderId, onSaved }: { open: boolean; onClose: () => void; orderId: number; onSaved: () => void }): React.JSX.Element {
  const ui = useUi()
  const accounts = useQuery<{ accountId: number; name: string; balance: number }[]>(open ? 'accounts:cash' : null, undefined, [open])
  const [costDate, setCostDate] = useState(today())
  const [costType, setCostType] = useState<'factory' | 'other'>('factory')
  const [amount, setAmount] = useState(0)
  const [description, setDescription] = useState('')
  const [payNow, setPayNow] = useState(false)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setCostDate(today())
    setCostType('factory')
    setAmount(0)
    setDescription('')
    setPayNow(false)
    setError(null)
  }, [open])

  useEffect(() => {
    if (!accountId && accounts.data?.length) setAccountId(accounts.data[0].accountId)
  }, [accounts.data, accountId])

  const save = async (): Promise<void> => {
    if (amount <= 0) return setError('أدخل مبلغًا أكبر من صفر.')
    setSaving(true)
    setError(null)
    try {
      await invoke('production:addCost', {
        orderId,
        date: costDate,
        costType,
        amount,
        description: description || null,
        paymentAccountId: payNow ? accountId : null
      })
      ui.success('تمت إضافة التكلفة')
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
      title="إضافة تكلفة تصنيع"
      description="تُضاف التكلفة إلى تكلفة المنتج النهائي وتُسجَّل على حساب المصنع إن لم تُدفع الآن."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            حفظ
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نوع التكلفة" required>
          <Select value={costType} onChange={(e) => setCostType(e.target.value as 'factory')}>
            <option value="factory">أجر تصنيع (مستحق للمصنع)</option>
            <option value="other">تكلفة أخرى (نقل، تغليف…)</option>
          </Select>
        </Field>
        <Field label="التاريخ" required>
          <Input type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} />
        </Field>
        <Field label="المبلغ" required>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="البيان">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثال: أجر خياطة 500 قطعة" />
        </Field>
        <div className="sm:col-span-2 rounded-xl border border-slate-200 p-3">
          <Switch checked={payNow} onChange={setPayNow} label="دفع المبلغ الآن" description="اترك الخيار مغلقًا لتسجيل المبلغ كمستحق على المصنع." />
          {payNow && (
            <Field label="من حساب" className="mt-3">
              <Select value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
                {(accounts.data ?? []).map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.name} — {money(a.balance)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ReceiveOutputModal({
  open,
  onClose,
  orderId,
  remaining,
  wipRemaining,
  onSaved
}: {
  open: boolean
  onClose: () => void
  orderId: number
  remaining: number
  wipRemaining: number
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const [receiveDate, setReceiveDate] = useState(today())
  const [quantity, setQuantity] = useState(0)
  const [isFinal, setIsFinal] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setReceiveDate(today())
    setQuantity(remaining)
    setIsFinal(true)
    setError(null)
  }, [open, remaining])

  const estimatedUnitCost = quantity > 0 ? Math.round((isFinal ? wipRemaining : Math.round((wipRemaining * quantity) / Math.max(remaining, quantity))) / quantity) : 0

  const save = async (): Promise<void> => {
    if (quantity <= 0) return setError('أدخل الكمية المستلمة.')
    setSaving(true)
    setError(null)
    try {
      await invoke('production:receiveOutput', { orderId, date: receiveDate, quantity, isFinal })
      ui.success('تم استلام الإنتاج', 'أُضيفت الكميات للمخزون بتكلفتها الفعلية.')
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
      title="استلام إنتاج من المصنع"
      description="تُضاف الكميات للمخزون بتكلفة محسوبة من الخامات وأجر التصنيع والتكاليف الأخرى."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            استلام
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="التاريخ" required>
          <Input type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
        </Field>
        <Field label="الكمية المستلمة" required hint={`المتبقي من الأمر: ${qty(remaining)}`}>
          <QtyInput value={quantity} onChange={setQuantity} />
        </Field>
        <div className="sm:col-span-2">
          <Switch
            checked={isFinal}
            onChange={setIsFinal}
            label="هذا هو الاستلام الأخير للأمر"
            description="عند التفعيل تُستوعب كامل التكلفة المتبقية في هذه الكمية ويُقفل الأمر."
          />
        </div>
      </div>

      <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-[13px]">
        <div className="flex justify-between">
          <span className="text-slate-600">التكلفة المتبقية تحت التشغيل</span>
          <span className="num font-semibold">{money(wipRemaining)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-2">
          <span className="font-bold text-slate-700">تكلفة الوحدة المتوقعة</span>
          <span className="num font-bold text-brand-700">{money(estimatedUnitCost)}</span>
        </div>
      </div>
    </Modal>
  )
}
