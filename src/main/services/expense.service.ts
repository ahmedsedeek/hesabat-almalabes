import { todayIso } from '@shared/date'
import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'
import type { Minor } from '@shared/money'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { LedgerService } from '../accounting/ledger'
import { ACC } from '../accounting/chart'
import { NumberingService } from './numbering.service'
import { AuditService } from './audit.service'

export interface ExpenseInput {
  date: string
  categoryId: number
  amount: Minor
  taxAmount?: Minor
  /** حساب الصندوق/البنك؛ اتركه فارغًا لتسجيل المصروف كمستحق على طرف */
  paymentAccountId?: number | null
  methodId?: number | null
  partyId?: number | null
  description?: string | null
  notes?: string | null
}

export interface ExpenseFilters {
  from?: string
  to?: string
  categoryId?: number
  partyId?: number
  status?: 'confirmed' | 'void'
  search?: string
  page?: number
  pageSize?: number
}

/**
 * المصروفات التشغيلية.
 * كل مصروف يزيد حساب المصروف ويُنقص النقدية (إن كان مدفوعًا) أو يزيد المستحق على طرف (إن كان آجلًا).
 */
export class ExpenseService {
  private readonly db: Database
  private readonly ledger: LedgerService
  private readonly numbering: NumberingService
  private readonly audit: AuditService

  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db
    this.ledger = new LedgerService(ctx)
    this.numbering = new NumberingService(ctx.db)
    this.audit = new AuditService(ctx)
  }

  create(input: ExpenseInput): { id: number; expenseNumber: string } {
    const amount = Math.round(input.amount)
    if (!(amount > 0)) throw ERRORS.validation('قيمة المصروف يجب أن تكون أكبر من صفر.', 'amount')
    const category = this.db
      .prepare('SELECT c.*, a.id AS account_id FROM expense_categories c JOIN accounts a ON a.id = c.account_id WHERE c.id = ?')
      .get(input.categoryId) as { id: number; name: string; account_id: number } | undefined
    if (!category) throw ERRORS.notFound('فئة المصروف')

    const taxAmount = Math.max(0, Math.round(input.taxAmount ?? 0))
    const total = amount + taxAmount
    if (!input.paymentAccountId && !input.partyId) {
      throw ERRORS.validation('حدّد طريقة الدفع أو الطرف المستحق عليه المصروف.', 'paymentAccountId')
    }

    let party: { id: number; party_type: 'customer' | 'supplier' | 'factory'; name: string } | null = null
    if (input.partyId && !input.paymentAccountId) {
      party = this.db.prepare('SELECT id, party_type, name FROM parties WHERE id = ?').get(input.partyId) as never
      if (!party) throw ERRORS.notFound('الطرف')
    }

    const run = this.db.transaction(() => {
      const expenseNumber = this.numbering.next('expense', new Date(input.date))
      const info = this.db
        .prepare(
          `INSERT INTO expenses (expense_number, date, category_id, amount, tax_amount, total,
                                 payment_account_id, party_id, method_id, description, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          expenseNumber,
          input.date,
          input.categoryId,
          amount,
          taxAmount,
          total,
          input.paymentAccountId ?? null,
          input.partyId ?? null,
          input.methodId ?? null,
          input.description ?? null,
          input.notes ?? null,
          actorId(this.ctx)
        )
      const expenseId = Number(info.lastInsertRowid)

      const entryId = this.ledger.post({
        date: input.date,
        refType: 'expense',
        refId: expenseId,
        refNumber: expenseNumber,
        description: `${category.name}${input.description ? ` — ${input.description}` : ''}`,
        lines: [
          { accountId: category.account_id, debit: amount },
          { accountKey: ACC.TAX_INPUT, debit: taxAmount },
          input.paymentAccountId
            ? { accountId: input.paymentAccountId, credit: total }
            : {
                accountKey: this.ledger.controlAccountKey(party!.party_type),
                partyId: party!.id,
                credit: total,
                description: `مصروف ${expenseNumber}`
              }
        ]
      })
      this.db.prepare('UPDATE expenses SET journal_entry_id = ? WHERE id = ?').run(entryId, expenseId)
      return { expenseId, expenseNumber }
    })

    const result = run.immediate()
    this.audit.log({
      action: 'create',
      entityType: 'expense',
      entityId: result.expenseId,
      entityLabel: result.expenseNumber,
      newValue: { categoryId: input.categoryId, amount: total }
    })
    return { id: result.expenseId, expenseNumber: result.expenseNumber }
  }

  void(id: number, reason: string): void {
    if (!reason?.trim()) throw ERRORS.validation('يجب إدخال سبب الإلغاء.', 'reason')
    const expense = this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!expense) throw ERRORS.notFound('المصروف')
    if (expense.status === 'void') throw ERRORS.conflict('المصروف ملغى بالفعل.')
    const date = todayIso()
    const run = this.db.transaction(() => {
      if (expense.journal_entry_id) {
        this.ledger.reverse(expense.journal_entry_id as number, date, `إلغاء مصروف ${expense.expense_number}: ${reason}`)
      }
      this.db.prepare("UPDATE expenses SET status = 'void', void_reason = ? WHERE id = ?").run(reason, id)
    })
    run.immediate()
    this.audit.log({ action: 'void', entityType: 'expense', entityId: id, entityLabel: String(expense.expense_number), reason, severity: 'critical' })
  }

  get(id: number): Record<string, unknown> {
    const row = this.db
      .prepare(
        `SELECT e.*, c.name AS category_name, a.name AS payment_account_name, p.name AS party_name,
                pm.name AS method_name, u.full_name AS created_by_name
         FROM expenses e JOIN expense_categories c ON c.id = e.category_id
         LEFT JOIN accounts a ON a.id = e.payment_account_id
         LEFT JOIN parties p ON p.id = e.party_id
         LEFT JOIN payment_methods pm ON pm.id = e.method_id
         LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    if (!row) throw ERRORS.notFound('المصروف')
    return row
  }

  list(filters: ExpenseFilters = {}): { rows: Record<string, unknown>[]; total: number; summary: Record<string, number> } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.from) { where.push('e.date >= @from'); params.from = filters.from }
    if (filters.to) { where.push('e.date <= @to'); params.to = filters.to }
    if (filters.categoryId) { where.push('e.category_id = @categoryId'); params.categoryId = filters.categoryId }
    if (filters.partyId) { where.push('e.party_id = @partyId'); params.partyId = filters.partyId }
    if (filters.status) { where.push('e.status = @status'); params.status = filters.status }
    if (filters.search) {
      where.push('(e.expense_number LIKE @search OR e.description LIKE @search OR c.name LIKE @search OR e.notes LIKE @search)')
      params.search = `%${filters.search}%`
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 50))

    const summary = this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN e.status = 'confirmed' THEN e.total ELSE 0 END),0) AS total
         FROM expenses e JOIN expense_categories c ON c.id = e.category_id ${clause}`
      )
      .get(params) as Record<string, number>

    const rows = this.db
      .prepare(
        `SELECT e.*, c.name AS category_name, a.name AS payment_account_name, p.name AS party_name, pm.name AS method_name
         FROM expenses e JOIN expense_categories c ON c.id = e.category_id
         LEFT JOIN accounts a ON a.id = e.payment_account_id
         LEFT JOIN parties p ON p.id = e.party_id
         LEFT JOIN payment_methods pm ON pm.id = e.method_id
         ${clause} ORDER BY e.date DESC, e.id DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[]

    return { rows, total: summary.count, summary }
  }

  byCategory(from: string, to: string): { categoryId: number; name: string; total: number; count: number }[] {
    return this.db
      .prepare(
        `SELECT c.id AS categoryId, c.name, COALESCE(SUM(e.total),0) AS total, COUNT(e.id) AS count
         FROM expense_categories c
         LEFT JOIN expenses e ON e.category_id = c.id AND e.status = 'confirmed' AND e.date >= ? AND e.date <= ?
         GROUP BY c.id HAVING total > 0 ORDER BY total DESC`
      )
      .all(from, to) as { categoryId: number; name: string; total: number; count: number }[]
  }

  // ------------------------- فئات المصروفات -------------------------

  listCategories(activeOnly = false): Record<string, unknown>[] {
    const clause = activeOnly ? 'WHERE c.is_active = 1' : ''
    return this.db
      .prepare(
        `SELECT c.*, a.name AS account_name, a.code AS account_code,
                (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id) AS usage_count
         FROM expense_categories c JOIN accounts a ON a.id = c.account_id ${clause} ORDER BY c.name`
      )
      .all() as Record<string, unknown>[]
  }

  createCategory(name: string, accountId?: number): number {
    if (!name.trim()) throw ERRORS.validation('اسم الفئة مطلوب.', 'name')
    if (this.db.prepare('SELECT id FROM expense_categories WHERE name = ?').get(name.trim())) {
      throw ERRORS.conflict('توجد فئة مصروفات بنفس الاسم.')
    }
    let targetAccount = accountId
    if (!targetAccount) {
      // إنشاء حساب مصروف جديد تحت مجموعة المصروفات التشغيلية
      const parent = this.ledger.accountByKey(ACC.EXPENSE_ROOT)
      const last = this.db
        .prepare("SELECT code FROM accounts WHERE parent_id = ? ORDER BY code DESC LIMIT 1")
        .get(parent.id) as { code: string } | undefined
      const nextCode = String(Number(last?.code ?? '6000') + 1)
      const info = this.db
        .prepare("INSERT INTO accounts (code, name, type, parent_id, is_group) VALUES (?, ?, 'expense', ?, 0)")
        .run(nextCode, name.trim(), parent.id)
      targetAccount = Number(info.lastInsertRowid)
    }
    const info = this.db.prepare('INSERT INTO expense_categories (name, account_id) VALUES (?, ?)').run(name.trim(), targetAccount)
    return Number(info.lastInsertRowid)
  }

  updateCategory(id: number, patch: { name?: string; accountId?: number; isActive?: boolean }): void {
    this.db
      .prepare(
        'UPDATE expense_categories SET name = COALESCE(?, name), account_id = COALESCE(?, account_id), is_active = COALESCE(?, is_active) WHERE id = ?'
      )
      .run(patch.name?.trim() ?? null, patch.accountId ?? null, patch.isActive === undefined ? null : patch.isActive ? 1 : 0, id)
  }

  deleteCategory(id: number): void {
    const used = this.db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE category_id = ?').get(id) as { n: number }
    if (used.n > 0) throw ERRORS.conflict('لا يمكن حذف فئة مستخدمة في مصروفات مسجّلة. يمكنك تعطيلها.')
    this.db.prepare('DELETE FROM expense_categories WHERE id = ?').run(id)
  }
}
