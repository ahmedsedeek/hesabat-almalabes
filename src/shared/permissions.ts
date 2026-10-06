/** مفاتيح الصلاحيات — تُستخدم في الواجهة وفي طبقة IPC معًا */
export const PERMISSIONS = {
  // العملاء والموردون والمصانع
  PARTIES_VIEW: 'parties.view',
  PARTIES_CREATE: 'parties.create',
  PARTIES_EDIT: 'parties.edit',
  PARTIES_DELETE: 'parties.delete',
  // المنتجات والمخزون
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_MANAGE: 'products.manage',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  // المبيعات
  SALES_VIEW: 'sales.view',
  SALES_CREATE: 'sales.create',
  SALES_EDIT: 'sales.edit',
  SALES_VOID: 'sales.void',
  // المشتريات
  PURCHASES_VIEW: 'purchases.view',
  PURCHASES_CREATE: 'purchases.create',
  PURCHASES_EDIT: 'purchases.edit',
  PURCHASES_VOID: 'purchases.void',
  // التصنيع
  PRODUCTION_VIEW: 'production.view',
  PRODUCTION_MANAGE: 'production.manage',
  // المالية
  PAYMENTS_VIEW: 'payments.view',
  PAYMENTS_CREATE: 'payments.create',
  PAYMENTS_VOID: 'payments.void',
  EXPENSES_VIEW: 'expenses.view',
  EXPENSES_MANAGE: 'expenses.manage',
  ACCOUNTING_VIEW: 'accounting.view',
  ACCOUNTING_MANAGE: 'accounting.manage',
  // التقارير
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  // النظام
  BACKUP_MANAGE: 'backup.manage',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view'
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS)

export const PERMISSION_LABELS: Record<Permission, string> = {
  'parties.view': 'عرض العملاء والموردين',
  'parties.create': 'إضافة عملاء وموردين',
  'parties.edit': 'تعديل العملاء والموردين',
  'parties.delete': 'حذف/تعطيل العملاء والموردين',
  'products.view': 'عرض المنتجات',
  'products.manage': 'إدارة المنتجات',
  'inventory.view': 'عرض المخزون',
  'inventory.manage': 'إدارة المخزون والتسويات',
  'sales.view': 'عرض المبيعات',
  'sales.create': 'إنشاء فواتير بيع',
  'sales.edit': 'تعديل فواتير البيع',
  'sales.void': 'إلغاء فواتير البيع',
  'purchases.view': 'عرض المشتريات',
  'purchases.create': 'إنشاء فواتير شراء',
  'purchases.edit': 'تعديل فواتير الشراء',
  'purchases.void': 'إلغاء فواتير الشراء',
  'production.view': 'عرض أوامر الإنتاج',
  'production.manage': 'إدارة أوامر الإنتاج',
  'payments.view': 'عرض المدفوعات',
  'payments.create': 'تسجيل المدفوعات',
  'payments.void': 'إلغاء المدفوعات',
  'expenses.view': 'عرض المصروفات',
  'expenses.manage': 'إدارة المصروفات',
  'accounting.view': 'عرض الحسابات والقيود',
  'accounting.manage': 'إدارة الحسابات والقيود',
  'reports.view': 'عرض التقارير',
  'reports.export': 'تصدير التقارير',
  'backup.manage': 'إدارة النسخ الاحتياطي',
  'users.manage': 'إدارة المستخدمين والصلاحيات',
  'settings.manage': 'تغيير إعدادات النظام',
  'audit.view': 'عرض سجل المراجعة'
}

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: 'العملاء والموردون والمصانع', permissions: ['parties.view', 'parties.create', 'parties.edit', 'parties.delete'] },
  { label: 'المنتجات والمخزون', permissions: ['products.view', 'products.manage', 'inventory.view', 'inventory.manage'] },
  { label: 'المبيعات', permissions: ['sales.view', 'sales.create', 'sales.edit', 'sales.void'] },
  { label: 'المشتريات', permissions: ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.void'] },
  { label: 'التصنيع', permissions: ['production.view', 'production.manage'] },
  { label: 'المالية', permissions: ['payments.view', 'payments.create', 'payments.void', 'expenses.view', 'expenses.manage', 'accounting.view', 'accounting.manage'] },
  { label: 'التقارير', permissions: ['reports.view', 'reports.export'] },
  { label: 'النظام', permissions: ['backup.manage', 'users.manage', 'settings.manage', 'audit.view'] }
]

/** أدوار افتراضية */
export const DEFAULT_ROLES: { code: string; name: string; description: string; permissions: Permission[] }[] = [
  {
    code: 'admin',
    name: 'مدير النظام',
    description: 'صلاحيات كاملة على جميع أجزاء النظام',
    permissions: ALL_PERMISSIONS
  },
  {
    code: 'accountant',
    name: 'محاسب',
    description: 'إدارة المعاملات المالية والتقارير دون إدارة المستخدمين',
    permissions: ALL_PERMISSIONS.filter(
      (p) => !['users.manage', 'settings.manage', 'backup.manage'].includes(p)
    )
  },
  {
    code: 'sales',
    name: 'موظف مبيعات',
    description: 'إنشاء فواتير البيع وتحصيل المدفوعات',
    permissions: [
      'parties.view', 'parties.create', 'parties.edit',
      'products.view', 'inventory.view',
      'sales.view', 'sales.create',
      'payments.view', 'payments.create',
      'reports.view'
    ]
  },
  {
    code: 'viewer',
    name: 'مُطّلع',
    description: 'عرض البيانات والتقارير فقط',
    permissions: [
      'parties.view', 'products.view', 'inventory.view', 'sales.view',
      'purchases.view', 'production.view', 'payments.view', 'expenses.view',
      'accounting.view', 'reports.view'
    ]
  }
]
