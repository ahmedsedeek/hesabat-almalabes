import React, { useEffect, useState } from 'react'
import { invoke, errorMessage } from '../../lib/api'
import { useUi } from '../../store/ui'
import { Badge, Field, Input, Modal, MoneyInput, QtyInput, Select, Spinner, Switch, Textarea, cn } from '../../components/ui'
import { PartyPicker } from '../../components/common/pickers'
import { useQuery } from '../../lib/hooks'
import { money, rate, today } from '../../lib/format'

interface ReturnableItem {
  saleItemId: number
  variantId: number
  quantity: number
  returnedQty: number
  remainingQty: number
  unitPrice: number
  taxRate: number
  productName: string
  sku: string
  size: string | null
  color: string | null
  unit: string
}

/** تسجيل مردود مبيعات — الكميات محدودة بما تبقّى من الفاتورة */
export function SaleReturnModal({
  open,
  onClose,
  saleId,
  customerId,
  shippingCharged = 0,
  onSaved
}: {
  open: boolean
  onClose: () => void
  saleId: number
  customerId: number
  /** الشحن الذي حُصِّل في الفاتورة الأصلية — الحد الأقصى لما يمكن ردّه */
  shippingCharged?: number
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const cashAccounts = useQuery<{ accountId: number; name: string }[]>(open ? 'accounts:cash' : null, undefined, [open])
  const [items, setItems] = useState<ReturnableItem[]>([])
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [restockMap, setRestockMap] = useState<Record<number, boolean>>({})
  const [returnDate, setReturnDate] = useState(today())
  const [reason, setReason] = useState('')
  const [refundShipping, setRefundShipping] = useState(false)
  const [refundedShipping, setRefundedShipping] = useState(0)
  const [returnDeliveryCost, setReturnDeliveryCost] = useState(0)
  const [deliveryPaidNow, setDeliveryPaidNow] = useState(true)
  const [deliveryAccountId, setDeliveryAccountId] = useState<number | null>(null)
  const [courierId, setCourierId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setQuantities({})
    setRestockMap({})
    setReason('')
    setError(null)
    setReturnDate(today())
    setRefundShipping(false)
    setRefundedShipping(0)
    setReturnDeliveryCost(0)
    setDeliveryPaidNow(true)
    setCourierId(null)
    invoke<ReturnableItem[]>('sales:returnableItems', { saleId })
      .then(setItems)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [open, saleId])

  const selected = items.filter((item) => (quantities[item.saleItemId] ?? 0) > 0)
  const itemsTotal = selected.reduce((sum, item) => {
    const q = quantities[item.saleItemId]
    const net = Math.round((q * item.unitPrice) / 100)
    return sum + net + Math.round((net * (item.taxRate ?? 0)) / 100)
  }, 0)
  const total = itemsTotal + (refundShipping ? refundedShipping : 0)
  const damagedCount = selected.filter((item) => restockMap[item.saleItemId] === false).length

  const save = async (): Promise<void> => {
    if (!selected.length) return setError('حدّد كمية صنف واحد على الأقل.')
    if (returnDeliveryCost > 0 && !deliveryPaidNow && !courierId) {
      return setError('اختر شركة الشحن، أو فعّل «دفع تكلفة الإرجاع الآن».')
    }
    setSaving(true)
    setError(null)
    try {
      await invoke('sales:createReturn', {
        date: returnDate,
        saleId,
        customerId,
        reason: reason || null,
        refundedShipping: refundShipping ? refundedShipping : 0,
        deliveryCost: returnDeliveryCost,
        deliveryPartyId: returnDeliveryCost > 0 && !deliveryPaidNow ? courierId : null,
        deliveryPaymentAccountId: returnDeliveryCost > 0 && deliveryPaidNow ? deliveryAccountId : null,
        items: selected.map((item) => ({
          saleItemId: item.saleItemId,
          variantId: item.variantId,
          quantity: quantities[item.saleItemId],
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          restock: restockMap[item.saleItemId] !== false
        }))
      })
      ui.success('تم تسجيل المردود', 'أُعيدت الكميات للمخزون وخُفِّض رصيد العميل.')
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
      title="تسجيل مردود مبيعات"
      description="حدّد الكميات المرتجعة من كل صنف"
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

      {loading ? (
        <div className="flex justify-center py-10"><Spinner className="h-7 w-7" /></div>
      ) : !items.length ? (
        <p className="py-8 text-center text-sm text-slate-500">لا توجد أصناف قابلة للإرجاع في هذه الفاتورة.</p>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <Field label="تاريخ المردود" required>
              <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </Field>
            <Field label="سبب الإرجاع">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: عيب في التصنيع" />
            </Field>
          </div>

          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th className="text-center">المباع</th>
                  <th className="text-center">المرتجع سابقًا</th>
                  <th className="text-center">المتاح للإرجاع</th>
                  <th className="text-left">سعر الوحدة</th>
                  <th style={{ width: '120px' }}>كمية الإرجاع</th>
                  <th className="text-center" style={{ width: '130px' }}>صالح للبيع؟</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.saleItemId}>
                    <td>
                      <p className="font-semibold text-slate-800">
                        {item.productName}
                        {item.size || item.color ? <span className="mr-1 text-[12px] text-slate-500">({[item.size, item.color].filter(Boolean).join(' / ')})</span> : null}
                      </p>
                      <p className="num text-[12px] text-slate-500">{item.sku}</p>
                    </td>
                    <td className="text-center"><span className="num">{item.quantity}</span></td>
                    <td className="text-center"><span className="num text-amber-700">{item.returnedQty}</span></td>
                    <td className="text-center"><span className="num font-semibold text-emerald-700">{item.remainingQty}</span></td>
                    <td className="text-left"><span className="num">{rate(item.unitPrice)}</span></td>
                    <td>
                      <QtyInput
                        value={quantities[item.saleItemId] ?? 0}
                        max={item.remainingQty}
                        onChange={(value) => setQuantities({ ...quantities, [item.saleItemId]: Math.min(value, item.remainingQty) })}
                      />
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        disabled={(quantities[item.saleItemId] ?? 0) <= 0}
                        onClick={() => setRestockMap({ ...restockMap, [item.saleItemId]: restockMap[item.saleItemId] === false })}
                        className={cn('transition-opacity', (quantities[item.saleItemId] ?? 0) <= 0 && 'opacity-30')}
                      >
                        {restockMap[item.saleItemId] === false ? (
                          <Badge tone="red">تالف — لا يعود</Badge>
                        ) : (
                          <Badge tone="green">صالح — يعود للمخزون</Badge>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-3">
              <Switch
                checked={refundShipping}
                onChange={(value) => {
                  setRefundShipping(value)
                  if (value && refundedShipping === 0) setRefundedShipping(shippingCharged)
                }}
                label="ردّ الشحن المحصَّل للعميل"
                description={
                  shippingCharged > 0
                    ? `حُصِّل من العميل ${money(shippingCharged)} شحنًا في الفاتورة الأصلية.`
                    : 'لم يُحصَّل شحن في الفاتورة الأصلية.'
                }
                disabled={shippingCharged <= 0}
              />
              {refundShipping && (
                <Field label="المبلغ المُعاد من الشحن" className="mt-3">
                  <MoneyInput value={refundedShipping} onChange={(v) => setRefundedShipping(Math.min(v, shippingCharged))} />
                </Field>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <Field label="تكلفة إرجاع الشحنة علينا" hint="ما تدفعه لشركة الشحن لإعادة البضاعة">
                <MoneyInput value={returnDeliveryCost} onChange={setReturnDeliveryCost} />
              </Field>
              {returnDeliveryCost > 0 && (
                <>
                  <div className="mt-3">
                    <Switch checked={deliveryPaidNow} onChange={setDeliveryPaidNow} label="دفع تكلفة الإرجاع الآن" />
                  </div>
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
                </>
              )}
            </div>
          </div>

          {damagedCount > 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
              {damagedCount === 1 ? 'صنف واحد' : `${damagedCount} أصناف`} لن تعود للمخزون، وستُحمَّل تكلفتها على «فروقات وتلف المخزون».
            </p>
          )}

          <div className="mt-4 space-y-1.5 rounded-xl bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-slate-600">قيمة الأصناف المرتجعة</span>
              <span className="num font-semibold">{money(itemsTotal)}</span>
            </div>
            {refundShipping && refundedShipping > 0 && (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-slate-600">شحن مُعاد</span>
                <span className="num font-semibold">{money(refundedShipping)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
              <span className="text-[13px] font-bold text-slate-700">إجمالي ما يُخصم من العميل</span>
              <span className="num text-lg font-bold text-rose-700">{money(total)}</span>
            </div>
            {returnDeliveryCost > 0 && (
              <div className="flex items-center justify-between text-[12.5px] text-amber-800">
                <span>تكلفة إرجاع تتحمّلها الشركة</span>
                <span className="num font-semibold">{money(returnDeliveryCost)}</span>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
