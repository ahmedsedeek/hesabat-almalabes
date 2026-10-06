/**
 * توليد أيقونة التطبيق.
 * تُرسم الأيقونة كصفحة HTML ثم تُلتقط عبر Electron، فيظهر الحرف العربي بشكل صحيح
 * ويستطيع electron-builder بعدها توليد صيغ .icns و .ico تلقائيًا من ملف PNG واحد.
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 1024

const fontBase64 = fs.readFileSync(path.join(root, 'resources', 'fonts', 'Cairo-Bold.ttf')).toString('base64')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Cairo';font-weight:700;src:url(data:font/ttf;base64,${fontBase64}) format('truetype');}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${SIZE}px;height:${SIZE}px;overflow:hidden;background:transparent}
.icon{width:${SIZE}px;height:${SIZE}px;border-radius:${SIZE * 0.22}px;
  background:linear-gradient(145deg,#3d9bff 0%,#1a70db 48%,#16294a 100%);
  position:relative;overflow:hidden;
  box-shadow:inset 0 ${SIZE * 0.012}px ${SIZE * 0.05}px rgba(255,255,255,.3)}
.glyph{position:absolute;left:0;right:0;top:${SIZE * 0.09}px;text-align:center;
  font-family:'Cairo',sans-serif;font-weight:700;color:#fff;font-size:${SIZE * 0.46}px;line-height:1;
  text-shadow:0 ${SIZE * 0.012}px ${SIZE * 0.035}px rgba(0,0,0,.28)}
.bars{position:absolute;left:0;right:0;bottom:${SIZE * 0.14}px;
  display:flex;align-items:flex-end;justify-content:center;gap:${SIZE * 0.035}px;height:${SIZE * 0.2}px}
.bar{width:${SIZE * 0.07}px;border-radius:${SIZE * 0.018}px;background:#fff;opacity:.95}
</style></head><body>
<div class="icon">
  <div class="glyph">ح</div>
  <div class="bars">
    <div class="bar" style="height:45%"></div>
    <div class="bar" style="height:75%"></div>
    <div class="bar" style="height:100%"></div>
    <div class="bar" style="height:62%"></div>
  </div>
</div></body></html>`

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true, javascript: false }
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const image = await win.webContents.capturePage()
  fs.mkdirSync(path.join(root, 'build'), { recursive: true })
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), image.toPNG())
  console.log('[icon] build/icon.png أُنشئت بحجم', image.getSize())
  win.destroy()
  app.quit()
})
