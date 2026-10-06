import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Save, Trash2 } from 'lucide-react'
import { allocate, lineAmount, percentOf, rateFromAmount } from '@shared/money'
import { invoke, errorMessage } from '../../lib/api'
import { useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Card, Field, Input, MoneyInput, QtyInput, RateInput, Select, Spinner, Switch, Textarea } from '../../components/ui'
import { PageHeader } from '../../components/common/page'
import { PartyPicker, ProductSearch, SummaryRow, variantLabel, type VariantOption } from '../../components/common/pickers'
import { PartyFormModal } from '../parties/PartyForm'
import { money, rate as fmtRate, today } from '../../lib/format'

interface LineItem {
  key: string
  variantId: number
  name: string
  sku: string
  unit: string
  quantity: number
  unitPrice: number
  discountAmount: number
  taxRate: number
}

export function PurchaseFormPage(): React.JSX.Element {
  const navigate = useNavigate()
  const ui = useUi()
  const { settings } = useSession()
  const [params] = useSearchParams()

  const warehouses = useQuery<Record<string, unknown>[]>('warehouses:list', { activeOnly: true })
  const methods = useQuery<Record<string, unknown>[]>('payments:methods', { activeOnly: true })

  const [supplierId, setSupplierId] = useState<number | null>(params.get('supplierId') ? Number(params.get('supplierId')) : null)
  const [supplierType, setSupplierType] = useState<'supplier' | 'factory'>('supplier')
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [purchaseType, setPurchaseType] = useState<'goods' | 'materials'>('goods')
  const [purchaseDate, setPurchaseDate] = useState(today())
  const [dueDate, setDueDate] = useState('')
  const [supplierInvoice, setSupplierInvoice] = useState('')
  const [items, setItems] = useState<LineItem[]>([])
  const [headerDiscount, setHeaderDiscount] = useState(0)
  const [shipping, setShipping] = useState(0)
  const [otherCost, setOtherCost] = useState(0)
  const [notes, setNotes] = useState('')
  const [payNow, setPayNow] = useState(false)
  const [paidAmount, setPaidAmount] = useState(0)
  const [methodId, setMethodId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newSupplierOpen, setNewSupplierOpen] = useState(false)

  const taxEnabled = settings?.tax.enabled ?? false

  useEffect(() => {
    if (!warehouseId && warehouses.data?.length) {
      const def = warehouses.data.find((w) => w.is_default === 1) ?? warehouses.data[0]
      setWarehouseId(Number(def.id))
    }
  }, [warehouses.data, warehouseId])

  useEffect(() => {
    if (!methodId && methods.data?.length) setMethodId(Number(methods.data[0].id))
  }, [methods.data, methodId])

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
    const nets = base.map((l, i) => l.net1 - shares[i])
    const extras = shipping + otherCost
    const landed = allocate(extras, nets)
    const lines = nets.map((net, i) => ({
      net,
      taxAmount: items[i].taxRate ? percentOf(net, items[i].taxRate) : 0,
      landed: landed[i],
      unitCost: items[i].quantity ? rateFromAmount(net + landed[i], items[i].quantity) : 0
    }))
    const discountAmount = shares.reduce((s, v) => s + v, 0) + base.reduce((s, l) => s + l.lineDiscount, 0)
    const taxAmount = lines.reduce((s, l) => s + l.taxAmount, 0)
    const total = subtotal - discountAmount + taxAmount + extras
    return { lines, subtotal, discountAmount, taxAmount, total }
  }, [items, headerDiscount, shipping, otherCost])

  useEffect(() => {
    if (payNow && paidAmount === 0) setPaidAmount(totals.total)
    if (!payNow) setPaidAmount(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payNow])

  const addItem = (option: VariantOption): void => {
    setItems((current) => {
      const existing = current.find((i) => i.variantId === option.variantId)
      if (existing) return current.map((i) => (i.variantId === option.variantId ? { ...i, quantity: i.quantity + 1 } : i))
      return [
        ...current,
        {
          key: `${option.variantId}-${Date.now()}`,
          variantId: option.variantId,
          name: variantLabel(option),
          sku: option.sku,
          unit: option.unit,
          quantity: 1,
          unitPrice: option.purchasePrice || option.avgCost,
          discountAmount: 0,
          taxRate: taxEnabled ? settings?.tax.defaultRate ?? 0 : 0
        }
      ]
    })
  }

  const update = (key: string, patch: Partial<LineItem>): void => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  const save = async (): Promise<void> => {
    setError(null)
    if (!supplierId) return setError('اختر المورد أولًا.')
    if (!items.length) return setError('أضف صنفًا واحدًا على الأقل.')
    if (payNow && paidAmount > totals.total) return setError('المبلغ المدفوع أكبر من إجمالي الفاتورة.')

    setSaving(true)
    try {
      const result = await invoke<{ id: number; invoiceNumber: string }>('purchases:create', {
        date: purchaseDate,
        dueDate: dueDate || null,
        supplierId,
        warehouseId,
        purchaseType,
        supplierInvoiceNumber: supplierInvoice || null,
        items: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          taxRate: item.taxRate
        })),
        discountAmount: headerDiscount,
        shippingAmount: shipping,
        otherCostAmount: otherCost,
        notes: notes || null,
        payment: payNow && paidAmount > 0 && methodId ? { amount: paidAmount, methodId } : undefined
      })
      ui.success('تم حفظ فاتورة الشراء', `رقم الفاتورة ${result.invoiceNumber}`)
      navigate(`/purchases/${result.id}`)
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
          <button type="button" onClick={() => navigate('/purchases')} className="inline-flex items-center gap-1 text-slate-500 hover:text-brand-600">
            <ArrowRight className="h-3.5 w-3.5" />
            المشتريات
          </button>
        }
        title="فاتورة شراء جديدة"
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => navigate('/purchases')} disabled={saving}>إلغاء</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4 text-white" /> : <Save className="h-4 w-4" />}
              حفظ الفاتورة
            </button>
          </>
        }
      />

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-700">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-[1fr,22rem]">
        <div className="space-y-4">
          <Card title="بيانات الفاتورة">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="نوع الشراء" required>
                <Select value={purchaseType} onChange={(e) => setPurchaseType(e.target.value as 'goods')}>
                  <option value="goods">بضاعة جاهزة</option>
                  <option value="materials">خامات ومستلزمات</option>
                </Select>
              </Field>
              <Field label="جهة التوريد">
                <Select
                  value={supplierType}
                  onChange={(e) => {
                    setSupplierType(e.target.value as 'supplier')
                    setSupplierId(null)
                  }}
                >
                  <option value="supplier">مورد</option>
                  <option value="factory">مصنع</option>
                </Select>
              </Field>
              <Field label={supplierType === 'factory' ? 'المصنع' : 'المورد'} required className="sm:col-span-2">
                <PartyPicker partyType={supplierType} value={supplierId} onChange={(id) => setSupplierId(id)} onCreateNew={() => setNewSupplierOpen(true)} />
              </Field>
              <Field label="التاريخ" required>
                <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
              </Field>
              <Field label="تاريخ الاستحقاق">
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label="رقم فاتورة المورد" hint="يمنع النظام تكراره">
                <Input dir="ltr" className="text-right" value={supplierInvoice} onChange={(e) => setSupplierInvoice(e.target.value)} />
              </Field>
              <Field label="المخزن" required>
                <Select value={warehouseId ?? ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                  {(warehouses.data ?? []).map((w) => (
                    <option key={String(w.id)} value={String(w.id)}>{String(w.name)}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card
            title="الأصناف"
            subtitle={purchaseType === 'materials' ? 'ابحث عن الخامات (قماش، أزرار، سحابات…)' : 'ابحث عن المنتجات الجاهزة'}
          >
            <ProductSearch
              warehouseId={warehouseId ?? undefined}
              productType={purchaseType === 'materials' ? 'raw' : undefined}
              onPick={addItem}
              autoFocus
              priceField="purchasePrice"
            />

            {items.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: '36px' }}>#</th>
                      <th>الصنف</th>
                      <th style={{ width: '110px' }}>الكمية</th>
                      <th style={{ width: '120px' }}>تكلفة الوحدة</th>
                      <th style={{ width: '110px' }}>خصم السطر</th>
                      {taxEnabled && <th style={{ width: '90px' }}>الضريبة٪</th>}
                      <th className="text-left" style={{ width: '110px' }}>الإجمالي</th>
                      <th className="text-left" style={{ width: '120px' }}>التكلفة النهائية</th>
                      <th style={{ width: '44px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => {
                      const line = totals.lines[index]
                      return (
                        <tr key={item.key}>
                          <td className="text-center text-slate-400">{index + 1}</td>
                          <td>
                            <p className="font-semibold text-slate-800">{item.name}</p>
                            <p className="num text-[12px] text-slate-500">{item.sku} · {item.unit}</p>
                          </td>
                          <td><QtyInput value={item.quantity} onChange={(value) => update(item.key, { quantity: value })} /></td>
                          <td><RateInput value={item.unitPrice} onChange={(value) => update(item.key, { unitPrice: value })} /></td>
                          <td><MoneyInput value={item.discountAmount} onChange={(value) => update(item.key, { discountAmount: value })} /></td>
                          {taxEnabled && (
                            <td>
                              <Input type="number" dir="ltr" className="text-left" value={item.taxRate} onChange={(e) => update(item.key, { taxRate: Number(e.target.value) })} />
                            </td>
                          )}
                          <td className="text-left"><span className="num font-semibold">{money(line.net + line.taxAmount, false)}</span></td>
                          <td className="text-left">
                            <span className="num font-bold text-brand-700">{fmtRate(line.unitCost)}</span>
                            {line.landed > 0 && <p className="text-[11px] text-slate-500">شامل {money(line.landed, false)} تكاليف</p>}
                          </td>
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

          <Card title="ملاحظات">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="ملخص الفاتورة" className="xl:sticky xl:top-0">
            <SummaryRow label="الإجمالي قبل الخصم" value={totals.subtotal} />

            <Field label="خصم على الفاتورة" className="my-3">
              <MoneyInput value={headerDiscount} onChange={setHeaderDiscount} />
            </Field>
            <Field label="الشحن" hint="يُضاف إلى تكلفة الأصناف" className="mb-3">
              <MoneyInput value={shipping} onChange={setShipping} />
            </Field>
            <Field label="تكاليف أخرى" hint="جمارك، تحميل، تفريغ… تُوزَّع على الأصناف" className="mb-3">
              <MoneyInput value={otherCost} onChange={setOtherCost} />
            </Field>

            <SummaryRow label="إجمالي الخصومات" value={-totals.discountAmount} />
            {taxEnabled && <SummaryRow label={settings?.tax.label ?? 'الضريبة'} value={totals.taxAmount} />}
            <SummaryRow label="الإجمالي المستحق" value={totals.total} strong />

            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <Switch checked={payNow} onChange={setPayNow} label="دفع مبلغ الآن" description="اترك الخيار مغلقًا لتسجيل الشراء كآجل." />
              {payNow && (
                <div className="mt-3 space-y-3">
                  <Field label="المبلغ المدفوع">
                    <MoneyInput value={paidAmount} onChange={setPaidAmount} />
                  </Field>
                  <Field label="طريقة الدفع">
                    <Select value={methodId ?? ''} onChange={(e) => setMethodId(Number(e.target.value))}>
                      {(methods.data ?? []).map((m) => (
                        <option key={String(m.id)} value={String(m.id)}>{String(m.name)}</option>
                      ))}
                    </Select>
                  </Field>
                  <SummaryRow label="المتبقي للمورد" value={totals.total - paidAmount} tone={totals.total - paidAmount > 0 ? 'negative' : 'positive'} />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <PartyFormModal open={newSupplierOpen} onClose={() => setNewSupplierOpen(false)} partyType={supplierType} onSaved={(id) => setSupplierId(id)} />
    </div>
  )
}
