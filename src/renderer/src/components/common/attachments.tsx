import React, { useState } from 'react'
import { FileText, Paperclip, Trash2, Upload } from 'lucide-react'
import { invoke, errorMessage } from '../../lib/api'
import { useQuery } from '../../lib/hooks'
import { useUi } from '../../store/ui'
import { Card, Spinner, useConfirm } from '../ui'
import { dateTime } from '../../lib/format'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`
}

/** لوحة المرفقات — تُستخدم في الفواتير والمصروفات وأوامر الإنتاج */
export function AttachmentsPanel({
  refType,
  refId,
  title = 'المرفقات'
}: {
  refType: string
  refId: number
  title?: string
}): React.JSX.Element {
  const ui = useUi()
  const { confirm, dialog } = useConfirm()
  const [uploading, setUploading] = useState(false)
  const { data, loading, reload } = useQuery<Record<string, unknown>[]>('attachments:list', { refType, refId }, [refType, refId])

  const add = async (): Promise<void> => {
    const filePath = await invoke<string | null>('dialog:openFile', {
      title: 'اختر ملفًا لإرفاقه',
      filters: [{ name: 'المستندات والصور', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'xlsx', 'xls', 'csv', 'docx', 'txt'] }]
    })
    if (!filePath) return
    setUploading(true)
    try {
      await invoke('attachments:add', { refType, refId, filePath })
      ui.success('تمت إضافة المرفق')
      reload()
    } catch (error) {
      ui.error('تعذّرت إضافة المرفق', errorMessage(error))
    } finally {
      setUploading(false)
    }
  }

  const remove = async (id: number, name: string): Promise<void> => {
    const answer = await confirm({ title: 'حذف المرفق', message: `سيُحذف الملف «${name}» نهائيًا.`, confirmLabel: 'حذف' })
    if (answer === null) return
    try {
      await invoke('attachments:remove', { id })
      reload()
    } catch (error) {
      ui.error('تعذّر الحذف', errorMessage(error))
    }
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-slate-400" />
          {title}
        </span>
      }
      actions={
        <button type="button" className="btn-secondary btn-sm" onClick={() => void add()} disabled={uploading}>
          {uploading ? <Spinner className="h-3.5 w-3.5" /> : <Upload className="h-4 w-4" />}
          إرفاق ملف
        </button>
      }
    >
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : !data?.length ? (
        <p className="py-4 text-center text-[13px] text-slate-500">لا توجد مرفقات. يمكنك إرفاق صورة الفاتورة الأصلية أو إيصال التحويل.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((file) => (
            <li key={String(file.id)} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
              <button
                type="button"
                className="min-w-0 flex-1 text-right"
                onClick={() => void invoke('shell:openPath', { path: String(file.full_path) })}
              >
                <span className="block truncate text-[13px] font-semibold text-brand-700 hover:underline">{String(file.file_name)}</span>
                <span className="block text-[11.5px] text-slate-500">
                  {humanSize(Number(file.size_bytes))} · {dateTime(String(file.created_at))} · {String(file.uploaded_by_name ?? '')}
                </span>
              </button>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                onClick={() => void remove(Number(file.id), String(file.file_name))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </Card>
  )
}
