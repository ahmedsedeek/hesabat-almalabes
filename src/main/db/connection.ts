import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { runMigrations } from './migrate'
import { seedDatabase } from './seed'

export type DB = Database.Database

export interface OpenOptions {
  /** مسار ملف قاعدة البيانات، أو ':memory:' للاختبارات */
  file: string
  /** تشغيل بيانات التهيئة الأساسية (شجرة الحسابات، الأدوار، الإعدادات) */
  seed?: boolean
  verbose?: (sql: string) => void
}

/**
 * فتح قاعدة البيانات مع الإعدادات التي تضمن سلامة البيانات المالية:
 *  - foreign_keys: منع السجلات اليتيمة
 *  - journal_mode = WAL: أداء أفضل وأمان أعلى عند الانهيار
 *  - synchronous = FULL: عدم فقدان أي معاملة مُثبَّتة حتى عند انقطاع الكهرباء
 *  - busy_timeout: تفادي أخطاء القفل عند الوصول المتزامن
 */
export function openDatabase(options: OpenOptions): DB {
  const { file, seed = true } = options
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }
  const db = new Database(file, options.verbose ? { verbose: (message?: unknown) => options.verbose?.(String(message)) } : {})
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 8000')
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -32000')
  db.function('regexp', (pattern: unknown, value: unknown) =>
    value == null ? 0 : new RegExp(String(pattern)).test(String(value)) ? 1 : 0
  )

  runMigrations(db)
  if (seed) seedDatabase(db)
  return db
}

/** فحص سلامة قاعدة البيانات — يُستخدم قبل النسخ الاحتياطي وعند بدء التشغيل */
export function checkIntegrity(db: DB): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  const integrity = db.pragma('integrity_check') as { integrity_check: string }[]
  for (const row of integrity) {
    if (row.integrity_check !== 'ok') problems.push(row.integrity_check)
  }
  const fk = db.pragma('foreign_key_check') as Record<string, unknown>[]
  for (const row of fk) {
    problems.push(`مرجع غير صالح في جدول ${String(row.table)} (rowid ${String(row.rowid)})`)
  }
  return { ok: problems.length === 0, problems }
}

/** تنفيذ دالة داخل معاملة واحدة — إما أن تنجح كل الخطوات أو لا تُحفظ أي منها */
export function transact<T>(db: DB, fn: () => T): T {
  const wrapped = db.transaction(fn)
  return wrapped.immediate()
}
