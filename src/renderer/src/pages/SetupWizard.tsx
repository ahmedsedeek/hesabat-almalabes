import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, Check, CloudUpload, Coins, FileDigit, ShieldCheck, Upload, Warehouse } from 'lucide-react'
import { invoke, errorMessage } from '../lib/api'
import { useSession } from '../store/session'
import { useUi } from '../store/ui'
import { cn, Field, Input, Select, Spinner, Switch } from '../components/ui'

const CURRENCIES = [
  { code: 'EGP', symbol: 'ج.م', name: 'جنيه مصري', decimals: 2 },
  { code: 'SAR', symbol: 'ر.س', name: 'ريال سعودي', decimals: 2 },
  { code: 'AED', symbol: 'د.إ', name: 'درهم إماراتي', decimals: 2 },
  { code: 'KWD', symbol: 'د.ك', name: 'دينار كويتي', decimals: 3 },
  { code: 'QAR', symbol: 'ر.ق', name: 'ريال قطري', decimals: 2 },
  { code: 'JOD', symbol: 'د.أ', name: 'دينار أردني', decimals: 3 },
  { code: 'MAD', symbol: 'د.م', name: 'درهم مغربي', decimals: 2 },
  { code: 'USD', symbol: '$', name: 'دولار أمريكي', decimals: 2 },
  { code: 'TRY', symbol: '₺', name: 'ليرة تركية', decimals: 2 }
]

const STEPS = [
  { key: 'company', label: 'بيانات الشركة', icon: Building2 },
  { key: 'currency', label: 'العملة والضريبة', icon: Coins },
  { key: 'admin', label: 'حساب المدير', icon: ShieldCheck },
  { key: 'numbering', label: 'ترقيم المستندات', icon: FileDigit },
  { key: 'warehouse', label: 'المخزن', icon: Warehouse },
  { key: 'backup', label: 'النسخ الاحتياطي', icon: CloudUpload },
  { key: 'import', label: 'استيراد البيانات', icon: Upload }
]

/** معالج الإعداد الأولي — يعمل مرة واحدة عند أول تشغيل */
export function SetupWizard(): React.JSX.Element {
  const { boot } = useSession()
  const ui = useUi()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [company, setCompany] = useState({ name: '', legalName: '', phone: '', email: '', address: '', city: '', taxNumber: '', commercialReg: '', invoiceFooter: 'شكرًا لتعاملكم معنا', bankDetails: '' })
  const [currency, setCurrency] = useState(CURRENCIES[0])
  const [tax, setTax] = useState({ enabled: false, defaultRate: 14, label: 'ضريبة القيمة المضافة', inclusive: false })
  const [admin, setAdmin] = useState({ username: 'admin', fullName: '', password: '', confirm: '' })
  const [numbering, setNumbering] = useState([
    { docType: 'sale', label: 'فواتير البيع', prefix: 'INV', padding: 6, includeYear: true, nextNumber: 1 },
    { docType: 'purchase', label: 'فواتير الشراء', prefix: 'PUR', padding: 6, includeYear: true, nextNumber: 1 },
    { docType: 'payment_in', label: 'سندات القبض', prefix: 'REC', padding: 6, includeYear: true, nextNumber: 1 },
    { docType: 'payment_out', label: 'سندات الصرف', prefix: 'PAY', padding: 6, includeYear: true, nextNumber: 1 },
    { docType: 'production_order', label: 'أوامر الإنتاج', prefix: 'PROD', padding: 6, includeYear: true, nextNumber: 1 }
  ])
  const [warehouse, setWarehouse] = useState({ code: 'MAIN', name: 'المخزن الرئيسي', address: '' })
  const [backup, setBackup] = useState({ localPath: '', frequency: 'daily' as 'daily' | 'weekly' | 'manual', cloudEnabled: false, cloudFolder: '' })

  const validateStep = (): boolean => {
    const next: Record<string, string> = {}
    if (step === 0 && !company.name.trim()) next.companyName = 'اسم الشركة مطلوب.'
    if (step === 2) {
      if (!admin.username.trim()) next.username = 'اسم المستخدم مطلوب.'
      if (!admin.fullName.trim()) next.fullName = 'الاسم الكامل مطلوب.'
      if (admin.password.length < 8) next.password = 'كلمة المرور يجب ألا تقل عن ٨ أحرف.'
      else if (!/[0-9]/.test(admin.password) || !/[A-Za-z؀-ۿ]/.test(admin.password)) {
        next.password = 'كلمة المرور يجب أن تحتوي على حروف وأرقام.'
      }
      if (admin.password !== admin.confirm) next.confirm = 'كلمتا المرور غير متطابقتين.'
    }
    if (step === 4 && !warehouse.name.trim()) next.warehouseName = 'اسم المخزن مطلوب.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const finish = async (): Promise<void> => {
    if (!validateStep()) return
    setSaving(true)
    try {
      await invoke('setup:run', {
        company,
        currency: { code: currency.code, symbol: currency.symbol, name: currency.name, decimals: currency.decimals },
        tax,
        admin: { username: admin.username.trim(), fullName: admin.fullName.trim(), password: admin.password },
        numbering: numbering.map(({ docType, prefix, padding, includeYear, nextNumber }) => ({ docType, prefix, padding, includeYear, nextNumber })),
        warehouse,
        backup: { ...backup, localEnabled: true, encrypt: true, retentionCount: 14, cloudProvider: backup.cloudEnabled ? 'folder' : 'none' }
      })
      setDone(true)
    } catch (error) {
      ui.error('تعذّر إكمال الإعداد', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-xl rounded-2xl bg-white p-8 text-center shadow-xl">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <Check className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">تم إعداد النظام بنجاح</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            يمكنك الآن تسجيل الدخول باسم المستخدم <strong>{admin.username}</strong> والبدء في إدخال بياناتك.
            <br />
            ستُؤخذ نسخة احتياطية تلقائية يوميًا، ويمكنك ضبط ذلك من الإعدادات في أي وقت.
          </p>
          <button type="button" className="btn-primary mt-6 w-full" onClick={() => void boot()}>
            الانتقال إلى تسجيل الدخول
          </button>
        </div>
      </div>
    )
  }

  const StepIcon = STEPS[step].icon

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-800">إعداد النظام لأول مرة</h1>
          <p className="mt-1 text-sm text-slate-500">بضع خطوات بسيطة وسيكون النظام جاهزًا للعمل</p>
        </header>

        <ol className="mb-6 flex flex-wrap items-center justify-center gap-1.5">
          {STEPS.map((item, index) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => index < step && setStep(index)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
                  index === step ? 'bg-brand-600 text-white' : index < step ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-slate-400'
                )}
              >
                {index < step ? <Check className="h-3.5 w-3.5" /> : <item.icon className="h-3.5 w-3.5" />}
                {item.label}
              </button>
            </li>
          ))}
        </ol>

        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="rounded-xl bg-brand-50 p-2.5 text-brand-600">
              <StepIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">{STEPS[step].label}</h2>
              <p className="text-[12.5px] text-slate-500">
                الخطوة {step + 1} من {STEPS.length}
              </p>
            </div>
          </div>

          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم الشركة التجاري" required error={errors.companyName} className="sm:col-span-2">
                <Input autoFocus value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} placeholder="مثال: مصنع النور للملابس الجاهزة" />
              </Field>
              <Field label="الاسم القانوني"><Input value={company.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })} /></Field>
              <Field label="الهاتف"><Input dir="ltr" className="text-right" value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></Field>
              <Field label="البريد الإلكتروني"><Input dir="ltr" className="text-right" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} /></Field>
              <Field label="المدينة"><Input value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} /></Field>
              <Field label="العنوان" className="sm:col-span-2"><Input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} /></Field>
              <Field label="الرقم الضريبي"><Input dir="ltr" className="text-right" value={company.taxNumber} onChange={(e) => setCompany({ ...company, taxNumber: e.target.value })} /></Field>
              <Field label="السجل التجاري"><Input dir="ltr" className="text-right" value={company.commercialReg} onChange={(e) => setCompany({ ...company, commercialReg: e.target.value })} /></Field>
              <Field label="تذييل الفاتورة" hint="نص يظهر أسفل كل فاتورة مطبوعة" className="sm:col-span-2">
                <Input value={company.invoiceFooter} onChange={(e) => setCompany({ ...company, invoiceFooter: e.target.value })} />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <Field label="عملة النظام" required hint="تُستخدم في جميع الفواتير والتقارير. يمكن تغييرها لاحقًا من الإعدادات.">
                <Select
                  value={currency.code}
                  onChange={(e) => setCurrency(CURRENCIES.find((c) => c.code === e.target.value) ?? CURRENCIES[0])}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.symbol})
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="rounded-xl border border-slate-200 p-4">
                <Switch
                  checked={tax.enabled}
                  onChange={(value) => setTax({ ...tax, enabled: value })}
                  label="تفعيل الضريبة على الفواتير"
                  description="فعّل هذا الخيار إذا كنت مسجّلًا ضريبيًا وتُصدر فواتير ضريبية."
                />
                {tax.enabled && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="اسم الضريبة">
                      <Input value={tax.label} onChange={(e) => setTax({ ...tax, label: e.target.value })} />
                    </Field>
                    <Field label="النسبة الافتراضية (٪)">
                      <Input type="number" dir="ltr" className="text-left" value={tax.defaultRate} onChange={(e) => setTax({ ...tax, defaultRate: Number(e.target.value) })} />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800">
                هذا الحساب له صلاحيات كاملة على النظام. احتفظ بكلمة المرور في مكان آمن — لا يمكن استرجاعها إذا فُقدت.
              </div>
              <Field label="اسم المستخدم" required error={errors.username}>
                <Input dir="ltr" className="text-right" value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value })} />
              </Field>
              <Field label="الاسم الكامل" required error={errors.fullName}>
                <Input value={admin.fullName} onChange={(e) => setAdmin({ ...admin, fullName: e.target.value })} placeholder="مثال: محمد أحمد" />
              </Field>
              <Field label="كلمة المرور" required error={errors.password} hint="٨ أحرف على الأقل، تحتوي على حروف وأرقام">
                <Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
              </Field>
              <Field label="تأكيد كلمة المرور" required error={errors.confirm}>
                <Input type="password" value={admin.confirm} onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })} />
              </Field>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-[13px] text-slate-500">
                حدّد بادئة وعدد خانات كل نوع مستند. مثال: <span className="num font-semibold">INV-2026-000001</span>
              </p>
              {numbering.map((seq, index) => (
                <div key={seq.docType} className="grid items-end gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-4">
                  <div className="text-sm font-semibold text-slate-700">{seq.label}</div>
                  <Field label="البادئة">
                    <Input dir="ltr" className="text-right" value={seq.prefix} onChange={(e) => setNumbering(numbering.map((s, i) => (i === index ? { ...s, prefix: e.target.value.toUpperCase() } : s)))} />
                  </Field>
                  <Field label="عدد الخانات">
                    <Input type="number" min={1} max={10} dir="ltr" className="text-left" value={seq.padding} onChange={(e) => setNumbering(numbering.map((s, i) => (i === index ? { ...s, padding: Number(e.target.value) } : s)))} />
                  </Field>
                  <div>
                    <p className="label">معاينة</p>
                    <p className="num rounded-lg bg-slate-50 px-3 py-2 text-[13px] font-bold text-slate-700">
                      {[seq.prefix, seq.includeYear ? new Date().getFullYear() : null, String(seq.nextNumber).padStart(seq.padding, '0')].filter(Boolean).join('-')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <p className="sm:col-span-2 text-[13px] text-slate-500">
                المخزن هو المكان الذي تُحفظ فيه البضاعة. يمكنك إضافة مخازن أخرى لاحقًا من الإعدادات.
              </p>
              <Field label="كود المخزن"><Input dir="ltr" className="text-right" value={warehouse.code} onChange={(e) => setWarehouse({ ...warehouse, code: e.target.value.toUpperCase() })} /></Field>
              <Field label="اسم المخزن" required error={errors.warehouseName}>
                <Input value={warehouse.name} onChange={(e) => setWarehouse({ ...warehouse, name: e.target.value })} />
              </Field>
              <Field label="العنوان" className="sm:col-span-2"><Input value={warehouse.address} onChange={(e) => setWarehouse({ ...warehouse, address: e.target.value })} /></Field>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-brand-900">
                النظام يأخذ نسخة احتياطية مشفّرة تلقائيًا ويحتفظ بآخر ١٤ نسخة. البيانات تبقى على جهازك،
                والنسخة تُشفَّر قبل نسخها لأي مجلد سحابي.
              </div>

              <Field label="مجلد حفظ النسخ الاحتياطية" hint="اتركه فارغًا لاستخدام المجلد الافتراضي داخل بيانات التطبيق">
                <div className="flex gap-2">
                  <Input readOnly value={backup.localPath} placeholder="المجلد الافتراضي" />
                  <button
                    type="button"
                    className="btn-secondary shrink-0"
                    onClick={async () => {
                      const folder = await invoke<string | null>('dialog:openFolder', { title: 'اختر مجلد النسخ الاحتياطية' })
                      if (folder) setBackup({ ...backup, localPath: folder })
                    }}
                  >
                    اختيار
                  </button>
                </div>
              </Field>

              <Field label="تكرار النسخ التلقائي">
                <Select value={backup.frequency} onChange={(e) => setBackup({ ...backup, frequency: e.target.value as 'daily' })}>
                  <option value="daily">يوميًا</option>
                  <option value="weekly">أسبوعيًا</option>
                  <option value="manual">يدويًا فقط</option>
                </Select>
              </Field>

              <div className="rounded-xl border border-slate-200 p-4">
                <Switch
                  checked={backup.cloudEnabled}
                  onChange={(value) => setBackup({ ...backup, cloudEnabled: value })}
                  label="نسخ احتياطي سحابي"
                  description="انسخ النسخة المشفّرة تلقائيًا إلى مجلد Google Drive أو OneDrive أو Dropbox المثبَّت على جهازك — مجاني تمامًا."
                />
                {backup.cloudEnabled && (
                  <Field label="مجلد المزامنة السحابية" className="mt-4">
                    <div className="flex gap-2">
                      <Input readOnly value={backup.cloudFolder} placeholder="اختر مجلدًا داخل Google Drive أو OneDrive…" />
                      <button
                        type="button"
                        className="btn-secondary shrink-0"
                        onClick={async () => {
                          const folder = await invoke<string | null>('dialog:openFolder', { title: 'اختر مجلد المزامنة السحابية' })
                          if (folder) setBackup({ ...backup, cloudFolder: folder })
                        }}
                      >
                        اختيار
                      </button>
                    </div>
                  </Field>
                )}
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <p className="text-[13px] leading-relaxed text-slate-600">
                إذا كان لديك بيانات جاهزة في ملفات Excel أو CSV — عملاء، موردين، منتجات، أرصدة افتتاحية —
                فيمكنك استيرادها بعد تسجيل الدخول مباشرة من: <strong>الإعدادات ← استيراد البيانات</strong>.
              </p>
              <ul className="space-y-2 text-[13px] text-slate-600">
                {[
                  'حمّل قالب Excel جاهزًا بالأعمدة المطلوبة لكل نوع بيانات.',
                  'سيعرض النظام معاينة كاملة ويتحقق من كل صف قبل الاستيراد.',
                  'الصفوف التي بها أخطاء تُعرض لك مع سبب الخطأ ولا تُستورد.'
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    {line}
                  </li>
                ))}
              </ul>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] text-emerald-800">
                كل شيء جاهز. اضغط «إنهاء الإعداد» لإنشاء حسابك وبدء استخدام النظام.
              </div>
            </div>
          )}

          <footer className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
            <button type="button" className="btn-secondary" disabled={step === 0 || saving} onClick={() => setStep(step - 1)}>
              <ArrowRight className="h-4 w-4" />
              السابق
            </button>
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (validateStep()) setStep(step + 1)
                }}
              >
                التالي
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void finish()}>
                {saving ? <Spinner className="h-4 w-4 text-white" /> : <Check className="h-4 w-4" />}
                إنهاء الإعداد
              </button>
            )}
          </footer>
        </div>
      </div>
    </div>
  )
}
