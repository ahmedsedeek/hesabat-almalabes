import { GENERIC_ERROR_MESSAGE } from '@shared/errors'

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly field?: string, readonly details?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * كل اتصال بين الواجهة والنواة يمرّ من هنا.
 * الخطأ يصل دائمًا كرسالة عربية جاهزة للعرض — لا تظهر أي تفاصيل تقنية للمستخدم.
 */
export async function invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  let result: { ok: boolean; data?: T; error?: { code: string; message: string; field?: string; details?: unknown } }
  try {
    result = await window.api.invoke<T>(channel, payload)
  } catch {
    throw new ApiError('INTERNAL', GENERIC_ERROR_MESSAGE)
  }
  if (!result.ok) {
    const error = result.error
    throw new ApiError(error?.code ?? 'INTERNAL', error?.message ?? GENERIC_ERROR_MESSAGE, error?.field, error?.details)
  }
  return result.data as T
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return GENERIC_ERROR_MESSAGE
}
