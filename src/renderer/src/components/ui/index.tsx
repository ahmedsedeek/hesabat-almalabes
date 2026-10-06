import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle, Check, ChevronDown, Inbox, Loader2, Search, X, Info, XCircle, CheckCircle2
} from 'lucide-react'
import { useUi } from '../../store/ui'
import { useEscapeKey } from '../../lib/hooks'
import { money, parseUserNumber, toMinor, fromMinor, toRate, fromRate } from '../../lib/format'

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

// ------------------------------- أساسيات -------------------------------

export function Spinner({ className = 'h-5 w-5' }: { className?: string }): React.JSX.Element {
  return <Loader2 className={cn('animate-spin text-brand-600', className)} />
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  noPadding
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  noPadding?: boolean
}): React.JSX.Element {
  return (
    <section className={cn('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            {title && <h2 className="text-[15px] font-bold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(noPadding ? '' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function Badge({
  tone = 'slate',
  children
}: {
  tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'violet'
  children: ReactNode
}): React.JSX.Element {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-rose-100 text-rose-800',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-brand-100 text-brand-800',
    violet: 'bg-violet-100 text-violet-800'
  }
  return <span className={cn('badge', tones[tone])}>{children}</span>
}

export function EmptyState({
  title,
  description,
  action,
  icon
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="rounded-full bg-slate-100 p-4 text-slate-400">{icon ?? <Inbox className="h-7 w-7" />}</div>
      <div>
        <p className="font-bold text-slate-700">{title}</p>
        {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="rounded-full bg-rose-100 p-4 text-rose-500">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <p className="max-w-md text-sm font-semibold text-slate-700">{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary btn-sm" onClick={onRetry}>
          إعادة المحاولة
        </button>
      )}
    </div>
  )
}

// ------------------------------- الحقول -------------------------------

export function Field({
  label,
  error,
  hint,
  required,
  children,
  className
}: {
  label?: string
  error?: string | null
  hint?: string
  required?: boolean
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="mr-1 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-[12px] font-semibold text-rose-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return <input ref={ref} className={cn('input', invalid && 'input-error', className)} {...props} />
  }
)

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  const { className, ...rest } = props
  return <textarea className={cn('input h-auto py-2', className)} rows={3} {...rest} />
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <div className="relative">
      <select className={cn('input appearance-none pl-9', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  )
}

/** حقل مبلغ — يخزّن القيمة بالوحدة الصغرى ويعرضها بالعملة */
export function MoneyInput({
  value,
  onChange,
  disabled,
  invalid,
  placeholder,
  autoFocus
}: {
  value: number
  onChange: (minor: number) => void
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  autoFocus?: boolean
}): React.JSX.Element {
  const [text, setText] = useState(() => (value ? String(fromMinor(value)) : ''))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(value ? String(fromMinor(value)) : '')
  }, [value])

  return (
    <Input
      type="text"
      inputMode="decimal"
      dir="ltr"
      className="text-left"
      autoFocus={autoFocus}
      placeholder={placeholder ?? '0.00'}
      value={text}
      disabled={disabled}
      invalid={invalid}
      onFocus={(e) => {
        focused.current = true
        e.target.select()
      }}
      onBlur={() => {
        focused.current = false
        setText(value ? String(fromMinor(value)) : '')
      }}
      onChange={(e) => {
        setText(e.target.value)
        onChange(toMinor(parseUserNumber(e.target.value)))
      }}
    />
  )
}

/** حقل سعر أو تكلفة وحدة — دقة أربع خانات عشرية */
export function RateInput({
  value,
  onChange,
  disabled,
  invalid
}: {
  value: number
  onChange: (rate: number) => void
  disabled?: boolean
  invalid?: boolean
}): React.JSX.Element {
  const [text, setText] = useState(() => (value ? String(fromRate(value)) : ''))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value ? String(fromRate(value)) : '')
  }, [value])
  return (
    <Input
      type="text"
      inputMode="decimal"
      dir="ltr"
      className="text-left"
      placeholder="0.00"
      value={text}
      disabled={disabled}
      invalid={invalid}
      onFocus={(e) => {
        focused.current = true
        e.target.select()
      }}
      onBlur={() => {
        focused.current = false
        setText(value ? String(fromRate(value)) : '')
      }}
      onChange={(e) => {
        setText(e.target.value)
        onChange(toRate(parseUserNumber(e.target.value)))
      }}
    />
  )
}

export function QtyInput({
  value,
  onChange,
  disabled,
  invalid,
  max
}: {
  value: number
  onChange: (qty: number) => void
  disabled?: boolean
  invalid?: boolean
  max?: number
}): React.JSX.Element {
  const [text, setText] = useState(() => (value ? String(value) : ''))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value ? String(value) : '')
  }, [value])
  return (
    <Input
      type="text"
      inputMode="decimal"
      dir="ltr"
      className="text-left"
      placeholder="0"
      value={text}
      disabled={disabled}
      invalid={invalid}
      onFocus={(e) => {
        focused.current = true
        e.target.select()
      }}
      onBlur={() => {
        focused.current = false
        setText(value ? String(value) : '')
      }}
      onChange={(e) => {
        setText(e.target.value)
        const parsed = parseUserNumber(e.target.value)
        onChange(max !== undefined ? Math.min(parsed, max) : parsed)
      }}
    />
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'بحث…',
  className,
  autoFocus
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}): React.JSX.Element {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        className="pr-9"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100"
          onClick={() => onChange('')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors',
          checked ? 'bg-brand-600' : 'bg-slate-300'
        )}
      >
        <span
          className={cn(
            'block h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? '-translate-x-5' : 'translate-x-0'
          )}
        />
      </button>
      <span>
        <span className="block text-sm font-semibold text-slate-700">{label}</span>
        {description && <span className="mt-0.5 block text-[12.5px] text-slate-500">{description}</span>}
      </span>
    </label>
  )
}

// ------------------------------- النوافذ -------------------------------

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md'
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
}): React.JSX.Element | null {
  useEscapeKey(onClose, open)
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null
  const sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl', full: 'max-w-[95vw]' }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-[2px]">
      <div
        className={cn('my-6 w-full rounded-2xl bg-white shadow-2xl', sizes[size])}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'تأكيد',
  tone = 'danger',
  requireReason,
  reasonLabel = 'سبب الإجراء',
  loading
}: {
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => void | Promise<void>
  title: string
  message: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  requireReason?: boolean
  reasonLabel?: string
  loading?: boolean
}): React.JSX.Element {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (open) {
      setReason('')
      setTouched(false)
    }
  }, [open])

  const invalid = Boolean(requireReason) && reason.trim().length < 3

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            إلغاء
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            disabled={loading}
            onClick={() => {
              setTouched(true)
              if (invalid) return
              void onConfirm(reason.trim())
            }}
          >
            {loading && <Spinner className="h-4 w-4 text-white" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">{message}</p>
      {requireReason && (
        <Field className="mt-4" label={reasonLabel} required error={touched && invalid ? 'يجب كتابة سبب واضح (٣ أحرف على الأقل).' : null}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اكتب السبب الذي سيُحفظ في سجل المراجعة…" />
        </Field>
      )}
    </Modal>
  )
}

// ------------------------------- التبويبات -------------------------------

export function Tabs({
  tabs,
  active,
  onChange
}: {
  tabs: { key: string; label: string; count?: number; icon?: ReactNode }[]
  active: string
  onChange: (key: string) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            'relative -mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors',
            active === tab.key
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
          )}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn('rounded-full px-1.5 py-0.5 text-[11px]', active === tab.key ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600')}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ------------------------------- الجداول -------------------------------

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T, index: number) => ReactNode
  align?: 'right' | 'left' | 'center'
  width?: string
  className?: string
  footer?: ReactNode
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  error,
  empty,
  onRowClick,
  rowKey,
  footer,
  compact,
  onRetry
}: {
  columns: Column<T>[]
  rows: T[]
  loading?: boolean
  error?: string | null
  empty?: ReactNode
  onRowClick?: (row: T) => void
  rowKey: (row: T, index: number) => string | number
  footer?: boolean
  compact?: boolean
  onRetry?: () => void
}): React.JSX.Element {
  if (error) return <ErrorState message={error} onRetry={onRetry} />
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }
  if (!rows.length) return <>{empty ?? <EmptyState title="لا توجد بيانات لعرضها" />}</>

  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  column.align === 'left' && 'text-left',
                  column.align === 'center' && 'text-center'
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(onRowClick && 'cursor-pointer')}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    compact && 'py-1.5',
                    column.align === 'left' && 'text-left',
                    column.align === 'center' && 'text-center',
                    column.className
                  )}
                >
                  {column.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="bg-slate-50 font-bold">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'border-t-2 border-slate-200 px-3 py-2.5',
                    column.align === 'left' && 'text-left',
                    column.align === 'center' && 'text-center'
                  )}
                >
                  {column.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange
}: {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}): React.JSX.Element | null {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-sm text-slate-600">
      <span>
        عرض <span className="num font-semibold">{from}</span> – <span className="num font-semibold">{to}</span> من{' '}
        <span className="num font-semibold">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          السابق
        </button>
        <span className="px-3 text-[13px]">
          صفحة <span className="num font-semibold">{page}</span> من <span className="num font-semibold">{pages}</span>
        </span>
        <button type="button" className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          التالي
        </button>
      </div>
    </div>
  )
}

// ------------------------------- التنبيهات -------------------------------

export function ToastHost(): React.JSX.Element {
  const { toasts, dismiss } = useUi()
  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
    error: <XCircle className="h-5 w-5 text-rose-600" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-600" />,
    info: <Info className="h-5 w-5 text-brand-600" />
  }
  const borders = {
    success: 'border-r-emerald-500',
    error: 'border-r-rose-500',
    warning: 'border-r-amber-500',
    info: 'border-r-brand-500'
  }

  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-[60] flex w-[min(24rem,90vw)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn('pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 border-r-4 bg-white p-3.5 shadow-lg', borders[toast.type])}
        >
          {icons[toast.type]}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-800">{toast.title}</p>
            {toast.description && <p className="mt-0.5 break-words text-[13px] leading-relaxed text-slate-600">{toast.description}</p>}
          </div>
          <button type="button" onClick={() => dismiss(toast.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ------------------------------- بطاقات المؤشرات -------------------------------

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  onClick
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'positive' | 'negative' | 'warning' | 'brand'
  onClick?: () => void
}): React.JSX.Element {
  const tones = {
    default: 'text-slate-800',
    positive: 'text-emerald-700',
    negative: 'text-rose-700',
    warning: 'text-amber-700',
    brand: 'text-brand-700'
  }
  const iconTones = {
    default: 'bg-slate-100 text-slate-500',
    positive: 'bg-emerald-50 text-emerald-600',
    negative: 'bg-rose-50 text-rose-600',
    warning: 'bg-amber-50 text-amber-600',
    brand: 'bg-brand-50 text-brand-600'
  }

  return (
    <div
      onClick={onClick}
      className={cn('card flex items-center gap-3 p-4', onClick && 'cursor-pointer transition-shadow hover:shadow-md')}
    >
      {icon && <div className={cn('rounded-xl p-2.5', iconTones[tone])}>{icon}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-slate-500">{label}</p>
        <p className={cn('num mt-0.5 truncate text-[19px] font-bold', tones[tone])}>{value}</p>
        {hint && <p className="mt-0.5 truncate text-[12px] text-slate-500">{hint}</p>}
      </div>
    </div>
  )
}

/** شريط صغير يوضح نسبة قيمة من إجمالي — يُستخدم في التقارير */
export function MiniBar({ value, max, tone = 'brand' }: { value: number; max: number; tone?: 'brand' | 'rose' | 'emerald' }): React.JSX.Element {
  const percent = max > 0 ? Math.min(100, Math.round((Math.abs(value) / max) * 100)) : 0
  const colors = { brand: 'bg-brand-500', rose: 'bg-rose-500', emerald: 'bg-emerald-500' }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn('h-full rounded-full', colors[tone])} style={{ width: `${percent}%` }} />
    </div>
  )
}

export function MoneyText({ value, colored }: { value: number; colored?: boolean }): React.JSX.Element {
  return (
    <span className={cn('num', colored && (value > 0 ? 'text-emerald-700' : value < 0 ? 'text-rose-700' : ''))}>
      {money(value)}
    </span>
  )
}

export function useConfirm(): {
  confirm: (options: { title: string; message: string; confirmLabel?: string; requireReason?: boolean; tone?: 'danger' | 'primary' }) => Promise<string | null>
  dialog: React.JSX.Element
} {
  const [state, setState] = useState<{
    open: boolean
    title: string
    message: string
    confirmLabel?: string
    requireReason?: boolean
    tone?: 'danger' | 'primary'
    resolve?: (value: string | null) => void
  }>({ open: false, title: '', message: '' })

  const confirm = useMemo(
    () =>
      (options: { title: string; message: string; confirmLabel?: string; requireReason?: boolean; tone?: 'danger' | 'primary' }) =>
        new Promise<string | null>((resolve) => {
          setState({ ...options, open: true, resolve })
        }),
    []
  )

  const dialog = (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      requireReason={state.requireReason}
      tone={state.tone}
      onClose={() => {
        state.resolve?.(null)
        setState((s) => ({ ...s, open: false }))
      }}
      onConfirm={(reason) => {
        state.resolve?.(reason)
        setState((s) => ({ ...s, open: false }))
      }}
    />
  )

  return { confirm, dialog }
}

export { Check }
