import React, { useEffect, useMemo, useState } from 'react'
import type { PartyType } from '@shared/types'
import { invoke, errorMessage } from '../../lib/api'
import { useUi } from '../../store/ui'
import { Badge, Field, Input, Modal, MoneyInput, Select, Spinner, Textarea, cn } from '../../components/ui'
import { PartyPicker } from '../../components/common/pickers'
import { date, money, today } from '../../lib/format'

interface OpenDocument {
  docType: 'sale' | 'purchase'
  docId: number
  number: string
  date: string
  total: number
  paid: number
  remaining: number
}

/**
 * سند قبض أو صرف مع توزيع المبلغ على الفواتير المفتوحة.
 * النظام يقترح التوزيع من الأقدم للأحدث، ويمنع تجاوز المتبقي على أي فاتورة.
 */
export function PaymentFormModal({
  open,
  onClose,
  direction: initialDirection,
  partyId: initialPartyId,
  partyType: initialPartyType,
  docId,
  docType,
  suggestedAmount,
  onSaved
}: {
  open: boolean
  onClose: () => void
  direction: 'in' | 'out'
  partyId?: number | null
  partyType?: PartyType
  docId?: number
  docType?: 'sale' | 'purchase'
  suggestedAmount?: number
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const [direction, setDirection] = useState(initialDirection)
  const [partyType, setPartyType] = useState<PartyType>(initialPartyType ?? (initialDirection === 'in' ? 'customer' : 'supplier'))
  const [partyId, setPartyId] = useState<number | null>(initialPartyId ?? null)
  const [amount, setAmount] = useState(suggestedAmount ?? 0)
  const [methodId, setMethodId] = useState<number | null>(null)
  const [paymentDate, setPaymentDate] = useState(today())
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [methods, setMethods] = useState<Record<string, unknown>[]>([])
  const [documents, setDocuments] = useState<OpenDocument[]>([])
  const [allocations, setAllocations] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDirection(initialDirection)
    setPartyType(initialPartyType ?? (initialDirection === 'in' ? 'customer' : 'supplier'))
    setPartyId(initialPartyId ?? null)
    setAmount(suggestedAmount ?? 0)
    setPaymentDate(today())
    setReference('')
    setNotes('')
    setAllocations({})
    setError(null)
    invoke<Record<string, unknown>[]>('payments:methods', { activeOnly: true })
      .then((rows) => {
        setMethods(rows)
        setMethodId((current) => current ?? (rows[0] ? Number(rows[0].id) : null))
      })
      .catch(() => setMethods([]))
  }, [open, initialDirection, initialPartyId, initialPartyType, suggestedAmount])

  useEffect(() => {
    if (!open || !partyId) {
      setDocuments([])
      return
    }
    invoke<OpenDocument[]>('payments:openDocuments', { partyId })
      .then((rows) => {
        setDocuments(rows)
        if (docId && docType) {
          const target = rows.find((r) => r.docId === docId && r.docType === docType)
          if (target) setAllocations({ [docId]: Math.min(suggestedAmount ?? target.remaining, target.remaining) })
        }
      })
      .catch(() => setDocuments([]))
  }, [open, partyId, docId, docType, suggestedAmount])

  const allocatedTotal = useMemo(() => Object.values(allocations).reduce((s, v) => s + v, 0), [allocations])
  const unallocated = amount - allocatedTotal

  const autoAllocate = (): void => {
    let remaining = amount
    const next: Record<number, number> = {}
    for (const doc of documents) {
      if (remaining <= 0) break
      const share = Math.min(remaining, doc.remaining)
      if (share > 0) {
        next[doc.docId] = share
        remaining -= share
      }
    }
    setAllocations(next)
  }

  const save = async (): Promise<void> => {
    setError(null)
    if (!amount || amount <= 0) return setError('أدخل مبلغًا أكبر من صفر.')
    if (!methodId) return setError('اختر طريقة الدفع.')
    if (allocatedTotal > amount) return setError('مجموع المبالغ الموزَّعة أكبر من قيمة السند.')

    setSaving(true)
    try {
      await invoke('payments:create', {
        date: paymentDate,
        direction,
        partyId,
        amount,
        methodId,
        reference: reference || null,
        notes: notes || null,
        allocations: documents
          .filter((doc) => (allocations[doc.docId] ?? 0) > 0)
          .map((doc) => ({ docType: doc.docType, docId: doc.docId, amount: allocations[doc.docId] }))
      })
      ui.success(direction === 'in' ? 'تم تسجيل سند القبض' : 'تم تسجيل سند الصرف')
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
      title={direction === 'in' ? 'سند قبض' : 'سند صرف'}
      description={direction === 'in' ? 'تسجيل مبلغ مُحصَّل من عميل' : 'تسجيل مبلغ مدفوع لمورد أو مصنع'}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            حفظ السند
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نوع السند" required>
          <Select
            value={direction}
            onChange={(e) => {
              const value = e.target.value as 'in' | 'out'
              setDirection(value)
              setPartyType(value === 'in' ? 'customer' : 'supplier')
              setPartyId(null)
              setAllocations({})
            }}
            disabled={Boolean(initialPartyId)}
          >
            <option value="in">سند قبض (تحصيل من عميل)</option>
            <option value="out">سند صرف (دفع لمورد أو مصنع)</option>
          </Select>
        </Field>

        <Field label="التاريخ" required>
          <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </Field>

        {direction === 'out' && !initialPartyId && (
          <Field label="نوع الطرف">
            <Select
              value={partyType}
              onChange={(e) => {
                setPartyType(e.target.value as PartyType)
                setPartyId(null)
                setAllocations({})
              }}
            >
              <option value="supplier">مورد</option>
              <option value="factory">مصنع</option>
            </Select>
          </Field>
        )}

        <Field label={partyType === 'customer' ? 'العميل' : partyType === 'factory' ? 'المصنع' : 'المورد'} required className={direction === 'out' && !initialPartyId ? '' : 'sm:col-span-1'}>
          <PartyPicker
            partyType={partyType}
            value={partyId}
            disabled={Boolean(initialPartyId)}
            onChange={(id) => {
              setPartyId(id)
              setAllocations({})
            }}
          />
        </Field>

        <Field label="المبلغ" required>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>

        <Field label="طريقة الدفع" required>
          <Select value={methodId ?? ''} onChange={(e) => setMethodId(Number(e.target.value))}>
            {methods.map((method) => (
              <option key={String(method.id)} value={String(method.id)}>
                {String(method.name)} — {String(method.account_name)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="المرجع" hint="رقم الشيك أو رقم الحوالة">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>

        <Field label="ملاحظات" className="sm:col-span-2">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      {partyId && documents.length > 0 && (
        <div className="mt-5 rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
            <h3 className="text-[13px] font-bold text-slate-700">توزيع المبلغ على الفواتير المفتوحة</h3>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={autoAllocate} disabled={!amount}>
                توزيع تلقائي (الأقدم أولًا)
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setAllocations({})}>
                مسح التوزيع
              </button>
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الفاتورة</th>
                  <th>التاريخ</th>
                  <th className="text-left">الإجمالي</th>
                  <th className="text-left">المتبقي</th>
                  <th className="text-left" style={{ width: '150px' }}>المبلغ المخصَّص</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={`${doc.docType}-${doc.docId}`}>
                    <td><span className="num font-semibold text-brand-700">{doc.number}</span></td>
                    <td><span className="num">{date(doc.date)}</span></td>
                    <td className="text-left"><span className="num">{money(doc.total, false)}</span></td>
                    <td className="text-left"><span className="num font-semibold text-rose-700">{money(doc.remaining, false)}</span></td>
                    <td className="text-left">
                      <MoneyInput
                        value={allocations[doc.docId] ?? 0}
                        onChange={(value) => setAllocations({ ...allocations, [doc.docId]: Math.min(value, doc.remaining) })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px]">
            <span className="font-semibold text-slate-600">
              الموزَّع: <span className="num font-bold text-slate-800">{money(allocatedTotal)}</span>
            </span>
            <span className={cn('font-semibold', unallocated < 0 ? 'text-rose-600' : unallocated > 0 ? 'text-amber-600' : 'text-emerald-600')}>
              {unallocated === 0 ? (
                <Badge tone="green">تم توزيع كامل المبلغ</Badge>
              ) : unallocated > 0 ? (
                <>غير موزَّع: <span className="num font-bold">{money(unallocated)}</span> (سيُسجَّل كدفعة على الحساب)</>
              ) : (
                <>تجاوز المبلغ بـ <span className="num font-bold">{money(-unallocated)}</span></>
              )}
            </span>
          </div>
        </div>
      )}

      {partyId && documents.length === 0 && (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">
          لا توجد فواتير مفتوحة لهذا الطرف — سيُسجَّل المبلغ كدفعة على الحساب وتُخصم من الرصيد مباشرة.
        </p>
      )}
    </Modal>
  )
}
