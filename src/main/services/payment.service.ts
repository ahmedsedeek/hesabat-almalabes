import { todayIso } from '@shared/date'
import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'
import type { Minor } from '@shared/money'
import type { PartyType, PaymentDirection } from '@shared/types'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { LedgerService } from '../accounting/ledger'
import { ACC } from '../accounting/chart'
import { NumberingService } from './numbering.service'
import { AuditService } from './audit.service'

export interface AllocationInput {
  docType: 'sale' | 'purchase' | 'production_order'
  docId: number
  amount: Minor
}

export interface PaymentInput {
  date: string
  direction: PaymentDirection
  partyId?: number | null
  amount: Minor
  methodId: number
  /** حساب الصندوق/البنك — يُؤخذ من طريقة الدفع إن لم يُحدَّد */
  accountId?: number
  reference?: string | null
  notes?: string | null
  allocations?: AllocationInput[]
}

export interface OpenDocument {
  docType: 'sale' | 'purchase'
  docId: number
  number: string
  date: string
  total: number
  paid: number
  remaining: number
}

export interface PaymentFilters {
  from?: string
  to?: string
  direction?: PaymentDirection
  partyId?: number
  partyType?: PartyType
  methodId?: number
  status?: 'confirmed' | 'void'
  search?: string
  page?: number
  pageSize?: number
}

/**
 * المدفوعات والمقبوضات.
 * سند القبض:  مدين الصندوق/البنك   /   دائن ذمم العميل
 * سند الصرف:  مدين ذمم المورد/المصنع /  دائن الصندوق/البنك
 * التخصيص على الفواتير يُحدِّث حقل «المدفوع» المخزَّن في الفاتورة داخل نفس المعاملة.
 */
export class PaymentService {
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

  create(input: PaymentInput): { id: number; paymentNumber: string } {
    const amount = Math.round(input.amount)
    if (!(amount > 0)) throw ERRORS.validation('قيمة السند يجب أن تكون أكبر من صفر.', 'amount')
    if (!input.date) throw ERRORS.validation('تاريخ السند مطلوب.', 'date')

    const method = this.db.prepare('SELECT * FROM payment_methods WHERE id = ? AND is_active = 1').get(input.methodId) as
      | { id: number; name: string; account_id: number }
      | undefined
    if (!method) throw ERRORS.notFound('طريقة الدفع')
    const accountId = input.accountId ?? method.account_id

    let party: { id: number; name: string; party_type: PartyType } | null = null
    if (input.partyId) {
      party = this.db.prepare('SELECT id, name, party_type FROM parties WHERE id = ?').get(input.partyId) as
        | { id: number; name: string; party_type: PartyType }
        | undefined ?? null
      if (!party) throw ERRORS.notFound('الطرف')
      if (input.direction === 'in' && party.party_type !== 'customer') {
        // يُسمح باستقبال مبالغ من مورد (مثل استرداد) لكن يُسجَّل على حسابه الرقابي الصحيح
      }
    }

    const allocations = (input.allocations ?? []).filter((a) => a.amount > 0)
    const allocatedTotal = allocations.reduce((s, a) => s + Math.round(a.amount), 0)
    if (allocatedTotal > amount) throw ERRORS.validation('مجموع المبالغ الموزَّعة على الفواتير أكبر من قيمة السند.')

    const run = this.db.transaction(() => {
      const docType = input.direction === 'in' ? 'payment_in' : 'payment_out'
      const paymentNumber = this.numbering.next(docType, new Date(input.date))
      const info = this.db
        .prepare(
          `INSERT INTO payments (payment_number, date, direction, party_id, party_type, amount, method_id,
                                 account_id, reference, notes, created_by)
           VALUES (@paymentNumber, @date, @direction, @partyId, @partyType, @amount, @methodId,
                   @accountId, @reference, @notes, @createdBy)`
        )
        .run({
          paymentNumber,
          date: input.date,
          direction: input.direction,
          partyId: party?.id ?? null,
          partyType: party?.party_type ?? null,
          amount,
          methodId: input.methodId,
          accountId,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          createdBy: actorId(this.ctx)
        })
      const paymentId = Number(info.lastInsertRowid)

      // التخصيص على الفواتير
      const insertAlloc = this.db.prepare(
        'INSERT INTO payment_allocations (payment_id, doc_type, doc_id, amount) VALUES (?, ?, ?, ?)'
      )
      for (const alloc of allocations) {
        this.assertAllocationFits(alloc)
        insertAlloc.run(paymentId, alloc.docType, alloc.docId, Math.round(alloc.amount))
        this.applyAllocationToDoc(alloc.docType, alloc.docId, Math.round(alloc.amount))
      }

      const controlKey = party ? this.ledger.controlAccountKey(party.party_type) : ACC.OPENING_BALANCE_EQUITY
      const description = party
        ? `${input.direction === 'in' ? 'سند قبض' : 'سند صرف'} ${paymentNumber} — ${party.name}`
        : `${input.direction === 'in' ? 'سند قبض' : 'سند صرف'} ${paymentNumber}`

      const entryId = this.ledger.post({
        date: input.date,
        refType: 'payment',
        refId: paymentId,
        refNumber: paymentNumber,
        description,
        lines:
          input.direction === 'in'
            ? [
                { accountId, debit: amount, description: method.name },
                { accountKey: controlKey, partyId: party?.id ?? null, credit: amount, description }
              ]
            : [
                { accountKey: controlKey, partyId: party?.id ?? null, debit: amount, description },
                { accountId, credit: amount, description: method.name }
              ]
      })
      this.db.prepare('UPDATE payments SET journal_entry_id = ? WHERE id = ?').run(entryId, paymentId)
      return { paymentId, paymentNumber }
    })

    const result = run.immediate()
    this.audit.log({
      action: 'create',
      entityType: 'payment',
      entityId: result.paymentId,
      entityLabel: result.paymentNumber,
      newValue: { direction: input.direction, amount, partyId: input.partyId, allocations: allocations.length }
    })
    return { id: result.paymentId, paymentNumber: result.paymentNumber }
  }

  private assertAllocationFits(alloc: AllocationInput): void {
    if (alloc.docType === 'production_order') return
    const table = alloc.docType === 'sale' ? 'sales' : 'purchases'
    const doc = this.db
      .prepare(`SELECT invoice_number, total, paid_amount, returned_amount, status FROM ${table} WHERE id = ?`)
      .get(alloc.docId) as
      | { invoice_number: string; total: number; paid_amount: number; returned_amount: number; status: string }
      | undefined
    if (!doc) throw ERRORS.notFound('الفاتورة المحددة')
    if (doc.status !== 'confirmed') throw ERRORS.conflict('لا يمكن تخصيص دفعة على فاتورة ملغاة أو مسودة.')
    const remaining = doc.total - doc.paid_amount - doc.returned_amount
    if (Math.round(alloc.amount) > remaining) {
      throw ERRORS.validation(`المبلغ المخصَّص للفاتورة ${doc.invoice_number} أكبر من المتبقي عليها.`)
    }
  }

  private applyAllocationToDoc(docType: string, docId: number, delta: Minor): void {
    if (docType === 'sale') {
      this.db.prepare('UPDATE sales SET paid_amount = paid_amount + ? WHERE id = ?').run(delta, docId)
    } else if (docType === 'purchase') {
      this.db.prepare('UPDATE purchases SET paid_amount = paid_amount + ? WHERE id = ?').run(delta, docId)
    }
  }

  void(id: number, reason: string): void {
    if (!reason?.trim()) throw ERRORS.validation('يجب إدخال سبب الإلغاء.', 'reason')
    const payment = this.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!payment) throw ERRORS.notFound('السند')
    if (payment.status === 'void') throw ERRORS.conflict('السند ملغى بالفعل.')
    const date = todayIso()

    const run = this.db.transaction(() => {
      const allocations = this.db.prepare('SELECT * FROM payment_allocations WHERE payment_id = ?').all(id) as {
        doc_type: string
        doc_id: number
        amount: number
      }[]
      for (const alloc of allocations) {
        this.applyAllocationToDoc(alloc.doc_type, alloc.doc_id, -alloc.amount)
      }
      if (payment.journal_entry_id) {
        this.ledger.reverse(payment.journal_entry_id as number, date, `إلغاء سند ${payment.payment_number}: ${reason}`)
      }
      this.db
        .prepare("UPDATE payments SET status = 'void', void_reason = ?, voided_at = datetime('now'), voided_by = ? WHERE id = ?")
        .run(reason, actorId(this.ctx), id)
    })
    run.immediate()
    this.audit.log({
      action: 'void',
      entityType: 'payment',
      entityId: id,
      entityLabel: String(payment.payment_number),
      oldValue: { amount: payment.amount },
      reason,
      severity: 'critical'
    })
  }

  get(id: number): Record<string, unknown> {
    const payment = this.db
      .prepare(
        `SELECT p.*, pm.name AS method_name, a.name AS account_name, pa.name AS party_name, pa.code AS party_code,
                pa.phone AS party_phone, u.full_name AS created_by_name
         FROM payments p JOIN payment_methods pm ON pm.id = p.method_id
         JOIN accounts a ON a.id = p.account_id
         LEFT JOIN parties pa ON pa.id = p.party_id
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    if (!payment) throw ERRORS.notFound('السند')
    const allocations = this.db
      .prepare(
        `SELECT al.*,
                CASE al.doc_type WHEN 'sale' THEN (SELECT invoice_number FROM sales WHERE id = al.doc_id)
                                 WHEN 'purchase' THEN (SELECT invoice_number FROM purchases WHERE id = al.doc_id)
                                 ELSE (SELECT order_number FROM production_orders WHERE id = al.doc_id) END AS doc_number,
                CASE al.doc_type WHEN 'sale' THEN (SELECT date FROM sales WHERE id = al.doc_id)
                                 WHEN 'purchase' THEN (SELECT date FROM purchases WHERE id = al.doc_id)
                                 ELSE (SELECT date FROM production_orders WHERE id = al.doc_id) END AS doc_date
         FROM payment_allocations al WHERE al.payment_id = ?`
      )
      .all(id) as Record<string, unknown>[]
    return { ...payment, allocations }
  }

  list(filters: PaymentFilters = {}): { rows: Record<string, unknown>[]; total: number; summary: Record<string, number> } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.from) { where.push('p.date >= @from'); params.from = filters.from }
    if (filters.to) { where.push('p.date <= @to'); params.to = filters.to }
    if (filters.direction) { where.push('p.direction = @direction'); params.direction = filters.direction }
    if (filters.partyId) { where.push('p.party_id = @partyId'); params.partyId = filters.partyId }
    if (filters.partyType) { where.push('p.party_type = @partyType'); params.partyType = filters.partyType }
    if (filters.methodId) { where.push('p.method_id = @methodId'); params.methodId = filters.methodId }
    if (filters.status) { where.push('p.status = @status'); params.status = filters.status }
    if (filters.search) {
      where.push('(p.payment_number LIKE @search OR pa.name LIKE @search OR p.reference LIKE @search OR p.notes LIKE @search)')
      params.search = `%${filters.search}%`
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 50))

    const summary = this.db
      .prepare(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN p.direction = 'in' AND p.status = 'confirmed' THEN p.amount ELSE 0 END),0) AS totalIn,
                COALESCE(SUM(CASE WHEN p.direction = 'out' AND p.status = 'confirmed' THEN p.amount ELSE 0 END),0) AS totalOut
         FROM payments p LEFT JOIN parties pa ON pa.id = p.party_id ${clause}`
      )
      .get(params) as Record<string, number>

    const rows = this.db
      .prepare(
        `SELECT p.id, p.payment_number, p.date, p.direction, p.amount, p.status, p.reference, p.notes,
                pa.name AS party_name, pa.code AS party_code, pm.name AS method_name, a.name AS account_name,
                COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id = p.id), 0) AS allocated
         FROM payments p
         LEFT JOIN parties pa ON pa.id = p.party_id
         JOIN payment_methods pm ON pm.id = p.method_id
         JOIN accounts a ON a.id = p.account_id
         ${clause} ORDER BY p.date DESC, p.id DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[]

    return { rows, total: summary.count, summary }
  }

  /** الفواتير المفتوحة لطرف — لشاشة تخصيص الدفعة */
  openDocuments(partyId: number): OpenDocument[] {
    const party = this.db.prepare('SELECT party_type FROM parties WHERE id = ?').get(partyId) as { party_type: PartyType } | undefined
    if (!party) throw ERRORS.notFound('الطرف')
    const isCustomer = party.party_type === 'customer'
    const table = isCustomer ? 'sales' : 'purchases'
    const column = isCustomer ? 'customer_id' : 'supplier_id'
    const rows = this.db
      .prepare(
        `SELECT id AS docId, invoice_number AS number, date, total, paid_amount AS paid,
                total - paid_amount - returned_amount AS remaining
         FROM ${table} WHERE ${column} = ? AND status = 'confirmed'
           AND total - paid_amount - returned_amount > 0
         ORDER BY date`
      )
      .all(partyId) as Omit<OpenDocument, 'docType'>[]
    return rows.map((row) => ({ ...row, docType: isCustomer ? ('sale' as const) : ('purchase' as const) }))
  }

  listMethods(activeOnly = true): Record<string, unknown>[] {
    const clause = activeOnly ? 'WHERE pm.is_active = 1' : ''
    return this.db
      .prepare(
        `SELECT pm.*, a.name AS account_name, a.subtype AS account_subtype
         FROM payment_methods pm JOIN accounts a ON a.id = pm.account_id ${clause}
         ORDER BY pm.sort_order, pm.name`
      )
      .all() as Record<string, unknown>[]
  }

  createMethod(name: string, accountId: number): number {
    if (!name.trim()) throw ERRORS.validation('اسم طريقة الدفع مطلوب.', 'name')
    if (this.db.prepare('SELECT id FROM payment_methods WHERE name = ?').get(name.trim())) {
      throw ERRORS.conflict('توجد طريقة دفع بنفس الاسم.')
    }
    const info = this.db.prepare('INSERT INTO payment_methods (name, account_id) VALUES (?, ?)').run(name.trim(), accountId)
    return Number(info.lastInsertRowid)
  }

  updateMethod(id: number, patch: { name?: string; accountId?: number; isActive?: boolean }): void {
    this.db
      .prepare(
        `UPDATE payment_methods SET name = COALESCE(?, name), account_id = COALESCE(?, account_id), is_active = COALESCE(?, is_active) WHERE id = ?`
      )
      .run(patch.name?.trim() ?? null, patch.accountId ?? null, patch.isActive === undefined ? null : patch.isActive ? 1 : 0, id)
  }

  // ------------------------- حركات الخزينة -------------------------

  createCashTransaction(input: {
    date: string
    trxType: 'deposit' | 'withdraw' | 'transfer'
    fromAccountId?: number | null
    toAccountId?: number | null
    amount: Minor
    description?: string | null
  }): { id: number; trxNumber: string } {
    const amount = Math.round(input.amount)
    if (!(amount > 0)) throw ERRORS.validation('المبلغ يجب أن يكون أكبر من صفر.', 'amount')

    // إيداع: من رأس المال/حساب خارجي إلى الصندوق أو البنك. سحب: العكس. تحويل: بين حسابين نقديين.
    const capitalId = this.ledger.accountIdByKey(ACC.CAPITAL)
    const from = input.trxType === 'deposit' ? (input.fromAccountId ?? capitalId) : input.fromAccountId
    const to = input.trxType === 'withdraw' ? (input.toAccountId ?? capitalId) : input.toAccountId
    if (!from || !to) throw ERRORS.validation('يجب تحديد الحساب المصدر والحساب المستقبل.')
    if (from === to) throw ERRORS.validation('لا يمكن التحويل من وإلى نفس الحساب.')

    const run = this.db.transaction(() => {
      const trxNumber = this.numbering.next('cash_transaction', new Date(input.date))
      const info = this.db
        .prepare(
          `INSERT INTO cash_transactions (trx_number, date, trx_type, from_account_id, to_account_id, amount, description, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(trxNumber, input.date, input.trxType, from, to, amount, input.description ?? null, actorId(this.ctx))
      const trxId = Number(info.lastInsertRowid)
      const entryId = this.ledger.post({
        date: input.date,
        refType: 'cash',
        refId: trxId,
        refNumber: trxNumber,
        description: input.description ?? 'حركة خزينة',
        lines: [
          { accountId: to, debit: amount },
          { accountId: from, credit: amount }
        ]
      })
      this.db.prepare('UPDATE cash_transactions SET journal_entry_id = ? WHERE id = ?').run(entryId, trxId)
      return { trxId, trxNumber }
    })
    const result = run.immediate()
    this.audit.log({ action: 'create', entityType: 'cash_transaction', entityId: result.trxId, entityLabel: result.trxNumber, newValue: input })
    return { id: result.trxId, trxNumber: result.trxNumber }
  }

  voidCashTransaction(id: number, reason: string): void {
    const trx = this.db.prepare('SELECT * FROM cash_transactions WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!trx) throw ERRORS.notFound('حركة الخزينة')
    if (trx.status === 'void') throw ERRORS.conflict('الحركة ملغاة بالفعل.')
    const date = todayIso()
    const run = this.db.transaction(() => {
      if (trx.journal_entry_id) this.ledger.reverse(trx.journal_entry_id as number, date, reason)
      this.db.prepare("UPDATE cash_transactions SET status = 'void', void_reason = ? WHERE id = ?").run(reason, id)
    })
    run.immediate()
    this.audit.log({ action: 'void', entityType: 'cash_transaction', entityId: id, reason, severity: 'critical' })
  }

  listCashTransactions(filters: { from?: string; to?: string; accountId?: number } = {}): Record<string, unknown>[] {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.from) { where.push('t.date >= @from'); params.from = filters.from }
    if (filters.to) { where.push('t.date <= @to'); params.to = filters.to }
    if (filters.accountId) { where.push('(t.from_account_id = @accountId OR t.to_account_id = @accountId)'); params.accountId = filters.accountId }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return this.db
      .prepare(
        `SELECT t.*, af.name AS from_account_name, at.name AS to_account_name
         FROM cash_transactions t
         LEFT JOIN accounts af ON af.id = t.from_account_id
         LEFT JOIN accounts at ON at.id = t.to_account_id
         ${clause} ORDER BY t.date DESC, t.id DESC LIMIT 500`
      )
      .all(params) as Record<string, unknown>[]
  }
}
