import bcrypt from 'bcryptjs'
import type { Database } from 'better-sqlite3'
import { AppError, ERRORS } from '@shared/errors'
import { ALL_PERMISSIONS, type Permission } from '@shared/permissions'
import type { SessionUser } from '@shared/types'
import type { Ctx } from '../core/context'
import { AuditService } from './audit.service'

const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15
const BCRYPT_ROUNDS = 11

export interface UserInput {
  username: string
  fullName: string
  password?: string
  roleId: number
  email?: string | null
  phone?: string | null
  isActive?: boolean
  mustChangePassword?: boolean
}

export interface UserRow {
  id: number
  username: string
  full_name: string
  role_id: number
  role_name: string
  role_code: string
  email: string | null
  phone: string | null
  is_active: number
  last_login_at: string | null
  created_at: string
}

export function validatePasswordStrength(password: string): void {
  if (password.length < 8) throw ERRORS.validation('كلمة المرور يجب ألا تقل عن ٨ أحرف.', 'password')
  if (!/[A-Za-z؀-ۿ]/.test(password) || !/[0-9]/.test(password)) {
    throw ERRORS.validation('كلمة المرور يجب أن تحتوي على حروف وأرقام.', 'password')
  }
}

export class AuthService {
  private readonly db: Database
  private readonly audit: AuditService

  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db
    this.audit = new AuditService(ctx)
  }

  hasAnyUser(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
    return row.n > 0
  }

  permissionsOf(roleId: number): Permission[] {
    return (
      this.db.prepare('SELECT permission FROM role_permissions WHERE role_id = ?').all(roleId) as {
        permission: Permission
      }[]
    ).map((r) => r.permission)
  }

  private toSession(row: {
    id: number
    username: string
    full_name: string
    role_id: number
    role_code: string
    role_name: string
  }): SessionUser {
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      roleId: row.role_id,
      roleCode: row.role_code,
      roleName: row.role_name,
      permissions: this.permissionsOf(row.role_id)
    }
  }

  login(username: string, password: string): SessionUser {
    const row = this.db
      .prepare(
        `SELECT u.*, r.code AS role_code, r.name AS role_name
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE lower(u.username) = lower(?)`
      )
      .get(username.trim()) as
      | {
          id: number
          username: string
          full_name: string
          password_hash: string
          role_id: number
          role_code: string
          role_name: string
          is_active: number
          failed_attempts: number
          locked_until: string | null
        }
      | undefined

    const genericFailure = new AppError('AUTH_FAILED', 'اسم المستخدم أو كلمة المرور غير صحيحة.')
    if (!row) throw genericFailure
    if (row.is_active === 0) throw new AppError('AUTH_FAILED', 'هذا الحساب معطّل. راجع مدير النظام.')

    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      const minutes = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000)
      throw new AppError('ACCOUNT_LOCKED', `تم قفل الحساب مؤقتًا بسبب محاولات دخول خاطئة. حاول بعد ${minutes} دقيقة.`)
    }

    if (!bcrypt.compareSync(password, row.password_hash)) {
      const attempts = row.failed_attempts + 1
      const lockUntil =
        attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null
      this.db
        .prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
        .run(attempts, lockUntil, row.id)
      if (lockUntil) {
        this.audit.log({
          action: 'login_locked',
          entityType: 'user',
          entityId: row.id,
          entityLabel: row.username,
          severity: 'warning'
        })
        throw new AppError('ACCOUNT_LOCKED', `تم قفل الحساب مؤقتًا بسبب محاولات دخول خاطئة. حاول بعد ${LOCK_MINUTES} دقيقة.`)
      }
      throw genericFailure
    }

    this.db
      .prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?")
      .run(row.id)
    const session = this.toSession(row)
    new AuditService({ ...this.ctx, user: session }).log({
      action: 'login',
      entityType: 'user',
      entityId: row.id,
      entityLabel: row.username
    })
    return session
  }

  listUsers(): UserRow[] {
    return this.db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.role_id, r.name AS role_name, r.code AS role_code,
                u.email, u.phone, u.is_active, u.last_login_at, u.created_at
         FROM users u JOIN roles r ON r.id = u.role_id
         ORDER BY u.full_name`
      )
      .all() as UserRow[]
  }

  createUser(input: UserInput): number {
    const username = input.username.trim()
    if (!username) throw ERRORS.validation('اسم المستخدم مطلوب.', 'username')
    if (!input.fullName.trim()) throw ERRORS.validation('الاسم الكامل مطلوب.', 'fullName')
    if (!input.password) throw ERRORS.validation('كلمة المرور مطلوبة.', 'password')
    validatePasswordStrength(input.password)
    const exists = this.db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username)
    if (exists) throw ERRORS.conflict('اسم المستخدم مستخدم بالفعل.')

    const info = this.db
      .prepare(
        `INSERT INTO users (username, full_name, password_hash, role_id, email, phone, is_active, must_change_password)
         VALUES (@username, @fullName, @hash, @roleId, @email, @phone, @isActive, @mustChange)`
      )
      .run({
        username,
        fullName: input.fullName.trim(),
        hash: bcrypt.hashSync(input.password, BCRYPT_ROUNDS),
        roleId: input.roleId,
        email: input.email ?? null,
        phone: input.phone ?? null,
        isActive: input.isActive === false ? 0 : 1,
        mustChange: input.mustChangePassword ? 1 : 0
      })
    const id = Number(info.lastInsertRowid)
    this.audit.log({ action: 'create', entityType: 'user', entityId: id, entityLabel: username, newValue: { username, roleId: input.roleId } })
    return id
  }

  updateUser(id: number, input: Partial<UserInput>): void {
    const current = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!current) throw ERRORS.notFound('المستخدم')

    if (input.password) validatePasswordStrength(input.password)
    // منع تعطيل آخر حساب مدير نشط
    if (input.isActive === false || (input.roleId && input.roleId !== current.role_id)) {
      this.assertNotLastAdmin(id)
    }

    this.db
      .prepare(
        `UPDATE users SET
           full_name = COALESCE(@fullName, full_name),
           role_id = COALESCE(@roleId, role_id),
           email = COALESCE(@email, email),
           phone = COALESCE(@phone, phone),
           is_active = COALESCE(@isActive, is_active),
           password_hash = COALESCE(@hash, password_hash),
           must_change_password = COALESCE(@mustChange, must_change_password),
           updated_at = datetime('now')
         WHERE id = @id`
      )
      .run({
        id,
        fullName: input.fullName?.trim() ?? null,
        roleId: input.roleId ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        isActive: input.isActive === undefined ? null : input.isActive ? 1 : 0,
        hash: input.password ? bcrypt.hashSync(input.password, BCRYPT_ROUNDS) : null,
        mustChange: input.mustChangePassword === undefined ? null : input.mustChangePassword ? 1 : 0
      })
    this.audit.log({
      action: 'update',
      entityType: 'user',
      entityId: id,
      entityLabel: String(current.username),
      oldValue: { fullName: current.full_name, roleId: current.role_id, isActive: current.is_active },
      newValue: { fullName: input.fullName, roleId: input.roleId, isActive: input.isActive, passwordChanged: Boolean(input.password) }
    })
  }

  private assertNotLastAdmin(userId: number): void {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.code = 'admin' AND u.is_active = 1 AND u.id <> ?`
      )
      .get(userId) as { n: number }
    const isAdmin = this.db
      .prepare(`SELECT 1 AS x FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.code = 'admin'`)
      .get(userId)
    if (isAdmin && row.n === 0) {
      throw ERRORS.conflict('لا يمكن تعطيل آخر حساب مدير نظام نشط.')
    }
  }

  changePassword(userId: number, currentPassword: string, newPassword: string): void {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
      | { password_hash: string }
      | undefined
    if (!row) throw ERRORS.notFound('المستخدم')
    if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
      throw ERRORS.validation('كلمة المرور الحالية غير صحيحة.', 'currentPassword')
    }
    validatePasswordStrength(newPassword)
    this.db
      .prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?")
      .run(bcrypt.hashSync(newPassword, BCRYPT_ROUNDS), userId)
    this.audit.log({ action: 'change_password', entityType: 'user', entityId: userId, severity: 'warning' })
  }

  // ------------------------- الأدوار -------------------------

  listRoles(): { id: number; code: string; name: string; description: string | null; isSystem: number; permissions: Permission[]; userCount: number }[] {
    const roles = this.db.prepare('SELECT * FROM roles ORDER BY id').all() as {
      id: number
      code: string
      name: string
      description: string | null
      is_system: number
    }[]
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.is_system,
      permissions: this.permissionsOf(r.id),
      userCount: (this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE role_id = ?').get(r.id) as { n: number }).n
    }))
  }

  createRole(name: string, permissions: Permission[], description?: string): number {
    if (!name.trim()) throw ERRORS.validation('اسم الدور مطلوب.', 'name')
    const code = `role_${Date.now()}`
    const info = this.db
      .prepare('INSERT INTO roles (code, name, description, is_system) VALUES (?, ?, ?, 0)')
      .run(code, name.trim(), description ?? null)
    const id = Number(info.lastInsertRowid)
    this.setRolePermissions(id, permissions)
    this.audit.log({ action: 'create', entityType: 'role', entityId: id, entityLabel: name, severity: 'warning' })
    return id
  }

  deleteRole(roleId: number): void {
    const role = this.db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId) as
      | { id: number; code: string; name: string; is_system: number }
      | undefined
    if (!role) throw ERRORS.notFound('الدور')
    if (role.is_system === 1) throw ERRORS.conflict('لا يمكن حذف دور أساسي في النظام.')
    const users = this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE role_id = ?').get(roleId) as { n: number }
    if (users.n > 0) throw ERRORS.conflict('لا يمكن حذف دور مرتبط بمستخدمين. غيّر أدوارهم أولًا.')
    this.db.prepare('DELETE FROM roles WHERE id = ?').run(roleId)
    this.audit.log({ action: 'delete', entityType: 'role', entityId: roleId, entityLabel: role.name, severity: 'warning' })
  }

  setRolePermissions(roleId: number, permissions: Permission[]): void {
    const role = this.db.prepare('SELECT code FROM roles WHERE id = ?').get(roleId) as { code: string } | undefined
    if (!role) throw ERRORS.notFound('الدور')
    if (role.code === 'admin') throw ERRORS.conflict('لا يمكن تعديل صلاحيات دور مدير النظام.')
    const valid = permissions.filter((p) => ALL_PERMISSIONS.includes(p))
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId)
      const insert = this.db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)')
      for (const p of valid) insert.run(roleId, p)
    })
    run.immediate()
    this.audit.log({ action: 'update', entityType: 'role', entityId: roleId, newValue: { permissions: valid }, severity: 'warning' })
  }

  can(user: SessionUser | null, permission: Permission): boolean {
    if (!user) return false
    return user.permissions.includes(permission)
  }

  assert(user: SessionUser | null, permission: Permission): void {
    if (!this.can(user, permission)) throw ERRORS.permission()
  }
}
