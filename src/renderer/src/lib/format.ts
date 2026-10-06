import { formatMoney, formatQty, fromMinor, fromRate, toArabicDigits, toMinor, toRate } from '@shared/money'
import { addDaysIso, daysBetweenIso, isoDate, startOfMonthIso, startOfYearIso, todayIso } from '@shared/date'
import type { AppSettings } from '@shared/types'
import { useSession } from '../store/session'

export { toMinor, toRate, fromMinor, fromRate, formatQty, isoDate }

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
]

function settings(): AppSettings | null {
  return useSession.getState().settings
}

/** تنسيق مبلغ بالوحدة الصغرى حسب عملة النظام */
export function money(minor: number | null | undefined, withSymbol = true): string {
  const s = settings()
  return formatMoney(Number(minor ?? 0), {
    currencySymbol: s?.currency.symbol ?? '',
    decimals: s?.currency.decimals ?? 2,
    arabicDigits: s?.locale.useArabicDigits ?? false,
    showSymbol: withSymbol
  })
}

/** تنسيق مختصر للمبالغ الكبيرة في البطاقات والرسوم */
export function moneyShort(minor: number | null | undefined): string {
  const value = fromMinor(Number(minor ?? 0))
  const abs = Math.abs(value)
  const symbol = settings()?.currency.symbol ?? ''
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)} م ${symbol}`
  if (abs >= 10_000) return `${(value / 1000).toFixed(abs >= 100_000 ? 0 : 1)} ألف ${symbol}`
  return money(minor)
}

export function qty(value: number | null | undefined): string {
  return formatQty(Number(value ?? 0), settings()?.locale.useArabicDigits ?? false)
}

export function rate(value: number | null | undefined): string {
  return money(Math.round(fromRate(Number(value ?? 0)) * 100))
}

export function date(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const text = settings()?.locale.dateFormat === 'yyyy-MM-dd' ? `${d.getFullYear()}-${mm}-${dd}` : `${dd}/${mm}/${d.getFullYear()}`
  return settings()?.locale.useArabicDigits ? toArabicDigits(text) : text
}

export function dateLong(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value.includes('T') || value.includes(' ') ? value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z') : value)
  if (Number.isNaN(d.getTime())) return String(value)
  const time = d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  return `${date(d.toISOString())} — ${time}`
}

export function number(value: number | null | undefined): string {
  const text = Number(value ?? 0).toLocaleString('en-US')
  return settings()?.locale.useArabicDigits ? toArabicDigits(text) : text
}

export function percent(value: number | null | undefined, decimals = 1): string {
  return `${Number(value ?? 0).toFixed(decimals)}٪`
}

export const today = todayIso

export const monthStart = startOfMonthIso

export const yearStart = startOfYearIso

export const addDays = addDaysIso

export const daysBetween = daysBetweenIso

/** تحويل نص يكتبه المستخدم (يدعم الأرقام العربية) إلى رقم */
export function parseUserNumber(input: string): number {
  if (!input) return 0
  const normalized = input
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/[,\s]/g, '')
  const value = Number(normalized)
  return Number.isFinite(value) ? value : 0
}
