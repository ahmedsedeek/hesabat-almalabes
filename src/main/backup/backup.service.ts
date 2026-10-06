import { todayIso } from '@shared/date'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Database } from 'better-sqlite3'
import { AppError } from '@shared/errors'
import type { Ctx } from '../core/context'
import { SettingsService } from '../services/settings.service'
import { AuditService } from '../services/audit.service'
import { NotificationService } from '../services/notification.service'
import { checkIntegrity, openDatabase } from '../db/connection'
import { currentSchemaVersion, LATEST_SCHEMA_VERSION } from '../db/migrate'
import { decryptFileSync, encryptFileSync, isEncryptedBackup, sha256File, compressFile, decompressFile } from './crypto'

export interface BackupResult {
  id: number
  fileName: string
  filePath: string
  sizeBytes: number
  encrypted: boolean
  destination: 'local' | 'cloud'
}

export interface BackupRecord {
  id: number
  created_at: string
  backup_type: string
  destination: string
  provider: string | null
  file_name: string
  file_path: string | null
  size_bytes: number
  checksum: string | null
  encrypted: number
  status: string
  error_message: string | null
  app_version: string | null
  schema_version: number | null
}

/**
 * النسخ الاحتياطي.
 *
 * القاعدة المحلية هي مصدر الحقيقة؛ النسخ الاحتياطي لا يعطّل العمل ولا يحتاج إنترنت.
 * النسخة تُؤخذ عبر آلية SQLite الرسمية (`backup`) وليس بنسخ الملف، فتكون متسقة حتى أثناء الكتابة.
 * ثم تُضغط وتُشفَّر (AES-256-GCM) قبل رفعها.
 *
 * النسخ السحابي يعمل عبر «مجلد مزامنة» — مجلد Google Drive أو OneDrive أو Dropbox المثبَّت على الجهاز.
 * هذا الخيار مجاني تمامًا، لا يحتاج مفاتيح API، ويعمل مع أي مزوّد، والملف يبقى مشفَّرًا قبل أن يغادر الجهاز.
 */
export class BackupService {
  private readonly db: Database
  private readonly settings: SettingsService
  private readonly audit: AuditService
  private readonly notifications: NotificationService

  constructor(
    private readonly ctx: Ctx,
    private readonly paths: { databaseFile: string; defaultBackupDir: string; appVersion: string }
  ) {
    this.db = ctx.db
    this.settings = new SettingsService(ctx.db)
    this.audit = new AuditService(ctx)
    this.notifications = new NotificationService(ctx.db)
  }

  private backupDir(): string {
    const configured = this.settings.getSection('backup').localPath
    const dir = configured?.trim() ? configured : this.paths.defaultBackupDir
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  /** كلمة مرور التشفير — تُشتق من معرّف التثبيت ما لم يحدد المستخدم كلمة خاصة */
  private passphrase(): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'backupKey'").get() as { value: string } | undefined
    if (row) return JSON.parse(row.value) as string
    const generated = `${os.hostname()}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('backupKey', ?)")
      .run(JSON.stringify(generated))
    return generated
  }

  /** كلمة مرور التشفير لعرضها للمستخدم حتى يحفظها في مكان آمن — بدونها لا يمكن استعادة نسخة مشفَّرة */
  getRecoveryKey(): string {
    return this.passphrase()
  }

  setRecoveryKey(key: string): void {
    if (key.length < 8) throw new AppError('VALIDATION', 'مفتاح الاستعادة يجب ألا يقل عن ٨ أحرف.')
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('backupKey', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(key))
    this.audit.log({ action: 'update', entityType: 'backup_key', severity: 'critical' })
  }

  async create(type: 'manual' | 'scheduled' | 'pre_migration' | 'pre_restore' = 'manual'): Promise<BackupResult> {
    const settings = this.settings.getSection('backup')
    const dir = this.backupDir()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const extension = settings.encrypt ? 'hmbak' : 'db.gz'
    const fileName = `backup-${stamp}.${extension}`
    const target = path.join(dir, fileName)
    const tempFile = path.join(os.tmpdir(), `hm-backup-${Date.now()}.db`)

    const recordId = Number(
      this.db
        .prepare(
          `INSERT INTO backup_records (backup_type, destination, file_name, status, app_version, schema_version)
           VALUES (?, 'local', ?, 'in_progress', ?, ?)`
        )
        .run(type, fileName, this.paths.appVersion, currentSchemaVersion(this.db)).lastInsertRowid
    )

    try {
      // نسخة متسقة عبر آلية SQLite نفسها
      await (this.db as unknown as { backup: (dest: string) => Promise<unknown> }).backup(tempFile)

      if (settings.encrypt) {
        encryptFileSync(tempFile, target, this.passphrase())
      } else {
        await compressFile(tempFile, target)
      }
      fs.rmSync(tempFile, { force: true })

      const stat = fs.statSync(target)
      this.db
        .prepare(
          `UPDATE backup_records SET status = 'success', file_path = ?, size_bytes = ?, checksum = ?, encrypted = ?
           WHERE id = ?`
        )
        .run(target, stat.size, sha256File(target), settings.encrypt ? 1 : 0, recordId)

      this.settings.update('backup', { lastLocalBackupAt: new Date().toISOString() })
      this.pruneOldBackups(dir, settings.retentionCount)
      this.audit.log({ action: 'backup', entityType: 'backup', entityId: recordId, entityLabel: fileName })
      if (this.settings.getSection('notifications').backupStatus && type === 'scheduled') {
        this.notifications.push({
          type: 'backup_success',
          severity: 'info',
          title: 'اكتملت النسخة الاحتياطية',
          body: `تم حفظ نسخة احتياطية باسم ${fileName}.`,
          dedupeKey: `backup_success:${stamp.slice(0, 10)}`
        })
      }

      return { id: recordId, fileName, filePath: target, sizeBytes: stat.size, encrypted: settings.encrypt, destination: 'local' }
    } catch (error) {
      fs.rmSync(tempFile, { force: true })
      const message = error instanceof Error ? error.message : String(error)
      this.db.prepare("UPDATE backup_records SET status = 'failed', error_message = ? WHERE id = ?").run(message, recordId)
      this.notifications.push({
        type: 'backup_failed',
        severity: 'critical',
        title: 'فشل النسخ الاحتياطي',
        body: 'تعذّر إنشاء نسخة احتياطية. تحقق من مسار الحفظ والمساحة المتاحة على القرص.',
        dedupeKey: `backup_failed:${todayIso()}`
      })
      this.audit.log({ action: 'backup_failed', entityType: 'backup', entityId: recordId, severity: 'critical', reason: message })
      throw new AppError('BACKUP_FAILED', 'تعذّر إنشاء النسخة الاحتياطية. تحقق من مسار الحفظ والمساحة المتاحة.', { cause: error })
    }
  }

  /** نسخ آخر نسخة محلية إلى مجلد المزامنة السحابية */
  async uploadToCloud(localBackupPath?: string): Promise<BackupResult> {
    const settings = this.settings.getSection('backup')
    if (!settings.cloudEnabled) throw new AppError('BACKUP_FAILED', 'النسخ السحابي غير مفعّل في الإعدادات.')
    if (!settings.cloudFolder?.trim()) {
      throw new AppError('BACKUP_FAILED', 'حدّد مجلد المزامنة السحابية من الإعدادات أولًا.')
    }

    const source = localBackupPath ?? (await this.create('scheduled')).filePath
    const fileName = path.basename(source)
    const recordId = Number(
      this.db
        .prepare(
          `INSERT INTO backup_records (backup_type, destination, provider, file_name, status, app_version, schema_version)
           VALUES ('scheduled', 'cloud', ?, ?, 'in_progress', ?, ?)`
        )
        .run(settings.cloudProvider, fileName, this.paths.appVersion, currentSchemaVersion(this.db)).lastInsertRowid
    )

    try {
      fs.mkdirSync(settings.cloudFolder, { recursive: true })
      const target = path.join(settings.cloudFolder, fileName)
      fs.copyFileSync(source, target)
      // التحقق من نجاح النسخ بمقارنة البصمة
      if (sha256File(source) !== sha256File(target)) {
        throw new Error('CHECKSUM_MISMATCH')
      }
      const stat = fs.statSync(target)
      this.db
        .prepare("UPDATE backup_records SET status = 'success', file_path = ?, size_bytes = ?, checksum = ?, encrypted = ? WHERE id = ?")
        .run(target, stat.size, sha256File(target), settings.encrypt ? 1 : 0, recordId)
      this.settings.update('backup', { lastCloudBackupAt: new Date().toISOString() })
      this.pruneOldBackups(settings.cloudFolder, settings.retentionCount)
      return { id: recordId, fileName, filePath: target, sizeBytes: stat.size, encrypted: settings.encrypt, destination: 'cloud' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.db.prepare("UPDATE backup_records SET status = 'failed', error_message = ? WHERE id = ?").run(message, recordId)
      this.notifications.push({
        type: 'cloud_backup_failed',
        severity: 'critical',
        title: 'فشل الرفع السحابي',
        body: 'تعذّر نسخ النسخة الاحتياطية إلى مجلد المزامنة. تأكد من وجود المجلد ومن اتصال برنامج المزامنة.',
        dedupeKey: `cloud_backup_failed:${todayIso()}`
      })
      throw new AppError('BACKUP_FAILED', 'تعذّر رفع النسخة الاحتياطية إلى المجلد السحابي.', { cause: error })
    }
  }

  /** حذف النسخ الأقدم مع الإبقاء على العدد المحدد في الإعدادات */
  private pruneOldBackups(dir: string, keep: number): void {
    if (!keep || keep < 1) return
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('backup-') && (f.endsWith('.hmbak') || f.endsWith('.db.gz')))
      .map((f) => ({ name: f, full: path.join(dir, f), time: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    for (const file of files.slice(keep)) {
      try {
        fs.rmSync(file.full, { force: true })
        this.db.prepare('UPDATE backup_records SET status = ? WHERE file_path = ?').run('success', file.full)
      } catch {
        // تجاهل فشل حذف ملف واحد حتى لا يفشل النسخ الاحتياطي كله
      }
    }
  }

  list(limit = 50): BackupRecord[] {
    return this.db
      .prepare('SELECT * FROM backup_records ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as BackupRecord[]
  }

  /** ملفات النسخ الاحتياطي الموجودة فعلًا على القرص */
  listFiles(): { fileName: string; filePath: string; sizeBytes: number; modifiedAt: string; encrypted: boolean }[] {
    const dirs = [this.backupDir()]
    const cloud = this.settings.getSection('backup').cloudFolder
    if (cloud?.trim() && fs.existsSync(cloud)) dirs.push(cloud)
    const out: { fileName: string; filePath: string; sizeBytes: number; modifiedAt: string; encrypted: boolean }[] = []
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.hmbak') && !name.endsWith('.db.gz')) continue
        const full = path.join(dir, name)
        const stat = fs.statSync(full)
        out.push({
          fileName: name,
          filePath: full,
          sizeBytes: stat.size,
          modifiedAt: new Date(stat.mtimeMs).toISOString(),
          encrypted: name.endsWith('.hmbak')
        })
      }
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  }

  /**
   * التحقق من صلاحية ملف نسخة احتياطية قبل الاستعادة —
   * يفك الضغط إلى ملف مؤقت ويتأكد أنه قاعدة بيانات سليمة بإصدار مخطط مدعوم.
   */
  async verify(backupPath: string, passphrase?: string): Promise<{ ok: boolean; schemaVersion: number; problems: string[]; tempFile: string }> {
    if (!fs.existsSync(backupPath)) {
      throw new AppError('RESTORE_FAILED', 'ملف النسخة الاحتياطية غير موجود.')
    }
    const tempFile = path.join(os.tmpdir(), `hm-restore-${Date.now()}.db`)
    try {
      if (isEncryptedBackup(backupPath)) {
        decryptFileSync(backupPath, tempFile, passphrase ?? this.passphrase())
      } else {
        await decompressFile(backupPath, tempFile)
      }
    } catch (error) {
      fs.rmSync(tempFile, { force: true })
      throw new AppError('RESTORE_FAILED', 'تعذّر فتح ملف النسخة الاحتياطية. قد يكون تالفًا أو مفتاح الاستعادة غير صحيح.', { cause: error })
    }

    const probe = openDatabase({ file: tempFile, seed: false })
    try {
      const integrity = checkIntegrity(probe)
      const schemaVersion = currentSchemaVersion(probe)
      const problems = [...integrity.problems]
      if (schemaVersion > LATEST_SCHEMA_VERSION) {
        problems.push('النسخة الاحتياطية أُنشئت بإصدار أحدث من التطبيق. حدّث التطبيق أولًا.')
      }
      return { ok: problems.length === 0, schemaVersion, problems, tempFile }
    } finally {
      probe.close()
    }
  }

  /**
   * استعادة نسخة احتياطية.
   * يأخذ نسخة أمان من القاعدة الحالية أولًا، ثم يستبدل الملف.
   * يعيد true للدلالة على وجوب إعادة تشغيل التطبيق.
   */
  async restore(backupPath: string, passphrase?: string): Promise<{ requiresRestart: true; safetyBackup: string }> {
    const verification = await this.verify(backupPath, passphrase)
    if (!verification.ok) {
      fs.rmSync(verification.tempFile, { force: true })
      throw new AppError('RESTORE_FAILED', `النسخة الاحتياطية غير سليمة: ${verification.problems[0] ?? 'ملف تالف'}`)
    }

    const safety = await this.create('pre_restore')
    this.audit.log({
      action: 'restore',
      entityType: 'backup',
      entityLabel: path.basename(backupPath),
      severity: 'critical',
      reason: 'استعادة نسخة احتياطية — تم أخذ نسخة أمان قبل الاستبدال'
    })

    // إغلاق القاعدة الحالية ثم استبدال الملف
    this.db.close()
    const dbFile = this.paths.databaseFile
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(`${dbFile}${suffix}`, { force: true })
    }
    fs.copyFileSync(verification.tempFile, dbFile)
    fs.rmSync(verification.tempFile, { force: true })

    return { requiresRestart: true, safetyBackup: safety.filePath }
  }

  /** هل حان موعد النسخ التلقائي؟ */
  isDue(): boolean {
    const settings = this.settings.getSection('backup')
    if (!settings.localEnabled || settings.frequency === 'manual') return false
    const last = settings.lastLocalBackupAt ? new Date(settings.lastLocalBackupAt).getTime() : 0
    const intervalMs = settings.frequency === 'weekly' ? 7 * 86_400_000 : 86_400_000
    return Date.now() - last >= intervalMs
  }
}
