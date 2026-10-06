/**
 * التواريخ في النظام تُخزَّن كنص 'YYYY-MM-DD' بالتوقيت المحلي للمستخدم.
 * لا تُستخدم toISOString مباشرة لأنها تحوّل إلى UTC فتُرجِع اليوم السابق
 * في البلدان التي تسبق التوقيت العالمي — وهو خطأ خطير في تأريخ الفواتير.
 */
export function isoDate(value: Date = new Date()): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayIso(): string {
  return isoDate()
}

export function startOfMonthIso(date: Date = new Date()): string {
  return isoDate(new Date(date.getFullYear(), date.getMonth(), 1))
}

export function startOfYearIso(date: Date = new Date()): string {
  return isoDate(new Date(date.getFullYear(), 0, 1))
}

export function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return isoDate(date)
}

export function daysBetweenIso(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86_400_000)
}
