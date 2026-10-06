import type { Ctx } from '../core/context'
import { actorId, actorName } from '../core/context'

export interface AuditInput {
  action: string
  entityType: string
  entityId?: number | string | null
  entityLabel?: string | null
  oldValue?: unknown
  newValue?: unknown
  reason?: string | null
  severity?: 'info' | 'warning' | 'critical'
}

export interface AuditQuery {
  from?: string
  to?: string
  userId?: number
  entityType?: string
  action?: string
  search?: string
  page?: number
  pageSize?: number
}

/**
 * سجل المراجعة — كل عملية مالية مؤثرة تُسجَّل هنا.
 * السجل غير قابل للتعديل أو الحذف من داخل التطبيق.
 */
export class AuditService {
  constructor(private readonly ctx: Ctx) {}

  log(input: AuditInput): void {
    this.ctx.db
      .prepare(
        `INSERT INTO audit_logs
           (user_id, user_name, action, entity_type, entity_id, entity_label, old_value, new_value, reason, device, severity)
         VALUES (@userId, @userName, @action, @entityType, @entityId, @entityLabel, @oldValue, @newValue, @reason, @device, @severity)`
      )
      .run({
        userId: actorId(this.ctx),
        userName: actorName(this.ctx),
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId != null ? String(input.entityId) : null,
        entityLabel: input.entityLabel ?? null,
        oldValue: input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
        newValue: input.newValue === undefined ? null : JSON.stringify(input.newValue),
        reason: input.reason ?? null,
        device: this.ctx.device ?? null,
        severity: input.severity ?? 'info'
      })
  }

  query(q: AuditQuery = {}): { rows: Record<string, unknown>[]; total: number } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (q.from) { where.push('date(created_at) >= date(@from)'); params.from = q.from }
    if (q.to) { where.push('date(created_at) <= date(@to)'); params.to = q.to }
    if (q.userId) { where.push('user_id = @userId'); params.userId = q.userId }
    if (q.entityType) { where.push('entity_type = @entityType'); params.entityType = q.entityType }
    if (q.action) { where.push('action = @action'); params.action = q.action }
    if (q.search) {
      where.push('(entity_label LIKE @search OR user_name LIKE @search OR reason LIKE @search OR entity_id LIKE @search)')
      params.search = `%${q.search}%`
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = Math.max(1, q.page ?? 1)
    const pageSize = Math.min(500, Math.max(1, q.pageSize ?? 50))
    const total = (
      this.ctx.db.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${clause}`).get(params) as { n: number }
    ).n
    const rows = this.ctx.db
      .prepare(`SELECT * FROM audit_logs ${clause} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[]
    return { rows, total }
  }
}
