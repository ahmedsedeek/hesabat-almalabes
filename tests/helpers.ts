import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { openDatabase, type DB } from '@main/db/connection'
import type { Ctx } from '@main/core/context'
import { ALL_PERMISSIONS } from '@shared/permissions'
import type { SessionUser } from '@shared/types'

export function createTestDb(): DB {
  return openDatabase({ file: ':memory:', seed: true })
}

export function createAdmin(db: DB, username = 'admin'): SessionUser {
  const role = db.prepare("SELECT id, code, name FROM roles WHERE code = 'admin'").get() as {
    id: number
    code: string
    name: string
  }
  const info = db
    .prepare('INSERT INTO users (username, full_name, password_hash, role_id) VALUES (?, ?, ?, ?)')
    .run(username, 'مدير النظام', bcrypt.hashSync('Admin@123', 8), role.id)
  return {
    id: Number(info.lastInsertRowid),
    username,
    fullName: 'مدير النظام',
    roleId: role.id,
    roleCode: role.code,
    roleName: role.name,
    permissions: [...ALL_PERMISSIONS]
  }
}

export function createCtx(): Ctx {
  const db = createTestDb()
  const user = createAdmin(db)
  return { db, user, device: 'test' }
}

/**
 * حذف مجلد مؤقت بأمان.
 * ويندوز يُبقي قفلًا على ملفات SQLite لحظات بعد الإغلاق، فتفشل عملية الحذف
 * بـ ENOTEMPTY إن لم تُعَد المحاولة.
 */
export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

export function defaultWarehouseId(db: DB): number {
  return (db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get() as { id: number }).id
}

export function cashAccountId(db: DB): number {
  return (db.prepare("SELECT id FROM accounts WHERE system_key = 'cash'").get() as { id: number }).id
}

export function cashMethodId(db: DB): number {
  return (db.prepare("SELECT id FROM payment_methods WHERE name = 'نقدي'").get() as { id: number }).id
}
