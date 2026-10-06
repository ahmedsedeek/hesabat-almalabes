import React, { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { invoke, errorMessage } from '../../lib/api'
import { useUi } from '../../store/ui'
import { Badge, Card, EmptyState, Select, Spinner, StatCard, Switch, cn } from '../../components/ui'

type ImportEntity = 'customers' | 'suppliers' | 'factories' | 'products' | 'opening_stock' | 'sales'

const ENTITY_LABEL: Record<ImportEntity, string> = {
  customers: 'العملاء',
  suppliers: 'الموردون',
  factories: 'المصانع',
  products: 'المنتجات',
  opening_stock: 'أرصدة المخزون الافتتاحية',
  sales: 'فواتير البيع (دفعة واحدة)'
}

const ENTITY_HINT: Partial<Record<ImportEntity, string>> = {
  sales:
    'كل سطر في الملف = صنف واحد. كرّر رقم الفاتورة في أسطر الفاتورة الواحدة ليجمعها النظام معًا. ' +
    'الشحن وتكلفة التوصيل والمبلغ المحصَّل تُكتب مرة واحدة لكل فاتورة. ' +
    'تُخصم الكميات من المخزون وتُحتسب التكلفة والقيود تمامًا كالإدخال اليدوي.'
}

interface PreviewRow {
  rowNumber: number
  values: Record<string, string>
  errors: string[]
  warnings: string[]
  valid: boolean
}

interface Preview {
  entity: ImportEntity
  columns: { key: string; label: string; required?: boolean }[]
  detectedHeaders: string[]
  mapping: Record<string, string>
  rows: PreviewRow[]
  validCount: number
  errorCount: number
}

/** استيراد البيانات من Excel أو CSV مع معاينة وتحقق قبل الحفظ */
export function ImportPanel({ compact }: { compact?: boolean } = {}): React.JSX.Element {
  const ui = useUi()
  const [entity, setEntity] = useState<ImportEntity>('customers')
  const [filePath, setFilePath] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [skipInvalid, setSkipInvalid] = useState(true)
  const [result, setResult] = useState<{ imported: number; skipped: number; failures: { rowNumber: number; message: string }[] } | null>(null)

  const pickFile = async (): Promise<void> => {
    const path = await invoke<string | null>('dialog:openFile', {
      title: 'اختر ملف البيانات',
      filters: [{ name: 'ملفات البيانات', extensions: ['xlsx', 'xls', 'csv'] }]
    })
    if (!path) return
    setFilePath(path)
    setResult(null)
    setLoading(true)
    try {
      const data = await invoke<Preview>('import:preview', { entity, filePath: path })
      setPreview(data)
    } catch (error) {
      ui.error('تعذّرت قراءة الملف', errorMessage(error))
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }

  const downloadTemplate = async (): Promise<void> => {
    const savePath = await invoke<string | null>('dialog:saveFile', {
      defaultName: `قالب ${ENTITY_LABEL[entity]}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (!savePath) return
    try {
      await invoke('import:template', { entity, savePath })
      ui.success('تم حفظ القالب', 'املأ البيانات في الملف ثم استورده.')
      await invoke('shell:showInFolder', { path: savePath })
    } catch (error) {
      ui.error('تعذّر إنشاء القالب', errorMessage(error))
    }
  }

  const runImport = async (): Promise<void> => {
    if (!preview) return
    setImporting(true)
    try {
      const outcome = await invoke<{ imported: number; skipped: number; failures: { rowNumber: number; message: string }[] }>('import:commit', {
        entity,
        rows: preview.rows,
        skipInvalid
      })
      setResult(outcome)
      setPreview(null)
      ui.success('اكتمل الاستيراد', `تم استيراد ${outcome.imported} سجل.`)
    } catch (error) {
      ui.error('تعذّر الاستيراد', errorMessage(error))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[12rem]">
          <span className="label">نوع البيانات</span>
          <Select
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value as ImportEntity)
              setPreview(null)
              setFilePath('')
              setResult(null)
            }}
          >
            {Object.entries(ENTITY_LABEL).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </label>
        <button type="button" className="btn-secondary" onClick={() => void downloadTemplate()}>
          <Download className="h-4 w-4" />
          تحميل قالب Excel
        </button>
        <button type="button" className="btn-primary" onClick={() => void pickFile()} disabled={loading}>
          {loading ? <Spinner className="h-4 w-4 text-white" /> : <Upload className="h-4 w-4" />}
          اختيار ملف
        </button>
      </div>

      {ENTITY_HINT[entity] && (
        <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-brand-900">
          {ENTITY_HINT[entity]}
        </p>
      )}

      {filePath && (
        <p className="truncate rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600" dir="ltr">{filePath}</p>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-emerald-800">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-bold">اكتمل الاستيراد</span>
          </div>
          <p className="mt-1 text-[13px] text-emerald-900">
            تم استيراد <span className="num font-bold">{result.imported}</span> سجل
            {result.skipped > 0 && <> وتخطّي <span className="num font-bold">{result.skipped}</span> سجل.</>}
          </p>
          {result.failures.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12.5px] text-rose-700">
              {result.failures.slice(0, 10).map((failure) => (
                <li key={failure.rowNumber}>الصف {failure.rowNumber}: {failure.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preview && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="إجمالي الصفوف" value={preview.rows.length} />
            <StatCard label="صفوف صالحة" value={preview.validCount} tone="positive" icon={<CheckCircle2 className="h-5 w-5" />} />
            <StatCard label="صفوف بها أخطاء" value={preview.errorCount} tone={preview.errorCount ? 'negative' : 'default'} icon={<AlertTriangle className="h-5 w-5" />} />
          </div>

          <div className="rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3">
              <h3 className="text-[13px] font-bold text-slate-700">معاينة البيانات قبل الاستيراد</h3>
              <div className="flex flex-wrap items-center gap-3">
                <Switch checked={skipInvalid} onChange={setSkipInvalid} label="تخطّي الصفوف غير الصالحة" />
                <button type="button" className="btn-primary btn-sm" onClick={() => void runImport()} disabled={importing || preview.validCount === 0}>
                  {importing ? <Spinner className="h-3.5 w-3.5 text-white" /> : <FileSpreadsheet className="h-4 w-4" />}
                  استيراد {preview.validCount} سجل
                </button>
              </div>
            </div>

            <div className={cn('overflow-auto', compact ? 'max-h-64' : 'max-h-[28rem]')}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>الصف</th>
                    <th style={{ width: '90px' }}>الحالة</th>
                    {preview.columns.map((column) => (
                      <th key={column.key}>{column.label}{column.required ? ' *' : ''}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 300).map((row) => (
                    <tr key={row.rowNumber} className={cn(!row.valid && 'bg-rose-50/60')}>
                      <td className="num text-center text-slate-400">{row.rowNumber}</td>
                      <td className="text-center">
                        {row.valid ? <Badge tone="green">صالح</Badge> : <Badge tone="red">خطأ</Badge>}
                      </td>
                      {preview.columns.map((column) => (
                        <td key={column.key} className="max-w-[12rem] truncate text-[12.5px]">{row.values[column.key] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.errorCount > 0 && (
              <div className="max-h-40 overflow-y-auto border-t border-slate-200 bg-rose-50 p-3">
                <p className="mb-1.5 text-[12.5px] font-bold text-rose-800">تفاصيل الأخطاء</p>
                <ul className="space-y-0.5 text-[12px] text-rose-700">
                  {preview.rows
                    .filter((row) => !row.valid)
                    .slice(0, 50)
                    .map((row) => (
                      <li key={row.rowNumber}>الصف {row.rowNumber}: {row.errors.join(' ')}</li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}

      {!preview && !result && !loading && (
        <EmptyState
          icon={<FileSpreadsheet className="h-7 w-7" />}
          title="لم يُختر ملف بعد"
          description="حمّل القالب الجاهز، املأ بياناتك، ثم اختر الملف لمعاينته والتحقق منه قبل الاستيراد."
        />
      )}
    </div>
  )
}
