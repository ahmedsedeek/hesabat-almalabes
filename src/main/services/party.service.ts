import { todayIso } from '@shared/date'
import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'
import type { PartyRecord, PartyType, PartyWithBalance, Statement, StatementLine } from '@shared/types'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { LedgerService } from '../accounting/ledger'
import { ACC } from '../accounting/chart'
import { AuditService } from './audit.service'

export interface PartyInput {
  partyType: PartyType
  code?: string
  name: string
  companyName?: string | null
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  taxNumber?: string | null
  commercialReg?: string | null
  contactPerson?: string | null
  openingBalance?: number
  openingDate?: string | null
  creditLimit?: number
  paymentTermsDays?: number
  notes?: string | null
  isActive?: boolean
}

export interface PartyFilters {
  partyType?: PartyType
  search?: string
  activeOnly?: boolean
  withBalanceOnly?: boolean
  page?: number
  pageSize?: number
  sortBy?: 'name' | 'code' | 'balance' | 'created'
  sortDir?: 'asc' | 'desc'
}

const TYPE_LABEL: Record<PartyType, string> = {
  customer: 'العميل',
  supplier: 'المورد',
  factory: 'المصنع'
}

const CODE_PREFIX: Record<PartyType, string> = { customer: 'C', supplier: 'S', factory: 'F' }

function rowToParty(row: Record<string, unknown>): PartyRecord {
  return {
    id: row.id as number,
    partyType: row.party_type as PartyType,
    code: row.code as string,
    name: row.name as string,
    companyName: row.company_name as string | null,
    phone: row.phone as string | null,
    whatsapp: row.whatsapp as string | null,
    email: row.email as string | null,
    address: row.address as string | null,
    city: row.city as string | null,
    taxNumber: row.tax_number as string | null,
    commercialReg: row.commercial_reg as string | null,
    contactPerson: row.contact_person as string | null,
    openingBalance: row.opening_balance as number,
    openingDate: row.opening_date as string | null,
    creditLimit: row.credit_limit as number,
    paymentTermsDays: row.payment_terms_days as number,
    notes: row.notes as string | null,
    isActive: row.is_active === 1,
    createdAt: row.created_at as string
  }
}

/**
 * العملاء والموردون والمصانع.
 * الرصيد لا يُخزَّن في جدول الأطراف بل يُشتق دائمًا من دفتر الأستاذ،
 * والرصيد الافتتاحي يُسجَّل كقيد محاسبي حقيقي مقابل حساب «أرصدة افتتاحية».
 */
export class PartyService {
  private readonly db: Database
  private readonly ledger: LedgerService
  private readonly audit: AuditService

  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db
    this.ledger = new LedgerService(ctx)
    this.audit = new AuditService(ctx)
  }

  nextCode(partyType: PartyType): string {
    const row = this.db
      .prepare(
        `SELECT code FROM parties WHERE party_type = ? AND code GLOB ? ORDER BY LENGTH(code) DESC, code DESC LIMIT 1`
      )
      .get(partyType, `${CODE_PREFIX[partyType]}[0-9]*`) as { code: string } | undefined
    const last = row ? Number(row.code.slice(1)) : 0
    return `${CODE_PREFIX[partyType]}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`
  }

  get(id: number): PartyRecord {
    const row = this.db.prepare('SELECT * FROM parties WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw ERRORS.notFound('الطرف')
    return rowToParty(row)
  }

  getWithBalance(id: number): PartyWithBalance {
    const party = this.get(id)
    return { ...party, ...this.balanceSummary(id, party.partyType) }
  }

  private balanceSummary(id: number, partyType: PartyType): {
    balance: number
    totalInvoiced: number
    totalPaid: number
    openInvoices: number
    lastTransactionDate: string | null
  } {
    const balance = this.ledger.partyBalance(id)
    const docTable = partyType === 'customer' ? 'sales' : 'purchases'
    const idColumn = partyType === 'customer' ? 'customer_id' : 'supplier_id'
    let totalInvoiced = 0
    let openInvoices = 0
    if (partyType !== 'factory') {
      const row = this.db
        .prepare(
          `SELECT COALESCE(SUM(total),0) AS total,
                  SUM(CASE WHEN total - paid_amount - returned_amount > 0 THEN 1 ELSE 0 END) AS open
           FROM ${docTable} WHERE ${idColumn} = ? AND status = 'confirmed'`
        )
        .get(id) as { total: number; open: number | null }
      totalInvoiced = row.total
      openInvoices = row.open ?? 0
    }
    const paid = this.db
      .prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE party_id = ? AND status = 'confirmed'")
      .get(id) as { total: number }
    const last = this.db
      .prepare(
        `SELECT MAX(je.date) AS d FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE jl.party_id = ?`
      )
      .get(id) as { d: string | null }
    return { balance, totalInvoiced, totalPaid: paid.total, openInvoices, lastTransactionDate: last.d }
  }

  list(filters: PartyFilters = {}): { rows: PartyWithBalance[]; total: number } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.partyType) { where.push('p.party_type = @partyType'); params.partyType = filters.partyType }
    if (filters.activeOnly) where.push('p.is_active = 1')
    if (filters.search) {
      where.push('(p.name LIKE @search OR p.code LIKE @search OR p.phone LIKE @search OR p.company_name LIKE @search OR p.whatsapp LIKE @search)')
      params.search = `%${filters.search}%`
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    // الرصيد يُحسب داخل الاستعلام لتفادي استدعاء منفصل لكل طرف عند وجود آلاف السجلات
    const balanceExpr = `COALESCE((
        SELECT CASE WHEN p.party_type = 'customer'
                    THEN SUM(jl.debit) - SUM(jl.credit)
                    ELSE SUM(jl.credit) - SUM(jl.debit) END
        FROM journal_lines jl WHERE jl.party_id = p.id), 0)`

    const sortColumn =
      filters.sortBy === 'balance' ? 'balance' : filters.sortBy === 'code' ? 'p.code' : filters.sortBy === 'created' ? 'p.created_at' : 'p.name'
    const dir = filters.sortDir === 'desc' ? 'DESC' : 'ASC'
    const having = filters.withBalanceOnly ? 'HAVING balance <> 0' : ''
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 50))

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS n FROM (SELECT p.id, ${balanceExpr} AS balance FROM parties p ${clause} ${having})`)
      .get(params) as { n: number }

    const rows = this.db
      .prepare(
        `SELECT p.*, ${balanceExpr} AS balance
         FROM parties p ${clause} ${having}
         ORDER BY ${sortColumn} ${dir}
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[]

    return {
      rows: rows.map((row) => ({
        ...rowToParty(row),
        balance: row.balance as number,
        totalInvoiced: 0,
        totalPaid: 0,
        openInvoices: 0,
        lastTransactionDate: null
      })),
      total: totalRow.n
    }
  }

  /** بحث سريع للاستخدام في قوائم الاختيار */
  search(partyType: PartyType, term: string, limit = 20): PartyRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM parties
         WHERE party_type = ? AND is_active = 1
           AND (name LIKE @t OR code LIKE @t OR phone LIKE @t OR company_name LIKE @t)
         ORDER BY name LIMIT @limit`
      )
      .all(partyType, { t: `%${term}%`, limit }) as Record<string, unknown>[]
    return rows.map(rowToParty)
  }

  create(input: PartyInput): number {
    const name = input.name?.trim()
    if (!name) throw ERRORS.validation(`اسم ${TYPE_LABEL[input.partyType]} مطلوب.`, 'name')
    const code = (input.code?.trim() || this.nextCode(input.partyType)).toUpperCase()
    const exists = this.db
      .prepare('SELECT id FROM parties WHERE party_type = ? AND code = ?')
      .get(input.partyType, code)
    if (exists) throw ERRORS.conflict(`الكود «${code}» مستخدم بالفعل.`)

    const openingBalance = Math.round(input.openingBalance ?? 0)
    const openingDate = input.openingDate ?? todayIso()

    const run = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO parties (party_type, code, name, company_name, phone, whatsapp, email, address, city,
                                tax_number, commercial_reg, contact_person, opening_balance, opening_date,
                                credit_limit, payment_terms_days, notes, is_active, created_by)
           VALUES (@partyType, @code, @name, @companyName, @phone, @whatsapp, @email, @address, @city,
                   @taxNumber, @commercialReg, @contactPerson, @openingBalance, @openingDate,
                   @creditLimit, @paymentTermsDays, @notes, @isActive, @createdBy)`
        )
        .run({
          partyType: input.partyType,
          code,
          name,
          companyName: input.companyName ?? null,
          phone: input.phone ?? null,
          whatsapp: input.whatsapp ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          city: input.city ?? null,
          taxNumber: input.taxNumber ?? null,
          commercialReg: input.commercialReg ?? null,
          contactPerson: input.contactPerson ?? null,
          openingBalance,
          openingDate,
          creditLimit: Math.round(input.creditLimit ?? 0),
          paymentTermsDays: input.paymentTermsDays ?? 0,
          notes: input.notes ?? null,
          isActive: input.isActive === false ? 0 : 1,
          createdBy: actorId(this.ctx)
        })
      const id = Number(info.lastInsertRowid)
      if (openingBalance !== 0) this.postOpeningEntry(id, input.partyType, openingBalance, openingDate)
      return id
    })
    const id = run.immediate()
    this.audit.log({ action: 'create', entityType: 'party', entityId: id, entityLabel: `${code} - ${name}`, newValue: { ...input, code } })
    return id
  }

  private postOpeningEntry(partyId: number, partyType: PartyType, amount: number, date: string): void {
    const controlKey = this.ledger.controlAccountKey(partyType)
    const isCustomer = partyType === 'customer'
    this.ledger.post({
      date,
      refType: 'opening',
      refId: partyId,
      refNumber: `OPEN-${partyId}`,
      description: `رصيد افتتاحي — ${TYPE_LABEL[partyType]}`,
      lines: isCustomer
        ? [
            { accountKey: controlKey, partyId, debit: amount },
            { accountKey: ACC.OPENING_BALANCE_EQUITY, credit: amount }
          ]
        : [
            { accountKey: ACC.OPENING_BALANCE_EQUITY, debit: amount },
            { accountKey: controlKey, partyId, credit: amount }
          ]
    })
  }

  update(id: number, input: Partial<PartyInput>): void {
    const current = this.get(id)
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE parties SET
             name = COALESCE(@name, name),
             company_name = @companyName,
             phone = @phone, whatsapp = @whatsapp, email = @email,
             address = @address, city = @city, tax_number = @taxNumber,
             commercial_reg = @commercialReg, contact_person = @contactPerson,
             credit_limit = COALESCE(@creditLimit, credit_limit),
             payment_terms_days = COALESCE(@paymentTermsDays, payment_terms_days),
             notes = @notes,
             is_active = COALESCE(@isActive, is_active),
             updated_at = datetime('now')
           WHERE id = @id`
        )
        .run({
          id,
          name: input.name?.trim() ?? null,
          companyName: input.companyName ?? current.companyName,
          phone: input.phone ?? current.phone,
          whatsapp: input.whatsapp ?? current.whatsapp,
          email: input.email ?? current.email,
          address: input.address ?? current.address,
          city: input.city ?? current.city,
          taxNumber: input.taxNumber ?? current.taxNumber,
          commercialReg: input.commercialReg ?? current.commercialReg,
          contactPerson: input.contactPerson ?? current.contactPerson,
          creditLimit: input.creditLimit === undefined ? null : Math.round(input.creditLimit),
          paymentTermsDays: input.paymentTermsDays ?? null,
          notes: input.notes ?? current.notes,
          isActive: input.isActive === undefined ? null : input.isActive ? 1 : 0
        })

      // تغيير الرصيد الافتتاحي يُعالَج بعكس القيد القديم وترحيل قيد جديد — لا تعديل مباشر للأرصدة
      const newOpening = input.openingBalance === undefined ? current.openingBalance : Math.round(input.openingBalance)
      const newDate = input.openingDate ?? current.openingDate ?? todayIso()
      if (newOpening !== current.openingBalance || newDate !== current.openingDate) {
        const existing = this.db
          .prepare("SELECT id FROM journal_entries WHERE ref_type = 'opening' AND ref_id = ? AND is_void = 0")
          .all(id) as { id: number }[]
        for (const entry of existing) {
          this.ledger.reverse(entry.id, newDate, 'تعديل الرصيد الافتتاحي')
        }
        if (newOpening !== 0) this.postOpeningEntry(id, current.partyType, newOpening, newDate)
        this.db
          .prepare('UPDATE parties SET opening_balance = ?, opening_date = ? WHERE id = ?')
          .run(newOpening, newDate, id)
      }
    })
    run.immediate()
    this.audit.log({
      action: 'update',
      entityType: 'party',
      entityId: id,
      entityLabel: `${current.code} - ${current.name}`,
      oldValue: current,
      newValue: input
    })
  }

  /** التعطيل بدل الحذف متى وُجدت معاملات مرتبطة — لا تُحذف البيانات المالية */
  deactivate(id: number, reason?: string): void {
    const party = this.get(id)
    this.db.prepare("UPDATE parties SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id)
    this.audit.log({ action: 'deactivate', entityType: 'party', entityId: id, entityLabel: party.name, reason, severity: 'warning' })
  }

  /** الحذف مسموح فقط لطرف بلا أي حركة مالية */
  remove(id: number): void {
    const party = this.get(id)
    const used = this.db
      .prepare('SELECT COUNT(*) AS n FROM journal_lines WHERE party_id = ?')
      .get(id) as { n: number }
    if (used.n > 0) {
      throw ERRORS.conflict(`لا يمكن حذف ${TYPE_LABEL[party.partyType]} لوجود معاملات مسجّلة. يمكنك تعطيله بدلًا من ذلك.`)
    }
    this.db.prepare('DELETE FROM parties WHERE id = ?').run(id)
    this.audit.log({ action: 'delete', entityType: 'party', entityId: id, entityLabel: party.name, oldValue: party, severity: 'warning' })
  }

  // ------------------------- كشف الحساب -------------------------

  /**
   * كشف حساب طرف خلال فترة.
   * كل سطر مُشتقّ من قيد محاسبي فعلي، والرصيد الجاري يُحسب تراكميًا من الرصيد الافتتاحي للفترة.
   */
  statement(partyId: number, from: string, to: string): Statement {
    const party = this.get(partyId)
    const isCustomer = party.partyType === 'customer'

    const openRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.party_id = ? AND je.date < ?`
      )
      .get(partyId, from) as { d: number; c: number }
    const openingBalance = isCustomer ? openRow.d - openRow.c : openRow.c - openRow.d

    const rows = this.db
      .prepare(
        `SELECT je.date, je.ref_type AS refType, je.ref_id AS refId,
                COALESCE(je.ref_number, je.entry_number) AS refNumber,
                COALESCE(jl.description, je.description) AS description,
                jl.debit, jl.credit
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.party_id = ? AND je.date >= ? AND je.date <= ?
         ORDER BY je.date, je.id, jl.line_no`
      )
      .all(partyId, from, to) as {
      date: string
      refType: string
      refId: number | null
      refNumber: string
      description: string | null
      debit: number
      credit: number
    }[]

    let balance = openingBalance
    const lines: StatementLine[] = rows.map((r) => {
      balance += isCustomer ? r.debit - r.credit : r.credit - r.debit
      return {
        date: r.date,
        refType: r.refType,
        refId: r.refId,
        refNumber: r.refNumber,
        description: r.description ?? describeRef(r.refType),
        debit: r.debit,
        credit: r.credit,
        balance
      }
    })

    return {
      party,
      from,
      to,
      openingBalance,
      lines,
      closingBalance: balance,
      totalDebit: lines.reduce((s, l) => s + l.debit, 0),
      totalCredit: lines.reduce((s, l) => s + l.credit, 0)
    }
  }

  /** أعمار الديون — تصنيف الأرصدة المستحقة حسب عمرها */
  aging(partyType: PartyType, asOf: string): {
    partyId: number
    code: string
    name: string
    phone: string | null
    total: number
    current: number
    d30: number
    d60: number
    d90: number
    d90plus: number
  }[] {
    const isCustomer = partyType === 'customer'
    const table = isCustomer ? 'sales' : 'purchases'
    const idCol = isCustomer ? 'customer_id' : 'supplier_id'
    const numberCol = 'invoice_number'

    const parties = this.db
      .prepare('SELECT id, code, name, phone FROM parties WHERE party_type = ?')
      .all(partyType) as { id: number; code: string; name: string; phone: string | null }[]

    const docs = this.db
      .prepare(
        `SELECT ${idCol} AS partyId, date, ${numberCol} AS number,
                total - paid_amount - returned_amount AS due
         FROM ${table}
         WHERE status = 'confirmed' AND date <= ? AND total - paid_amount - returned_amount > 0`
      )
      .all(asOf) as { partyId: number; date: string; number: string; due: number }[]

    const asOfTime = new Date(asOf).getTime()
    const buckets = new Map<number, { current: number; d30: number; d60: number; d90: number; d90plus: number }>()
    for (const doc of docs) {
      const days = Math.floor((asOfTime - new Date(doc.date).getTime()) / 86_400_000)
      const b = buckets.get(doc.partyId) ?? { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 }
      if (days <= 30) b.current += doc.due
      else if (days <= 60) b.d30 += doc.due
      else if (days <= 90) b.d60 += doc.due
      else if (days <= 120) b.d90 += doc.due
      else b.d90plus += doc.due
      buckets.set(doc.partyId, b)
    }

    return parties
      .map((p) => {
        const b = buckets.get(p.id) ?? { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 }
        const total = b.current + b.d30 + b.d60 + b.d90 + b.d90plus
        return { partyId: p.id, code: p.code, name: p.name, phone: p.phone, total, ...b }
      })
      .filter((r) => r.total !== 0)
      .sort((a, b) => b.total - a.total)
  }
}

const REF_LABELS: Record<string, string> = {
  sale: 'فاتورة بيع',
  sale_return: 'مردود مبيعات',
  purchase: 'فاتورة شراء',
  purchase_return: 'مردود مشتريات',
  payment: 'سند دفع',
  expense: 'مصروف',
  production: 'أمر إنتاج',
  opening: 'رصيد افتتاحي',
  adjustment: 'قيد تسوية',
  manual: 'قيد يدوي'
}

export function describeRef(refType: string): string {
  return REF_LABELS[refType] ?? refType
}
