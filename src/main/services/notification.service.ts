import { todayIso } from '@shared/date'
import type { Database } from 'better-sqlite3'
import { SettingsService } from './settings.service'

export interface NotificationInput {
  type: string
  severity?: 'info' | 'warning' | 'critical'
  title: string
  body?: string | null
  refType?: string | null
  refId?: number | null
  /** مفتاح لمنع تكرار نفس التنبيه — التنبيهات يجب ألا تصبح مزعجة */
  dedupeKey?: string | null
}

export class NotificationService {
  constructor(private readonly db: Database) {}

  push(input: NotificationInput): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO notifications (type, severity, title, body, ref_type, ref_id, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.type,
        input.severity ?? 'info',
        input.title,
        input.body ?? null,
        input.refType ?? null,
        input.refId ?? null,
        input.dedupeKey ?? null
      )
  }

  list(options: { unreadOnly?: boolean; limit?: number } = {}): Record<string, unknown>[] {
    const clause = options.unreadOnly ? 'WHERE is_read = 0' : ''
    return this.db
      .prepare(`SELECT * FROM notifications ${clause} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(options.limit ?? 50) as Record<string, unknown>[]
  }

  unreadCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE is_read = 0').get() as { n: number }).n
  }

  markRead(id: number): void {
    this.db.prepare("UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE id = ?").run(id)
  }

  markAllRead(): void {
    this.db.prepare("UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE is_read = 0").run()
  }

  clearOld(days = 60): void {
    this.db.prepare(`DELETE FROM notifications WHERE is_read = 1 AND created_at < date('now', '-${days} days')`).run()
  }

  /**
   * فحص دوري يولّد تنبيهات العمل: نقص المخزون، تأخر التحصيل، تأخر أوامر الإنتاج، المخزون السالب.
   * يُستدعى عند بدء التشغيل ومرة يوميًا — ومفتاح منع التكرار يضمن ألا يتكرر التنبيه في نفس اليوم.
   */
  runChecks(): void {
    const settings = new SettingsService(this.db).getSection('notifications')
    const today = todayIso()

    if (settings.lowStock) {
      const low = this.db
        .prepare(
          `SELECT p.name, v.sku, v.min_stock AS minStock,
                  COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.variant_id = v.id),0) AS qty
           FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE v.is_active = 1 AND p.track_inventory = 1 AND v.min_stock > 0
             AND COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.variant_id = v.id),0) <= v.min_stock
           LIMIT 50`
        )
        .all() as { name: string; sku: string; minStock: number; qty: number }[]
      for (const item of low) {
        this.push({
          type: 'low_stock',
          severity: 'warning',
          title: 'نقص في المخزون',
          body: `الكمية المتاحة من «${item.name}» (${item.sku}) هي ${item.qty} وحد إعادة الطلب ${item.minStock}.`,
          dedupeKey: `low_stock:${item.sku}:${today}`
        })
      }
    }

    if (settings.overdueReceivables) {
      const overdue = this.db
        .prepare(
          `SELECT p.id, p.name, SUM(s.total - s.paid_amount - s.returned_amount) AS due
           FROM sales s JOIN parties p ON p.id = s.customer_id
           WHERE s.status = 'confirmed' AND s.total - s.paid_amount - s.returned_amount > 0
             AND julianday('now') - julianday(COALESCE(s.due_date, s.date)) > ?
           GROUP BY p.id LIMIT 30`
        )
        .all(settings.overdueDays) as { id: number; name: string; due: number }[]
      for (const row of overdue) {
        this.push({
          type: 'overdue_receivable',
          severity: 'warning',
          title: 'مستحقات متأخرة على عميل',
          body: `للعميل «${row.name}» مستحقات متأخرة تجاوزت ${settings.overdueDays} يومًا.`,
          refType: 'party',
          refId: row.id,
          dedupeKey: `overdue_receivable:${row.id}:${today}`
        })
      }
    }

    const lateOrders = this.db
      .prepare(
        `SELECT o.id, o.order_number, f.name AS factory
         FROM production_orders o JOIN parties f ON f.id = o.factory_id
         WHERE o.status NOT IN ('completed','cancelled') AND o.expected_date IS NOT NULL
           AND julianday('now') > julianday(o.expected_date) LIMIT 30`
      )
      .all() as { id: number; order_number: string; factory: string }[]
    for (const order of lateOrders) {
      this.push({
        type: 'production_late',
        severity: 'warning',
        title: 'تأخر أمر إنتاج',
        body: `أمر الإنتاج ${order.order_number} لدى «${order.factory}» تجاوز الموعد المتوقع للتسليم.`,
        refType: 'production_order',
        refId: order.id,
        dedupeKey: `production_late:${order.id}:${today}`
      })
    }

    const negative = this.db
      .prepare(
        `SELECT p.name, v.sku, sl.quantity FROM stock_levels sl
         JOIN product_variants v ON v.id = sl.variant_id JOIN products p ON p.id = v.product_id
         WHERE sl.quantity < 0 LIMIT 20`
      )
      .all() as { name: string; sku: string; quantity: number }[]
    for (const item of negative) {
      this.push({
        type: 'negative_stock',
        severity: 'critical',
        title: 'رصيد مخزون سالب',
        body: `رصيد «${item.name}» (${item.sku}) سالب (${item.quantity}). راجع حركات المخزون وسجّل تسوية جرد.`,
        dedupeKey: `negative_stock:${item.sku}:${today}`
      })
    }
  }
}
