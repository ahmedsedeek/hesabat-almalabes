import type { Database } from 'better-sqlite3'
import type { AppSettings } from '@shared/types'

/** الإعدادات تُخزَّن كأقسام JSON في جدول settings — قسم واحد لكل مفتاح */
export const DEFAULT_SETTINGS: AppSettings = {
  company: {
    name: 'شركتي',
    legalName: '',
    address: '',
    city: '',
    phone: '',
    email: '',
    website: '',
    taxNumber: '',
    commercialReg: '',
    logoPath: '',
    invoiceFooter: 'شكرًا لتعاملكم معنا',
    bankDetails: ''
  },
  currency: { code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه مصري' },
  locale: { language: 'ar', dateFormat: 'dd/MM/yyyy', useArabicDigits: false },
  tax: { enabled: false, defaultRate: 14, label: 'ضريبة القيمة المضافة', inclusive: false },
  inventory: { allowNegativeStock: false, costingMethod: 'moving_average' },
  backup: {
    localEnabled: true,
    localPath: '',
    frequency: 'daily',
    retentionCount: 14,
    cloudEnabled: false,
    cloudProvider: 'none',
    cloudFolder: '',
    encrypt: true
  },
  notifications: { lowStock: true, overdueReceivables: true, overdueDays: 30, backupStatus: true },
  setupCompleted: false
}

export function writeSettingsSection(db: Database, section: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(section, JSON.stringify(value))
}

function readSection<T>(db: Database, section: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(section) as
    | { value: string }
    | undefined
  if (!row) return fallback
  try {
    const parsed = JSON.parse(row.value)
    // الدمج مع الافتراضي يضمن وجود المفاتيح الجديدة بعد ترقية التطبيق
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? { ...(fallback as object), ...(parsed as object) } as T
      : (parsed as T)
  } catch {
    return fallback
  }
}

export class SettingsService {
  constructor(private readonly db: Database) {}

  getAll(): AppSettings {
    return {
      company: readSection(this.db, 'company', DEFAULT_SETTINGS.company),
      currency: readSection(this.db, 'currency', DEFAULT_SETTINGS.currency),
      locale: readSection(this.db, 'locale', DEFAULT_SETTINGS.locale),
      tax: readSection(this.db, 'tax', DEFAULT_SETTINGS.tax),
      inventory: readSection(this.db, 'inventory', DEFAULT_SETTINGS.inventory),
      backup: readSection(this.db, 'backup', DEFAULT_SETTINGS.backup),
      notifications: readSection(this.db, 'notifications', DEFAULT_SETTINGS.notifications),
      setupCompleted: readSection(this.db, 'setupCompleted', DEFAULT_SETTINGS.setupCompleted)
    }
  }

  getSection<K extends keyof AppSettings>(section: K): AppSettings[K] {
    return this.getAll()[section]
  }

  update<K extends keyof AppSettings>(section: K, value: Partial<AppSettings[K]>): AppSettings[K] {
    const current = this.getSection(section)
    const next =
      typeof current === 'object' && current !== null ? { ...current, ...(value as object) } : (value as AppSettings[K])
    writeSettingsSection(this.db, section, next)
    return next as AppSettings[K]
  }

  set<K extends keyof AppSettings>(section: K, value: AppSettings[K]): void {
    writeSettingsSection(this.db, section, value)
  }

  isSetupCompleted(): boolean {
    return this.getSection('setupCompleted') === true
  }
}
