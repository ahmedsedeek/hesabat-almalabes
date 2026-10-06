import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Boxes, CheckCircle2, CreditCard, DatabaseBackup, FileBarChart, Keyboard,
  Package, Receipt, ShieldCheck, ShoppingCart, Store, Truck, Upload, Users, Wrench
} from 'lucide-react'
import { Badge, Card, Tabs, cn } from '../components/ui'
import { PageHeader } from '../components/common/page'
import { useSession } from '../store/session'

interface Step {
  title: string
  body: string
  where?: string
  route?: string
  tip?: string
}

interface Chapter {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  intro: string
  steps: Step[]
}

const CHAPTERS: Chapter[] = [
  {
    key: 'start',
    label: 'ابدأ من هنا',
    icon: CheckCircle2,
    intro:
      'قبل تسجيل أي عملية، أدخل بياناتك الأساسية بهذا الترتيب. كل خطوة تعتمد على التي قبلها، ' +
      'وبعد إتمامها يصبح النظام جاهزًا لتسجيل عملك اليومي.',
    steps: [
      {
        title: '١ — أدخل العملاء والموردين والمصانع',
        body:
          'لكل طرف أدخل اسمه وهاتفه، وأهم شيء: «الرصيد الافتتاحي» وهو المبلغ المستحق له أو عليه اليوم. ' +
          'إن كان الحساب صفرًا اتركه صفرًا.',
        where: 'العملاء · الموردون · المصانع',
        route: '/customers',
        tip: 'لديك قائمة في Excel؟ استوردها دفعة واحدة من الإعدادات ← استيراد البيانات.'
      },
      {
        title: '٢ — أدخل المنتجات والخامات',
        body:
          'المنتج الجاهز (قميص، بنطلون) والخامة (قماش، أزرار، سحابات) كلاهما يُدخل هنا مع تحديد النوع. ' +
          'للملابس: اكتب المقاسات والألوان واضغط «توليد التركيبات» فيُنشئ النظام كل الاحتمالات تلقائيًا.',
        where: 'المنتجات ← منتج جديد',
        route: '/products',
        tip: 'حدّد «حد إعادة الطلب» لكل صنف لينبّهك النظام قبل نفاده.'
      },
      {
        title: '٣ — أدخل أرصدة المخزون الحالية',
        body:
          'سجّل الكميات الموجودة فعلًا في مخزنك الآن مع تكلفة الوحدة. اختر نوع التسوية «رصيد افتتاحي». ' +
          'التكلفة التي تدخلها هنا هي أساس حساب أرباحك، فاحرص على دقتها.',
        where: 'المخزون ← تسوية جرد',
        route: '/inventory'
      },
      {
        title: '٤ — أدخل النقدية ورأس المال',
        body: 'سجّل ما لديك في الصندوق والبنك اليوم عبر حركة «إيداع». بعدها يتتبّع النظام نقديتك تلقائيًا مع كل عملية.',
        where: 'الخزينة والبنوك ← حركة خزينة',
        route: '/treasury'
      }
    ]
  },
  {
    key: 'daily',
    label: 'العمل اليومي',
    icon: ShoppingCart,
    intro: 'هذه العمليات الخمس تغطي أكثر من ٩٠٪ من استخدامك اليومي للنظام.',
    steps: [
      {
        title: 'بيع بضاعة',
        body:
          'اختر قناة البيع (جملة / تجزئة / أونلاين) ثم العميل، وابحث عن الصنف بالاسم أو امسح الباركود واضغط Enter. ' +
          'للبيع النقدي فعّل «تحصيل مبلغ الآن»، وللبيع الآجل اتركه مغلقًا. ' +
          'يخصم النظام المخزون ويحسب تكلفة البضاعة المباعة ويزيد رصيد العميل في خطوة واحدة.',
        where: 'المبيعات ← فاتورة بيع جديدة',
        route: '/sales/new',
        tip: 'النظام يمنعك من بيع كمية أكبر من رصيدك ويخبرك بالمتاح فعلًا.'
      },
      {
        title: 'شراء بضاعة أو خامات',
        body:
          'اختر «بضاعة جاهزة» أو «خامات ومستلزمات». أدخل الشحن والتكاليف الإضافية في الملخص — ' +
          'سيوزّعها النظام على الأصناف فتظهر لك التكلفة النهائية الحقيقية لكل صنف.',
        where: 'المشتريات ← فاتورة شراء جديدة',
        route: '/purchases/new',
        tip: 'أدخل رقم فاتورة المورد ليمنع النظام تسجيلها مرتين بالخطأ.'
      },
      {
        title: 'تصنيع لدى مصنع',
        body:
          'أنشئ أمر إنتاج، ثم «صرف خامات» فتخرج من مخزنك إلى المصنع، ثم «إضافة تكلفة» لأجر التصنيع، ' +
          'وأخيرًا «استلام إنتاج». يحسب النظام تكلفة القطعة = (الخامات + أجر التصنيع + التكاليف الأخرى) ÷ الكمية.',
        where: 'التصنيع ← أمر إنتاج جديد',
        route: '/production',
        tip: 'الخامات المصروفة للمصنع تخرج من المخزن فورًا فلا يمكن استخدامها في عملية أخرى.'
      },
      {
        title: 'تحصيل ودفع',
        body:
          'من صفحة الفاتورة مباشرة، أو من شاشة المقبوضات والمدفوعات. ' +
          'يمكن توزيع المبلغ على عدة فواتير، أو اضغط «توزيع تلقائي» ليبدأ بالأقدم. ' +
          'المبلغ غير الموزَّع يُسجَّل «على الحساب» ويُخفّض الرصيد.',
        where: 'المقبوضات والمدفوعات',
        route: '/payments'
      },
      {
        title: 'تسجيل مصروف',
        body: 'اختر الفئة والمبلغ وطريقة الدفع. المصروفات تُخصم من صافي الربح وتظهر موزّعة على الفئات في التقارير.',
        where: 'المصروفات ← تسجيل مصروف',
        route: '/expenses'
      }
    ]
  },
  {
    key: 'retail',
    label: 'البيع أونلاين والتوصيل',
    icon: Truck,
    intro:
      'إن كنت تبيع للمستهلك مباشرة ويُشحن الطلب، فالنظام يفرّق بين مبلغين مختلفين تمامًا — ' +
      'وهذا الفرق هو ما يجعل أرباحك دقيقة.',
    steps: [
      {
        title: 'الشحن المحصَّل ≠ تكلفة التوصيل',
        body:
          '«الشحن المحصَّل من العميل» مبلغ تأخذه أنت ⇐ إيراد. ' +
          '«تكلفة التوصيل علينا» مبلغ تدفعه لشركة الشحن ⇐ مصروف. ' +
          'إن تحمّل العميل الشحن املأ الحقلين، وإن كان الشحن مجانيًا املأ الثاني فقط واترك الأول صفرًا.',
        where: 'المبيعات ← فاتورة بيع ← بطاقة الشحن والتوصيل',
        route: '/sales/new',
        tip: 'تكلفة التوصيل لا تُضاف لفاتورة العميل — تظهر كمصروف ويطرحها النظام من صافي ربح الطلب.'
      },
      {
        title: 'تكلفة التوصيل: نقدًا أو على حساب شركة الشحن',
        body:
          'إن دفعتها فورًا اختر الحساب الذي خرجت منه. وإن كانت آجلة اختر شركة الشحن فيتراكم المستحق عليها ' +
          'وتسدّده لاحقًا بسند صرف واحد.',
        where: 'المبيعات ← فاتورة بيع',
        tip: 'أضف شركة الشحن كـ «مورد» لتتابع حسابها معها.'
      },
      {
        title: 'المرتجعات: صالحة أم تالفة؟',
        body:
          'في البيع للمستهلك كثير من المرتجعات تعود غير صالحة. لكل صنف في شاشة المردود اضغط على الشارة ' +
          'لتحدّد «صالح — يعود للمخزون» أو «تالف — لا يعود». التالف لا يدخل المخزون وتُحمَّل تكلفته على التلف.',
        where: 'صفحة الفاتورة ← تسجيل مردود',
        tip: 'يمكن خلط أصناف صالحة وأخرى تالفة في مردود واحد.'
      },
      {
        title: 'ردّ الشحن وتكلفة الإرجاع',
        body:
          'في نفس الشاشة: «ردّ الشحن المحصَّل» إن اتفقت على إعادته للعميل، و«تكلفة إرجاع الشحنة» ' +
          'إن دفعت لشركة الشحن لإعادة البضاعة. الاثنان يظهران في حساباتك بشكل صحيح.',
        where: 'صفحة الفاتورة ← تسجيل مردود'
      },
      {
        title: 'تابع ربح كل قناة',
        body:
          'في التقارير اختر «تقرير المبيعات ← حسب قناة البيع» لترى الجملة والتجزئة والأونلاين جنبًا إلى جنب ' +
          'مع صافي ربح كل قناة بعد خصم التكلفة والتوصيل.',
        where: 'التقارير ← تقرير المبيعات',
        route: '/reports/sales'
      }
    ]
  },
  {
    key: 'bulk',
    label: 'إدخال البيانات دفعة واحدة',
    icon: Upload,
    intro:
      'بدل الإدخال اليدوي يمكنك رفع بياناتك من ملف Excel أو CSV — عملاء، موردين، منتجات، ' +
      'أرصدة مخزون، وحتى فواتير بيع كاملة.',
    steps: [
      {
        title: '١ — حمّل القالب الجاهز',
        body: 'اختر نوع البيانات ثم اضغط «تحميل قالب Excel». القالب يحتوي على الأعمدة المطلوبة بأسمائها العربية.',
        where: 'الإعدادات ← استيراد البيانات',
        route: '/settings/import'
      },
      {
        title: '٢ — املأ الملف',
        body:
          'لفواتير البيع: كل سطر = صنف واحد، وكرّر رقم الفاتورة في أسطر الفاتورة الواحدة ليجمعها النظام معًا. ' +
          'الشحن وتكلفة التوصيل والمبلغ المحصَّل تُكتب مرة واحدة لكل فاتورة.',
        where: 'ملف Excel',
        tip: 'العميل غير الموجود يُنشأ تلقائيًا باسمه ورقم هاتفه.'
      },
      {
        title: '٣ — عاين وتحقّق',
        body:
          'بعد اختيار الملف يعرض النظام كل الصفوف ويؤشّر الصالح والخاطئ مع سبب كل خطأ. ' +
          'لا يُستورد أي صف غير صالح.',
        where: 'الإعدادات ← استيراد البيانات'
      },
      {
        title: '٤ — استورد',
        body:
          'فواتير البيع المستوردة تُعامَل تمامًا كالمُدخلة يدويًا: تُخصم من المخزون، وتُحتسب تكلفتها، ' +
          'وتُرحَّل قيودها، وتظهر في كل التقارير.',
        where: 'الإعدادات ← استيراد البيانات',
        tip: 'خذ نسخة احتياطية قبل استيراد دفعة كبيرة.'
      }
    ]
  },
  {
    key: 'reports',
    label: 'اقرأ أرقامك',
    icon: FileBarChart,
    intro: 'لوحة المعلومات تعطيك الصورة في ثوانٍ، والتقارير تعطيك التفاصيل.',
    steps: [
      {
        title: 'لوحة المعلومات',
        body:
          'أول شاشة بعد الدخول. اختر الفترة من الأزرار أعلى الشاشة. ' +
          'البطاقات تعرض المبيعات ومجمل الربح وصافي الربح والنقدية والمستحقات وقيمة المخزون، ' +
          'وتحتها تنبيهات تحتاج إجراءً منك.',
        where: 'لوحة المعلومات',
        route: '/'
      },
      {
        title: 'الأرباح والخسائر',
        body:
          'الإيرادات ناقص تكلفة البضاعة المباعة = مجمل الربح، ناقص المصروفات = صافي الربح. ' +
          'كل رقم مُشتقّ من معاملاتك الفعلية، لا يوجد رقم مُدخل يدويًا.',
        where: 'التقارير ← الأرباح والخسائر',
        route: '/reports/profit'
      },
      {
        title: 'ربحية المنتجات',
        body: 'يخبرك أي صنف يكسب فعلًا: الإيراد والتكلفة والربح وهامشه لكل صنف. استخدمه لتسعير أصنافك.',
        where: 'التقارير ← ربحية المنتجات',
        route: '/reports/profitability'
      },
      {
        title: 'أعمار الديون',
        body: 'يصنّف المستحق على كل عميل حسب عمر الدين. راجعه أسبوعيًا واتصل بالمتأخرين.',
        where: 'التقارير ← أعمار الذمم المدينة',
        route: '/reports/receivables'
      },
      {
        title: 'كشف حساب عميل',
        body:
          'من صفحة العميل. يعرض الرصيد الافتتاحي وكل فاتورة ودفعة والرصيد الجاري. ' +
          'احفظه PDF عربيًا جاهزًا للإرسال عبر واتساب.',
        where: 'العملاء ← اختر العميل ← كشف الحساب',
        route: '/customers'
      }
    ]
  },
  {
    key: 'safety',
    label: 'حماية بياناتك',
    icon: ShieldCheck,
    intro: 'بياناتك المالية محفوظة على جهازك. هذه القواعد تحميها من الضياع والخطأ.',
    steps: [
      {
        title: 'لا شيء يُحذف',
        body:
          'المعاملات المالية لا تُحذف نهائيًا. الإلغاء يطلب منك سببًا، ويُنشئ قيدًا عكسيًا، ' +
          'ويبقي المستند في السجل بحالة «ملغى» باسمك ووقت الإلغاء.',
        where: 'أي فاتورة أو سند'
      },
      {
        title: 'سجل المراجعة',
        body: 'كل عملية مؤثرة مسجّلة: من نفّذها ومتى وماذا تغيّر ولماذا. أنشئ حسابًا لكل موظف ليكون السجل ذا قيمة.',
        where: 'الإعدادات ← سجل المراجعة',
        route: '/settings/audit'
      },
      {
        title: 'النسخ الاحتياطي',
        body:
          'النظام يأخذ نسخة مشفّرة يوميًا تلقائيًا. فعّل النسخ السحابي واختر مجلد Google Drive أو OneDrive ' +
          'على جهازك — مجاني، والنسخة تُشفَّر قبل أن تغادر الجهاز.',
        where: 'الإعدادات ← النسخ الاحتياطي',
        route: '/settings/backup',
        tip: 'احفظ «مفتاح الاستعادة» في مكان آمن خارج الجهاز — بدونه لا تُفتح النسخ المشفّرة.'
      },
      {
        title: 'فحص سلامة البيانات',
        body:
          'يتأكد أن كل قيد متوازن وأن أرصدة المخزون تطابق حركاتها. شغّله شهريًا، ' +
          'وزر «الإصلاح» يعيد احتساب القيم من مصادرها دون حذف أي بيانات.',
        where: 'الإعدادات ← الصيانة',
        route: '/settings/maintenance'
      }
    ]
  }
]

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl / ⌘ + K', action: 'بحث سريع في كل شيء: عميل، مورد، منتج، فاتورة، سند' },
  { keys: 'Ctrl / ⌘ + N', action: 'فاتورة بيع جديدة' },
  { keys: 'Ctrl / ⌘ + Shift + N', action: 'فاتورة شراء جديدة' },
  { keys: 'Ctrl / ⌘ + R', action: 'سند قبض جديد' },
  { keys: 'Ctrl / ⌘ + 1 … 9', action: 'التنقل السريع بين الشاشات' },
  { keys: 'Ctrl / ⌘ + ,', action: 'الإعدادات' },
  { keys: 'Enter', action: 'في شاشات الفواتير: إضافة الصنف المحدد مباشرة' }
]

const MONTHLY: string[] = [
  'راجع «أعمار الذمم المدينة» واتصل بالعملاء المتأخرين.',
  'اطبع «الأرباح والخسائر» للشهر وقارنها بالشهر السابق.',
  'راجع «ربحية المنتجات» وأعد تسعير الأصناف ضعيفة الهامش.',
  'اعمل جردًا فعليًا وسجّل الفروقات من المخزون ← تسوية جرد.',
  'شغّل فحص سلامة البيانات من الإعدادات ← الصيانة.',
  'تأكد أن آخر نسخة احتياطية حديثة ومرفوعة للمجلد السحابي.'
]

export function HelpPage(): React.JSX.Element {
  const { info, settings } = useSession()
  const navigate = useNavigate()
  const [chapter, setChapter] = useState('start')
  const active = CHAPTERS.find((c) => c.key === chapter) ?? CHAPTERS[0]

  return (
    <div>
      <PageHeader
        title="دليل الاستخدام"
        subtitle="شرح عملي خطوة بخطوة — ابدأ من الفصل الأول إن كنت تستخدم النظام لأول مرة"
      />

      <div className="mb-4 overflow-x-auto">
        <Tabs
          tabs={CHAPTERS.map((c) => ({ key: c.key, label: c.label, icon: <c.icon className="h-4 w-4" /> }))}
          active={chapter}
          onChange={setChapter}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr,20rem]">
        <div className="space-y-3">
          <Card>
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-brand-50 p-2.5 text-brand-600">
                <active.icon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-800">{active.label}</h2>
                <p className="mt-1 text-[13.5px] leading-relaxed text-slate-600">{active.intro}</p>
              </div>
            </div>
          </Card>

          {active.steps.map((step, index) => (
            <Card key={step.title}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[13px] font-bold text-white">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-slate-800">{step.title}</h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-slate-600">{step.body}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {step.where && (
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-600">
                        مكانه: {step.where}
                      </span>
                    )}
                    {step.route && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => navigate(step.route as string)}
                      >
                        افتح الشاشة
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {step.tip && (
                    <p className="mt-3 rounded-lg border-r-[3px] border-amber-400 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900">
                      💡 {step.tip}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <Card
            title={
              <span className="flex items-center gap-2">
                <Keyboard className="h-4 w-4 text-brand-600" />
                اختصارات تسرّع عملك
              </span>
            }
          >
            <ul className="space-y-2">
              {SHORTCUTS.map((shortcut) => (
                <li key={shortcut.keys} className="flex items-start justify-between gap-3">
                  <span className="text-[12.5px] leading-relaxed text-slate-600">{shortcut.action}</span>
                  <kbd className="num shrink-0 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                    {shortcut.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="روتين شهري مقترح">
            <ol className="space-y-2">
              {MONTHLY.map((item, index) => (
                <li key={item} className="flex gap-2 text-[12.5px] leading-relaxed text-slate-600">
                  <span className="num shrink-0 font-bold text-brand-600">{index + 1}.</span>
                  {item}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="أيقونات الشاشات">
            <ul className="grid grid-cols-2 gap-2 text-[12.5px]">
              {[
                { icon: Users, label: 'العملاء' },
                { icon: Store, label: 'المشتريات' },
                { icon: Package, label: 'المنتجات' },
                { icon: Boxes, label: 'المخزون' },
                { icon: Wrench, label: 'التصنيع' },
                { icon: CreditCard, label: 'المقبوضات' },
                { icon: Receipt, label: 'المصروفات' },
                { icon: DatabaseBackup, label: 'النسخ الاحتياطي' }
              ].map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-slate-600">
                  <item.icon className="h-4 w-4 text-slate-400" />
                  {item.label}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="معلومات النظام">
            <dl className="space-y-2 text-[12.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">الشركة</dt>
                <dd className="font-semibold text-slate-700">{settings?.company.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">إصدار التطبيق</dt>
                <dd className="num font-semibold">{info?.version}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">نظام التشغيل</dt>
                <dd className="font-semibold">
                  {info?.platform === 'darwin' ? 'macOS' : info?.platform === 'win32' ? 'Windows' : info?.platform}
                </dd>
              </div>
              <div className="pt-1">
                <dt className="mb-1 text-slate-500">مجلد النسخ الاحتياطية</dt>
                <dd className="break-all rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600" dir="ltr">
                  {info?.paths.backups}
                </dd>
              </div>
            </dl>
            <p className={cn('mt-3 rounded-lg px-3 py-2 text-[12px]', 'bg-emerald-50 text-emerald-800')}>
              <Badge tone="green">تذكير</Badge>{' '}
              بياناتك محفوظة على هذا الجهاز فقط. احتفظ دائمًا بنسخة احتياطية خارجه.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
