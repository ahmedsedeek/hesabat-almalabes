import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ERRORS } from '@shared/errors'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { AuditService } from './audit.service'

const MAX_SIZE = 25 * 1024 * 1024
const ALLOWED = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
  '.xlsx', '.xls', '.csv', '.doc', '.docx', '.txt'
])

/** المرفقات: صور المنتجات، فواتير الموردين، إيصالات المصروفات، مستندات المصانع */
export class AttachmentService {
  constructor(private readonly ctx: Ctx, private readonly storageDir: string) {
    fs.mkdirSync(storageDir, { recursive: true })
  }

  add(refType: string, refId: number, sourcePath: string, notes?: string): number {
    if (!fs.existsSync(sourcePath)) throw ERRORS.notFound('الملف')
    const ext = path.extname(sourcePath).toLowerCase()
    if (!ALLOWED.has(ext)) throw ERRORS.validation('صيغة الملف غير مسموح بها.')
    const stat = fs.statSync(sourcePath)
    if (stat.size > MAX_SIZE) throw ERRORS.validation('حجم الملف يتجاوز ٢٥ ميجابايت.')

    const storedName = `${refType}-${refId}-${crypto.randomBytes(8).toString('hex')}${ext}`
    const target = path.join(this.storageDir, storedName)
    fs.copyFileSync(sourcePath, target)

    const info = this.ctx.db
      .prepare(
        `INSERT INTO attachments (ref_type, ref_id, file_name, stored_name, mime_type, size_bytes, notes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(refType, refId, path.basename(sourcePath), storedName, mimeOf(ext), stat.size, notes ?? null, actorId(this.ctx))
    const id = Number(info.lastInsertRowid)
    new AuditService(this.ctx).log({ action: 'attach', entityType: refType, entityId: refId, entityLabel: path.basename(sourcePath) })
    return id
  }

  list(refType: string, refId: number): Record<string, unknown>[] {
    return this.ctx.db
      .prepare(
        `SELECT a.*, u.full_name AS uploaded_by_name FROM attachments a
         LEFT JOIN users u ON u.id = a.uploaded_by
         WHERE a.ref_type = ? AND a.ref_id = ? ORDER BY a.created_at DESC`
      )
      .all(refType, refId)
      .map((r) => ({ ...(r as Record<string, unknown>), full_path: path.join(this.storageDir, String((r as { stored_name: string }).stored_name)) }))
  }

  remove(id: number): void {
    const row = this.ctx.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as
      | { id: number; stored_name: string; file_name: string; ref_type: string; ref_id: number }
      | undefined
    if (!row) throw ERRORS.notFound('المرفق')
    fs.rmSync(path.join(this.storageDir, row.stored_name), { force: true })
    this.ctx.db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
    new AuditService(this.ctx).log({
      action: 'detach',
      entityType: row.ref_type,
      entityId: row.ref_id,
      entityLabel: row.file_name,
      severity: 'warning'
    })
  }

  path(id: number): string {
    const row = this.ctx.db.prepare('SELECT stored_name FROM attachments WHERE id = ?').get(id) as { stored_name: string } | undefined
    if (!row) throw ERRORS.notFound('المرفق')
    return path.join(this.storageDir, row.stored_name)
  }

  /** نسخ صورة منتج إلى مخزن المرفقات وإرجاع مسارها */
  storeImage(sourcePath: string, prefix: string): string {
    const ext = path.extname(sourcePath).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
      throw ERRORS.validation('يُسمح بصور PNG أو JPG أو WEBP فقط.')
    }
    const storedName = `${prefix}-${crypto.randomBytes(6).toString('hex')}${ext}`
    const target = path.join(this.storageDir, storedName)
    fs.copyFileSync(sourcePath, target)
    return target
  }
}

function mimeOf(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  return map[ext] ?? 'application/octet-stream'
}
