import type { Database } from 'better-sqlite3'
import type { Ctx } from '../core/context'
import { checkIntegrity } from '../db/connection'

export interface IntegrityIssue {
  code: string
  title: string
  detail: string
  severity: 'warning' | 'critical'
  fixable: boolean
  count: number
}

/**
 * فحص سلامة البيانات المالية.
 * يقارن القيم المخزَّنة مؤقتًا (مثل «المدفوع» في الفاتورة) بمصدرها الحقيقي،
 * ويتأكد أن كل قيد متوازن وأن أرصدة المخزون تطابق مجموع حركاتها.
 */
export class IntegrityService {
  private readonly db: Database

  constructor(ctx: Ctx) {
    this.db = ctx.db
  }

  run(): { ok: boolean; issues: IntegrityIssue[]; checkedAt: string } {
    const issues: IntegrityIssue[] = []

    const database = checkIntegrity(this.db)
    if (!database.ok) {
      issues.push({
        code: 'db_integrity',
        title: 'مشكلة في ملف قاعدة البيانات',
        detail: database.problems.slice(0, 5).join(' — '),
        severity: 'critical',
        fixable: false,
        count: database.problems.length
      })
    }

    const unbalanced = this.db
      .prepare(
        `SELECT je.id, je.entry_number, SUM(jl.debit) AS d, SUM(jl.credit) AS c
         FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
         GROUP BY je.id HAVING d <> c`
      )
      .all() as { entry_number: string }[]
    if (unbalanced.length) {
      issues.push({
        code: 'unbalanced_entries',
        title: 'قيود غير متوازنة',
        detail: `القيود: ${unbalanced.slice(0, 5).map((e) => e.entry_number).join('، ')}`,
        severity: 'critical',
        fixable: false,
        count: unbalanced.length
      })
    }

    const salePaidMismatch = this.db
      .prepare(
        `SELECT s.id, s.invoice_number, s.paid_amount,
                COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
                          WHERE pa.doc_type = 'sale' AND pa.doc_id = s.id AND p.status = 'confirmed'), 0) AS actual
         FROM sales s WHERE s.paid_amount <> actual`
      )
      .all() as { invoice_number: string }[]
    if (salePaidMismatch.length) {
      issues.push({
        code: 'sale_paid_mismatch',
        title: 'اختلاف في المبالغ المحصَّلة على فواتير البيع',
        detail: `الفواتير: ${salePaidMismatch.slice(0, 5).map((s) => s.invoice_number).join('، ')}`,
        severity: 'warning',
        fixable: true,
        count: salePaidMismatch.length
      })
    }

    const purchasePaidMismatch = this.db
      .prepare(
        `SELECT p.id, p.invoice_number, p.paid_amount,
                COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments pm ON pm.id = pa.payment_id
                          WHERE pa.doc_type = 'purchase' AND pa.doc_id = p.id AND pm.status = 'confirmed'), 0) AS actual
         FROM purchases p WHERE p.paid_amount <> actual`
      )
      .all() as { invoice_number: string }[]
    if (purchasePaidMismatch.length) {
      issues.push({
        code: 'purchase_paid_mismatch',
        title: 'اختلاف في المبالغ المدفوعة على فواتير الشراء',
        detail: `الفواتير: ${purchasePaidMismatch.slice(0, 5).map((p) => p.invoice_number).join('، ')}`,
        severity: 'warning',
        fixable: true,
        count: purchasePaidMismatch.length
      })
    }

    const stockMismatch = this.db
      .prepare(
        `SELECT sl.variant_id, sl.warehouse_id, sl.quantity,
                COALESCE((SELECT SUM(m.qty_in - m.qty_out) FROM stock_movements m
                          WHERE m.variant_id = sl.variant_id AND m.warehouse_id = sl.warehouse_id), 0) AS actual
         FROM stock_levels sl WHERE ABS(sl.quantity - actual) > 0.0001`
      )
      .all() as unknown[]
    if (stockMismatch.length) {
      issues.push({
        code: 'stock_level_mismatch',
        title: 'اختلاف بين أرصدة المخزون وحركاته',
        detail: 'يوجد أصناف رصيدها المخزَّن لا يطابق مجموع حركاتها.',
        severity: 'critical',
        fixable: true,
        count: stockMismatch.length
      })
    }

    const negativeStock = this.db.prepare('SELECT COUNT(*) AS n FROM stock_levels WHERE quantity < 0').get() as { n: number }
    if (negativeStock.n > 0) {
      issues.push({
        code: 'negative_stock',
        title: 'أرصدة مخزون سالبة',
        detail: 'سجّل تسوية جرد لتصحيح الأرصدة السالبة.',
        severity: 'warning',
        fixable: false,
        count: negativeStock.n
      })
    }

    const orphanDocs = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM sales WHERE status = 'confirmed' AND journal_entry_id IS NULL`
      )
      .get() as { n: number }
    if (orphanDocs.n > 0) {
      issues.push({
        code: 'missing_journal',
        title: 'فواتير بدون قيود محاسبية',
        detail: 'توجد فواتير مؤكدة لم يُرحَّل لها قيد. راجع سجل الأخطاء.',
        severity: 'critical',
        fixable: false,
        count: orphanDocs.n
      })
    }

    return { ok: issues.length === 0, issues, checkedAt: new Date().toISOString() }
  }

  /** إصلاح القيم المخزَّنة مؤقتًا بإعادة احتسابها من مصدرها الأصلي */
  repair(): { repaired: string[] } {
    const repaired: string[] = []
    const run = this.db.transaction(() => {
      const salesFixed = this.db
        .prepare(
          `UPDATE sales SET paid_amount = COALESCE(
             (SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
              WHERE pa.doc_type = 'sale' AND pa.doc_id = sales.id AND p.status = 'confirmed'), 0)`
        )
        .run()
      if (salesFixed.changes) repaired.push('تصحيح المبالغ المحصَّلة على فواتير البيع')

      this.db
        .prepare(
          `UPDATE purchases SET paid_amount = COALESCE(
             (SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
              WHERE pa.doc_type = 'purchase' AND pa.doc_id = purchases.id AND p.status = 'confirmed'), 0)`
        )
        .run()
      repaired.push('تصحيح المبالغ المدفوعة على فواتير الشراء')

      this.db
        .prepare(
          `UPDATE stock_levels SET quantity = COALESCE(
             (SELECT SUM(m.qty_in - m.qty_out) FROM stock_movements m
              WHERE m.variant_id = stock_levels.variant_id AND m.warehouse_id = stock_levels.warehouse_id), 0),
             updated_at = datetime('now')`
        )
        .run()
      repaired.push('إعادة احتساب أرصدة المخزون من الحركات')

      this.db
        .prepare(
          `UPDATE sales SET returned_amount = COALESCE(
             (SELECT SUM(r.total) FROM sales_returns r WHERE r.sale_id = sales.id AND r.status = 'confirmed'), 0)`
        )
        .run()
      this.db
        .prepare(
          `UPDATE purchases SET returned_amount = COALESCE(
             (SELECT SUM(r.total) FROM purchase_returns r WHERE r.purchase_id = purchases.id AND r.status = 'confirmed'), 0)`
        )
        .run()
      repaired.push('إعادة احتساب قيم المردودات')
    })
    run.immediate()
    this.db.pragma('wal_checkpoint(TRUNCATE)')
    this.db.pragma('optimize')
    return { repaired }
  }

  /** إحصاءات حجم قاعدة البيانات — تُعرض في شاشة الصيانة */
  stats(): { table: string; rows: number }[] {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
    return tables.map((t) => ({
      table: t.name,
      rows: (this.db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number }).n
    }))
  }

  vacuum(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)')
    this.db.exec('VACUUM')
  }
}
