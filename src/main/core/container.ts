import type { SessionUser } from '@shared/types'
import type { DB } from '../db/connection'
import { openDatabase } from '../db/connection'
import type { AppPaths } from './paths'
import { Logger } from './logger'
import type { Ctx } from './context'

/**
 * حاوية التطبيق: تملك قاعدة البيانات وجلسة المستخدم الحالية والسجل،
 * وتُنشئ سياق (Ctx) لكل عملية حتى تُسجَّل باسم المستخدم المنفِّذ.
 */
export class AppContainer {
  db: DB
  readonly logger: Logger
  currentUser: SessionUser | null = null
  device: string

  constructor(readonly paths: AppPaths, readonly appVersion: string) {
    this.logger = new Logger(paths.logsDir)
    this.db = openDatabase({ file: paths.databaseFile })
    this.device = `${process.platform}-${process.arch}`
  }

  ctx(): Ctx {
    return { db: this.db, user: this.currentUser, device: this.device }
  }

  /** سياق بصلاحيات النظام — يُستخدم للمهام التلقائية مثل النسخ الاحتياطي المجدول */
  systemCtx(): Ctx {
    return { db: this.db, user: this.currentUser, device: 'system' }
  }

  reopenDatabase(): void {
    try {
      this.db.close()
    } catch {
      // القاعدة قد تكون مغلقة بالفعل بعد الاستعادة
    }
    this.db = openDatabase({ file: this.paths.databaseFile })
  }

  close(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)')
      this.db.close()
    } catch (error) {
      this.logger.error('فشل إغلاق قاعدة البيانات', error)
    }
  }
}
