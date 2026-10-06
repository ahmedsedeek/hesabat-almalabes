import { ipcMain } from 'electron'
import { AppError, serializeError } from '@shared/errors'
import type { AppContainer } from '../core/container'
import { coreRoutes } from './routes.core'
import { businessRoutes } from './routes.business'
import { reportRoutes } from './routes.reports'
import type { RouteMap } from './types'

export const ROUTES: RouteMap = { ...coreRoutes, ...businessRoutes, ...reportRoutes }

export const IPC_CHANNEL = 'api:invoke'

/**
 * نقطة دخول واحدة لكل استدعاءات الواجهة.
 * كل استدعاء يمرّ بفحص الجلسة والصلاحية قبل تنفيذه،
 * والأخطاء تُحوَّل إلى رسائل عربية آمنة مع تسجيل التفاصيل التقنية في السجل.
 */
export function registerIpc(app: AppContainer): void {
  ipcMain.handle(IPC_CHANNEL, async (_event, channel: string, payload: unknown) => {
    const route = ROUTES[channel]
    if (!route) {
      app.logger.error(`قناة غير معروفة: ${channel}`)
      return { ok: false, error: serializeError(new AppError('NOT_FOUND', 'الإجراء المطلوب غير متاح في هذا الإصدار.')) }
    }

    try {
      if (!route.public && !app.currentUser) {
        throw new AppError('PERMISSION_DENIED', 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.')
      }
      if (route.permission && !app.currentUser?.permissions.includes(route.permission)) {
        throw new AppError('PERMISSION_DENIED', 'ليس لديك صلاحية لتنفيذ هذه العملية.')
      }
      const data = await route.handler(app, payload)
      return { ok: true, data }
    } catch (error) {
      if (error instanceof AppError) {
        if (error.code === 'INTERNAL' || error.code === 'BALANCE_MISMATCH') {
          app.logger.error(`خطأ في ${channel}`, error)
        } else {
          app.logger.warn(`رفض العملية ${channel}: ${error.userMessage}`, { code: error.code })
        }
      } else {
        app.logger.error(`خطأ غير متوقع في ${channel}`, error)
      }
      return { ok: false, error: serializeError(error) }
    }
  })
}
