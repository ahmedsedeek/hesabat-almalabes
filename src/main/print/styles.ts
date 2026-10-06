import fs from 'node:fs'
import path from 'node:path'

let cachedFontCss: string | null = null

/** تضمين خط Cairo داخل ملف HTML حتى يظهر النص العربي بنفس الشكل على ويندوز وماك وفي ملف PDF */
export function arabicFontCss(resourcesDir: string): string {
  if (cachedFontCss !== null) return cachedFontCss
  const faces: string[] = []
  const files: { file: string; weight: number }[] = [
    { file: 'Cairo-Regular.ttf', weight: 400 },
    { file: 'Cairo-SemiBold.ttf', weight: 600 },
    { file: 'Cairo-Bold.ttf', weight: 700 }
  ]
  for (const font of files) {
    const full = path.join(resourcesDir, 'fonts', font.file)
    if (!fs.existsSync(full)) continue
    const base64 = fs.readFileSync(full).toString('base64')
    faces.push(
      `@font-face{font-family:'Cairo';font-style:normal;font-weight:${font.weight};src:url(data:font/ttf;base64,${base64}) format('truetype');}`
    )
  }
  cachedFontCss = faces.join('\n')
  return cachedFontCss
}

/** أنماط الطباعة المشتركة لكل المستندات — تخطيط من اليمين لليسار وألوان مناسبة للطباعة */
export const PRINT_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cairo','Segoe UI','Geeza Pro',Tahoma,sans-serif;direction:rtl;color:#111827;background:#fff;font-size:12px;line-height:1.6}
.page{padding:18mm 14mm}
.doc-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #1a70db;padding-bottom:12px;margin-bottom:16px}
.company{display:flex;gap:12px;align-items:center}
.company img{height:56px;max-width:150px;object-fit:contain}
.company-name{font-size:19px;font-weight:700;color:#16294a}
.company-meta{font-size:11px;color:#4b5563;margin-top:2px;white-space:pre-line}
.doc-title{text-align:left}
.doc-title h1{font-size:20px;font-weight:700;color:#1a70db}
.doc-title .num{font-size:14px;font-weight:600;margin-top:4px;letter-spacing:.4px}
.doc-title .date{font-size:11px;color:#4b5563;margin-top:2px}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.info-box{border:1px solid #e5e7eb;border-radius:6px;padding:9px 11px;background:#fafafa}
.info-box h3{font-size:11px;color:#6b7280;font-weight:600;margin-bottom:5px}
.info-box .val{font-size:13px;font-weight:600}
.info-box .sub{font-size:11px;color:#4b5563;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
thead th{background:#1a70db;color:#fff;font-size:11px;font-weight:600;padding:7px 6px;text-align:center;border:1px solid #1a70db}
tbody td{padding:6px;border:1px solid #e5e7eb;font-size:11.5px;text-align:center}
tbody td.right{text-align:right}
tbody tr:nth-child(even){background:#f8fafc}
tfoot td{padding:7px 6px;border:1px solid #e5e7eb;font-weight:700;background:#f1f5f9;font-size:12px}
.totals{margin-right:auto;width:52%;margin-top:4px}
.totals tr td{border:none;padding:4px 6px;font-size:12px}
.totals tr td:first-child{color:#4b5563}
.totals tr td:last-child{text-align:left;font-weight:600}
.totals tr.grand td{border-top:2px solid #1a70db;padding-top:7px;font-size:15px;font-weight:700;color:#16294a}
.num-cell{font-variant-numeric:tabular-nums;direction:ltr;display:inline-block;unicode-bidi:isolate}
.bidi{unicode-bidi:plaintext}
.code{direction:ltr;display:inline-block;unicode-bidi:isolate;font-size:11px;color:#6b7280}
.notes{margin-top:12px;padding:9px 11px;background:#fffbeb;border-right:3px solid #f59e0b;border-radius:4px;font-size:11px}
.footer{margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10.5px;color:#6b7280;display:flex;justify-content:space-between;gap:12px}
.signatures{display:flex;justify-content:space-between;margin-top:28px;gap:30px}
.signature{flex:1;text-align:center;font-size:11px}
.signature .line{border-top:1px solid #9ca3af;margin-top:34px;padding-top:5px}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:600}
.badge-paid{background:#dcfce7;color:#166534}
.badge-due{background:#fee2e2;color:#991b1b}
.badge-partial{background:#fef3c7;color:#92400e}
.badge-void{background:#f3f4f6;color:#6b7280}
.void-stamp{position:fixed;top:42%;right:26%;font-size:76px;color:rgba(220,38,38,.16);font-weight:700;transform:rotate(-22deg);letter-spacing:6px}
.summary-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:14px}
.summary-card{border:1px solid #e5e7eb;border-radius:6px;padding:9px;text-align:center;background:#fafafa}
.summary-card .label{font-size:10.5px;color:#6b7280}
.summary-card .value{font-size:15px;font-weight:700;margin-top:3px;color:#16294a}
.pos{color:#166534}.neg{color:#991b1b}
@page{size:A4;margin:0}
@media print{.page{padding:12mm}tbody tr{break-inside:avoid}thead{display:table-header-group}}
`
