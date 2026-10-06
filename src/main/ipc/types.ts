import type { Permission } from '@shared/permissions'
import type { AppContainer } from '../core/container'

/**
 * تعريف مسار IPC واحد.
 * الحمولة غير مقيّدة النوع هنا لأن التحقق الفعلي يحدث داخل الخدمات نفسها،
 * حيث تُرفض أي بيانات غير صالحة برسالة عربية واضحة.
 */
export interface RouteDef {
  /** الصلاحية المطلوبة لتنفيذ هذا الإجراء */
  permission?: Permission
  /** بعض المسارات متاحة قبل تسجيل الدخول (الإعداد الأولي وتسجيل الدخول) */
  public?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (app: AppContainer, payload: any) => unknown | Promise<unknown>
}

export type RouteMap = Record<string, RouteDef>

export function route(def: RouteDef): RouteDef {
  return def
}
