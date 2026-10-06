import path from 'node:path'
import { app as electronApp } from 'electron'
import { PERMISSIONS } from '@shared/permissions'
import { ERRORS } from '@shared/errors'
import { ReportsService } from '../reports/reports.service'
import { DashboardService } from '../reports/dashboard.service'
import { PartyService } from '../services/party.service'
import { SalesService } from '../services/sales.service'
import { PurchaseService } from '../services/purchase.service'
import { PaymentService } from '../services/payment.service'
import { ProductionService } from '../services/production.service'
import { ExportService, type ExportTable } from '../services/export.service'
import { ImportService, IMPORT_SCHEMAS, type ImportEntity } from '../services/import.service'
import { AttachmentService } from '../services/attachment.service'
import { SettingsService } from '../services/settings.service'
import { BackupService } from '../backup/backup.service'
import { htmlToPdf, htmlToTempPdf, listPrinters, printHtml } from '../print/pdf'
import { invoiceHtml, paymentReceiptHtml, productionOrderHtml, reportHtml, statementHtml, type PrintContext } from '../print/templates'
import { route, type RouteMap } from './types'
import type { AppContainer } from '../core/container'

function printContext(app: AppContainer): PrintContext {
  return { settings: new SettingsService(app.db).getAll(), resourcesDir: app.paths.resourcesDir }
}

/** بناء HTML المستند المطلوب من قاعدة البيانات مباشرة — الواجهة لا تُرسل بيانات مالية للطباعة */
function buildDocumentHtml(app: AppContainer, payload: { docType: string; id?: number; params?: Record<string, unknown> }): { html: string; fileName: string; landscape: boolean } {
  const ctx = printContext(app)
  switch (payload.docType) {
    case 'sale': {
      const doc = new SalesService(app.ctx()).get(payload.id!)
      return { html: invoiceHtml(ctx, doc, 'sale'), fileName: `فاتورة-${doc.invoice_number}`, landscape: false }
    }
    case 'purchase': {
      const doc = new PurchaseService(app.ctx()).get(payload.id!)
      return { html: invoiceHtml(ctx, doc, 'purchase'), fileName: `شراء-${doc.invoice_number}`, landscape: false }
    }
    case 'payment': {
      const doc = new PaymentService(app.ctx()).get(payload.id!)
      return { html: paymentReceiptHtml(ctx, doc), fileName: `سند-${doc.payment_number}`, landscape: false }
    }
    case 'production_order': {
      const doc = new ProductionService(app.ctx()).get(payload.id!)
      return { html: productionOrderHtml(ctx, doc), fileName: `أمر-إنتاج-${doc.order_number}`, landscape: false }
    }
    case 'statement': {
      const params = payload.params as { partyId: number; from: string; to: string }
      const statement = new PartyService(app.ctx()).statement(params.partyId, params.from, params.to)
      return { html: statementHtml(ctx, statement), fileName: `كشف-حساب-${statement.party.name}`, landscape: false }
    }
    case 'report': {
      const params = payload.params as Parameters<typeof reportHtml>[1]
      return { html: reportHtml(ctx, params), fileName: params.title, landscape: params.columns.length > 6 }
    }
    default:
      throw ERRORS.validation('نوع المستند غير معروف.')
  }
}

export const reportRoutes: RouteMap = {
  // ------------------------- لوحة المعلومات -------------------------
  'dashboard:load': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { preset?: never; custom?: { from: string; to: string } } = {}) => {
      const overdueDays = new SettingsService(app.db).getSection('notifications').overdueDays
      return new DashboardService(app.ctx()).load(payload?.preset ?? 'this_month', payload?.custom, overdueDays)
    }
  }),

  // ------------------------- التقارير -------------------------
  'reports:profitAndLoss': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { from: string; to: string }) => new ReportsService(app.ctx()).profitAndLoss(payload)
  }),
  'reports:balanceSheet': route({
    permission: PERMISSIONS.ACCOUNTING_VIEW,
    handler: (app, payload: { asOf: string }) => new ReportsService(app.ctx()).balanceSheet(payload.asOf)
  }),
  'reports:sales': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { from: string; to: string; groupBy?: never }) =>
      new ReportsService(app.ctx()).salesReport(payload, payload.groupBy)
  }),
  'reports:purchases': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { from: string; to: string; groupBy?: never }) =>
      new ReportsService(app.ctx()).purchasesReport(payload, payload.groupBy)
  }),
  'reports:productProfitability': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { from: string; to: string }) => new ReportsService(app.ctx()).productProfitability(payload)
  }),
  'reports:inventoryValuation': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { warehouseId?: number } = {}) => new ReportsService(app.ctx()).inventoryValuation(payload?.warehouseId)
  }),
  'reports:cashFlow': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { from: string; to: string }) => new ReportsService(app.ctx()).cashFlow(payload)
  }),
  'reports:outstanding': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { kind: 'sales' | 'purchases'; asOf: string }) =>
      new ReportsService(app.ctx()).outstandingInvoices(payload.kind, payload.asOf)
  }),
  'reports:production': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { from: string; to: string }) => new ReportsService(app.ctx()).productionReport(payload)
  }),
  'reports:partyBalances': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { partyType: never }) => new ReportsService(app.ctx()).partyBalances(payload.partyType)
  }),
  'reports:payments': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { from: string; to: string; direction?: 'in' | 'out' }) =>
      new ReportsService(app.ctx()).paymentsReport(payload, payload.direction)
  }),
  'reports:trialBalance': route({
    permission: PERMISSIONS.ACCOUNTING_VIEW,
    handler: (app, payload: { asOf: string }) => new ReportsService(app.ctx()).trialBalance(payload.asOf)
  }),

  // ------------------------- الطباعة و PDF -------------------------
  'print:preview': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: async (app, payload: { docType: string; id?: number; params?: Record<string, unknown> }) => {
      const doc = buildDocumentHtml(app, payload)
      const file = await htmlToTempPdf(doc.html, doc.fileName)
      return { path: file, fileName: `${doc.fileName}.pdf` }
    }
  }),
  'print:pdf': route({
    permission: PERMISSIONS.REPORTS_EXPORT,
    handler: async (app, payload: { docType: string; id?: number; params?: Record<string, unknown>; savePath?: string }) => {
      const doc = buildDocumentHtml(app, payload)
      const target = payload.savePath ?? path.join(electronApp.getPath('documents'), `${doc.fileName}.pdf`)
      await htmlToPdf(doc.html, target, { landscape: doc.landscape })
      return { path: target }
    }
  }),
  'print:send': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: async (app, payload: { docType: string; id?: number; params?: Record<string, unknown>; deviceName?: string; silent?: boolean }) => {
      const doc = buildDocumentHtml(app, payload)
      const ok = await printHtml(doc.html, { deviceName: payload.deviceName, silent: payload.silent, landscape: doc.landscape })
      return { ok }
    }
  }),
  'print:printers': route({ handler: () => listPrinters() }),

  // ------------------------- التصدير -------------------------
  'export:excel': route({
    permission: PERMISSIONS.REPORTS_EXPORT,
    handler: async (app, payload: { table: ExportTable; savePath?: string }) => {
      const target = payload.savePath ?? path.join(electronApp.getPath('documents'), `${payload.table.title}.xlsx`)
      await new ExportService().toExcel(payload.table, target)
      return { path: target }
    }
  }),
  'export:csv': route({
    permission: PERMISSIONS.REPORTS_EXPORT,
    handler: (app, payload: { table: ExportTable; savePath?: string }) => {
      const target = payload.savePath ?? path.join(electronApp.getPath('documents'), `${payload.table.title}.csv`)
      new ExportService().toCsv(payload.table, target)
      return { path: target }
    }
  }),

  // ------------------------- الاستيراد -------------------------
  'import:schemas': route({ permission: PERMISSIONS.SETTINGS_MANAGE, handler: () => IMPORT_SCHEMAS }),
  'import:preview': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: (app, payload: { entity: ImportEntity; filePath: string; mapping?: Record<string, string> }) =>
      new ImportService(app.ctx()).preview(payload.entity, payload.filePath, payload.mapping)
  }),
  'import:commit': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: (app, payload: { entity: ImportEntity; rows: never; skipInvalid?: boolean }) =>
      new ImportService(app.ctx()).commit(payload.entity, payload.rows, { skipInvalid: payload.skipInvalid })
  }),
  'import:template': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: async (app, payload: { entity: ImportEntity; savePath: string }) => {
      await new ImportService(app.ctx()).writeTemplate(payload.entity, payload.savePath)
      return { path: payload.savePath }
    }
  }),

  // ------------------------- المرفقات -------------------------
  'attachments:list': route({
    handler: (app, payload: { refType: string; refId: number }) =>
      new AttachmentService(app.ctx(), app.paths.attachmentsDir).list(payload.refType, payload.refId)
  }),
  'attachments:add': route({
    handler: (app, payload: { refType: string; refId: number; filePath: string; notes?: string }) =>
      new AttachmentService(app.ctx(), app.paths.attachmentsDir).add(payload.refType, payload.refId, payload.filePath, payload.notes)
  }),
  'attachments:remove': route({
    handler: (app, payload: { id: number }) => {
      new AttachmentService(app.ctx(), app.paths.attachmentsDir).remove(payload.id)
      return { ok: true }
    }
  }),
  'attachments:storeImage': route({
    permission: PERMISSIONS.PRODUCTS_MANAGE,
    handler: (app, payload: { filePath: string; prefix: string }) => ({
      path: new AttachmentService(app.ctx(), app.paths.attachmentsDir).storeImage(payload.filePath, payload.prefix)
    })
  }),

  // ------------------------- النسخ الاحتياطي -------------------------
  'backup:create': route({
    permission: PERMISSIONS.BACKUP_MANAGE,
    handler: (app) => backupService(app).create('manual')
  }),
  'backup:list': route({ permission: PERMISSIONS.BACKUP_MANAGE, handler: (app) => backupService(app).list() }),
  'backup:files': route({ permission: PERMISSIONS.BACKUP_MANAGE, handler: (app) => backupService(app).listFiles() }),
  'backup:upload': route({
    permission: PERMISSIONS.BACKUP_MANAGE,
    handler: (app, payload: { filePath?: string } = {}) => backupService(app).uploadToCloud(payload?.filePath)
  }),
  'backup:verify': route({
    permission: PERMISSIONS.BACKUP_MANAGE,
    handler: async (app, payload: { filePath: string; passphrase?: string }) => {
      const result = await backupService(app).verify(payload.filePath, payload.passphrase)
      return { ok: result.ok, schemaVersion: result.schemaVersion, problems: result.problems }
    }
  }),
  'backup:restore': route({
    permission: PERMISSIONS.BACKUP_MANAGE,
    handler: async (app, payload: { filePath: string; passphrase?: string }) => {
      const result = await backupService(app).restore(payload.filePath, payload.passphrase)
      app.reopenDatabase()
      app.currentUser = null
      return result
    }
  }),
  'backup:recoveryKey': route({ permission: PERMISSIONS.BACKUP_MANAGE, handler: (app) => ({ key: backupService(app).getRecoveryKey() }) }),
  'backup:setRecoveryKey': route({
    permission: PERMISSIONS.BACKUP_MANAGE,
    handler: (app, payload: { key: string }) => {
      backupService(app).setRecoveryKey(payload.key)
      return { ok: true }
    }
  })
}

function backupService(app: AppContainer): BackupService {
  return new BackupService(app.ctx(), {
    databaseFile: app.paths.databaseFile,
    defaultBackupDir: app.paths.backupsDir,
    appVersion: app.appVersion
  })
}
