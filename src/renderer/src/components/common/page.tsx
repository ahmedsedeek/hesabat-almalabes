import React, { useState, type ReactNode } from 'react'
import { Calendar, Download, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { invoke } from '../../lib/api'
import { useUi } from '../../store/ui'
import { cn, Input, Select, Spinner } from '../ui'
import { isoDate, monthStart, today } from '../../lib/format'

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  breadcrumb?: ReactNode
}): React.JSX.Element {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        {breadcrumb && <div className="mb-1 text-[13px] text-slate-500">{breadcrumb}</div>}
        <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13.5px] text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export interface DateRange {
  from: string
  to: string
}

const PRESETS: { key: string; label: string; resolve: () => DateRange }[] = [
  { key: 'today', label: 'اليوم', resolve: () => ({ from: today(), to: today() }) },
  {
    key: 'yesterday',
    label: 'أمس',
    resolve: () => {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      const iso = isoDate(d)
      return { from: iso, to: iso }
    }
  },
  {
    key: 'this_week',
    label: 'هذا الأسبوع',
    resolve: () => {
      const d = new Date()
      const diff = (d.getDay() + 1) % 7
      const start = new Date(d)
      start.setDate(d.getDate() - diff)
      return { from: isoDate(start), to: today() }
    }
  },
  { key: 'this_month', label: 'هذا الشهر', resolve: () => ({ from: monthStart(), to: today() }) },
  {
    key: 'last_month',
    label: 'الشهر الماضي',
    resolve: () => {
      const d = new Date()
      const start = new Date(d.getFullYear(), d.getMonth() - 1, 1)
      const end = new Date(d.getFullYear(), d.getMonth(), 0)
      return { from: isoDate(start), to: isoDate(end) }
    }
  },
  { key: 'this_year', label: 'هذه السنة', resolve: () => ({ from: `${new Date().getFullYear()}-01-01`, to: today() }) }
]

export function DateRangePicker({
  value,
  onChange,
  className
}: {
  value: DateRange
  onChange: (range: DateRange) => void
  className?: string
}): React.JSX.Element {
  const [preset, setPreset] = useState('this_month')

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Select
        className="h-9 w-36"
        value={preset}
        onChange={(e) => {
          const key = e.target.value
          setPreset(key)
          const found = PRESETS.find((p) => p.key === key)
          if (found) onChange(found.resolve())
        }}
      >
        {PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">فترة مخصصة</option>
      </Select>
      <div className="flex items-center gap-1.5">
        <Calendar className="h-4 w-4 text-slate-400" />
        <Input
          type="date"
          className="h-9 w-36"
          value={value.from}
          onChange={(e) => {
            setPreset('custom')
            onChange({ ...value, from: e.target.value })
          }}
        />
        <span className="text-slate-400">—</span>
        <Input
          type="date"
          className="h-9 w-36"
          value={value.to}
          onChange={(e) => {
            setPreset('custom')
            onChange({ ...value, to: e.target.value })
          }}
        />
      </div>
    </div>
  )
}

export interface ExportColumn {
  key: string
  label: string
  type?: 'text' | 'money' | 'number' | 'qty' | 'date'
  width?: number
}

/** أزرار التصدير والطباعة الموحّدة لكل التقارير والقوائم */
export function ExportButtons({
  title,
  subtitle,
  meta,
  cards,
  columns,
  rows,
  totals,
  disabled
}: {
  title: string
  subtitle?: string
  meta?: { label: string; value: string }[]
  cards?: { label: string; value: string; tone?: 'pos' | 'neg' }[]
  columns: ExportColumn[]
  rows: Record<string, unknown>[]
  totals?: Record<string, unknown>
  disabled?: boolean
}): React.JSX.Element {
  const ui = useUi()
  const [busy, setBusy] = useState<string | null>(null)

  const table = { title, subtitle, meta, columns, rows, totals }

  const run = async (kind: 'excel' | 'csv' | 'pdf' | 'print'): Promise<void> => {
    setBusy(kind)
    try {
      if (kind === 'print') {
        await invoke('print:send', { docType: 'report', params: { title, subtitle, meta, cards, columns, rows, totals } })
      } else if (kind === 'pdf') {
        const savePath = await invoke<string | null>('dialog:saveFile', {
          defaultName: `${title}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })
        if (!savePath) return
        const result = await invoke<{ path: string }>('print:pdf', {
          docType: 'report',
          params: { title, subtitle, meta, cards, columns, rows, totals },
          savePath
        })
        ui.success('تم حفظ الملف', result.path)
        await invoke('shell:showInFolder', { path: result.path })
      } else {
        const ext = kind === 'excel' ? 'xlsx' : 'csv'
        const savePath = await invoke<string | null>('dialog:saveFile', {
          defaultName: `${title}.${ext}`,
          filters: [{ name: kind === 'excel' ? 'Excel' : 'CSV', extensions: [ext] }]
        })
        if (!savePath) return
        const result = await invoke<{ path: string }>(kind === 'excel' ? 'export:excel' : 'export:csv', { table, savePath })
        ui.success('تم تصدير الملف', result.path)
        await invoke('shell:showInFolder', { path: result.path })
      }
    } catch (error) {
      ui.error('تعذّر إتمام العملية', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className="btn-secondary btn-sm" disabled={disabled || busy !== null} onClick={() => void run('print')}>
        {busy === 'print' ? <Spinner className="h-3.5 w-3.5" /> : <Printer className="h-4 w-4" />}
        طباعة
      </button>
      <button type="button" className="btn-secondary btn-sm" disabled={disabled || busy !== null} onClick={() => void run('pdf')}>
        {busy === 'pdf' ? <Spinner className="h-3.5 w-3.5" /> : <FileText className="h-4 w-4" />}
        PDF
      </button>
      <button type="button" className="btn-secondary btn-sm" disabled={disabled || busy !== null} onClick={() => void run('excel')}>
        {busy === 'excel' ? <Spinner className="h-3.5 w-3.5" /> : <FileSpreadsheet className="h-4 w-4" />}
        Excel
      </button>
      <button type="button" className="btn-secondary btn-sm" disabled={disabled || busy !== null} onClick={() => void run('csv')}>
        {busy === 'csv' ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-4 w-4" />}
        CSV
      </button>
    </div>
  )
}

/** طباعة أو تصدير مستند محدد (فاتورة، سند، كشف حساب، أمر إنتاج) */
export function DocumentActions({
  docType,
  id,
  params,
  fileName,
  compact
}: {
  docType: 'sale' | 'purchase' | 'payment' | 'production_order' | 'statement'
  id?: number
  params?: Record<string, unknown>
  fileName: string
  compact?: boolean
}): React.JSX.Element {
  const ui = useUi()
  const [busy, setBusy] = useState<string | null>(null)

  const print = async (): Promise<void> => {
    setBusy('print')
    try {
      await invoke('print:send', { docType, id, params })
    } catch (error) {
      ui.error('تعذّرت الطباعة', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const pdf = async (): Promise<void> => {
    setBusy('pdf')
    try {
      const savePath = await invoke<string | null>('dialog:saveFile', {
        defaultName: `${fileName}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (!savePath) return
      const result = await invoke<{ path: string }>('print:pdf', { docType, id, params, savePath })
      ui.success('تم حفظ ملف PDF', 'يمكنك إرساله للعميل عبر واتساب أو البريد.')
      await invoke('shell:showInFolder', { path: result.path })
    } catch (error) {
      ui.error('تعذّر إنشاء ملف PDF', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={cn('btn-secondary', compact && 'btn-sm')} onClick={() => void print()} disabled={busy !== null}>
        {busy === 'print' ? <Spinner className="h-4 w-4" /> : <Printer className="h-4 w-4" />}
        طباعة
      </button>
      <button type="button" className={cn('btn-secondary', compact && 'btn-sm')} onClick={() => void pdf()} disabled={busy !== null}>
        {busy === 'pdf' ? <Spinner className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        حفظ PDF
      </button>
    </div>
  )
}
