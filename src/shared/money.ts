/**
 * تمثيل المبالغ المالية
 * -------------------------------------------------------------
 * كل المبالغ (الإجماليات، القيود، الأرصدة) تُخزَّن كأعداد صحيحة بالوحدة الصغرى
 *   minor = currency * 100        →  AMOUNT_SCALE
 * الأسعار وتكاليف الوحدة تُخزَّن بمقياس أدق لتفادي تراكم أخطاء التقريب
 *   rate  = currency * 10000      →  RATE_SCALE
 *
 * لا تُستخدم الأعداد العشرية (float) لأي قيمة مالية إطلاقًا.
 */

export const AMOUNT_SCALE = 100
export const RATE_SCALE = 10_000
/** عدد وحدات المقياس الصغرى في وحدة سعر واحدة = 10000 / 100 = 100 */
const RATE_TO_AMOUNT = RATE_SCALE / AMOUNT_SCALE

/** مبلغ بالوحدة الصغرى (قرش) */
export type Minor = number
/** سعر أو تكلفة وحدة بمقياس 10000 */
export type Rate = number

/** تقريب نصفي بعيدًا عن الصفر — الطريقة المحاسبية المعتادة */
export function roundHalf(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** تحويل رقم يدخله المستخدم (بالعملة) إلى وحدة صغرى */
export function toMinor(currencyValue: number): Minor {
  if (!Number.isFinite(currencyValue)) return 0
  return roundHalf(currencyValue * AMOUNT_SCALE)
}

/** تحويل وحدة صغرى إلى رقم بالعملة (للعرض فقط) */
export function fromMinor(minor: Minor): number {
  return minor / AMOUNT_SCALE
}

/** تحويل سعر يدخله المستخدم إلى مقياس السعر */
export function toRate(currencyValue: number): Rate {
  if (!Number.isFinite(currencyValue)) return 0
  return roundHalf(currencyValue * RATE_SCALE)
}

export function fromRate(rate: Rate): number {
  return rate / RATE_SCALE
}

/**
 * قيمة سطر = كمية × سعر الوحدة، والنتيجة بالوحدة الصغرى.
 * qty عدد عشري، rate بمقياس 10000 ⇒ minor = qty * rate / 100
 */
export function lineAmount(quantity: number, rate: Rate): Minor {
  return roundHalf((quantity * rate) / RATE_TO_AMOUNT)
}

/** استنتاج تكلفة/سعر الوحدة من مبلغ وكمية */
export function rateFromAmount(amount: Minor, quantity: number): Rate {
  if (!quantity) return 0
  return roundHalf((amount * RATE_TO_AMOUNT) / quantity)
}

/** نسبة مئوية من مبلغ (مثل الضريبة أو الخصم) */
export function percentOf(amount: Minor, percent: number): Minor {
  return roundHalf((amount * percent) / 100)
}

/**
 * توزيع مبلغ على أوزان بحيث يساوي مجموع الأنصبة المبلغ الأصلي تمامًا.
 * تُستخدم لتوزيع الشحن والتكاليف الإضافية على أسطر الفاتورة.
 */
export function allocate(amount: Minor, weights: number[]): Minor[] {
  const total = weights.reduce((s, w) => s + w, 0)
  if (total === 0 || weights.length === 0) {
    const out = new Array(weights.length).fill(0)
    if (out.length > 0) out[0] = amount
    return out
  }
  const raw = weights.map((w) => (amount * w) / total)
  const floored = raw.map((v) => (v < 0 ? Math.ceil(v) : Math.floor(v)))
  let remainder = amount - floored.reduce((s, v) => s + v, 0)
  // وزّع الوحدات المتبقية على الأسطر ذات أكبر كسر متبقٍ
  const order = raw
    .map((v, i) => ({ i, frac: Math.abs(v - floored[i]) }))
    .sort((a, b) => b.frac - a.frac)
  const step = remainder < 0 ? -1 : 1
  let k = 0
  while (remainder !== 0 && order.length > 0) {
    floored[order[k % order.length].i] += step
    remainder -= step
    k++
  }
  return floored
}

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

export function toArabicDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)])
}

export interface MoneyFormatOptions {
  currencySymbol?: string
  decimals?: number
  arabicDigits?: boolean
  showSymbol?: boolean
}

/** تنسيق مبلغ بالوحدة الصغرى للعرض */
export function formatMoney(minor: Minor, opts: MoneyFormatOptions = {}): string {
  const { currencySymbol = '', decimals = 2, arabicDigits = false, showSymbol = true } = opts
  const negative = minor < 0
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / AMOUNT_SCALE)
  const frac = abs % AMOUNT_SCALE
  const wholeText = whole.toLocaleString('en-US')
  let text = decimals > 0 ? `${wholeText}.${String(frac).padStart(2, '0').slice(0, decimals)}` : wholeText
  if (negative) text = `-${text}`
  if (arabicDigits) text = toArabicDigits(text)
  return showSymbol && currencySymbol ? `${text} ${currencySymbol}` : text
}

/** تنسيق كمية (٣ خانات عشرية بحد أقصى، بدون أصفار زائدة) */
export function formatQty(qty: number, arabicDigits = false): string {
  const text = Number(qty.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 })
  return arabicDigits ? toArabicDigits(text) : text
}

/** تقريب الكمية لثلاث خانات لتفادي أخطاء الفاصلة العائمة */
export function normalizeQty(qty: number): number {
  return Math.round(qty * 1000) / 1000
}

/** مقارنة كميتين مع تسامح لأخطاء الفاصلة العائمة */
export function qtyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6
}

export function qtyGreater(a: number, b: number): boolean {
  return a - b > 1e-6
}
