import type { Database } from 'better-sqlite3'
import { AppError, ERRORS } from '@shared/errors'
import type { Ctx } from '../core/context'
import { actorId } from '../core/context'
import { NumberingService } from '../services/numbering.service'
import { ACC, type SystemAccountKey } from './chart'

export interface JournalLineInput {
  accountId?: number
  accountKey?: SystemAccountKey | string
  partyId?: number | null
  debit?: number
  credit?: number
  description?: string
}

export interface JournalEntryInput {
  date: string
  refType: string
  refId?: number | null
  refNumber?: string | null
  description?: string
  lines: JournalLineInput[]
}

export interface AccountRow {
  id: number
  code: string
  name: string
  name_en: string | null
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  subtype: string | null
  parent_id: number | null
  system_key: string | null
  is_group: number
  is_active: number
}

/**
 * دفتر الأستاذ — القيد المزدوج هو المصدر الوحيد للحقيقة المالية.
 * كل مستند مالي (بيع، شراء، دفعة، مصروف، إنتاج) يُنتج قيدًا متوازنًا،
 * وكل رصيد في النظام مُشتق من هذه القيود لا من حقول محفوظة يدويًا.
 */
export class LedgerService {
  private readonly db: Database
  private readonly numbering: NumberingService

  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db
    this.numbering = new NumberingService(ctx.db)
  }

  // ------------------------- الحسابات -------------------------

  accountByKey(key: SystemAccountKey | string): AccountRow {
    const row = this.db.prepare('SELECT * FROM accounts WHERE system_key = ?').get(key) as
      | AccountRow
      | undefined
    if (!row) throw ERRORS.notFound(`الحساب «${key}»`)
    return row
  }

  accountIdByKey(key: SystemAccountKey | string): number {
    return this.accountByKey(key).id
  }

  account(id: number): AccountRow {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined
    if (!row) throw ERRORS.notFound('الحساب')
    return row
  }

  listAccounts(options: { activeOnly?: boolean } = {}): AccountRow[] {
    const clause = options.activeOnly ? 'WHERE is_active = 1' : ''
    return this.db.prepare(`SELECT * FROM accounts ${clause} ORDER BY code`).all() as AccountRow[]
  }

  /** الحسابات النقدية والبنكية المتاحة لاستقبال أو صرف الأموال */
  listCashAccounts(): AccountRow[] {
    return this.db
      .prepare("SELECT * FROM accounts WHERE subtype IN ('cash','bank') AND is_active = 1 ORDER BY code")
      .all() as AccountRow[]
  }

  // ------------------------- ترحيل القيود -------------------------

  /**
   * ترحيل قيد متوازن. يجب استدعاؤها داخل معاملة المستند نفسه.
   * يرفض القيد إذا لم يتساوَ مجموع المدين مع مجموع الدائن.
   */
  post(input: JournalEntryInput): number {
    const lines = input.lines
      .map((line, index) => {
        const accountId = line.accountId ?? (line.accountKey ? this.accountIdByKey(line.accountKey) : undefined)
        if (!accountId) throw ERRORS.validation('سطر قيد بدون حساب محدد.')
        const debit = Math.round(line.debit ?? 0)
        const credit = Math.round(line.credit ?? 0)
        if (debit < 0 || credit < 0) throw ERRORS.validation('لا يمكن أن تكون قيمة المدين أو الدائن سالبة.')
        if (debit > 0 && credit > 0) throw ERRORS.validation('لا يجوز أن يحتوي السطر على مدين ودائن معًا.')
        return { accountId, partyId: line.partyId ?? null, debit, credit, description: line.description ?? null, lineNo: index + 1 }
      })
      .filter((line) => line.debit !== 0 || line.credit !== 0)

    if (lines.length === 0) throw ERRORS.validation('لا يمكن ترحيل قيد بدون أسطر ذات قيمة.')

    const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
    if (totalDebit !== totalCredit) {
      throw new AppError(
        'BALANCE_MISMATCH',
        'القيد المحاسبي غير متوازن — لم تُحفظ العملية.',
        { details: { totalDebit, totalCredit, refType: input.refType, refNumber: input.refNumber } }
      )
    }

    const entryNumber = this.numbering.next('journal', new Date(input.date))
    const info = this.db
      .prepare(
        `INSERT INTO journal_entries (entry_number, date, ref_type, ref_id, ref_number, description, created_by)
         VALUES (@entryNumber, @date, @refType, @refId, @refNumber, @description, @createdBy)`
      )
      .run({
        entryNumber,
        date: input.date,
        refType: input.refType,
        refId: input.refId ?? null,
        refNumber: input.refNumber ?? null,
        description: input.description ?? null,
        createdBy: actorId(this.ctx)
      })

    const entryId = Number(info.lastInsertRowid)
    const insertLine = this.db.prepare(
      `INSERT INTO journal_lines (entry_id, line_no, account_id, party_id, debit, credit, description)
       VALUES (@entryId, @lineNo, @accountId, @partyId, @debit, @credit, @description)`
    )
    for (const line of lines) insertLine.run({ entryId, ...line })
    return entryId
  }

  /**
   * عكس قيد سابق بقيد مضاد بدلًا من حذفه — لا تُحذف السجلات المالية أبدًا.
   */
  reverse(entryId: number, date: string, reason: string): number {
    const entry = this.db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId) as
      | { id: number; is_void: number; ref_type: string; ref_id: number | null; ref_number: string | null; description: string | null }
      | undefined
    if (!entry) throw ERRORS.notFound('القيد المحاسبي')
    if (entry.is_void === 1) throw ERRORS.conflict('هذا القيد ملغى بالفعل.')

    const lines = this.db
      .prepare('SELECT account_id, party_id, debit, credit, description FROM journal_lines WHERE entry_id = ? ORDER BY line_no')
      .all(entryId) as { account_id: number; party_id: number | null; debit: number; credit: number; description: string | null }[]

    const reversalId = this.post({
      date,
      refType: entry.ref_type,
      refId: entry.ref_id,
      refNumber: entry.ref_number,
      description: `عكس قيد: ${entry.description ?? ''} — ${reason}`.trim(),
      lines: lines.map((l) => ({
        accountId: l.account_id,
        partyId: l.party_id,
        debit: l.credit,
        credit: l.debit,
        description: l.description ?? undefined
      }))
    })

    this.db
      .prepare(
        `UPDATE journal_entries SET is_void = 1, void_reason = ?, voided_at = datetime('now'), voided_by = ?
         WHERE id = ?`
      )
      .run(reason, actorId(this.ctx), entryId)
    this.db.prepare('UPDATE journal_entries SET reverses_entry_id = ? WHERE id = ?').run(entryId, reversalId)
    return reversalId
  }

  // ------------------------- الأرصدة -------------------------

  /** رصيد حساب بالطبيعة المحاسبية (مدين موجب للأصول والمصروفات، دائن موجب للخصوم والإيرادات وحقوق الملكية) */
  accountBalance(accountId: number, asOf?: string): number {
    const account = this.account(accountId)
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.account_id = ? AND (? IS NULL OR je.date <= ?)`
      )
      .get(accountId, asOf ?? null, asOf ?? null) as { d: number; c: number }
    const debitNatured = account.type === 'asset' || account.type === 'expense'
    return debitNatured ? row.d - row.c : row.c - row.d
  }

  balanceByKey(key: SystemAccountKey | string, asOf?: string): number {
    return this.accountBalance(this.accountIdByKey(key), asOf)
  }

  /** إجمالي النقدية (الصندوق + البنك + أي حساب نقدي آخر) */
  cashBalances(asOf?: string): { accountId: number; code: string; name: string; subtype: string; balance: number }[] {
    return this.listCashAccounts().map((a) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      subtype: a.subtype ?? 'cash',
      balance: this.accountBalance(a.id, asOf)
    }))
  }

  /**
   * رصيد طرف (عميل/مورد/مصنع) بالاتجاه الطبيعي:
   * العميل: موجب = مستحق علينا تحصيله. المورد/المصنع: موجب = مستحق علينا سداده.
   */
  partyBalance(partyId: number, asOf?: string): number {
    const party = this.db.prepare('SELECT party_type FROM parties WHERE id = ?').get(partyId) as
      | { party_type: string }
      | undefined
    if (!party) throw ERRORS.notFound('الطرف')
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.party_id = ? AND (? IS NULL OR je.date <= ?)`
      )
      .get(partyId, asOf ?? null, asOf ?? null) as { d: number; c: number }
    return party.party_type === 'customer' ? row.d - row.c : row.c - row.d
  }

  /** الحساب الرقابي المناسب لكل نوع طرف */
  controlAccountKey(partyType: 'customer' | 'supplier' | 'factory'): SystemAccountKey {
    if (partyType === 'customer') return ACC.RECEIVABLE
    if (partyType === 'factory') return ACC.FACTORY_PAYABLE
    return ACC.PAYABLE
  }

  // ------------------------- التقارير الأساسية -------------------------

  trialBalance(asOf?: string): {
    accountId: number
    code: string
    name: string
    type: string
    debit: number
    credit: number
  }[] {
    return this.db
      .prepare(
        `SELECT a.id AS accountId, a.code, a.name, a.type,
                COALESCE(SUM(jl.debit),0) AS totalDebit,
                COALESCE(SUM(jl.credit),0) AS totalCredit
         FROM accounts a
         LEFT JOIN journal_lines jl ON jl.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jl.entry_id AND (? IS NULL OR je.date <= ?)
         WHERE a.is_group = 0
         GROUP BY a.id
         HAVING totalDebit <> 0 OR totalCredit <> 0
         ORDER BY a.code`
      )
      .all(asOf ?? null, asOf ?? null)
      .map((r) => {
        const row = r as { accountId: number; code: string; name: string; type: string; totalDebit: number; totalCredit: number }
        const net = row.totalDebit - row.totalCredit
        return {
          accountId: row.accountId,
          code: row.code,
          name: row.name,
          type: row.type,
          debit: net > 0 ? net : 0,
          credit: net < 0 ? -net : 0
        }
      })
  }

  /** حركة حساب خلال فترة مع الرصيد الافتتاحي والرصيد الجاري */
  accountLedger(accountId: number, from: string, to: string): {
    opening: number
    lines: { date: string; entryNumber: string; refType: string; refNumber: string | null; description: string | null; debit: number; credit: number; balance: number }[]
    closing: number
  } {
    const account = this.account(accountId)
    const debitNatured = account.type === 'asset' || account.type === 'expense'
    const openRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.account_id = ? AND je.date < ?`
      )
      .get(accountId, from) as { d: number; c: number }
    const opening = debitNatured ? openRow.d - openRow.c : openRow.c - openRow.d

    const rows = this.db
      .prepare(
        `SELECT je.date, je.entry_number AS entryNumber, je.ref_type AS refType, je.ref_number AS refNumber,
                COALESCE(jl.description, je.description) AS description, jl.debit, jl.credit
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.account_id = ? AND je.date >= ? AND je.date <= ?
         ORDER BY je.date, je.id, jl.line_no`
      )
      .all(accountId, from, to) as { date: string; entryNumber: string; refType: string; refNumber: string | null; description: string | null; debit: number; credit: number }[]

    let balance = opening
    const lines = rows.map((r) => {
      balance += debitNatured ? r.debit - r.credit : r.credit - r.debit
      return { ...r, balance }
    })
    return { opening, lines, closing: balance }
  }
}
