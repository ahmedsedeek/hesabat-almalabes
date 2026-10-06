import type { Database } from 'better-sqlite3'
import { DEFAULT_CHART, DEFAULT_EXPENSE_CATEGORIES, type ChartNode, ACC } from '../accounting/chart'
import { DEFAULT_ROLES } from '@shared/permissions'
import { DEFAULT_SETTINGS, writeSettingsSection } from '../services/settings.service'

/** أنواع المستندات التي يولِّد النظام أرقامها تلقائيًا */
export const DEFAULT_SEQUENCES: {
  docType: string
  prefix: string
  label: string
}[] = [
  { docType: 'sale', prefix: 'INV', label: 'فاتورة بيع' },
  { docType: 'sale_return', prefix: 'SRET', label: 'مردود مبيعات' },
  { docType: 'purchase', prefix: 'PUR', label: 'فاتورة شراء' },
  { docType: 'purchase_return', prefix: 'PRET', label: 'مردود مشتريات' },
  { docType: 'payment_in', prefix: 'REC', label: 'سند قبض' },
  { docType: 'payment_out', prefix: 'PAY', label: 'سند صرف' },
  { docType: 'expense', prefix: 'EXP', label: 'مصروف' },
  { docType: 'production_order', prefix: 'PROD', label: 'أمر إنتاج' },
  { docType: 'stock_adjustment', prefix: 'ADJ', label: 'تسوية مخزون' },
  { docType: 'stock_transfer', prefix: 'TRF', label: 'تحويل مخزني' },
  { docType: 'cash_transaction', prefix: 'CSH', label: 'حركة خزينة' },
  { docType: 'journal', prefix: 'JV', label: 'قيد يومية' }
]

function insertChart(db: Database): void {
  const insert = db.prepare(
    `INSERT INTO accounts (code, name, name_en, type, subtype, parent_id, system_key, is_group)
     VALUES (@code, @name, @nameEn, @type, @subtype, @parentId, @systemKey, @isGroup)`
  )
  const walk = (nodes: ChartNode[], parentId: number | null): void => {
    for (const node of nodes) {
      const info = insert.run({
        code: node.code,
        name: node.name,
        nameEn: node.nameEn,
        type: node.type,
        subtype: node.subtype ?? null,
        parentId,
        systemKey: node.systemKey ?? null,
        isGroup: node.isGroup ? 1 : 0
      })
      if (node.children?.length) walk(node.children, Number(info.lastInsertRowid))
    }
  }
  walk(DEFAULT_CHART, null)
}

export function seedDatabase(db: Database): void {
  const seeded = db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }
  if (seeded.n > 0) return

  const run = db.transaction(() => {
    insertChart(db)

    // الأدوار والصلاحيات
    const insertRole = db.prepare(
      'INSERT INTO roles (code, name, description, is_system) VALUES (?, ?, ?, 1)'
    )
    const insertPerm = db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)')
    for (const role of DEFAULT_ROLES) {
      const info = insertRole.run(role.code, role.name, role.description)
      for (const permission of role.permissions) insertPerm.run(info.lastInsertRowid, permission)
    }

    // تسلسلات الترقيم
    const insertSeq = db.prepare(
      'INSERT INTO number_sequences (doc_type, prefix, include_year, padding, next_number) VALUES (?, ?, 1, 6, 1)'
    )
    for (const seq of DEFAULT_SEQUENCES) insertSeq.run(seq.docType, seq.prefix)

    // طرق الدفع
    const accountId = (key: string): number =>
      (db.prepare('SELECT id FROM accounts WHERE system_key = ?').get(key) as { id: number }).id
    const insertMethod = db.prepare(
      'INSERT INTO payment_methods (name, account_id, sort_order) VALUES (?, ?, ?)'
    )
    insertMethod.run('نقدي', accountId(ACC.CASH), 1)
    insertMethod.run('تحويل بنكي', accountId(ACC.BANK), 2)
    insertMethod.run('شبكة / بطاقة', accountId(ACC.BANK), 3)
    insertMethod.run('شيك', accountId(ACC.BANK), 4)

    // فئات المصروفات
    const insertCat = db.prepare('INSERT INTO expense_categories (name, account_id) VALUES (?, ?)')
    const byCode = db.prepare('SELECT id FROM accounts WHERE code = ?')
    for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
      const acc = byCode.get(cat.accountCode) as { id: number } | undefined
      if (acc) insertCat.run(cat.name, acc.id)
    }

    // المخزن الافتراضي
    db.prepare(
      "INSERT INTO warehouses (code, name, is_default, is_active) VALUES ('MAIN', 'المخزن الرئيسي', 1, 1)"
    ).run()

    // الإعدادات الافتراضية
    for (const [section, value] of Object.entries(DEFAULT_SETTINGS)) {
      writeSettingsSection(db, section, value)
    }
  })
  run.immediate()
}
