import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow } from 'electron'

export interface PdfOptions {
  landscape?: boolean
  pageSize?: 'A4' | 'A5' | 'Letter'
  fileName?: string
}

/**
 * توليد PDF من HTML عبر محرك Chromium المدمج.
 * هذه أفضل طريقة للطباعة العربية: التشكيل والاتجاه من اليمين لليسار وربط الحروف
 * يتكفّل بها المحرك نفسه، على عكس مكتبات PDF التي تتطلب معالجة يدوية للنص العربي.
 */
async function renderWindow<T>(html: string, action: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1400,
    webPreferences: { offscreen: true, sandbox: true, javascript: false }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    // مهلة قصيرة لضمان اكتمال تحميل الخط المضمَّن قبل الطباعة
    await new Promise((resolve) => setTimeout(resolve, 250))
    return await action(win)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function htmlToPdf(html: string, outputPath: string, options: PdfOptions = {}): Promise<string> {
  const data = await renderWindow(html, (win) =>
    win.webContents.printToPDF({
      pageSize: options.pageSize ?? 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      margins: { marginType: 'none' }
    })
  )
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, data)
  return outputPath
}

/** حفظ PDF مؤقت — يُستخدم للمعاينة أو للإرسال عبر واتساب/البريد */
export async function htmlToTempPdf(html: string, fileName: string): Promise<string> {
  const safeName = fileName.replace(/[^\p{L}\p{N}_.-]/gu, '_')
  return htmlToPdf(html, path.join(os.tmpdir(), `${safeName}-${Date.now()}.pdf`))
}

/** إرسال المستند لطابعة النظام مباشرة */
export async function printHtml(html: string, options: { silent?: boolean; deviceName?: string; landscape?: boolean } = {}): Promise<boolean> {
  return renderWindow(
    html,
    (win) =>
      new Promise<boolean>((resolve, reject) => {
        win.webContents.print(
          {
            silent: options.silent ?? false,
            printBackground: true,
            deviceName: options.deviceName,
            landscape: options.landscape ?? false,
            margins: { marginType: 'none' }
          },
          (success, failureReason) => {
            if (!success && failureReason && failureReason !== 'Print job canceled') reject(new Error(failureReason))
            else resolve(success)
          }
        )
      })
  )
}

export async function listPrinters(): Promise<{ name: string; displayName: string; isDefault: boolean }[]> {
  return renderWindow('<html><body></body></html>', async (win) => {
    const printers = await win.webContents.getPrintersAsync()
    return printers.map((p) => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault }))
  })
}
