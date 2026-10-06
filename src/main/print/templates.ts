import { todayIso } from '@shared/date'
import fs from 'node:fs'
import { formatMoney, formatQty, fromRate, type Minor } from '@shared/money'
import type { AppSettings, Statement } from '@shared/types'
import { arabicFontCss, PRINT_CSS } from './styles'

export interface PrintContext {
  settings: AppSettings
  resourcesDir: string
}

function esc(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(minor: Minor | null | undefined, settings: AppSettings, withSymbol = false): string {
  const text = formatMoney(Number(minor ?? 0), {
    currencySymbol: settings.currency.symbol,
    decimals: settings.currency.decimals,
    arabicDigits: settings.locale.useArabicDigits,
    showSymbol: withSymbol
  })
  return `<span class="num-cell">${esc(text)}</span>`
}

function qty(value: number, settings: AppSettings): string {
  return `<span class="num-cell">${esc(formatQty(Number(value ?? 0), settings.locale.useArabicDigits))}</span>`
}

function formatDate(value: string | null | undefined, settings: AppSettings): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return esc(value)
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear()
  const text = settings.locale.dateFormat === 'yyyy-MM-dd' ? `${yyyy}-${mm}-${dd}` : `${dd}/${mm}/${yyyy}`
  return esc(text)
}

function logoTag(settings: AppSettings): string {
  const logo = settings.company.logoPath
  if (!logo || !fs.existsSync(logo)) return ''
  try {
    const ext = logo.toLowerCase().endsWith('.png') ? 'png' : logo.toLowerCase().endsWith('.svg') ? 'svg+xml' : 'jpeg'
    const base64 = fs.readFileSync(logo).toString('base64')
    return `<img src="data:image/${ext};base64,${base64}" alt="" />`
  } catch {
    return ''
  }
}

function documentHead(ctx: PrintContext, title: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<title>${esc(title)}</title>
<style>${arabicFontCss(ctx.resourcesDir)}${PRINT_CSS}</style></head><body>`
}

function header(ctx: PrintContext, docTitle: string, docNumber: string, date: string): string {
  const c = ctx.settings.company
  const metaLines = [c.address, [c.phone, c.email].filter(Boolean).join(' · '), c.taxNumber ? `الرقم الضريبي: ${c.taxNumber}` : '']
    .filter(Boolean)
    .join('\n')
  return `<div class="doc-header">
    <div class="company">${logoTag(ctx.settings)}
      <div><div class="company-name">${esc(c.name)}</div><div class="company-meta">${esc(metaLines)}</div></div>
    </div>
    <div class="doc-title"><h1>${esc(docTitle)}</h1>
      <div class="num">${esc(docNumber)}</div>
      <div class="date">التاريخ: ${formatDate(date, ctx.settings)}</div>
    </div>
  </div>`
}

function footer(ctx: PrintContext): string {
  const c = ctx.settings.company
  const printedAt = new Date().toLocaleString('ar-EG')
  return `<div class="footer">
    <div>${esc(c.invoiceFooter ?? '')}${c.bankDetails ? ` — ${esc(c.bankDetails)}` : ''}</div>
    <div>طُبع في ${esc(printedAt)}</div>
  </div></body></html>`
}

function paymentBadge(total: number, paid: number, returned: number, status: string): string {
  if (status === 'void') return '<span class="badge badge-void">ملغاة</span>'
  const due = total - paid - returned
  if (due <= 0) return '<span class="badge badge-paid">مدفوعة بالكامل</span>'
  if (paid > 0) return '<span class="badge badge-partial">مدفوعة جزئيًا</span>'
  return '<span class="badge badge-due">غير مدفوعة</span>'
}

/** فاتورة بيع أو شراء */
export function invoiceHtml(
  ctx: PrintContext,
  doc: Record<string, unknown>,
  kind: 'sale' | 'purchase'
): string {
  const s = ctx.settings
  const isSale = kind === 'sale'
  const title = isSale ? 'فاتورة بيع' : 'فاتورة شراء'
  const partyName = isSale ? doc.customer_name : doc.supplier_name
  const partyPhone = isSale ? doc.customer_phone : doc.supplier_phone
  const partyAddress = isSale ? doc.customer_address : doc.supplier_address
  const partyTax = isSale ? doc.customer_tax_number : doc.supplier_tax_number
  const items = (doc.items ?? []) as Record<string, unknown>[]
  const showTax = s.tax.enabled && Number(doc.tax_amount ?? 0) > 0
  const total = Number(doc.total ?? 0)
  const paid = Number(doc.paid_amount ?? 0)
  const returned = Number(doc.returned_amount ?? 0)

  const rows = items
    .map((item, index) => {
      const attrs = [item.size, item.color].filter(Boolean).join(' / ')
      return `<tr>
        <td>${index + 1}</td>
        <td class="right">${esc(item.product_name)}${attrs ? ` <small>(${esc(attrs)})</small>` : ''}<br/><small class="code">${esc(item.sku)}</small></td>
        <td>${qty(Number(item.quantity), s)} ${esc(item.unit ?? '')}</td>
        <td>${money(Math.round(fromRate(Number(item.unit_price)) * 100), s)}</td>
        ${Number(doc.discount_amount ?? 0) > 0 ? `<td>${money(Number(item.discount_amount), s)}</td>` : ''}
        ${showTax ? `<td>${money(Number(item.tax_amount), s)}</td>` : ''}
        <td><strong>${money(Number(item.line_total) + Number(item.tax_amount ?? 0), s)}</strong></td>
      </tr>`
    })
    .join('')

  const headers = [
    '#', 'الصنف', 'الكمية', 'سعر الوحدة',
    ...(Number(doc.discount_amount ?? 0) > 0 ? ['الخصم'] : []),
    ...(showTax ? [s.tax.label] : []),
    'الإجمالي'
  ]

  return `${documentHead(ctx, `${title} ${doc.invoice_number}`)}
  <div class="page">
    ${doc.status === 'void' ? '<div class="void-stamp">ملغاة</div>' : ''}
    ${header(ctx, title, String(doc.invoice_number), String(doc.date))}
    <div class="info-grid">
      <div class="info-box">
        <h3>${isSale ? 'العميل' : 'المورد'}</h3>
        <div class="val">${esc(partyName)}</div>
        ${partyPhone ? `<div class="sub">هاتف: ${esc(partyPhone)}</div>` : ''}
        ${partyAddress ? `<div class="sub">${esc(partyAddress)}</div>` : ''}
        ${partyTax ? `<div class="sub">الرقم الضريبي: ${esc(partyTax)}</div>` : ''}
      </div>
      <div class="info-box">
        <h3>بيانات الفاتورة</h3>
        <div class="sub">المخزن: ${esc(doc.warehouse_name)}</div>
        ${doc.due_date ? `<div class="sub">تاريخ الاستحقاق: ${formatDate(String(doc.due_date), s)}</div>` : ''}
        ${doc.supplier_invoice_number ? `<div class="sub">رقم فاتورة المورد: ${esc(doc.supplier_invoice_number)}</div>` : ''}
        ${doc.delivery_address ? `<div class="sub">عنوان التوصيل: ${esc(doc.delivery_address)}</div>` : ''}
        ${doc.tracking_number ? `<div class="sub">رقم البوليصة: <span class="num-cell">${esc(doc.tracking_number)}</span></div>` : ''}
        <div class="sub" style="margin-top:5px">${paymentBadge(total, paid, returned, String(doc.status))}</div>
      </div>
    </div>

    <table>
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <table class="totals">
      <tr><td>الإجمالي قبل الخصم</td><td>${money(Number(doc.subtotal), s, true)}</td></tr>
      ${Number(doc.discount_amount ?? 0) > 0 ? `<tr><td>الخصم</td><td>- ${money(Number(doc.discount_amount), s, true)}</td></tr>` : ''}
      ${showTax ? `<tr><td>${esc(s.tax.label)}</td><td>${money(Number(doc.tax_amount), s, true)}</td></tr>` : ''}
      ${Number(doc.shipping_amount ?? 0) > 0 ? `<tr><td>${isSale ? 'الشحن' : 'الشحن'}</td><td>${money(Number(doc.shipping_amount), s, true)}</td></tr>` : ''}
      ${Number(doc.other_cost_amount ?? 0) > 0 ? `<tr><td>تكاليف أخرى</td><td>${money(Number(doc.other_cost_amount), s, true)}</td></tr>` : ''}
      <tr class="grand"><td>الإجمالي المستحق</td><td>${money(total, s, true)}</td></tr>
      ${paid > 0 ? `<tr><td>المدفوع</td><td>${money(paid, s, true)}</td></tr>` : ''}
      ${returned > 0 ? `<tr><td>المرتجع</td><td>${money(returned, s, true)}</td></tr>` : ''}
      ${total - paid - returned > 0 ? `<tr><td><strong>المتبقي</strong></td><td><strong>${money(total - paid - returned, s, true)}</strong></td></tr>` : ''}
    </table>

    ${doc.notes ? `<div class="notes"><strong>ملاحظات:</strong> ${esc(doc.notes)}</div>` : ''}
    <div class="signatures">
      <div class="signature"><div class="line">توقيع المستلم</div></div>
      <div class="signature"><div class="line">توقيع المحاسب</div></div>
    </div>
    ${footer(ctx)}`
}

/** سند قبض أو صرف */
export function paymentReceiptHtml(ctx: PrintContext, payment: Record<string, unknown>): string {
  const s = ctx.settings
  const isIn = payment.direction === 'in'
  const title = isIn ? 'سند قبض' : 'سند صرف'
  const allocations = (payment.allocations ?? []) as Record<string, unknown>[]

  return `${documentHead(ctx, `${title} ${payment.payment_number}`)}
  <div class="page">
    ${payment.status === 'void' ? '<div class="void-stamp">ملغى</div>' : ''}
    ${header(ctx, title, String(payment.payment_number), String(payment.date))}
    <div class="info-grid">
      <div class="info-box">
        <h3>${isIn ? 'استلمنا من' : 'صرفنا إلى'}</h3>
        <div class="val">${esc(payment.party_name ?? '—')}</div>
        ${payment.party_phone ? `<div class="sub">هاتف: ${esc(payment.party_phone)}</div>` : ''}
      </div>
      <div class="info-box">
        <h3>بيانات السند</h3>
        <div class="sub">طريقة الدفع: ${esc(payment.method_name)}</div>
        <div class="sub">الحساب: ${esc(payment.account_name)}</div>
        ${payment.reference ? `<div class="sub">المرجع: ${esc(payment.reference)}</div>` : ''}
      </div>
    </div>

    <div class="info-box" style="text-align:center;padding:16px;margin-bottom:14px;background:#eff6ff;border-color:#bfdbfe">
      <h3>المبلغ</h3>
      <div style="font-size:27px;font-weight:700;color:#1a70db">${money(Number(payment.amount), s, true)}</div>
    </div>

    ${
      allocations.length
        ? `<table><thead><tr><th>المستند</th><th>التاريخ</th><th>المبلغ المخصَّص</th></tr></thead><tbody>
            ${allocations.map((a) => `<tr><td><span class="num-cell">${esc(a.doc_number)}</span></td><td>${formatDate(String(a.doc_date), s)}</td><td>${money(Number(a.amount), s)}</td></tr>`).join('')}
           </tbody></table>`
        : ''
    }
    ${payment.notes ? `<div class="notes">${esc(payment.notes)}</div>` : ''}
    <div class="signatures">
      <div class="signature"><div class="line">${isIn ? 'توقيع المستلم' : 'توقيع المستفيد'}</div></div>
      <div class="signature"><div class="line">توقيع المحاسب</div></div>
    </div>
    ${footer(ctx)}`
}

/** كشف حساب عميل أو مورد */
export function statementHtml(ctx: PrintContext, statement: Statement): string {
  const s = ctx.settings
  const isCustomer = statement.party.partyType === 'customer'
  const title = isCustomer ? 'كشف حساب عميل' : statement.party.partyType === 'factory' ? 'كشف حساب مصنع' : 'كشف حساب مورد'

  const rows = statement.lines
    .map(
      (line) => `<tr>
        <td>${formatDate(line.date, s)}</td>
        <td><span class="num-cell">${esc(line.refNumber)}</span></td>
        <td class="right bidi">${esc(line.description)}</td>
        <td>${line.debit ? money(line.debit, s) : '—'}</td>
        <td>${line.credit ? money(line.credit, s) : '—'}</td>
        <td><strong>${money(line.balance, s)}</strong></td>
      </tr>`
    )
    .join('')

  return `${documentHead(ctx, `${title} — ${statement.party.name}`)}
  <div class="page">
    ${header(ctx, title, statement.party.code, statement.to)}
    <div class="info-grid">
      <div class="info-box">
        <h3>${isCustomer ? 'العميل' : 'المورد'}</h3>
        <div class="val">${esc(statement.party.name)}</div>
        ${statement.party.companyName ? `<div class="sub">${esc(statement.party.companyName)}</div>` : ''}
        ${statement.party.phone ? `<div class="sub">هاتف: ${esc(statement.party.phone)}</div>` : ''}
        ${statement.party.address ? `<div class="sub">${esc(statement.party.address)}</div>` : ''}
      </div>
      <div class="info-box">
        <h3>الفترة</h3>
        <div class="sub">من ${formatDate(statement.from, s)} إلى ${formatDate(statement.to, s)}</div>
        <div class="sub">الرصيد الافتتاحي: ${money(statement.openingBalance, s, true)}</div>
        <div class="val" style="margin-top:5px">الرصيد الختامي: ${money(statement.closingBalance, s, true)}</div>
      </div>
    </div>

    <table>
      <thead><tr><th style="width:13%">التاريخ</th><th style="width:15%">رقم المستند</th><th>البيان</th><th style="width:14%">مدين</th><th style="width:14%">دائن</th><th style="width:15%">الرصيد</th></tr></thead>
      <tbody>
        <tr style="background:#eff6ff"><td colspan="3" class="right"><strong>رصيد افتتاحي</strong></td><td>—</td><td>—</td><td><strong>${money(statement.openingBalance, s)}</strong></td></tr>
        ${rows}
      </tbody>
      <tfoot>
        <tr><td colspan="3" class="right">الإجماليات</td><td>${money(statement.totalDebit, s)}</td><td>${money(statement.totalCredit, s)}</td><td>${money(statement.closingBalance, s)}</td></tr>
      </tfoot>
    </table>

    <div class="info-box" style="text-align:center;background:${statement.closingBalance > 0 ? '#fef2f2' : '#f0fdf4'};border-color:${statement.closingBalance > 0 ? '#fecaca' : '#bbf7d0'}">
      <h3>${isCustomer ? 'الرصيد المستحق على العميل' : 'الرصيد المستحق للمورد'}</h3>
      <div style="font-size:23px;font-weight:700;color:${statement.closingBalance > 0 ? '#991b1b' : '#166534'}">${money(Math.abs(statement.closingBalance), s, true)}</div>
      ${statement.closingBalance < 0 ? '<div class="sub">رصيد دائن لصالح الطرف الآخر</div>' : ''}
    </div>
    ${footer(ctx)}`
}

/** أمر إنتاج */
export function productionOrderHtml(ctx: PrintContext, order: Record<string, unknown>): string {
  const s = ctx.settings
  const materials = (order.materials ?? []) as Record<string, unknown>[]
  const costs = (order.costs ?? []) as Record<string, unknown>[]
  const outputs = (order.outputs ?? []) as Record<string, unknown>[]

  return `${documentHead(ctx, `أمر إنتاج ${order.order_number}`)}
  <div class="page">
    ${header(ctx, 'أمر إنتاج', String(order.order_number), String(order.date))}
    <div class="info-grid">
      <div class="info-box">
        <h3>المصنع</h3>
        <div class="val">${esc(order.factory_name)}</div>
        ${order.factory_phone ? `<div class="sub">هاتف: ${esc(order.factory_phone)}</div>` : ''}
      </div>
      <div class="info-box">
        <h3>المنتج المطلوب</h3>
        <div class="val">${esc(order.product_name)}${order.size || order.color ? ` (${esc([order.size, order.color].filter(Boolean).join(' / '))})` : ''}</div>
        <div class="sub">الكمية المتوقعة: ${qty(Number(order.expected_qty), s)} ${esc(order.unit ?? '')}</div>
        <div class="sub">المنتج فعليًا: ${qty(Number(order.produced_qty), s)} ${esc(order.unit ?? '')}</div>
        <div class="sub">الحالة: ${esc(order.status_label)}</div>
      </div>
    </div>

    <h3 style="margin:12px 0 6px;font-size:13px">الخامات</h3>
    <table>
      <thead><tr><th>#</th><th>الخامة</th><th>المخطط</th><th>المصروف</th><th>تكلفة المصروف</th></tr></thead>
      <tbody>${materials
        .map(
          (m, i) => `<tr><td>${i + 1}</td><td class="right">${esc(m.product_name)} <small class="code">${esc(m.sku)}</small></td>
          <td>${qty(Number(m.planned_qty), s)} ${esc(m.unit ?? '')}</td><td>${qty(Number(m.issued_qty), s)} ${esc(m.unit ?? '')}</td>
          <td>${money(Number(m.issued_cost), s)}</td></tr>`
        )
        .join('')}</tbody>
    </table>

    ${
      costs.length
        ? `<h3 style="margin:12px 0 6px;font-size:13px">تكاليف التصنيع</h3>
           <table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المبلغ</th></tr></thead>
           <tbody>${costs
             .filter((c) => c.status === 'confirmed')
             .map(
               (c) => `<tr><td>${formatDate(String(c.date), s)}</td><td>${c.cost_type === 'factory' ? 'أجر تصنيع' : 'تكلفة أخرى'}</td>
               <td class="right bidi">${esc(c.description ?? '—')}</td><td>${money(Number(c.amount), s)}</td></tr>`
             )
             .join('')}</tbody></table>`
        : ''
    }

    ${
      outputs.length
        ? `<h3 style="margin:12px 0 6px;font-size:13px">الاستلامات</h3>
           <table><thead><tr><th>التاريخ</th><th>الكمية</th><th>تكلفة الوحدة</th><th>إجمالي التكلفة</th></tr></thead>
           <tbody>${outputs
             .map(
               (o) => `<tr><td>${formatDate(String(o.date), s)}</td><td>${qty(Number(o.quantity), s)}</td>
               <td>${money(Math.round(fromRate(Number(o.unit_cost)) * 100), s)}</td><td>${money(Number(o.total_cost), s)}</td></tr>`
             )
             .join('')}</tbody></table>`
        : ''
    }

    <table class="totals">
      <tr><td>تكلفة الخامات</td><td>${money(Number(order.materials_cost), s, true)}</td></tr>
      <tr><td>أجر التصنيع</td><td>${money(Number(order.factory_cost), s, true)}</td></tr>
      <tr><td>تكاليف أخرى</td><td>${money(Number(order.other_cost), s, true)}</td></tr>
      <tr class="grand"><td>إجمالي التكلفة</td><td>${money(Number(order.total_cost), s, true)}</td></tr>
      <tr><td>تكلفة الوحدة المنتجة</td><td>${money(Math.round(fromRate(Number(order.unit_cost)) * 100), s, true)}</td></tr>
    </table>

    ${order.notes ? `<div class="notes">${esc(order.notes)}</div>` : ''}
    <div class="signatures">
      <div class="signature"><div class="line">توقيع المصنع</div></div>
      <div class="signature"><div class="line">توقيع الإدارة</div></div>
    </div>
    ${footer(ctx)}`
}

export interface ReportPrintColumn {
  key: string
  label: string
  type?: 'text' | 'money' | 'number' | 'qty' | 'date'
  width?: string
}

/** قالب عام لطباعة أي تقرير جدولي */
export function reportHtml(
  ctx: PrintContext,
  report: {
    title: string
    subtitle?: string
    meta?: { label: string; value: string }[]
    cards?: { label: string; value: string; tone?: 'pos' | 'neg' }[]
    columns: ReportPrintColumn[]
    rows: Record<string, unknown>[]
    totals?: Record<string, unknown>
  }
): string {
  const s = ctx.settings
  const cell = (row: Record<string, unknown>, column: ReportPrintColumn): string => {
    const value = row[column.key]
    if (value === null || value === undefined) return '—'
    if (column.type === 'money') return money(Number(value), s)
    if (column.type === 'qty') return qty(Number(value), s)
    if (column.type === 'date') return formatDate(String(value), s)
    if (column.type === 'number') return `<span class="num-cell">${esc(value)}</span>`
    return esc(value)
  }

  return `${documentHead(ctx, report.title)}
  <div class="page">
    ${header(ctx, report.title, report.subtitle ?? '', todayIso())}
    ${
      report.meta?.length
        ? `<div class="info-grid">${report.meta
            .map((m) => `<div class="info-box"><h3>${esc(m.label)}</h3><div class="val">${esc(m.value)}</div></div>`)
            .join('')}</div>`
        : ''
    }
    ${
      report.cards?.length
        ? `<div class="summary-cards">${report.cards
            .map((c) => `<div class="summary-card"><div class="label">${esc(c.label)}</div><div class="value ${c.tone ?? ''}">${esc(c.value)}</div></div>`)
            .join('')}</div>`
        : ''
    }
    <table>
      <thead><tr>${report.columns.map((c) => `<th${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${report.rows
        .map(
          (row) =>
            `<tr>${report.columns
              .map((c) => `<td${c.type === 'text' || !c.type ? ' class="right bidi"' : ''}>${cell(row, c)}</td>`)
              .join('')}</tr>`
        )
        .join('')}</tbody>
      ${
        report.totals
          ? `<tfoot><tr>${report.columns
              .map((c, i) => {
                if (report.totals![c.key] === undefined) return `<td>${i === 0 ? 'الإجمالي' : ''}</td>`
                return `<td>${cell(report.totals!, c)}</td>`
              })
              .join('')}</tr></tfoot>`
          : ''
      }
    </table>
    ${footer(ctx)}`
}
