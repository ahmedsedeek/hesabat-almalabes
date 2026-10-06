import { allocate, lineAmount, percentOf, type Minor, type Rate } from '@shared/money'
import { ERRORS } from '@shared/errors'

export interface RawLine {
  quantity: number
  unitPrice: Rate
  /** خصم على مستوى السطر بالوحدة الصغرى */
  discountAmount?: Minor
  /** نسبة الضريبة لهذا السطر */
  taxRate?: number
}

export interface ComputedLine {
  quantity: number
  unitPrice: Rate
  gross: Minor
  discountAmount: Minor
  net: Minor
  taxRate: number
  taxAmount: Minor
  lineTotal: Minor
}

export interface DocumentTotals {
  lines: ComputedLine[]
  subtotal: Minor
  discountAmount: Minor
  taxAmount: Minor
  shippingAmount: Minor
  total: Minor
}

export interface TotalsInput {
  lines: RawLine[]
  /** خصم على مستوى الفاتورة، يُوزَّع على الأسطر قبل حساب الضريبة */
  headerDiscountAmount?: Minor
  headerDiscountPercent?: number
  shippingAmount?: Minor
}

/**
 * حساب إجماليات مستند (فاتورة بيع أو شراء).
 *
 * القاعدة:
 *   إجمالي السطر قبل الخصم = الكمية × سعر الوحدة
 *   خصم الفاتورة يُوزَّع على الأسطر بنسبة قيمتها، ثم تُحسب الضريبة على الصافي بعد كل الخصومات
 *   الإجمالي = مجموع الأسطر قبل الخصم − إجمالي الخصومات + الضريبة + الشحن
 *
 * التوزيع يضمن أن مجموع أنصبة الخصم يساوي الخصم المُدخل تمامًا (بلا فروق تقريب).
 */
export function computeTotals(input: TotalsInput): DocumentTotals {
  if (!input.lines.length) throw ERRORS.validation('يجب إضافة صنف واحد على الأقل.')

  const base = input.lines.map((line) => {
    if (!(line.quantity > 0)) throw ERRORS.validation('كمية الصنف يجب أن تكون أكبر من صفر.')
    if (line.unitPrice < 0) throw ERRORS.validation('سعر الوحدة لا يمكن أن يكون سالبًا.')
    const gross = lineAmount(line.quantity, line.unitPrice)
    const lineDiscount = Math.max(0, Math.round(line.discountAmount ?? 0))
    if (lineDiscount > gross) throw ERRORS.validation('خصم السطر أكبر من قيمة السطر.')
    return { ...line, gross, lineDiscount, net1: gross - lineDiscount }
  })

  const subtotal = base.reduce((s, l) => s + l.gross, 0)
  const netAfterLineDiscounts = base.reduce((s, l) => s + l.net1, 0)

  let headerDiscount = Math.round(input.headerDiscountAmount ?? 0)
  if (input.headerDiscountPercent) {
    headerDiscount += percentOf(netAfterLineDiscounts, input.headerDiscountPercent)
  }
  headerDiscount = Math.max(0, Math.min(headerDiscount, netAfterLineDiscounts))

  const shares = allocate(headerDiscount, base.map((l) => l.net1))

  const lines: ComputedLine[] = base.map((l, i) => {
    const net = l.net1 - shares[i]
    const taxRate = l.taxRate ?? 0
    const taxAmount = taxRate ? percentOf(net, taxRate) : 0
    return {
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      gross: l.gross,
      discountAmount: l.lineDiscount + shares[i],
      net,
      taxRate,
      taxAmount,
      lineTotal: net
    }
  })

  const discountAmount = lines.reduce((s, l) => s + l.discountAmount, 0)
  const taxAmount = lines.reduce((s, l) => s + l.taxAmount, 0)
  const shippingAmount = Math.max(0, Math.round(input.shippingAmount ?? 0))
  const total = subtotal - discountAmount + taxAmount + shippingAmount

  return { lines, subtotal, discountAmount, taxAmount, shippingAmount, total }
}

/**
 * توزيع تكاليف الشحن والتكاليف الإضافية على أسطر فاتورة الشراء
 * للوصول إلى تكلفة الوحدة الحقيقية (Landed Cost).
 */
export function allocateLandedCosts(lineNets: Minor[], extraCosts: Minor): Minor[] {
  return allocate(Math.round(extraCosts), lineNets)
}
