import fs from 'node:fs'
import path from 'node:path'
import { app as electronApp, dialog, shell } from 'electron'
import { PERMISSIONS } from '@shared/permissions'
import { ERRORS } from '@shared/errors'
import { AuthService } from '../services/auth.service'
import { SettingsService } from '../services/settings.service'
import { NumberingService } from '../services/numbering.service'
import { AuditService } from '../services/audit.service'
import { NotificationService } from '../services/notification.service'
import { WarehouseService } from '../services/warehouse.service'
import { IntegrityService } from '../services/integrity.service'
import { LedgerService } from '../accounting/ledger'
import { route, type RouteMap } from './types'

export const coreRoutes: RouteMap = {
  'app:info': route({
    public: true,
    handler: (app) => ({
      version: app.appVersion,
      platform: process.platform,
      paths: { backups: app.paths.backupsDir, database: app.paths.databaseFile, logs: app.paths.logsDir },
      hasUsers: new AuthService(app.ctx()).hasAnyUser(),
      setupCompleted: new SettingsService(app.db).isSetupCompleted()
    })
  }),

  'settings:get': route({
    public: true,
    handler: (app) => new SettingsService(app.db).getAll()
  }),

  'settings:update': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: (app, payload: { section: string; value: Record<string, unknown> }) => {
      const service = new SettingsService(app.db)
      const updated = service.update(payload.section as never, payload.value as never)
      new AuditService(app.ctx()).log({
        action: 'update',
        entityType: 'settings',
        entityLabel: payload.section,
        newValue: payload.value,
        severity: 'warning'
      })
      return updated
    }
  }),

  // ------------------------- الإعداد الأولي -------------------------
  'setup:run': route({
    public: true,
    handler: (app, payload: {
      company: Record<string, unknown>
      currency: { code: string; symbol: string; decimals: number; name: string }
      admin: { username: string; fullName: string; password: string }
      numbering?: { docType: string; prefix: string; padding: number; includeYear: boolean; nextNumber: number }[]
      warehouse?: { code?: string; name: string; address?: string }
      backup?: { localPath?: string; frequency?: 'daily' | 'weekly' | 'manual'; cloudEnabled?: boolean; cloudFolder?: string }
      tax?: { enabled: boolean; defaultRate: number; label: string }
    }) => {
      const auth = new AuthService(app.ctx())
      const settings = new SettingsService(app.db)
      if (settings.isSetupCompleted() || auth.hasAnyUser()) {
        throw ERRORS.conflict('تم إعداد النظام من قبل. سجّل الدخول بحسابك.')
      }

      const run = app.db.transaction(() => {
        settings.update('company', payload.company as never)
        settings.update('currency', payload.currency as never)
        if (payload.tax) settings.update('tax', payload.tax as never)
        if (payload.backup) settings.update('backup', payload.backup as never)

        const adminRole = app.db.prepare("SELECT id FROM roles WHERE code = 'admin'").get() as { id: number }
        auth.createUser({
          username: payload.admin.username,
          fullName: payload.admin.fullName,
          password: payload.admin.password,
          roleId: adminRole.id
        })

        const numbering = new NumberingService(app.db)
        for (const seq of payload.numbering ?? []) {
          numbering.update(seq.docType, {
            prefix: seq.prefix,
            padding: seq.padding,
            includeYear: seq.includeYear,
            nextNumber: seq.nextNumber
          })
        }

        if (payload.warehouse?.name) {
          const warehouses = new WarehouseService(app.ctx())
          const existing = app.db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get() as { id: number } | undefined
          if (existing) warehouses.update(existing.id, { name: payload.warehouse.name, address: payload.warehouse.address ?? null, code: payload.warehouse.code })
          else warehouses.create({ ...payload.warehouse, isDefault: true })
        }

        settings.set('setupCompleted', true)
      })
      run.immediate()
      return { ok: true }
    }
  }),

  // ------------------------- المصادقة -------------------------
  'auth:login': route({
    public: true,
    handler: (app, payload: { username: string; password: string }) => {
      const session = new AuthService(app.ctx()).login(payload.username, payload.password)
      app.currentUser = session
      new NotificationService(app.db).runChecks()
      return session
    }
  }),

  'auth:session': route({ public: true, handler: (app) => app.currentUser }),

  'auth:logout': route({
    public: true,
    handler: (app) => {
      if (app.currentUser) {
        new AuditService(app.ctx()).log({ action: 'logout', entityType: 'user', entityId: app.currentUser.id })
      }
      app.currentUser = null
      return { ok: true }
    }
  }),

  'auth:changePassword': route({
    handler: (app, payload: { currentPassword: string; newPassword: string }) => {
      if (!app.currentUser) throw ERRORS.permission()
      new AuthService(app.ctx()).changePassword(app.currentUser.id, payload.currentPassword, payload.newPassword)
      return { ok: true }
    }
  }),

  'users:list': route({ permission: PERMISSIONS.USERS_MANAGE, handler: (app) => new AuthService(app.ctx()).listUsers() }),
  'users:create': route({
    permission: PERMISSIONS.USERS_MANAGE,
    handler: (app, payload: any) => new AuthService(app.ctx()).createUser(payload)
  }),
  'users:update': route({
    permission: PERMISSIONS.USERS_MANAGE,
    handler: (app, payload: { id: number; data: never }) => {
      new AuthService(app.ctx()).updateUser(payload.id, payload.data)
      return { ok: true }
    }
  }),
  'roles:list': route({ permission: PERMISSIONS.USERS_MANAGE, handler: (app) => new AuthService(app.ctx()).listRoles() }),
  'roles:create': route({
    permission: PERMISSIONS.USERS_MANAGE,
    handler: (app, payload: { name: string; permissions: never; description?: string }) =>
      new AuthService(app.ctx()).createRole(payload.name, payload.permissions, payload.description)
  }),
  'roles:setPermissions': route({
    permission: PERMISSIONS.USERS_MANAGE,
    handler: (app, payload: { roleId: number; permissions: never }) => {
      new AuthService(app.ctx()).setRolePermissions(payload.roleId, payload.permissions)
      return { ok: true }
    }
  }),
  'roles:delete': route({
    permission: PERMISSIONS.USERS_MANAGE,
    handler: (app, payload: { roleId: number }) => {
      new AuthService(app.ctx()).deleteRole(payload.roleId)
      return { ok: true }
    }
  }),

  // ------------------------- الترقيم -------------------------
  'numbering:list': route({ permission: PERMISSIONS.SETTINGS_MANAGE, handler: (app) => new NumberingService(app.db).list() }),
  'numbering:update': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: (app, payload: { docType: string; data: never }) => new NumberingService(app.db).update(payload.docType, payload.data)
  }),
  'numbering:preview': route({
    handler: (app, payload: { docType: string }) => new NumberingService(app.db).preview(payload.docType)
  }),

  // ------------------------- المخازن -------------------------
  'warehouses:list': route({
    permission: PERMISSIONS.INVENTORY_VIEW,
    handler: (app, payload: { activeOnly?: boolean } = {}) => new WarehouseService(app.ctx()).list(payload?.activeOnly)
  }),
  'warehouses:create': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: (app, payload: any) => new WarehouseService(app.ctx()).create(payload)
  }),
  'warehouses:update': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: (app, payload: { id: number; data: never }) => {
      new WarehouseService(app.ctx()).update(payload.id, payload.data)
      return { ok: true }
    }
  }),
  'warehouses:delete': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: (app, payload: { id: number }) => {
      new WarehouseService(app.ctx()).remove(payload.id)
      return { ok: true }
    }
  }),

  // ------------------------- الحسابات -------------------------
  'accounts:list': route({
    permission: PERMISSIONS.ACCOUNTING_VIEW,
    handler: (app, payload: { activeOnly?: boolean } = {}) => new LedgerService(app.ctx()).listAccounts(payload ?? {})
  }),
  'accounts:cash': route({
    permission: PERMISSIONS.PAYMENTS_VIEW,
    handler: (app) => new LedgerService(app.ctx()).cashBalances()
  }),
  'accounts:ledger': route({
    permission: PERMISSIONS.ACCOUNTING_VIEW,
    handler: (app, payload: { accountId: number; from: string; to: string }) =>
      new LedgerService(app.ctx()).accountLedger(payload.accountId, payload.from, payload.to)
  }),

  // ------------------------- سجل المراجعة والتنبيهات -------------------------
  'audit:query': route({
    permission: PERMISSIONS.AUDIT_VIEW,
    handler: (app, payload: any) => new AuditService(app.ctx()).query(payload ?? {})
  }),
  'notifications:list': route({
    handler: (app, payload: { unreadOnly?: boolean; limit?: number } = {}) => new NotificationService(app.db).list(payload ?? {})
  }),
  'notifications:count': route({ handler: (app) => new NotificationService(app.db).unreadCount() }),
  'notifications:markRead': route({
    handler: (app, payload: { id?: number }) => {
      const service = new NotificationService(app.db)
      if (payload?.id) service.markRead(payload.id)
      else service.markAllRead()
      return { ok: true }
    }
  }),
  'notifications:refresh': route({
    handler: (app) => {
      new NotificationService(app.db).runChecks()
      return new NotificationService(app.db).list({ unreadOnly: true })
    }
  }),

  // ------------------------- سلامة البيانات -------------------------
  'integrity:check': route({
    permission: PERMISSIONS.BACKUP_MANAGE,
    handler: (app) => new IntegrityService(app.ctx()).run()
  }),
  'integrity:repair': route({
    permission: PERMISSIONS.BACKUP_MANAGE,
    handler: (app) => {
      const result = new IntegrityService(app.ctx()).repair()
      new AuditService(app.ctx()).log({ action: 'repair', entityType: 'database', newValue: result, severity: 'critical' })
      return result
    }
  }),
  'integrity:stats': route({ permission: PERMISSIONS.BACKUP_MANAGE, handler: (app) => new IntegrityService(app.ctx()).stats() }),
  'integrity:vacuum': route({
    permission: PERMISSIONS.BACKUP_MANAGE,
    handler: (app) => {
      new IntegrityService(app.ctx()).vacuum()
      return { ok: true }
    }
  }),
  'logs:read': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: (app) => ({ path: app.logger.logFilePath(), content: app.logger.readRecent(300) })
  }),

  // ------------------------- حوارات النظام -------------------------
  'dialog:openFile': route({
    handler: async (app, payload: { filters?: { name: string; extensions: string[] }[]; title?: string }) => {
      const result = await dialog.showOpenDialog({
        title: payload?.title ?? 'اختر ملفًا',
        properties: ['openFile'],
        filters: payload?.filters
      })
      return result.canceled ? null : result.filePaths[0]
    }
  }),
  'dialog:openFolder': route({
    handler: async (app, payload: { title?: string }) => {
      const result = await dialog.showOpenDialog({
        title: payload?.title ?? 'اختر مجلدًا',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled ? null : result.filePaths[0]
    }
  }),
  'dialog:saveFile': route({
    handler: async (app, payload: { defaultName: string; filters?: { name: string; extensions: string[] }[] }) => {
      const result = await dialog.showSaveDialog({
        title: 'حفظ الملف',
        defaultPath: path.join(electronApp.getPath('documents'), payload.defaultName),
        filters: payload.filters
      })
      return result.canceled ? null : result.filePath
    }
  }),
  'shell:openPath': route({
    handler: async (app, payload: { path: string }) => {
      if (!fs.existsSync(payload.path)) throw ERRORS.notFound('الملف')
      await shell.openPath(payload.path)
      return { ok: true }
    }
  }),
  'shell:showInFolder': route({
    handler: (app, payload: { path: string }) => {
      shell.showItemInFolder(payload.path)
      return { ok: true }
    }
  }),
  'shell:openExternal': route({
    handler: async (app, payload: { url: string }) => {
      if (!/^https?:\/\//i.test(payload.url) && !/^mailto:/i.test(payload.url)) {
        throw ERRORS.validation('رابط غير صالح.')
      }
      await shell.openExternal(payload.url)
      return { ok: true }
    }
  })
}
