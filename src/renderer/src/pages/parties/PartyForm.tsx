import React, { useEffect, useState } from 'react'
import type { PartyType } from '@shared/types'
import { invoke, errorMessage } from '../../lib/api'
import { useUi } from '../../store/ui'
import { Field, Input, Modal, MoneyInput, Spinner, Switch, Textarea } from '../../components/ui'
import { today } from '../../lib/format'

export const PARTY_META: Record<PartyType, { singular: string; plural: string; balanceHint: string }> = {
  customer: { singular: 'عميل', plural: 'العملاء', balanceHint: 'المبلغ المستحق على العميل عند بدء استخدام النظام' },
  supplier: { singular: 'مورد', plural: 'الموردون', balanceHint: 'المبلغ المستحق للمورد عند بدء استخدام النظام' },
  factory: { singular: 'مصنع', plural: 'المصانع', balanceHint: 'المبلغ المستحق للمصنع عند بدء استخدام النظام' }
}

export interface PartyFormValues {
  id?: number
  code: string
  name: string
  companyName: string
  phone: string
  whatsapp: string
  email: string
  address: string
  city: string
  taxNumber: string
  commercialReg: string
  contactPerson: string
  openingBalance: number
  openingDate: string
  creditLimit: number
  paymentTermsDays: number
  notes: string
  isActive: boolean
}

const EMPTY: PartyFormValues = {
  code: '', name: '', companyName: '', phone: '', whatsapp: '', email: '', address: '', city: '',
  taxNumber: '', commercialReg: '', contactPerson: '', openingBalance: 0, openingDate: today(),
  creditLimit: 0, paymentTermsDays: 0, notes: '', isActive: true
}

export function PartyFormModal({
  open,
  onClose,
  partyType,
  partyId,
  onSaved
}: {
  open: boolean
  onClose: () => void
  partyType: PartyType
  partyId?: number | null
  onSaved: (id: number) => void
}): React.JSX.Element {
  const ui = useUi()
  const meta = PARTY_META[partyType]
  const [values, setValues] = useState<PartyFormValues>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    if (partyId) {
      setLoading(true)
      invoke<Record<string, unknown>>('parties:get', { id: partyId })
        .then((party) =>
          setValues({
            id: partyId,
            code: String(party.code ?? ''),
            name: String(party.name ?? ''),
            companyName: String(party.companyName ?? ''),
            phone: String(party.phone ?? ''),
            whatsapp: String(party.whatsapp ?? ''),
            email: String(party.email ?? ''),
            address: String(party.address ?? ''),
            city: String(party.city ?? ''),
            taxNumber: String(party.taxNumber ?? ''),
            commercialReg: String(party.commercialReg ?? ''),
            contactPerson: String(party.contactPerson ?? ''),
            openingBalance: Number(party.openingBalance ?? 0),
            openingDate: String(party.openingDate ?? today()),
            creditLimit: Number(party.creditLimit ?? 0),
            paymentTermsDays: Number(party.paymentTermsDays ?? 0),
            notes: String(party.notes ?? ''),
            isActive: Boolean(party.isActive)
          })
        )
        .catch((error) => ui.error('تعذّر تحميل البيانات', errorMessage(error)))
        .finally(() => setLoading(false))
    } else {
      invoke<string>('parties:nextCode', { partyType })
        .then((code) => setValues({ ...EMPTY, code, openingDate: today() }))
        .catch(() => setValues({ ...EMPTY, openingDate: today() }))
    }
  }, [open, partyId, partyType, ui])

  const save = async (): Promise<void> => {
    if (!values.name.trim()) {
      setErrors({ name: `اسم ${meta.singular} مطلوب.` })
      return
    }
    setSaving(true)
    try {
      const payload = {
        partyType,
        code: values.code || undefined,
        name: values.name.trim(),
        companyName: values.companyName || null,
        phone: values.phone || null,
        whatsapp: values.whatsapp || null,
        email: values.email || null,
        address: values.address || null,
        city: values.city || null,
        taxNumber: values.taxNumber || null,
        commercialReg: values.commercialReg || null,
        contactPerson: values.contactPerson || null,
        openingBalance: values.openingBalance,
        openingDate: values.openingDate,
        creditLimit: values.creditLimit,
        paymentTermsDays: values.paymentTermsDays,
        notes: values.notes || null,
        isActive: values.isActive
      }
      const id = partyId
        ? (await invoke('parties:update', { id: partyId, data: payload }), partyId)
        : await invoke<number>('parties:create', payload)
      ui.success(partyId ? 'تم حفظ التعديلات' : `تمت إضافة ${meta.singular} بنجاح`)
      onSaved(id)
      onClose()
    } catch (error) {
      ui.error('تعذّر الحفظ', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={partyId ? `تعديل بيانات ${meta.singular}` : `إضافة ${meta.singular} جديد`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving || loading}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            حفظ
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center py-10"><Spinner className="h-7 w-7" /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الكود" hint="يُولَّد تلقائيًا إن تُرك فارغًا">
            <Input dir="ltr" className="text-right" value={values.code} onChange={(e) => setValues({ ...values, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="الاسم" required error={errors.name}>
            <Input autoFocus value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
          </Field>
          <Field label="اسم الشركة / المحل">
            <Input value={values.companyName} onChange={(e) => setValues({ ...values, companyName: e.target.value })} />
          </Field>
          <Field label="مسؤول التواصل">
            <Input value={values.contactPerson} onChange={(e) => setValues({ ...values, contactPerson: e.target.value })} />
          </Field>
          <Field label="الهاتف">
            <Input dir="ltr" className="text-right" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />
          </Field>
          <Field label="واتساب">
            <Input dir="ltr" className="text-right" value={values.whatsapp} onChange={(e) => setValues({ ...values, whatsapp: e.target.value })} />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input dir="ltr" className="text-right" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
          </Field>
          <Field label="المدينة">
            <Input value={values.city} onChange={(e) => setValues({ ...values, city: e.target.value })} />
          </Field>
          <Field label="العنوان" className="sm:col-span-2">
            <Input value={values.address} onChange={(e) => setValues({ ...values, address: e.target.value })} />
          </Field>
          <Field label="الرقم الضريبي">
            <Input dir="ltr" className="text-right" value={values.taxNumber} onChange={(e) => setValues({ ...values, taxNumber: e.target.value })} />
          </Field>
          <Field label="السجل التجاري">
            <Input dir="ltr" className="text-right" value={values.commercialReg} onChange={(e) => setValues({ ...values, commercialReg: e.target.value })} />
          </Field>

          <div className="sm:col-span-2 mt-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-3 text-[13px] font-bold text-slate-700">الرصيد الافتتاحي والشروط</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="الرصيد الافتتاحي" hint={meta.balanceHint}>
                <MoneyInput value={values.openingBalance} onChange={(v) => setValues({ ...values, openingBalance: v })} />
              </Field>
              <Field label="تاريخ الرصيد">
                <Input type="date" value={values.openingDate} onChange={(e) => setValues({ ...values, openingDate: e.target.value })} />
              </Field>
              {partyType === 'customer' ? (
                <Field label="حد الائتمان" hint="٠ = بلا حد">
                  <MoneyInput value={values.creditLimit} onChange={(v) => setValues({ ...values, creditLimit: v })} />
                </Field>
              ) : (
                <Field label="مدة السداد (أيام)">
                  <Input type="number" dir="ltr" className="text-left" value={values.paymentTermsDays} onChange={(e) => setValues({ ...values, paymentTermsDays: Number(e.target.value) })} />
                </Field>
              )}
            </div>
            {partyId && values.openingBalance !== 0 && (
              <p className="mt-2 text-[12px] text-amber-700">
                تعديل الرصيد الافتتاحي يُنشئ قيد تسوية محاسبيًا ويُسجَّل في سجل المراجعة.
              </p>
            )}
          </div>

          <Field label="ملاحظات" className="sm:col-span-2">
            <Textarea value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} />
          </Field>

          {partyId && (
            <div className="sm:col-span-2">
              <Switch
                checked={values.isActive}
                onChange={(v) => setValues({ ...values, isActive: v })}
                label="نشط"
                description="الأطراف غير النشطة لا تظهر في قوائم اختيار الفواتير الجديدة."
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
