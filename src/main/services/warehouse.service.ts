import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'
import type { Ctx } from '../core/context'
import { AuditService } from './audit.service'

export interface WarehouseInput {
  code?: string
  name: string
  address?: string | null
  isDefault?: boolean
  isActive?: boolean
  notes?: string | null
}

export class WarehouseService {
  private readonly db: Database
  private readonly audit: AuditService

  constructor(ctx: Ctx) {
    this.db = ctx.db
    this.audit = new AuditService(ctx)
  }

  list(activeOnly = false): Record<string, unknown>[] {
    const clause = activeOnly ? 'WHERE is_active = 1' : ''
    return this.db
      .prepare(
        `SELECT w.*,
                COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.warehouse_id = w.id), 0) AS total_qty
         FROM warehouses w ${clause} ORDER BY w.is_default DESC, w.name`
      )
      .all() as Record<string, unknown>[]
  }

  defaultId(): number {
    const row = this.db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1').get() as
      | { id: number }
      | undefined
    if (row) return row.id
    const any = this.db.prepare('SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id LIMIT 1').get() as
      | { id: number }
      | undefined
    if (!any) throw ERRORS.validation('لا يوجد مخزن نشط. أنشئ مخزنًا أولًا من الإعدادات.')
    return any.id
  }

  create(input: WarehouseInput): number {
    if (!input.name?.trim()) throw ERRORS.validation('اسم المخزن مطلوب.', 'name')
    const code = (input.code?.trim() || `WH${Date.now().toString().slice(-5)}`).toUpperCase()
    if (this.db.prepare('SELECT id FROM warehouses WHERE code = ?').get(code)) {
      throw ERRORS.conflict(`كود المخزن «${code}» مستخدم بالفعل.`)
    }
    const run = this.db.transaction(() => {
      if (input.isDefault) this.db.prepare('UPDATE warehouses SET is_default = 0').run()
      const info = this.db
        .prepare(
          'INSERT INTO warehouses (code, name, address, is_default, is_active, notes) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(code, input.name.trim(), input.address ?? null, input.isDefault ? 1 : 0, input.isActive === false ? 0 : 1, input.notes ?? null)
      return Number(info.lastInsertRowid)
    })
    const id = run.immediate()
    this.audit.log({ action: 'create', entityType: 'warehouse', entityId: id, entityLabel: input.name })
    return id
  }

  update(id: number, input: Partial<WarehouseInput>): void {
    const run = this.db.transaction(() => {
      if (input.isDefault) this.db.prepare('UPDATE warehouses SET is_default = 0').run()
      this.db
        .prepare(
          `UPDATE warehouses SET name = COALESCE(@name, name), address = @address,
             is_default = COALESCE(@isDefault, is_default), is_active = COALESCE(@isActive, is_active), notes = @notes
           WHERE id = @id`
        )
        .run({
          id,
          name: input.name?.trim() ?? null,
          address: input.address ?? null,
          isDefault: input.isDefault === undefined ? null : input.isDefault ? 1 : 0,
          isActive: input.isActive === undefined ? null : input.isActive ? 1 : 0,
          notes: input.notes ?? null
        })
    })
    run.immediate()
    this.audit.log({ action: 'update', entityType: 'warehouse', entityId: id, newValue: input })
  }

  remove(id: number): void {
    const used = this.db.prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE warehouse_id = ?').get(id) as { n: number }
    if (used.n > 0) throw ERRORS.conflict('لا يمكن حذف مخزن له حركات. يمكنك تعطيله بدلًا من ذلك.')
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM warehouses').get() as { n: number }
    if (count.n <= 1) throw ERRORS.conflict('يجب أن يبقى مخزن واحد على الأقل في النظام.')
    this.db.prepare('DELETE FROM warehouses WHERE id = ?').run(id)
    this.audit.log({ action: 'delete', entityType: 'warehouse', entityId: id, severity: 'warning' })
  }
}
