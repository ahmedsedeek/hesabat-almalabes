import type { Database } from 'better-sqlite3'
import type { SessionUser } from '@shared/types'

/** السياق المُمرَّر لكل خدمة: قاعدة البيانات + المستخدم المنفِّذ */
export interface Ctx {
  db: Database
  user: SessionUser | null
  device?: string
}

export function actorId(ctx: Ctx): number | null {
  return ctx.user?.id ?? null
}

export function actorName(ctx: Ctx): string {
  return ctx.user?.fullName ?? 'النظام'
}
