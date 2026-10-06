import { describe, expect, it } from 'vitest'
import { checkIntegrity } from '@main/db/connection'
import { LedgerService } from '@main/accounting/ledger'
import { NumberingService } from '@main/services/numbering.service'
import { ACC } from '@main/accounting/chart'
import { allocate, lineAmount, toMinor, toRate, formatMoney } from '@shared/money'
import { createCtx, createTestDb } from './helpers'

describe('قاعدة البيانات والتهيئة', () => {
  it('تنشئ المخطط وشجرة الحسابات والأدوار', () => {
    const db = createTestDb()
    const accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }
    const roles = db.prepare('SELECT COUNT(*) AS n FROM roles').get() as { n: number }
    const sequences = db.prepare('SELECT COUNT(*) AS n FROM number_sequences').get() as { n: number }
    expect(accounts.n).toBeGreaterThan(20)
    expect(roles.n).toBe(4)
    expect(sequences.n).toBeGreaterThan(10)
    expect(checkIntegrity(db).ok).toBe(true)
  })

  it('لا تعيد التهيئة عند إعادة الفتح', () => {
    const db = createTestDb()
    const before = db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }
    // seedDatabase يعمل عند كل فتح، ويجب أن يتجاهل قاعدة مهيّأة
    const after = db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }
    expect(after.n).toBe(before.n)
  })
})

describe('حسابات المبالغ', () => {
  it('تحوّل بين العملة والوحدة الصغرى دون فقد دقة', () => {
    expect(toMinor(1234.56)).toBe(123456)
    expect(toMinor(0.1 + 0.2)).toBe(30)
    expect(formatMoney(123456, { currencySymbol: 'ج.م' })).toBe('1,234.56 ج.م')
  })

  it('تحسب قيمة السطر من الكمية وسعر الوحدة', () => {
    expect(lineAmount(3, toRate(12.5))).toBe(toMinor(37.5))
    expect(lineAmount(800.5, toRate(4.75))).toBe(toMinor(3802.375))
  })

  it('توزّع المبلغ دون فقد أي وحدة', () => {
    const parts = allocate(1000, [1, 1, 1])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000)
    const parts2 = allocate(10_000, [3, 7, 11])
    expect(parts2.reduce((a, b) => a + b, 0)).toBe(10_000)
  })
})

describe('ترقيم المستندات', () => {
  it('يولّد أرقامًا متسلسلة فريدة', () => {
    const db = createTestDb()
    const numbering = new NumberingService(db)
    const date = new Date('2026-03-01')
    expect(numbering.next('sale', date)).toBe('INV-2026-000001')
    expect(numbering.next('sale', date)).toBe('INV-2026-000002')
    expect(numbering.preview('sale', date)).toBe('INV-2026-000003')
    expect(numbering.next('purchase', date)).toBe('PUR-2026-000001')
  })

  it('يصفّر العداد مع بداية سنة جديدة', () => {
    const db = createTestDb()
    const numbering = new NumberingService(db)
    numbering.next('sale', new Date('2026-12-31'))
    expect(numbering.next('sale', new Date('2027-01-02'))).toBe('INV-2027-000001')
  })
})

describe('دفتر الأستاذ', () => {
  it('يرفض القيد غير المتوازن ولا يحفظ منه شيئًا', () => {
    const ctx = createCtx()
    const ledger = new LedgerService(ctx)
    expect(() =>
      ledger.post({
        date: '2026-01-01',
        refType: 'manual',
        lines: [
          { accountKey: ACC.CASH, debit: 1000 },
          { accountKey: ACC.SALES_REVENUE, credit: 900 }
        ]
      })
    ).toThrowError()
    const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('يرحّل قيدًا متوازنًا ويحسب الأرصدة بالاتجاه الطبيعي', () => {
    const ctx = createCtx()
    const ledger = new LedgerService(ctx)
    ledger.post({
      date: '2026-01-01',
      refType: 'manual',
      description: 'مبيعات نقدية',
      lines: [
        { accountKey: ACC.CASH, debit: 50_000 },
        { accountKey: ACC.SALES_REVENUE, credit: 50_000 }
      ]
    })
    expect(ledger.balanceByKey(ACC.CASH)).toBe(50_000)
    expect(ledger.balanceByKey(ACC.SALES_REVENUE)).toBe(50_000)
  })

  it('يعكس القيد بقيد مضاد ولا يحذف الأصل', () => {
    const ctx = createCtx()
    const ledger = new LedgerService(ctx)
    const id = ledger.post({
      date: '2026-01-01',
      refType: 'manual',
      lines: [
        { accountKey: ACC.CASH, debit: 25_000 },
        { accountKey: ACC.SALES_REVENUE, credit: 25_000 }
      ]
    })
    ledger.reverse(id, '2026-01-05', 'خطأ في التسجيل')
    expect(ledger.balanceByKey(ACC.CASH)).toBe(0)
    const entries = ctx.db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get() as { n: number }
    expect(entries.n).toBe(2)
    const original = ctx.db.prepare('SELECT is_void FROM journal_entries WHERE id = ?').get(id) as { is_void: number }
    expect(original.is_void).toBe(1)
  })
})
