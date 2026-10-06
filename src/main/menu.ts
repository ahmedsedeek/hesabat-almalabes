import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/** قائمة التطبيق بالعربية — الاختصارات تعمل على ويندوز وماك */
export function buildMenu(window: BrowserWindow): Menu {
  const send = (route: string) => (): void => {
    window.webContents.send('app:message', { type: 'navigate', payload: route })
  }

  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.getName(),
            submenu: [
              { role: 'about', label: 'حول التطبيق' },
              { type: 'separator' },
              { role: 'hide', label: 'إخفاء' },
              { role: 'hideOthers', label: 'إخفاء الآخرين' },
              { role: 'unhide', label: 'إظهار الكل' },
              { type: 'separator' },
              { role: 'quit', label: 'إنهاء' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'ملف',
      submenu: [
        { label: 'فاتورة بيع جديدة', accelerator: 'CmdOrCtrl+N', click: send('/sales/new') },
        { label: 'فاتورة شراء جديدة', accelerator: 'CmdOrCtrl+Shift+N', click: send('/purchases/new') },
        { label: 'سند قبض جديد', accelerator: 'CmdOrCtrl+R', click: send('/payments/new?direction=in') },
        { type: 'separator' },
        { label: 'نسخة احتياطية الآن', click: send('/settings/backup?action=create') },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'إغلاق النافذة' } : { role: 'quit', label: 'إنهاء' }
      ]
    },
    {
      label: 'تحرير',
      submenu: [
        { role: 'undo', label: 'تراجع' },
        { role: 'redo', label: 'إعادة' },
        { type: 'separator' },
        { role: 'cut', label: 'قص' },
        { role: 'copy', label: 'نسخ' },
        { role: 'paste', label: 'لصق' },
        { role: 'selectAll', label: 'تحديد الكل' }
      ]
    },
    {
      label: 'انتقال',
      submenu: [
        { label: 'لوحة المعلومات', accelerator: 'CmdOrCtrl+1', click: send('/') },
        { label: 'العملاء', accelerator: 'CmdOrCtrl+2', click: send('/customers') },
        { label: 'الموردون', accelerator: 'CmdOrCtrl+3', click: send('/suppliers') },
        { label: 'المصانع', accelerator: 'CmdOrCtrl+4', click: send('/factories') },
        { label: 'المنتجات', accelerator: 'CmdOrCtrl+5', click: send('/products') },
        { label: 'المبيعات', accelerator: 'CmdOrCtrl+6', click: send('/sales') },
        { label: 'المشتريات', accelerator: 'CmdOrCtrl+7', click: send('/purchases') },
        { label: 'التصنيع', accelerator: 'CmdOrCtrl+8', click: send('/production') },
        { label: 'التقارير', accelerator: 'CmdOrCtrl+9', click: send('/reports') },
        { type: 'separator' },
        { label: 'بحث سريع', accelerator: 'CmdOrCtrl+K', click: () => window.webContents.send('app:message', { type: 'open-search' }) }
      ]
    },
    {
      label: 'عرض',
      submenu: [
        { role: 'reload', label: 'إعادة تحميل' },
        { role: 'resetZoom', label: 'حجم افتراضي' },
        { role: 'zoomIn', label: 'تكبير' },
        { role: 'zoomOut', label: 'تصغير' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'ملء الشاشة' },
        { role: 'toggleDevTools', label: 'أدوات المطوّر', visible: !app.isPackaged }
      ]
    },
    {
      label: 'مساعدة',
      submenu: [
        { label: 'دليل الاستخدام', click: send('/help') },
        { label: 'الإعدادات', accelerator: 'CmdOrCtrl+,', click: send('/settings') },
        { type: 'separator' },
        { label: 'فتح مجلد السجلات', click: () => shell.openPath(app.getPath('logs')) }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
