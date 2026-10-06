import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/** مسارات التطبيق — كلها داخل مجلد بيانات المستخدم حتى لا تحتاج صلاحيات إدارية */
export interface AppPaths {
  userData: string
  databaseFile: string
  backupsDir: string
  attachmentsDir: string
  logsDir: string
  exportsDir: string
  resourcesDir: string
}

export function resolvePaths(): AppPaths {
  const userData = app.getPath('userData')
  const paths: AppPaths = {
    userData,
    databaseFile: path.join(userData, 'data', 'business.db'),
    backupsDir: path.join(userData, 'backups'),
    attachmentsDir: path.join(userData, 'attachments'),
    logsDir: path.join(userData, 'logs'),
    exportsDir: path.join(app.getPath('documents'), 'تقارير النظام'),
    resourcesDir: app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')
  }
  for (const dir of [path.dirname(paths.databaseFile), paths.backupsDir, paths.attachmentsDir, paths.logsDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return paths
}
