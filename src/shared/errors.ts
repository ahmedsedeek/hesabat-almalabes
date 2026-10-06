/**
 * أخطاء التطبيق — رسالة عربية واضحة للمستخدم + تفاصيل تقنية للسجل فقط.
 * لا تُعرض رسائل SQLite أو أي نص تقني في الواجهة إطلاقًا.
 */
export type AppErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'PERMISSION_DENIED'
  | 'AUTH_FAILED'
  | 'ACCOUNT_LOCKED'
  | 'IMMUTABLE_DOCUMENT'
  | 'BALANCE_MISMATCH'
  | 'BACKUP_FAILED'
  | 'RESTORE_FAILED'
  | 'IMPORT_FAILED'
  | 'INTERNAL'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly userMessage: string
  readonly details?: unknown
  readonly field?: string

  constructor(code: AppErrorCode, userMessage: string, options?: { details?: unknown; field?: string; cause?: unknown }) {
    super(userMessage)
    this.name = 'AppError'
    this.code = code
    this.userMessage = userMessage
    this.details = options?.details
    this.field = options?.field
    if (options?.cause) (this as { cause?: unknown }).cause = options.cause
  }
}

export const ERRORS = {
  validation: (msg: string, field?: string) => new AppError('VALIDATION', msg, { field }),
  notFound: (what = 'السجل المطلوب') => new AppError('NOT_FOUND', `${what} غير موجود.`),
  conflict: (msg: string) => new AppError('CONFLICT', msg),
  permission: () => new AppError('PERMISSION_DENIED', 'ليس لديك صلاحية لتنفيذ هذه العملية.'),
  immutable: (msg = 'لا يمكن تعديل مستند مُرحَّل أو ملغى. استخدم الإلغاء أو قيد تسوية.') =>
    new AppError('IMMUTABLE_DOCUMENT', msg),
  insufficientStock: (productName: string, available: number, requested: number) =>
    new AppError(
      'INSUFFICIENT_STOCK',
      `الكمية المتاحة من «${productName}» هي ${available} فقط، والمطلوب ${requested}.`,
      { details: { productName, available, requested } }
    ),
  internal: (cause?: unknown) =>
    new AppError('INTERNAL', 'تعذّر إتمام العملية. يرجى المحاولة مرة أخرى، وإذا تكرر الخطأ راجع سجل الأخطاء.', {
      cause
    })
}

/** رسالة عامة آمنة لأي خطأ غير متوقع */
export const GENERIC_ERROR_MESSAGE =
  'تعذّر حفظ العملية. يرجى التحقق من البيانات والمحاولة مرة أخرى.'

export interface SerializedError {
  __appError: true
  code: AppErrorCode
  message: string
  field?: string
  details?: unknown
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof AppError) {
    return { __appError: true, code: err.code, message: err.userMessage, field: err.field, details: err.details }
  }
  return { __appError: true, code: 'INTERNAL', message: GENERIC_ERROR_MESSAGE }
}

export function isSerializedError(value: unknown): value is SerializedError {
  return typeof value === 'object' && value !== null && (value as SerializedError).__appError === true
}
