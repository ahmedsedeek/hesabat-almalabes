import type { Database } from 'better-sqlite3'
import init001 from './migrations/001_init.sql?raw'
import retail002 from './migrations/002_retail_delivery.sql?raw'

export interface Migration {
  version: number
  name: string
  sql?: string
  up?: (db: Database) => void
}

/**
 * الهجرات مرتَّبة تصاعديًا. لا تُعدَّل هجرة منشورة أبدًا —
 * أي تغيير في المخطط يُضاف كهجرة جديدة حتى تعمل الترقية على قواعد البيانات القائمة.
 */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: init001 },
  { version: 2, name: 'retail_delivery', sql: retail002 }
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

export function runMigrations(db: Database): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version)
  )

  let count = 0
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    const run = db.transaction(() => {
      if (migration.sql) db.exec(migration.sql)
      if (migration.up) migration.up(db)
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name
      )
    })
    run.immediate()
    count++
  }
  return count
}

export function currentSchemaVersion(db: Database): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }
  return row?.v ?? 0
}
