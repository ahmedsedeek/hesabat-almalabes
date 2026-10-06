import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Activity, Building2, Coins, CreditCard, DatabaseBackup, FileDigit, HardDrive,
  Image as ImageIcon, Plus, ShieldCheck, Trash2, Upload, UserCog, Warehouse, Wrench
} from 'lucide-react'
import type { AppSettings } from '@shared/types'
import { PERMISSION_GROUPS, PERMISSION_LABELS, type Permission } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Field, Input, Modal, Select, Spinner, StatCard, Switch, Tabs, Textarea, cn, useConfirm } from '../../components/ui'
import { PageHeader } from '../../components/common/page'
import { dateTime, money } from '../../lib/format'
import { BackupPanel } from './BackupPanel'
import { ImportPanel } from './ImportPanel'

const TABS = [
  { key: 'company', label: 'بيانات الشركة', icon: <Building2 className="h-4 w-4" /> },
  { key: 'financial', label: 'العملة والضريبة', icon: <Coins className="h-4 w-4" /> },
  { key: 'numbering', label: 'ترقيم المستندات', icon: <FileDigit className="h-4 w-4" /> },
  { key: 'warehouses', label: 'المخازن', icon: <Warehouse className="h-4 w-4" /> },
  { key: 'payments', label: 'طرق الدفع', icon: <CreditCard className="h-4 w-4" /> },
  { key: 'users', label: 'المستخدمون والصلاحيات', icon: <UserCog className="h-4 w-4" /> },
  { key: 'backup', label: 'النسخ الاحتياطي', icon: <DatabaseBackup className="h-4 w-4" /> },
  { key: 'import', label: 'استيراد البيانات', icon: <Upload className="h-4 w-4" /> },
  { key: 'audit', label: 'سجل المراجعة', icon: <Activity className="h-4 w-4" /> },
  { key: 'maintenance', label: 'الصيانة', icon: <Wrench className="h-4 w-4" /> }
]

export function SettingsPage(): React.JSX.Element {
  const { tab } = useParams<{ tab: string }>()
  const navigate = useNavigate()
  const { settings, refreshSettings } = useSession()
  const active = tab && TABS.some((t) => t.key === tab) ? tab : 'company'

  if (!settings) return <div className="flex h-96 items-center justify-center"><Spinner className="h-8 w-8" /></div>

  return (
    <div>
      <PageHeader title="الإعدادات" subtitle="تهيئة النظام وإدارة المستخدمين والنسخ الاحتياطي" />

      <div className="mb-4">
        <Tabs tabs={TABS} active={active} onChange={(key) => navigate(`/settings/${key}`)} />
      </div>

      {active === 'company' && <CompanyTab settings={settings} onChange={refreshSettings} />}
      {active === 'financial' && <FinancialTab settings={settings} onChange={refreshSettings} />}
      {active === 'numbering' && <NumberingTab />}
      {active === 'warehouses' && <WarehousesTab />}
      {active === 'payments' && <PaymentMethodsTab />}
      {active === 'users' && <UsersTab />}
      {active === 'backup' && <BackupPanel settings={settings} onSettingsChange={refreshSettings} />}
      {active === 'import' && <Card><ImportPanel /></Card>}
      {active === 'audit' && <AuditTab />}
      {active === 'maintenance' && <MaintenanceTab />}
    </div>
  )
}

function CompanyTab({ settings, onChange }: { settings: AppSettings; onChange: () => Promise<void> }): React.JSX.Element {
  const ui = useUi()
  const [values, setValues] = useState(settings.company)
  const [locale, setLocale] = useState(settings.locale)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await invoke('settings:update', { section: 'company', value: values })
      await invoke('settings:update', { section: 'locale', value: locale })
      await onChange()
      ui.success('تم حفظ الإعدادات')
    } catch (error) {
      ui.error('تعذّر الحفظ', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const pickLogo = async (): Promise<void> => {
    const filePath = await invoke<string | null>('dialog:openFile', {
      title: 'اختر شعار الشركة',
      filters: [{ name: 'صور', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (!filePath) return
    try {
      const result = await invoke<{ path: string }>('attachments:storeImage', { filePath, prefix: 'logo' })
      setValues({ ...values, logoPath: result.path })
    } catch (error) {
      ui.error('تعذّر حفظ الشعار', errorMessage(error))
    }
  }

  return (
    <Card
      title="بيانات الشركة"
      subtitle="تظهر هذه البيانات في الفواتير وكشوف الحسابات المطبوعة"
      actions={
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving && <Spinner className="h-4 w-4 text-white" />}
          حفظ
        </button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="اسم الشركة التجاري" required className="lg:col-span-2">
          <Input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
        </Field>
        <Field label="الاسم القانوني">
          <Input value={values.legalName ?? ''} onChange={(e) => setValues({ ...values, legalName: e.target.value })} />
        </Field>
        <Field label="الهاتف"><Input dir="ltr" className="text-right" value={values.phone ?? ''} onChange={(e) => setValues({ ...values, phone: e.target.value })} /></Field>
        <Field label="البريد الإلكتروني"><Input dir="ltr" className="text-right" value={values.email ?? ''} onChange={(e) => setValues({ ...values, email: e.target.value })} /></Field>
        <Field label="الموقع الإلكتروني"><Input dir="ltr" className="text-right" value={values.website ?? ''} onChange={(e) => setValues({ ...values, website: e.target.value })} /></Field>
        <Field label="المدينة"><Input value={values.city ?? ''} onChange={(e) => setValues({ ...values, city: e.target.value })} /></Field>
        <Field label="العنوان" className="lg:col-span-2"><Input value={values.address ?? ''} onChange={(e) => setValues({ ...values, address: e.target.value })} /></Field>
        <Field label="الرقم الضريبي"><Input dir="ltr" className="text-right" value={values.taxNumber ?? ''} onChange={(e) => setValues({ ...values, taxNumber: e.target.value })} /></Field>
        <Field label="السجل التجاري"><Input dir="ltr" className="text-right" value={values.commercialReg ?? ''} onChange={(e) => setValues({ ...values, commercialReg: e.target.value })} /></Field>

        <Field label="شعار الشركة" hint="يظهر أعلى الفواتير المطبوعة">
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => void pickLogo()}>
              <ImageIcon className="h-4 w-4" />
              {values.logoPath ? 'تغيير الشعار' : 'اختيار شعار'}
            </button>
            {values.logoPath && (
              <button type="button" className="btn-ghost" onClick={() => setValues({ ...values, logoPath: '' })}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </Field>

        <Field label="تذييل الفاتورة" className="lg:col-span-3">
          <Input value={values.invoiceFooter ?? ''} onChange={(e) => setValues({ ...values, invoiceFooter: e.target.value })} />
        </Field>
        <Field label="بيانات الحساب البنكي" hint="تظهر أسفل الفاتورة لتسهيل التحويل" className="lg:col-span-3">
          <Textarea rows={2} value={values.bankDetails ?? ''} onChange={(e) => setValues({ ...values, bankDetails: e.target.value })} />
        </Field>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 text-[13px] font-bold text-slate-700">تنسيق العرض</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="تنسيق التاريخ">
            <Select value={locale.dateFormat} onChange={(e) => setLocale({ ...locale, dateFormat: e.target.value })}>
              <option value="dd/MM/yyyy">يوم/شهر/سنة (31/12/2026)</option>
              <option value="yyyy-MM-dd">سنة-شهر-يوم (2026-12-31)</option>
            </Select>
          </Field>
          <div className="sm:col-span-2 flex items-end">
            <Switch
              checked={locale.useArabicDigits}
              onChange={(value) => setLocale({ ...locale, useArabicDigits: value })}
              label="استخدام الأرقام العربية الهندية (٠١٢٣)"
              description="الافتراضي هو الأرقام اللاتينية (0123) لأنها أوضح في الجداول المالية."
            />
          </div>
        </div>
      </div>
    </Card>
  )
}

function FinancialTab({ settings, onChange }: { settings: AppSettings; onChange: () => Promise<void> }): React.JSX.Element {
  const ui = useUi()
  const [currency, setCurrency] = useState(settings.currency)
  const [tax, setTax] = useState(settings.tax)
  const [inventory, setInventory] = useState(settings.inventory)
  const [notifications, setNotifications] = useState(settings.notifications)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await invoke('settings:update', { section: 'currency', value: currency })
      await invoke('settings:update', { section: 'tax', value: tax })
      await invoke('settings:update', { section: 'inventory', value: inventory })
      await invoke('settings:update', { section: 'notifications', value: notifications })
      await onChange()
      ui.success('تم حفظ الإعدادات')
    } catch (error) {
      ui.error('تعذّر الحفظ', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="العملة"
        actions={
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            حفظ كل الإعدادات
          </button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="رمز العملة" hint="مثل EGP أو SAR">
            <Input dir="ltr" className="text-right" value={currency.code} onChange={(e) => setCurrency({ ...currency, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="الرمز المعروض" hint="مثل ج.م أو ر.س">
            <Input value={currency.symbol} onChange={(e) => setCurrency({ ...currency, symbol: e.target.value })} />
          </Field>
          <Field label="اسم العملة">
            <Input value={currency.name} onChange={(e) => setCurrency({ ...currency, name: e.target.value })} />
          </Field>
          <Field label="عدد الخانات العشرية">
            <Select value={String(currency.decimals)} onChange={(e) => setCurrency({ ...currency, decimals: Number(e.target.value) })}>
              <option value="0">بدون كسور</option>
              <option value="2">خانتان (0.00)</option>
              <option value="3">ثلاث خانات (0.000)</option>
            </Select>
          </Field>
        </div>
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
          مثال على العرض: <span className="num font-bold">{money(123456)}</span>
        </p>
      </Card>

      <Card title="الضريبة">
        <Switch
          checked={tax.enabled}
          onChange={(value) => setTax({ ...tax, enabled: value })}
          label="تفعيل الضريبة على الفواتير"
          description="عند التفعيل يظهر حقل الضريبة في فواتير البيع والشراء والمصروفات."
        />
        {tax.enabled && (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="اسم الضريبة"><Input value={tax.label} onChange={(e) => setTax({ ...tax, label: e.target.value })} /></Field>
            <Field label="النسبة الافتراضية (٪)">
              <Input type="number" dir="ltr" className="text-left" value={tax.defaultRate} onChange={(e) => setTax({ ...tax, defaultRate: Number(e.target.value) })} />
            </Field>
          </div>
        )}
      </Card>

      <Card title="المخزون">
        <Switch
          checked={inventory.allowNegativeStock}
          onChange={(value) => setInventory({ ...inventory, allowNegativeStock: value })}
          label="السماح بالبيع عند نفاد الرصيد"
          description="غير مُستحسن — يؤدي إلى أرصدة سالبة وتشويه تكلفة البضاعة المباعة. فعّله فقط عند الضرورة."
        />
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
          طريقة تسعير المخزون: <strong>المتوسط المرجَّح المتحرك</strong> — تُحدَّث تكلفة الوحدة تلقائيًا مع كل عملية شراء أو إنتاج.
        </p>
      </Card>

      <Card title="التنبيهات">
        <div className="space-y-4">
          <Switch checked={notifications.lowStock} onChange={(value) => setNotifications({ ...notifications, lowStock: value })} label="تنبيه نقص المخزون" description="عند وصول أي صنف إلى حد إعادة الطلب." />
          <Switch checked={notifications.overdueReceivables} onChange={(value) => setNotifications({ ...notifications, overdueReceivables: value })} label="تنبيه المستحقات المتأخرة" />
          <Field label="اعتبار المستحق متأخرًا بعد (أيام)" className="max-w-xs">
            <Input type="number" dir="ltr" className="text-left" value={notifications.overdueDays} onChange={(e) => setNotifications({ ...notifications, overdueDays: Number(e.target.value) })} />
          </Field>
          <Switch checked={notifications.backupStatus} onChange={(value) => setNotifications({ ...notifications, backupStatus: value })} label="تنبيهات النسخ الاحتياطي" description="إشعار عند نجاح أو فشل النسخ التلقائي." />
        </div>
      </Card>
    </div>
  )
}

function NumberingTab(): React.JSX.Element {
  const ui = useUi()
  const sequences = useQuery<{ docType: string; prefix: string; includeYear: boolean; padding: number; separator: string; nextNumber: number; resetPeriod: string }[]>('numbering:list')
  const [saving, setSaving] = useState<string | null>(null)

  const LABELS: Record<string, string> = {
    sale: 'فواتير البيع',
    sale_return: 'مردودات المبيعات',
    purchase: 'فواتير الشراء',
    purchase_return: 'مردودات المشتريات',
    payment_in: 'سندات القبض',
    payment_out: 'سندات الصرف',
    expense: 'المصروفات',
    production_order: 'أوامر الإنتاج',
    stock_adjustment: 'تسويات المخزون',
    stock_transfer: 'التحويلات المخزنية',
    cash_transaction: 'حركات الخزينة',
    journal: 'قيود اليومية'
  }

  const update = async (docType: string, patch: Record<string, unknown>): Promise<void> => {
    setSaving(docType)
    try {
      await invoke('numbering:update', { docType, data: patch })
      sequences.reload()
    } catch (error) {
      ui.error('تعذّر الحفظ', errorMessage(error))
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card title="ترقيم المستندات" subtitle="البادئة وعدد الخانات لكل نوع مستند. الأرقام فريدة ولا تتكرر.">
      {sequences.loading ? (
        <div className="flex justify-center py-10"><Spinner className="h-7 w-7" /></div>
      ) : (
        <div className="space-y-2">
          {(sequences.data ?? []).map((sequence) => (
            <div key={sequence.docType} className="grid items-end gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-5">
              <div className="text-[13.5px] font-semibold text-slate-700">{LABELS[sequence.docType] ?? sequence.docType}</div>
              <Field label="البادئة">
                <Input
                  dir="ltr"
                  className="text-right"
                  defaultValue={sequence.prefix}
                  onBlur={(e) => e.target.value !== sequence.prefix && void update(sequence.docType, { prefix: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="عدد الخانات">
                <Input
                  type="number"
                  dir="ltr"
                  className="text-left"
                  min={1}
                  max={10}
                  defaultValue={sequence.padding}
                  onBlur={(e) => Number(e.target.value) !== sequence.padding && void update(sequence.docType, { padding: Number(e.target.value) })}
                />
              </Field>
              <Field label="الرقم التالي">
                <Input
                  type="number"
                  dir="ltr"
                  className="text-left"
                  min={1}
                  defaultValue={sequence.nextNumber}
                  onBlur={(e) => Number(e.target.value) !== sequence.nextNumber && void update(sequence.docType, { nextNumber: Number(e.target.value) })}
                />
              </Field>
              <div>
                <p className="label">المعاينة</p>
                <p className="num flex h-10 items-center rounded-lg bg-slate-50 px-3 text-[13px] font-bold text-slate-700">
                  {saving === sequence.docType ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    [sequence.prefix, sequence.includeYear ? new Date().getFullYear() : null, String(sequence.nextNumber).padStart(sequence.padding, '0')].filter(Boolean).join(sequence.separator)
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function WarehousesTab(): React.JSX.Element {
  const ui = useUi()
  const { confirm, dialog } = useConfirm()
  const warehouses = useQuery<Record<string, unknown>[]>('warehouses:list')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState({ code: '', name: '', address: '', isDefault: false, isActive: true })

  const save = async (): Promise<void> => {
    try {
      if (editing) await invoke('warehouses:update', { id: Number(editing.id), data: form })
      else await invoke('warehouses:create', form)
      ui.success('تم الحفظ')
      warehouses.reload()
      setOpen(false)
    } catch (error) {
      ui.error('تعذّر الحفظ', errorMessage(error))
    }
  }

  return (
    <>
      <Card
        title="المخازن"
        subtitle="يمكنك إضافة أكثر من مخزن والتحويل بينها"
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setEditing(null)
              setForm({ code: '', name: '', address: '', isDefault: false, isActive: true })
              setOpen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            مخزن جديد
          </button>
        }
        noPadding
      >
        <DataTable
          rows={warehouses.data ?? []}
          loading={warehouses.loading}
          rowKey={(row) => String(row.id)}
          onRowClick={(row) => {
            setEditing(row)
            setForm({
              code: String(row.code),
              name: String(row.name),
              address: String(row.address ?? ''),
              isDefault: row.is_default === 1,
              isActive: row.is_active === 1
            })
            setOpen(true)
          }}
          empty={<EmptyState title="لا توجد مخازن" />}
          columns={[
            { key: 'code', header: 'الكود', render: (row) => <span className="num text-slate-500">{String(row.code)}</span> },
            { key: 'name', header: 'الاسم', render: (row) => <span className="font-semibold text-slate-800">{String(row.name)}</span> },
            { key: 'address', header: 'العنوان', render: (row) => String(row.address ?? '—') },
            { key: 'qty', header: 'إجمالي الكميات', align: 'left', render: (row) => <span className="num">{String(row.total_qty)}</span> },
            {
              key: 'flags',
              header: '',
              align: 'center',
              render: (row) => (
                <span className="flex justify-center gap-1">
                  {row.is_default === 1 && <Badge tone="blue">افتراضي</Badge>}
                  {row.is_active === 0 && <Badge tone="slate">معطّل</Badge>}
                </span>
              )
            }
          ]}
        />
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'تعديل المخزن' : 'مخزن جديد'}
        size="sm"
        footer={
          <>
            {editing && (
              <button
                type="button"
                className="btn-ghost mr-0 text-rose-600 hover:bg-rose-50"
                onClick={async () => {
                  const answer = await confirm({ title: 'حذف المخزن', message: 'لا يمكن حذف مخزن له حركات مسجّلة.', confirmLabel: 'حذف' })
                  if (answer === null) return
                  try {
                    await invoke('warehouses:delete', { id: Number(editing.id) })
                    ui.success('تم الحذف')
                    warehouses.reload()
                    setOpen(false)
                  } catch (error) {
                    ui.error('تعذّر الحذف', errorMessage(error))
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
                حذف
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>إلغاء</button>
            <button type="button" className="btn-primary" onClick={() => void save()}>حفظ</button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="الكود"><Input dir="ltr" className="text-right" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="اسم المخزن" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="العنوان"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Switch checked={form.isDefault} onChange={(value) => setForm({ ...form, isDefault: value })} label="المخزن الافتراضي" description="يُختار تلقائيًا في الفواتير الجديدة." />
          <Switch checked={form.isActive} onChange={(value) => setForm({ ...form, isActive: value })} label="نشط" />
        </div>
      </Modal>
      {dialog}
    </>
  )
}

function PaymentMethodsTab(): React.JSX.Element {
  const ui = useUi()
  const methods = useQuery<Record<string, unknown>[]>('payments:methods', { activeOnly: false })
  const accounts = useQuery<Record<string, unknown>[]>('accounts:cash')
  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState('')

  useEffect(() => {
    if (!accountId && accounts.data?.length) setAccountId(String(accounts.data[0].accountId))
  }, [accounts.data, accountId])

  const add = async (): Promise<void> => {
    if (!name.trim() || !accountId) return
    try {
      await invoke('payments:createMethod', { name: name.trim(), accountId: Number(accountId) })
      setName('')
      methods.reload()
      ui.success('تمت الإضافة')
    } catch (error) {
      ui.error('تعذّرت الإضافة', errorMessage(error))
    }
  }

  return (
    <Card title="طرق الدفع" subtitle="كل طريقة دفع مرتبطة بحساب نقدي أو بنكي يتأثر رصيده تلقائيًا" noPadding>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-3">
        <Field label="اسم طريقة الدفع" className="flex-1 min-w-[12rem]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: فودافون كاش" />
        </Field>
        <Field label="الحساب المرتبط" className="flex-1 min-w-[12rem]">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {(accounts.data ?? []).map((a) => (
              <option key={String(a.accountId)} value={String(a.accountId)}>{String(a.name)}</option>
            ))}
          </Select>
        </Field>
        <button type="button" className="btn-primary mb-[1px]" onClick={() => void add()}>
          <Plus className="h-4 w-4" />
          إضافة
        </button>
      </div>

      <DataTable
        rows={methods.data ?? []}
        loading={methods.loading}
        rowKey={(row) => String(row.id)}
        empty={<EmptyState title="لا توجد طرق دفع" />}
        columns={[
          { key: 'name', header: 'الاسم', render: (row) => <span className="font-semibold text-slate-800">{String(row.name)}</span> },
          { key: 'account', header: 'الحساب المرتبط', render: (row) => String(row.account_name) },
          { key: 'type', header: 'النوع', align: 'center', render: (row) => <Badge tone={row.account_subtype === 'bank' ? 'blue' : 'green'}>{row.account_subtype === 'bank' ? 'بنكي' : 'نقدي'}</Badge> },
          {
            key: 'active',
            header: 'الحالة',
            align: 'center',
            render: (row) => (
              <button
                type="button"
                onClick={async () => {
                  await invoke('payments:updateMethod', { id: Number(row.id), data: { isActive: row.is_active !== 1 } })
                  methods.reload()
                }}
              >
                {row.is_active === 1 ? <Badge tone="green">مفعّلة</Badge> : <Badge tone="slate">معطّلة</Badge>}
              </button>
            )
          }
        ]}
      />
    </Card>
  )
}

function UsersTab(): React.JSX.Element {
  const ui = useUi()
  const { user } = useSession()
  const users = useQuery<Record<string, unknown>[]>('users:list')
  const roles = useQuery<{ id: number; code: string; name: string; description: string | null; isSystem: number; permissions: Permission[]; userCount: number }[]>('roles:list')
  const [userOpen, setUserOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState({ username: '', fullName: '', password: '', roleId: 0, email: '', phone: '', isActive: true })
  const [roleOpen, setRoleOpen] = useState(false)
  const [selectedRole, setSelectedRole] = useState<{ id: number; name: string; permissions: Permission[]; code: string } | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)

  const saveUser = async (): Promise<void> => {
    try {
      if (editing) {
        await invoke('users:update', {
          id: Number(editing.id),
          data: {
            fullName: form.fullName,
            roleId: form.roleId,
            email: form.email || null,
            phone: form.phone || null,
            isActive: form.isActive,
            password: form.password || undefined
          }
        })
      } else {
        await invoke('users:create', { ...form, roleId: form.roleId })
      }
      ui.success('تم الحفظ')
      users.reload()
      setUserOpen(false)
    } catch (error) {
      ui.error('تعذّر الحفظ', errorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="المستخدمون"
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPasswordOpen(true)}>
              <ShieldCheck className="h-4 w-4" />
              تغيير كلمة مروري
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setEditing(null)
                setForm({ username: '', fullName: '', password: '', roleId: roles.data?.[0]?.id ?? 0, email: '', phone: '', isActive: true })
                setUserOpen(true)
              }}
            >
              <Plus className="h-4 w-4" />
              مستخدم جديد
            </button>
          </>
        }
        noPadding
      >
        <DataTable
          rows={users.data ?? []}
          loading={users.loading}
          rowKey={(row) => String(row.id)}
          onRowClick={(row) => {
            setEditing(row)
            setForm({
              username: String(row.username),
              fullName: String(row.full_name),
              password: '',
              roleId: Number(row.role_id),
              email: String(row.email ?? ''),
              phone: String(row.phone ?? ''),
              isActive: row.is_active === 1
            })
            setUserOpen(true)
          }}
          empty={<EmptyState title="لا يوجد مستخدمون" />}
          columns={[
            { key: 'username', header: 'اسم المستخدم', render: (row) => <span className="num font-semibold text-slate-700" dir="ltr">{String(row.username)}</span> },
            { key: 'name', header: 'الاسم الكامل', render: (row) => <span className="font-semibold text-slate-800">{String(row.full_name)}{Number(row.id) === user?.id && <span className="mr-2 text-[11.5px] text-brand-600">(أنت)</span>}</span> },
            { key: 'role', header: 'الدور', align: 'center', render: (row) => <Badge tone={row.role_code === 'admin' ? 'violet' : 'blue'}>{String(row.role_name)}</Badge> },
            { key: 'last', header: 'آخر دخول', render: (row) => <span className="num text-[12.5px]">{row.last_login_at ? dateTime(String(row.last_login_at)) : '—'}</span> },
            { key: 'status', header: 'الحالة', align: 'center', render: (row) => (row.is_active === 1 ? <Badge tone="green">نشط</Badge> : <Badge tone="slate">معطّل</Badge>) }
          ]}
        />
      </Card>

      <Card title="الأدوار والصلاحيات" subtitle="حدّد ما يمكن لكل دور الاطلاع عليه أو تنفيذه" noPadding>
        <DataTable
          rows={roles.data ?? []}
          loading={roles.loading}
          rowKey={(row) => row.id}
          onRowClick={(row) => {
            setSelectedRole({ id: row.id, name: row.name, permissions: row.permissions, code: row.code })
            setRoleOpen(true)
          }}
          empty={<EmptyState title="لا توجد أدوار" />}
          columns={[
            { key: 'name', header: 'الدور', render: (row) => <span className="font-semibold text-slate-800">{row.name}</span> },
            { key: 'desc', header: 'الوصف', render: (row) => <span className="text-[12.5px] text-slate-500">{row.description ?? '—'}</span> },
            { key: 'perms', header: 'عدد الصلاحيات', align: 'center', render: (row) => <span className="num">{row.permissions.length}</span> },
            { key: 'users', header: 'عدد المستخدمين', align: 'center', render: (row) => <span className="num">{row.userCount}</span> },
            { key: 'system', header: '', align: 'center', render: (row) => (row.isSystem === 1 ? <Badge tone="slate">أساسي</Badge> : null) }
          ]}
        />
      </Card>

      <Modal
        open={userOpen}
        onClose={() => setUserOpen(false)}
        title={editing ? 'تعديل المستخدم' : 'مستخدم جديد'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setUserOpen(false)}>إلغاء</button>
            <button type="button" className="btn-primary" onClick={() => void saveUser()}>حفظ</button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم المستخدم" required>
            <Input dir="ltr" className="text-right" value={form.username} disabled={Boolean(editing)} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="الاسم الكامل" required>
            <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </Field>
          <Field label={editing ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'} required={!editing} hint="٨ أحرف على الأقل، حروف وأرقام">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="الدور" required>
            <Select value={String(form.roleId)} onChange={(e) => setForm({ ...form, roleId: Number(e.target.value) })}>
              {(roles.data ?? []).map((role) => (
                <option key={role.id} value={String(role.id)}>{role.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="البريد الإلكتروني"><Input dir="ltr" className="text-right" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="الهاتف"><Input dir="ltr" className="text-right" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <Switch checked={form.isActive} onChange={(value) => setForm({ ...form, isActive: value })} label="حساب نشط" description="المستخدم المعطّل لا يستطيع تسجيل الدخول." />
          </div>
        </div>
      </Modal>

      <RolePermissionsModal
        open={roleOpen}
        role={selectedRole}
        onClose={() => setRoleOpen(false)}
        onSaved={() => {
          roles.reload()
          setRoleOpen(false)
        }}
      />

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  )
}

function RolePermissionsModal({
  open,
  role,
  onClose,
  onSaved
}: {
  open: boolean
  role: { id: number; name: string; permissions: Permission[]; code: string } | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const [selected, setSelected] = useState<Permission[]>([])

  useEffect(() => {
    if (role) setSelected(role.permissions)
  }, [role])

  const isAdmin = role?.code === 'admin'

  const toggle = (permission: Permission): void => {
    setSelected((current) => (current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission]))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`صلاحيات: ${role?.name ?? ''}`}
      description={isAdmin ? 'دور مدير النظام له كل الصلاحيات ولا يمكن تعديله.' : 'حدّد الصلاحيات المسموح بها لهذا الدور'}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>إغلاق</button>
          {!isAdmin && (
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                try {
                  await invoke('roles:setPermissions', { roleId: role?.id, permissions: selected })
                  ui.success('تم حفظ الصلاحيات')
                  onSaved()
                } catch (error) {
                  ui.error('تعذّر الحفظ', errorMessage(error))
                }
              }}
            >
              حفظ الصلاحيات
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.label} className="rounded-xl border border-slate-200 p-3">
            <h3 className="mb-2 text-[13px] font-bold text-slate-700">{group.label}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.permissions.map((permission) => (
                <label key={permission} className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]', isAdmin && 'cursor-not-allowed opacity-60', selected.includes(permission) && 'bg-brand-50')}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                    checked={isAdmin || selected.includes(permission)}
                    disabled={isAdmin}
                    onChange={() => toggle(permission)}
                  />
                  <span className="text-slate-700">{PERMISSION_LABELS[permission]}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const ui = useUi()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setError(null)
    if (next !== confirmText) return setError('كلمتا المرور غير متطابقتين.')
    try {
      await invoke('auth:changePassword', { currentPassword: current, newPassword: next })
      ui.success('تم تغيير كلمة المرور')
      setCurrent('')
      setNext('')
      setConfirmText('')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="تغيير كلمة المرور"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()}>حفظ</button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>}
      <div className="space-y-4">
        <Field label="كلمة المرور الحالية" required><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="كلمة المرور الجديدة" required hint="٨ أحرف على الأقل، حروف وأرقام"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="تأكيد كلمة المرور" required><Input type="password" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function AuditTab(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [entityType, setEntityType] = useState('')
  const [search, setSearch] = useState('')
  const { data, loading } = useQuery<{ rows: Record<string, unknown>[]; total: number }>(
    'audit:query',
    { entityType: entityType || undefined, search: search || undefined, page, pageSize: 60 },
    [entityType, search, page]
  )

  const ACTION_LABEL: Record<string, string> = {
    create: 'إنشاء',
    update: 'تعديل',
    delete: 'حذف',
    void: 'إلغاء',
    login: 'تسجيل دخول',
    logout: 'خروج',
    backup: 'نسخ احتياطي',
    restore: 'استعادة',
    import: 'استيراد',
    repair: 'إصلاح بيانات',
    change_password: 'تغيير كلمة مرور',
    deactivate: 'تعطيل',
    issue_materials: 'صرف خامات',
    receive_output: 'استلام إنتاج',
    add_cost: 'إضافة تكلفة',
    complete: 'إقفال',
    cancel: 'إلغاء',
    attach: 'إرفاق ملف',
    detach: 'حذف مرفق'
  }

  const ENTITY_LABEL: Record<string, string> = {
    sale: 'فاتورة بيع',
    purchase: 'فاتورة شراء',
    payment: 'سند',
    expense: 'مصروف',
    party: 'عميل/مورد',
    product: 'منتج',
    production_order: 'أمر إنتاج',
    stock_adjustment: 'تسوية مخزون',
    user: 'مستخدم',
    role: 'دور',
    settings: 'إعدادات',
    backup: 'نسخة احتياطية'
  }

  return (
    <Card title="سجل المراجعة" subtitle="كل عملية مؤثرة في النظام مسجّلة هنا ولا يمكن حذفها" noPadding>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <Input className="w-full max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="ابحث في السجل…" />
        <Select className="h-10 w-48" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1) }}>
          <option value="">كل الأنواع</option>
          {Object.entries(ENTITY_LABEL).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </Select>
      </div>

      <DataTable
        rows={data?.rows ?? []}
        loading={loading}
        rowKey={(row) => String(row.id)}
        compact
        empty={<EmptyState title="لا توجد سجلات" />}
        columns={[
          { key: 'time', header: 'الوقت', width: '170px', render: (row) => <span className="num text-[12.5px]">{dateTime(String(row.created_at))}</span> },
          { key: 'user', header: 'المستخدم', render: (row) => <span className="font-semibold text-slate-700">{String(row.user_name ?? '—')}</span> },
          { key: 'action', header: 'الإجراء', align: 'center', render: (row) => <Badge tone={String(row.severity) === 'critical' ? 'red' : String(row.severity) === 'warning' ? 'amber' : 'slate'}>{ACTION_LABEL[String(row.action)] ?? String(row.action)}</Badge> },
          { key: 'entity', header: 'النوع', render: (row) => ENTITY_LABEL[String(row.entity_type)] ?? String(row.entity_type) },
          { key: 'label', header: 'السجل', render: (row) => <span className="num text-[12.5px] font-semibold text-brand-700">{String(row.entity_label ?? row.entity_id ?? '—')}</span> },
          { key: 'reason', header: 'السبب / ملاحظات', render: (row) => <span className="text-[12.5px] text-slate-600">{String(row.reason ?? '—')}</span> }
        ]}
      />

      <div className="flex items-center justify-between p-3 text-[13px] text-slate-600">
        <span>
          إجمالي السجلات: <span className="num font-semibold">{data?.total ?? 0}</span>
        </span>
        <div className="flex gap-1">
          <button type="button" className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</button>
          <button type="button" className="btn-secondary btn-sm" disabled={(data?.rows.length ?? 0) < 60} onClick={() => setPage(page + 1)}>التالي</button>
        </div>
      </div>
    </Card>
  )
}

function MaintenanceTab(): React.JSX.Element {
  const ui = useUi()
  const { confirm, dialog } = useConfirm()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; issues: { code: string; title: string; detail: string; severity: string; fixable: boolean; count: number }[]; checkedAt: string } | null>(null)
  const stats = useQuery<{ table: string; rows: number }[]>('integrity:stats')
  const logs = useQuery<{ path: string; content: string }>('logs:read')

  const runCheck = async (): Promise<void> => {
    setChecking(true)
    try {
      const outcome = await invoke<typeof result>('integrity:check')
      setResult(outcome)
      if (outcome?.ok) ui.success('البيانات سليمة', 'لم يُعثر على أي مشكلة.')
      else ui.error('توجد مشاكل في البيانات', 'راجع التفاصيل أدناه.')
    } catch (error) {
      ui.error('تعذّر الفحص', errorMessage(error))
    } finally {
      setChecking(false)
    }
  }

  const repair = async (): Promise<void> => {
    const answer = await confirm({
      title: 'إصلاح البيانات',
      message: 'سيعيد النظام احتساب الأرصدة والقيم المخزَّنة من مصادرها الأصلية (القيود والحركات). هذه العملية آمنة ولا تحذف أي بيانات.',
      confirmLabel: 'تشغيل الإصلاح',
      tone: 'primary'
    })
    if (answer === null) return
    try {
      const outcome = await invoke<{ repaired: string[] }>('integrity:repair')
      ui.success('اكتمل الإصلاح', outcome.repaired.join(' · '))
      void runCheck()
      stats.reload()
    } catch (error) {
      ui.error('تعذّر الإصلاح', errorMessage(error))
    }
  }

  const totalRows = (stats.data ?? []).reduce((s, row) => s + row.rows, 0)

  return (
    <div className="space-y-4">
      <Card
        title="فحص سلامة البيانات"
        subtitle="يتحقق من توازن القيود ومطابقة أرصدة المخزون والمبالغ المحصَّلة"
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => void repair()}>
              <Wrench className="h-4 w-4" />
              إصلاح القيم المحسوبة
            </button>
            <button type="button" className="btn-primary" onClick={() => void runCheck()} disabled={checking}>
              {checking ? <Spinner className="h-4 w-4 text-white" /> : <ShieldCheck className="h-4 w-4" />}
              تشغيل الفحص
            </button>
          </>
        }
      >
        {!result ? (
          <p className="py-4 text-center text-[13px] text-slate-500">اضغط «تشغيل الفحص» للتحقق من سلامة البيانات المالية.</p>
        ) : result.ok ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
            <p className="font-bold text-emerald-800">البيانات سليمة تمامًا</p>
            <p className="mt-1 text-[12.5px] text-emerald-700">آخر فحص: {dateTime(result.checkedAt)}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {result.issues.map((issue) => (
              <li key={issue.code} className={cn('rounded-xl border p-3', issue.severity === 'critical' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50')}>
                <div className="flex items-center justify-between gap-3">
                  <span className={cn('font-bold', issue.severity === 'critical' ? 'text-rose-800' : 'text-amber-800')}>{issue.title}</span>
                  <span className="flex items-center gap-2">
                    <span className="num text-[12px] font-semibold text-slate-600">{issue.count}</span>
                    {issue.fixable && <Badge tone="blue">قابل للإصلاح</Badge>}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] text-slate-700">{issue.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="حجم قاعدة البيانات" subtitle={`إجمالي السجلات: ${totalRows.toLocaleString('en-US')}`} noPadding>
        <DataTable
          rows={(stats.data ?? []).filter((row) => row.rows > 0).sort((a, b) => b.rows - a.rows)}
          loading={stats.loading}
          rowKey={(row) => row.table}
          compact
          empty={<EmptyState title="لا توجد بيانات" />}
          columns={[
            { key: 'table', header: 'الجدول', render: (row) => <span className="num text-[12.5px] text-slate-600" dir="ltr">{row.table}</span> },
            { key: 'rows', header: 'عدد السجلات', align: 'left', render: (row) => <span className="num font-semibold">{row.rows.toLocaleString('en-US')}</span> }
          ]}
        />
      </Card>

      <Card
        title="سجل الأخطاء التقني"
        subtitle="للدعم الفني فقط — لا يحتوي على بيانات مالية"
        actions={
          <button type="button" className="btn-secondary btn-sm" onClick={() => void invoke('shell:showInFolder', { path: logs.data?.path ?? '' })}>
            <HardDrive className="h-4 w-4" />
            فتح مجلد السجلات
          </button>
        }
      >
        <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-200" dir="ltr">
          {logs.data?.content || 'لا توجد أخطاء مسجّلة.'}
        </pre>
      </Card>

      {dialog}
    </div>
  )
}
