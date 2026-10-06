import type { Database } from 'better-sqlite3'
import { ERRORS } from '@shared/errors'

export interface SequenceConfig {
  docType: string
  prefix: string
  includeYear: boolean
  padding: number
  separator: string
  nextNumber: number
  resetPeriod: 'never' | 'yearly'
  currentPeriod: string | null
}

interface SequenceRow {
  doc_type: string
  prefix: string
  include_year: number
  padding: number
  separator: string
  next_number: number
  reset_period: 'never' | 'yearly'
  current_period: string | null
}

function toConfig(row: SequenceRow): SequenceConfig {
  return {
    docType: row.doc_type,
    prefix: row.prefix,
    includeYear: row.include_year === 1,
    padding: row.padding,
    separator: row.separator,
    nextNumber: row.next_number,
    resetPeriod: row.reset_period,
    currentPeriod: row.current_period
  }
}

function render(cfg: SequenceConfig, value: number, period: string): string {
  const parts = [cfg.prefix]
  if (cfg.includeYear) parts.push(period)
  parts.push(String(value).padStart(cfg.padding, '0'))
  return parts.filter((p) => p !== '').join(cfg.separator)
}

/**
 * توليد أرقام المستندات.
 * يجب استدعاؤها داخل نفس معاملة حفظ المستند حتى لا يُستهلك رقم عند فشل الحفظ،
 * وحتى لا يحصل مستندان على نفس الرقم عند الحفظ المتزامن.
 */
export class NumberingService {
  constructor(private readonly db: Database) {}

  list(): SequenceConfig[] {
    const rows = this.db.prepare('SELECT * FROM number_sequences ORDER BY doc_type').all() as SequenceRow[]
    return rows.map(toConfig)
  }

  get(docType: string): SequenceConfig {
    const row = this.db.prepare('SELECT * FROM number_sequences WHERE doc_type = ?').get(docType) as
      | SequenceRow
      | undefined
    if (!row) throw ERRORS.notFound(`إعداد ترقيم «${docType}»`)
    return toConfig(row)
  }

  /** معاينة الرقم التالي دون استهلاكه */
  preview(docType: string, date = new Date()): string {
    const cfg = this.get(docType)
    const period = String(date.getFullYear())
    const value = cfg.resetPeriod === 'yearly' && cfg.currentPeriod !== period ? 1 : cfg.nextNumber
    return render(cfg, value, period)
  }

  /** حجز الرقم التالي وزيادة العداد */
  next(docType: string, date = new Date()): string {
    const cfg = this.get(docType)
    const period = String(date.getFullYear())
    let value = cfg.nextNumber
    if (cfg.resetPeriod === 'yearly' && cfg.currentPeriod !== period) value = 1
    this.db
      .prepare('UPDATE number_sequences SET next_number = ?, current_period = ? WHERE doc_type = ?')
      .run(value + 1, period, docType)
    return render(cfg, value, period)
  }

  update(docType: string, patch: Partial<Omit<SequenceConfig, 'docType'>>): SequenceConfig {
    const cfg = { ...this.get(docType), ...patch }
    if (cfg.padding < 1 || cfg.padding > 12) throw ERRORS.validation('عدد خانات الترقيم يجب أن يكون بين ١ و ١٢.')
    if (cfg.nextNumber < 1) throw ERRORS.validation('الرقم التالي يجب أن يكون ١ أو أكثر.')
    this.db
      .prepare(
        `UPDATE number_sequences
         SET prefix = ?, include_year = ?, padding = ?, separator = ?, next_number = ?, reset_period = ?
         WHERE doc_type = ?`
      )
      .run(
        cfg.prefix,
        cfg.includeYear ? 1 : 0,
        cfg.padding,
        cfg.separator,
        cfg.nextNumber,
        cfg.resetPeriod,
        docType
      )
    return this.get(docType)
  }
}
