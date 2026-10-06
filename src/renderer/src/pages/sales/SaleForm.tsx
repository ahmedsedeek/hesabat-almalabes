import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Save, Trash2 } from 'lucide-react'
import { allocate, lineAmount, percentOf } from '@shared/money'
import { invoke, errorMessage } from '../../lib/api'
import { useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Card, Field, Input, MoneyInput, QtyInput, RateInput, Select, Spinner, Switch, Textarea, cn } from '../../components/ui'
import { PageHeader } from '../../components/common/page'
import { PartyPicker, ProductSearch, SummaryRow, variantLabel, type VariantOption } from '../../components/common/pickers'
import { PartyFormModal } from '../parties/PartyForm'
import { money, qty as fmtQty, today } from '../../lib/format'

interface LineItem {
  key: string
  variantId: number
  name: string
  sku: string
  unit: string
  stock: number
  quantity: number
  unitPrice: number
  discountAmount: number
  taxRate: number
}

export function SaleFormPage(): React.JSX.Element {
  const navigate = useNavigate()
  const ui = useUi()
  const { settings } = useSession()
  const [params] = useSearchParams()

  const warehouses = useQuery<Record<string, unknown>[]>('warehouses:list', { activeOnly: true })
  const methods = useQuery<Record<string, unknown>[]>('payments:methods', { activeOnly: true })
  const cashAccounts = useQuery<{ accountId: number; name: string; balance: number }[]>('accounts:cash')

  const [customerId, setCustomerId] = useState<number | null>(params.get('customerId') ? Number(params.get('customerId')) : null)
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [saleDate, setSaleDate] = useState(today())
  const [dueDate, setDueDate] = useState('')
  const [items, setItems] = useState<LineItem[]>([])
  const [headerDiscount, setHeaderDiscount] = useState(0)
  const [shipping, setShipping] = useState(0)
  const [channel, setChannel] = useState<'wholesale' | 'retail' | 'online'>('wholesale')
  const [deliveryCost, setDeliveryCost] = useState(0)
  const [courierId, setCourierId] = useState<number | null>(null)
  const [deliveryPaidNow, setDeliveryPaidNow] = useState(true)
  const [deliveryAccountId, setDeliveryAccountId] = useState<number | null>(null)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [payNow, setPayNow] = useState(false)
  const [paidAmount, setPaidAmount] = useState(0)
  const [methodId, setMethodId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)

  const taxEnabled = settings?.tax.enabled ?? false
  const defaultTaxRate = settings?.tax.defaultRate ?? 0

  useEffect(() => {
    if (!warehouseId && warehouses.data?.length) {
      const def = warehouses.data.find((w) => w.is_default === 1) ?? warehouses.data[0]
      setWarehouseId(Number(def.id))
    }
  }, [warehouses.data, warehouseId])

  useEffect(() => {
    if (!methodId && methods.data?.length) setMethodId(Number(methods.data[0].id))
  }, [methods.data, methodId])

  useEffect(() => {
    if (!deliveryAccountId && cashAccounts.data?.length) setDeliveryAccountId(cashAccounts.data[0].accountId)
  }, [cashAccounts.data, deliveryAccountId])

  // البيع المباشر للمستهلك يكون نقديًا في الغالب، فيُفعَّل التحصيل تلقائيًا
  useEffect(() => {
    if (channel === 'retail') setPayNow(true)
  }, [channel])

  // حساب الإجماليات بنفس منطق النواة تمامًا حتى لا يختلف المعروض عن المحفوظ
  const totals = useMemo(() => {
    const base = items.map((item) => {
      const gross = lineAmount(item.quantity, item.unitPrice)
      const lineDiscount = Math.min(item.discountAmount, gross)
      return { gross, lineDiscount, net1: gross - lineDiscount }
    })
    const subtotal = base.reduce((s, l) => s + l.gross, 0)
    const netAfterLine = base.reduce((s, l) => s + l.net1, 0)
    const capped = Math.max(0, Math.min(headerDiscount, netAfterLine))
    const shares = allocate(capped, base.map((l) => l.net1))
    const lines = base.map((l, i) => {
      const net = l.net1 - shares[i]
      const taxAmount = items[i].taxRate ? percentOf(net, items[i].taxRate) : 0
      return { net, taxAmount, discount: l.lineDiscount + shares[i], gross: l.gross }
    })
    const discountAmount = lines.reduce((s, l) => s + l.discount, 0)
    const taxAmount = lines.reduce((s, l) => s + l.taxAmount, 0)
    const total = subtotal - discountAmount + taxAmount + shipping
    return { lines, subtotal, discountAmount, taxAmount, total }
  }, [items, headerDiscount, shipping])

  useEffect(() => {
    if (payNow && paidAmount === 0) setPaidAmount(totals.total)
    if (!payNow) setPaidAmount(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payNow])

  const addItem = (option: VariantOption): void => {
    setItems((current) => {
      const existing = current.find((i) => i.variantId === option.variantId)
      if (existing) {
        return current.map((i) => (i.variantId === option.variantId ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [
        ...current,
        {
          key: `${option.variantId}-${Date.now()}`,
          variantId: option.variantId,
          name: variantLabel(option),
          sku: option.sku,
          unit: option.unit,
          stock: option.stock,
          quantity: 1,
          unitPrice: option.salePrice,
          discountAmount: 0,
          taxRate: taxEnabled ? defaultTaxRate : 0
        }
      ]
    })
  }

  const update = (key: string, patch: Partial<LineItem>): void => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  const save = async (): Promise<void> => {
    setError(null)
    if (!customerId) return setError('اختر العميل أولًا.')
    if (!items.length) return setError('أضف صنفًا واحدًا على الأقل.')
    if (items.some((i) => i.quantity <= 0)) return setError('تأكد من أن كمية كل صنف أكبر من صفر.')
    if (payNow && paidAmount > totals.total) return setError('المبلغ المدفوع أكبر من إجمالي الفاتورة.')
    if (deliveryCost > 0 && !deliveryPaidNow && !courierId) {
      return setError('اختر شركة الشحن، أو فعّل «دفع تكلفة التوصيل الآن».')
    }

    setSaving(true)
    try {
      const result = await invoke<{ id: number; invoiceNumber: string }>('sales:create', {
        date: saleDate,
        dueDate: dueDate || null,
        customerId,
        warehouseId,
        items: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          taxRate: item.taxRate
        })),
        saleChannel: channel,
        discountAmount: headerDiscount,
        shippingAmount: shipping,
        deliveryCost,
        deliveryPartyId: deliveryCost > 0 && !deliveryPaidNow ? courierId : null,
        deliveryPaymentAccountId: deliveryCost > 0 && deliveryPaidNow ? deliveryAccountId : null,
        deliveryAddress: deliveryAddress || null,
        trackingNumber: trackingNumber || null,
        notes: notes || null,
        payment: payNow && paidAmount > 0 && methodId ? { amount: paidAmount, methodId } : undefined
      })
      ui.success('تم حفظ الفاتورة', `رقم الفاتورة ${result.invoiceNumber}`)
      navigate(`/sales/${result.id}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
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
        title="فاتورة بيع جديدة"
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => navigate('/sales')} disabled={saving}>إلغاء</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4 text-white" /> : <Save className="h-4 w-4" />}
              حفظ الفاتورة
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-700">{error}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr,22rem]">
        <div className="space-y-4">
          <Card title="بيانات الفاتورة">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="قناة البيع" required hint="تُستخدم في تحليل المبيعات">
                <Select value={channel} onChange={(e) => setChannel(e.target.value as 'retail')}>
                  <option value="wholesale">جملة (محلات وتجار)</option>
                  <option value="retail">تجزئة (بيع مباشر)</option>
                  <option value="online">أونلاين (طلب يُشحن)</option>
                </Select>
              </Field>
              <Field label="العميل" required className="sm:col-span-2">
                <PartyPicker partyType="customer" value={customerId} onChange={(id) => setCustomerId(id)} onCreateNew={() => setNewCustomerOpen(true)} />
              </Field>
              <Field label="التاريخ" required>
                <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
              </Field>
              <Field label="تاريخ الاستحقاق" hint="للبيع الآجل">
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label="المخزن" required className="sm:col-span-2">
                <Select value={warehouseId ?? ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                  {(warehouses.data ?? []).map((w) => (
                    <option key={String(w.id)} value={String(w.id)}>{String(w.name)}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card title="الأصناف" subtitle="ابحث بالاسم أو الكود أو امسح الباركود ثم اضغط Enter">
            <ProductSearch warehouseId={warehouseId ?? undefined} onPick={addItem} autoFocus priceField="salePrice" />

            {items.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: '36px' }}>#</th>
                      <th>الصنف</th>
                      <th style={{ width: '110px' }}>الكمية</th>
                      <th style={{ width: '120px' }}>سعر الوحدة</th>
                      <th style={{ width: '110px' }}>خصم السطر</th>
                      {taxEnabled && <th style={{ width: '90px' }}>الضريبة٪</th>}
                      <th className="text-left" style={{ width: '120px' }}>الإجمالي</th>
                      <th style={{ width: '44px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => {
                      const line = totals.lines[index]
                      const overStock = item.quantity > item.stock
                      return (
                        <tr key={item.key}>
                          <td className="text-center text-slate-400">{index + 1}</td>
                          <td>
                            <p className="font-semibold text-slate-800">{item.name}</p>
                            <p className="text-[12px] text-slate-500">
                              {item.sku} · الرصيد: <span className={cn('num', overStock && 'font-bold text-rose-600')}>{fmtQty(item.stock)}</span> {item.unit}
                            </p>
                          </td>
                          <td><QtyInput value={item.quantity} onChange={(value) => update(item.key, { quantity: value })} invalid={overStock} /></td>
                          <td><RateInput value={item.unitPrice} onChange={(value) => update(item.key, { unitPrice: value })} /></td>
                          <td><MoneyInput value={item.discountAmount} onChange={(value) => update(item.key, { discountAmount: value })} /></td>
                          {taxEnabled && (
                            <td>
                              <Input
                                type="number"
                                dir="ltr"
                                className="text-left"
                                value={item.taxRate}
                                onChange={(e) => update(item.key, { taxRate: Number(e.target.value) })}
                              />
                            </td>
                          )}
                          <td className="text-left"><span className="num font-bold text-slate-800">{money(line.net + line.taxAmount, false)}</span></td>
                          <td>
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              onClick={() => setItems((current) => current.filter((i) => i.key !== item.key))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {items.length === 0 && (
              <p className="mt-6 rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
                لم تُضف أي صنف بعد. ابدأ بالبحث في الحقل أعلاه.
              </p>
            )}
          </Card>

          {channel !== 'wholesale' && (
            <Card
              title="الشحن والتوصيل"
              subtitle="«الشحن المحصَّل» ما يدفعه العميل لك، و«تكلفة التوصيل» ما تدفعه أنت لشركة الشحن"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="عنوان التوصيل" className="sm:col-span-2">
                  <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="العنوان الذي يُسلَّم إليه الطلب" />
                </Field>
                <Field label="رقم البوليصة / التتبّع">
                  <Input dir="ltr" className="text-right" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
                </Field>
                <Field label="تكلفة التوصيل علينا" hint="تُحمَّل كمصروف ولا تدخل إجمالي الفاتورة">
                  <MoneyInput value={deliveryCost} onChange={setDeliveryCost} />
                </Field>

                {deliveryCost > 0 && (
                  <div className="sm:col-span-2 rounded-xl border border-slate-200 p-3">
                    <Switch
                      checked={deliveryPaidNow}
                      onChange={setDeliveryPaidNow}
                      label="دفع تكلفة التوصيل الآن"
                      description="أغلقه إن كانت التكلفة آجلة على حساب شركة الشحن."
                    />
                    {deliveryPaidNow ? (
                      <Field label="الدفع من حساب" className="mt-3">
                        <Select value={deliveryAccountId ?? ''} onChange={(e) => setDeliveryAccountId(Number(e.target.value))}>
                          {(cashAccounts.data ?? []).map((a) => (
                            <option key={a.accountId} value={a.accountId}>{a.name}</option>
                          ))}
                        </Select>
                      </Field>
                    ) : (
                      <Field label="شركة الشحن" className="mt-3" required>
                        <PartyPicker partyType="supplier" value={courierId} onChange={(id) => setCourierId(id)} />
                      </Field>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card title="ملاحظات">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات تظهر في الفاتورة المطبوعة…" />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="ملخص الفاتورة" className="xl:sticky xl:top-0">
            <SummaryRow label="الإجمالي قبل الخصم" value={totals.subtotal} />

            <Field label="خصم على الفاتورة" className="my-3">
              <MoneyInput value={headerDiscount} onChange={setHeaderDiscount} />
            </Field>

            <Field label="الشحن المحصَّل من العميل" className="mb-3" hint="اتركه صفرًا إذا كان الشحن مجانيًا">
              <MoneyInput value={shipping} onChange={setShipping} />
            </Field>

            <SummaryRow label="إجمالي الخصومات" value={-totals.discountAmount} />
            {taxEnabled && <SummaryRow label={settings?.tax.label ?? 'الضريبة'} value={totals.taxAmount} />}
            <SummaryRow label="الإجمالي المستحق" value={totals.total} strong />
            {deliveryCost > 0 && (
              <div className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
                تكلفة التوصيل <span className="num font-bold">{money(deliveryCost)}</span> مصروف عليك ولا تُضاف لفاتورة العميل.
                {shipping > 0
                  ? ` حصّلت منه ${money(shipping)} شحنًا، فالصافي ${money(shipping - deliveryCost)}.`
                  : ' أنت تتحمّلها بالكامل في هذا الطلب.'}
              </div>
            )}

            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <Switch
                checked={payNow}
                onChange={setPayNow}
                label="تحصيل مبلغ الآن"
                description="اترك الخيار مغلقًا لتسجيل الفاتورة كبيع آجل."
              />
              {payNow && (
                <div className="mt-3 space-y-3">
                  <Field label="المبلغ المُحصَّل">
                    <MoneyInput value={paidAmount} onChange={setPaidAmount} />
                  </Field>
                  <Field label="طريقة الدفع">
                    <Select value={methodId ?? ''} onChange={(e) => setMethodId(Number(e.target.value))}>
                      {(methods.data ?? []).map((m) => (
                        <option key={String(m.id)} value={String(m.id)}>{String(m.name)}</option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex gap-1.5">
                    <button type="button" className="btn-secondary btn-sm flex-1" onClick={() => setPaidAmount(totals.total)}>المبلغ كاملًا</button>
                    <button type="button" className="btn-secondary btn-sm flex-1" onClick={() => setPaidAmount(Math.round(totals.total / 2))}>النصف</button>
                  </div>
                  <SummaryRow label="المتبقي على العميل" value={totals.total - paidAmount} tone={totals.total - paidAmount > 0 ? 'negative' : 'positive'} />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <PartyFormModal
        open={newCustomerOpen}
        onClose={() => setNewCustomerOpen(false)}
        partyType="customer"
        onSaved={(id) => setCustomerId(id)}
      />
    </div>
  )
}
