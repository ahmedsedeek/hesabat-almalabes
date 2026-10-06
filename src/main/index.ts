import { app, BrowserWindow, Menu, shell, dialog } from 'electron'
import path from 'node:path'
import fsSync from 'node:fs'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { AppContainer } from './core/container'
import { resolvePaths } from './core/paths'
import { registerIpc } from './ipc'
import { BackupService } from './backup/backup.service'
import { NotificationService } from './services/notification.service'
import { checkIntegrity } from './db/connection'
import { buildMenu } from './menu'

let container: AppContainer | null = null
let mainWindow: BrowserWindow | null = null
let backupTimer: NodeJS.Timeout | null = null

// وضع الفحص الذاتي يعمل على قاعدة بيانات مؤقتة، فلا يتنافس مع نسخة قيد التشغيل
const isSelfTest = process.argv.includes('--self-test')

// نسخة واحدة فقط من التطبيق حتى لا تتنافس نسختان على قاعدة البيانات
if (!isSelfTest && !app.requestSingleInstanceLock()) {
  app.quit()
} else if (!isSelfTest) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#f1f5f9',
    autoHideMenuBar: false,
    title: 'نظام إدارة الأعمال والحسابات',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  window.on('ready-to-show', () => {
    window.show()
    if (process.platform !== 'darwin') window.maximize()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

function scheduleBackground(): void {
  if (!container) return
  const runChecks = (): void => {
    if (!container) return
    try {
      const notifications = new NotificationService(container.db)
      notifications.runChecks()
      notifications.clearOld()

      const backup = new BackupService(container.systemCtx(), {
        databaseFile: container.paths.databaseFile,
        defaultBackupDir: container.paths.backupsDir,
        appVersion: container.appVersion
      })
      if (backup.isDue()) {
        backup
          .create('scheduled')
          .then(async (result) => {
            container?.logger.info('اكتملت النسخة الاحتياطية المجدولة', { file: result.fileName })
            const settings = container?.db
              ? (JSON.parse(
                  (container.db.prepare("SELECT value FROM settings WHERE key = 'backup'").get() as { value: string })?.value ?? '{}'
                ) as { cloudEnabled?: boolean })
              : {}
            if (settings.cloudEnabled) await backup.uploadToCloud(result.filePath)
          })
          .catch((error) => container?.logger.error('فشل النسخ الاحتياطي المجدول', error))
      }
      mainWindow?.webContents.send('app:message', { type: 'notifications:updated' })
    } catch (error) {
      container?.logger.error('فشل الفحص الدوري', error)
    }
  }

  // فحص أول بعد دقيقة من التشغيل ثم كل ساعة
  setTimeout(runChecks, 60_000)
  backupTimer = setInterval(runChecks, 60 * 60_000)
}

app.whenReady().then(async () => {
  // وضع الفحص الذاتي: يتحقق من سلامة التثبيت ثم يخرج دون فتح نافذة
  if (process.argv.includes('--self-test')) {
    try {
      const { runSelfTest } = await import('./selftest')
      app.exit(await runSelfTest())
    } catch (error) {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
      console.error('فشل الفحص الذاتي:', detail)
      // يُكتب الخطأ في ملف أيضًا لأن مخرجات العملية الرئيسية قد لا تصل إلى الطرفية
      const reportIndex = process.argv.indexOf('--report')
      if (reportIndex !== -1 && process.argv[reportIndex + 1]) {
        try {
          fsSync.writeFileSync(process.argv[reportIndex + 1], `فشل الفحص الذاتي\n\n${detail}\n`)
        } catch {
          // تجاهل
        }
      }
      app.exit(1)
    }
    return
  }

  electronApp.setAppUserModelId('com.mohamed.business')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const paths = resolvePaths()
  container = new AppContainer(paths, app.getVersion())
  container.logger.info('بدء تشغيل التطبيق', { version: app.getVersion(), platform: process.platform })

  const integrity = checkIntegrity(container.db)
  if (!integrity.ok) {
    container.logger.error('مشكلة في سلامة قاعدة البيانات عند بدء التشغيل', integrity.problems)
    dialog.showErrorBox(
      'تحذير: مشكلة في قاعدة البيانات',
      'تم اكتشاف مشكلة في ملف قاعدة البيانات. يُنصح بالانتقال إلى «الإعدادات ← الصيانة والنسخ الاحتياطي» واستعادة آخر نسخة سليمة.'
    )
  }

  registerIpc(container)
  mainWindow = createWindow()
  Menu.setApplicationMenu(buildMenu(mainWindow))
  scheduleBackground()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (backupTimer) clearInterval(backupTimer)
  container?.logger.info('إغلاق التطبيق')
  container?.close()
})

process.on('uncaughtException', (error) => {
  container?.logger.error('خطأ غير معالَج في العملية الرئيسية', error)
})
process.on('unhandledRejection', (reason) => {
  container?.logger.error('وعد مرفوض دون معالجة', reason)
})
