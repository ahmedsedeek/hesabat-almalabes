import type { AccountType } from '@shared/types'

/**
 * المفاتيح الثابتة للحسابات الأساسية.
 * الشيفرة لا تشير إلى الحسابات برقمها أو اسمها بل بهذه المفاتيح،
 * حتى يستطيع المستخدم إعادة تسمية الحسابات أو ترقيمها دون كسر المنطق المحاسبي.
 */
export const ACC = {
  CASH: 'cash',
  BANK: 'bank',
  RECEIVABLE: 'receivable',
  INVENTORY_FINISHED: 'inventory_finished',
  INVENTORY_RAW: 'inventory_raw',
  WIP_FACTORY: 'wip_factory',
  TAX_INPUT: 'tax_input',
  PAYABLE: 'payable',
  FACTORY_PAYABLE: 'factory_payable',
  TAX_OUTPUT: 'tax_output',
  CAPITAL: 'capital',
  RETAINED_EARNINGS: 'retained_earnings',
  OPENING_BALANCE_EQUITY: 'opening_balance_equity',
  SALES_REVENUE: 'sales_revenue',
  SALES_RETURNS: 'sales_returns',
  SALES_DISCOUNTS: 'sales_discounts',
  SHIPPING_REVENUE: 'shipping_revenue',
  COGS: 'cogs',
  INVENTORY_ADJUSTMENT: 'inventory_adjustment',
  PRODUCTION_VARIANCE: 'production_variance',
  PURCHASE_DISCOUNTS: 'purchase_discounts',
  DELIVERY_EXPENSE: 'delivery_expense',
  EXPENSE_ROOT: 'expense_root',
  EXPENSE_OTHER: 'expense_other'
} as const

export type SystemAccountKey = (typeof ACC)[keyof typeof ACC]

export interface ChartNode {
  code: string
  name: string
  nameEn: string
  type: AccountType
  subtype?: string
  systemKey?: string
  isGroup?: boolean
  children?: ChartNode[]
}

/** شجرة الحسابات الافتراضية — عربية أولًا مع أسماء إنجليزية للتقارير المستقبلية */
export const DEFAULT_CHART: ChartNode[] = [
  {
    code: '1000', name: 'الأصول', nameEn: 'Assets', type: 'asset', isGroup: true,
    children: [
      {
        code: '1100', name: 'النقدية والبنوك', nameEn: 'Cash and Banks', type: 'asset', isGroup: true,
        children: [
          { code: '1110', name: 'الصندوق', nameEn: 'Cash on Hand', type: 'asset', subtype: 'cash', systemKey: ACC.CASH },
          { code: '1120', name: 'البنك', nameEn: 'Bank Account', type: 'asset', subtype: 'bank', systemKey: ACC.BANK }
        ]
      },
      { code: '1200', name: 'ذمم العملاء', nameEn: 'Accounts Receivable', type: 'asset', subtype: 'receivable', systemKey: ACC.RECEIVABLE },
      { code: '1250', name: 'ضريبة مشتريات مستحقة الاسترداد', nameEn: 'Input Tax', type: 'asset', subtype: 'tax', systemKey: ACC.TAX_INPUT },
      {
        code: '1300', name: 'المخزون', nameEn: 'Inventory', type: 'asset', isGroup: true,
        children: [
          { code: '1310', name: 'مخزون بضاعة جاهزة', nameEn: 'Finished Goods', type: 'asset', subtype: 'inventory', systemKey: ACC.INVENTORY_FINISHED },
          { code: '1320', name: 'مخزون مواد خام', nameEn: 'Raw Materials', type: 'asset', subtype: 'inventory', systemKey: ACC.INVENTORY_RAW },
          { code: '1330', name: 'بضاعة وخامات لدى المصانع', nameEn: 'Goods at Factories (WIP)', type: 'asset', subtype: 'wip', systemKey: ACC.WIP_FACTORY }
        ]
      }
    ]
  },
  {
    code: '2000', name: 'الخصوم', nameEn: 'Liabilities', type: 'liability', isGroup: true,
    children: [
      { code: '2100', name: 'ذمم الموردين', nameEn: 'Accounts Payable', type: 'liability', subtype: 'payable', systemKey: ACC.PAYABLE },
      { code: '2150', name: 'مستحقات المصانع', nameEn: 'Factories Payable', type: 'liability', subtype: 'payable', systemKey: ACC.FACTORY_PAYABLE },
      { code: '2200', name: 'ضريبة مبيعات مستحقة', nameEn: 'Output Tax', type: 'liability', subtype: 'tax', systemKey: ACC.TAX_OUTPUT }
    ]
  },
  {
    code: '3000', name: 'حقوق الملكية', nameEn: 'Equity', type: 'equity', isGroup: true,
    children: [
      { code: '3100', name: 'رأس المال', nameEn: 'Capital', type: 'equity', systemKey: ACC.CAPITAL },
      { code: '3200', name: 'الأرباح المحتجزة', nameEn: 'Retained Earnings', type: 'equity', systemKey: ACC.RETAINED_EARNINGS },
      { code: '3900', name: 'أرصدة افتتاحية', nameEn: 'Opening Balance Equity', type: 'equity', systemKey: ACC.OPENING_BALANCE_EQUITY }
    ]
  },
  {
    code: '4000', name: 'الإيرادات', nameEn: 'Revenue', type: 'revenue', isGroup: true,
    children: [
      { code: '4100', name: 'إيرادات المبيعات', nameEn: 'Sales Revenue', type: 'revenue', systemKey: ACC.SALES_REVENUE },
      { code: '4200', name: 'مردودات المبيعات', nameEn: 'Sales Returns', type: 'revenue', subtype: 'contra', systemKey: ACC.SALES_RETURNS },
      { code: '4300', name: 'خصومات المبيعات', nameEn: 'Sales Discounts', type: 'revenue', subtype: 'contra', systemKey: ACC.SALES_DISCOUNTS },
      { code: '4400', name: 'إيرادات الشحن', nameEn: 'Shipping Revenue', type: 'revenue', systemKey: ACC.SHIPPING_REVENUE },
      { code: '4500', name: 'خصومات المشتريات المكتسبة', nameEn: 'Purchase Discounts', type: 'revenue', systemKey: ACC.PURCHASE_DISCOUNTS }
    ]
  },
  {
    code: '5000', name: 'تكلفة المبيعات', nameEn: 'Cost of Sales', type: 'expense', isGroup: true,
    children: [
      { code: '5100', name: 'تكلفة البضاعة المباعة', nameEn: 'Cost of Goods Sold', type: 'expense', subtype: 'cogs', systemKey: ACC.COGS },
      { code: '5200', name: 'فروقات وتلف المخزون', nameEn: 'Inventory Adjustments', type: 'expense', subtype: 'cogs', systemKey: ACC.INVENTORY_ADJUSTMENT },
      { code: '5300', name: 'فروقات تكلفة الإنتاج', nameEn: 'Production Variance', type: 'expense', subtype: 'cogs', systemKey: ACC.PRODUCTION_VARIANCE }
    ]
  },
  {
    code: '6000', name: 'المصروفات التشغيلية', nameEn: 'Operating Expenses', type: 'expense', isGroup: true, systemKey: ACC.EXPENSE_ROOT,
    children: [
      { code: '6010', name: 'الإيجار', nameEn: 'Rent', type: 'expense' },
      { code: '6020', name: 'الرواتب والأجور', nameEn: 'Salaries', type: 'expense' },
      { code: '6030', name: 'النقل والمواصلات', nameEn: 'Transportation', type: 'expense' },
      { code: '6040', name: 'الشحن والتوصيل', nameEn: 'Shipping & Delivery', type: 'expense', systemKey: ACC.DELIVERY_EXPENSE },
      { code: '6050', name: 'الكهرباء والمياه', nameEn: 'Utilities', type: 'expense' },
      { code: '6060', name: 'الإنترنت والاتصالات', nameEn: 'Communications', type: 'expense' },
      { code: '6070', name: 'التسويق والدعاية', nameEn: 'Marketing', type: 'expense' },
      { code: '6080', name: 'مواد التغليف', nameEn: 'Packaging', type: 'expense' },
      { code: '6090', name: 'مصروفات المصانع', nameEn: 'Factory Expenses', type: 'expense' },
      { code: '6100', name: 'مصروفات المكتب', nameEn: 'Office Expenses', type: 'expense' },
      { code: '6110', name: 'رسوم بنكية', nameEn: 'Bank Charges', type: 'expense' },
      { code: '6900', name: 'مصروفات أخرى', nameEn: 'Other Expenses', type: 'expense', systemKey: ACC.EXPENSE_OTHER }
    ]
  }
]

/** فئات المصروفات الافتراضية مرتبطة بحسابات شجرة الحسابات */
export const DEFAULT_EXPENSE_CATEGORIES: { name: string; accountCode: string }[] = [
  { name: 'إيجار', accountCode: '6010' },
  { name: 'رواتب وأجور', accountCode: '6020' },
  { name: 'نقل ومواصلات', accountCode: '6030' },
  { name: 'شحن وتوصيل', accountCode: '6040' },
  { name: 'كهرباء ومياه', accountCode: '6050' },
  { name: 'إنترنت واتصالات', accountCode: '6060' },
  { name: 'تسويق ودعاية', accountCode: '6070' },
  { name: 'مواد تغليف', accountCode: '6080' },
  { name: 'مصروفات مصانع', accountCode: '6090' },
  { name: 'مصروفات مكتب', accountCode: '6100' },
  { name: 'رسوم بنكية', accountCode: '6110' },
  { name: 'أخرى', accountCode: '6900' }
]
