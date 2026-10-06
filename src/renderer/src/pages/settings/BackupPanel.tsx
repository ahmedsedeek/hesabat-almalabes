import React, { useState } from 'react'
import { AlertTriangle, CloudUpload, DatabaseBackup, Eye, EyeOff, FolderOpen, HardDriveDownload, RotateCcw, ShieldCheck } from 'lucide-react'
import type { AppSettings } from '@shared/types'
import { invoke, errorMessage } from '../../lib/api'
import { useQuery } from '../../lib/hooks'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Field, Input, Modal, Select, Spinner, StatCard, Switch, cn, useConfirm } from '../../components/ui'
import { dateTime } from '../../lib/format'

function humanSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} ك.ب`
  return `${(bytes / (1024 * 1024)).toFixed(2)} م.ب`
}

export function BackupPanel({ settings, onSettingsChange }: { settings: AppSettings; onSettingsChange: () => void }): React.JSX.Element {
  const ui = useUi()
  const { confirm, dialog } = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [keyVisible, setKeyVisible] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)

  const files = useQuery<{ fileName: string; filePath: string; sizeBytes: number; modifiedAt: string; encrypted: boolean }[]>('backup:files')
  const records = useQuery<Record<string, unknown>[]>('backup:list')
  const recoveryKey = useQuery<{ key: string }>(keyVisible ? 'backup:recoveryKey' : null, undefined, [keyVisible])

  const update = async (patch: Partial<AppSettings['backup']>): Promise<void> => {
    try {
      await invoke('settings:update', { section: 'backup', value: patch })
      onSettingsChange()
    } catch (error) {
      ui.error('تعذّر حفظ الإعداد', errorMessage(error))
    }
  }

  const createBackup = async (): Promise<void> => {
    setBusy('create')
    try {
      const result = await invoke<{ fileName: string; filePath: string; sizeBytes: number }>('backup:create')
      ui.success('تم إنشاء نسخة احتياطية', `${result.fileName} — ${humanSize(result.sizeBytes)}`)
      files.reload()
      records.reload()
      onSettingsChange()
    } catch (error) {
      ui.error('تعذّر إنشاء النسخة', errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const uploadCloud = async (): Promise<void> => {
    setBusy('cloud')
    try {
      const result = await invoke<{ fileName: string }>('backup:upload')
      ui.success('تم الرفع إلى المجلد السحابي', result.fileName)
      records.reload()
      onSettingsChange()
    } catch (error) {
      ui.error('تعذّر الرفع', errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const backup = settings.backup

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="آخر نسخة محلية"
          value={backup.lastLocalBackupAt ? dateTime(backup.lastLocalBackupAt) : 'لا توجد'}
          icon={<DatabaseBackup className="h-5 w-5" />}
          tone={backup.lastLocalBackupAt ? 'positive' : 'warning'}
        />
        <StatCard
          label="آخر نسخة سحابية"
          value={backup.lastCloudBackupAt ? dateTime(backup.lastCloudBackupAt) : backup.cloudEnabled ? 'لا توجد' : 'غير مفعّل'}
          icon={<CloudUpload className="h-5 w-5" />}
          tone={backup.lastCloudBackupAt ? 'positive' : 'default'}
        />
        <StatCard label="عدد النسخ المحفوظة" value={files.data?.length ?? 0} />
      </div>

      <Card
        title="إجراءات سريعة"
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => void createBackup()} disabled={busy !== null}>
              {busy === 'create' ? <Spinner className="h-4 w-4 text-white" /> : <DatabaseBackup className="h-4 w-4" />}
              نسخة احتياطية الآن
            </button>
            {backup.cloudEnabled && (
              <button type="button" className="btn-secondary" onClick={() => void uploadCloud()} disabled={busy !== null}>
                {busy === 'cloud' ? <Spinner className="h-4 w-4" /> : <CloudUpload className="h-4 w-4" />}
                رفع إلى السحابة
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => setRestoreOpen(true)}>
              <RotateCcw className="h-4 w-4" />
              استعادة نسخة
            </button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-3">
            <Switch
              checked={backup.localEnabled}
              onChange={(value) => void update({ localEnabled: value })}
              label="النسخ الاحتياطي التلقائي"
              description="يأخذ النظام نسخة حسب الجدول المحدد عند تشغيل التطبيق."
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="التكرار">
                <Select value={backup.frequency} onChange={(e) => void update({ frequency: e.target.value as 'daily' })}>
                  <option value="daily">يوميًا</option>
                  <option value="weekly">أسبوعيًا</option>
                  <option value="manual">يدويًا فقط</option>
                </Select>
              </Field>
              <Field label="عدد النسخ المحفوظة" hint="تُحذف الأقدم تلقائيًا">
                <Input
                  type="number"
                  dir="ltr"
                  className="text-left"
                  min={1}
                  max={100}
                  value={backup.retentionCount}
                  onChange={(e) => void update({ retentionCount: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="مجلد الحفظ" className="mt-3">
              <div className="flex gap-2">
                <Input readOnly value={backup.localPath} placeholder="المجلد الافتراضي داخل بيانات التطبيق" />
                <button
                  type="button"
                  className="btn-secondary shrink-0"
                  onClick={async () => {
                    const folder = await invoke<string | null>('dialog:openFolder', { title: 'اختر مجلد النسخ الاحتياطية' })
                    if (folder) void update({ localPath: folder })
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </div>
            </Field>
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <Switch
              checked={backup.cloudEnabled}
              onChange={(value) => void update({ cloudEnabled: value, cloudProvider: value ? 'folder' : 'none' })}
              label="النسخ الاحتياطي السحابي"
              description="ينسخ النسخة المشفّرة إلى مجلد Google Drive أو OneDrive أو Dropbox المثبَّت على جهازك."
            />
            {backup.cloudEnabled && (
              <Field label="مجلد المزامنة" className="mt-3" hint="أي مجلد يزامنه برنامج التخزين السحابي لديك">
                <div className="flex gap-2">
                  <Input readOnly value={backup.cloudFolder} placeholder="اختر المجلد…" />
                  <button
                    type="button"
                    className="btn-secondary shrink-0"
                    onClick={async () => {
                      const folder = await invoke<string | null>('dialog:openFolder', { title: 'اختر مجلد المزامنة السحابية' })
                      if (folder) void update({ cloudFolder: folder })
                    }}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                </div>
              </Field>
            )}

            <div className="mt-3">
              <Switch
                checked={backup.encrypt}
                onChange={(value) => void update({ encrypt: value })}
                label="تشفير النسخ الاحتياطية"
                description="AES-256 — يمنع فتح النسخة أو العبث بها دون مفتاح الاستعادة."
              />
            </div>
          </div>
        </div>
      </Card>

      <Card
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-600" />
            مفتاح الاستعادة
          </span>
        }
        subtitle="احفظ هذا المفتاح في مكان آمن خارج الجهاز — بدونه لا يمكن فتح النسخ المشفّرة"
        actions={
          <button type="button" className="btn-secondary btn-sm" onClick={() => setKeyVisible(!keyVisible)}>
            {keyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {keyVisible ? 'إخفاء' : 'إظهار المفتاح'}
          </button>
        }
      >
        {keyVisible ? (
          recoveryKey.loading ? (
            <Spinner />
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <code className="block break-all text-[13px] font-bold text-amber-900" dir="ltr">{recoveryKey.data?.key}</code>
              <p className="mt-2 text-[12px] text-amber-800">انسخ هذا المفتاح واحفظه في مكان آمن. لن تتمكن من استعادة أي نسخة مشفّرة بدونه.</p>
            </div>
          )
        ) : (
          <p className="text-[13px] text-slate-500">المفتاح مخفي لحمايته. اضغط «إظهار المفتاح» لعرضه.</p>
        )}
      </Card>

      <Card title="ملفات النسخ الاحتياطية" noPadding>
        <DataTable
          rows={files.data ?? []}
          loading={files.loading}
          rowKey={(row) => row.filePath}
          empty={<EmptyState icon={<DatabaseBackup className="h-7 w-7" />} title="لا توجد نسخ احتياطية بعد" description="اضغط «نسخة احتياطية الآن» لإنشاء أول نسخة." />}
          columns={[
            { key: 'name', header: 'اسم الملف', render: (row) => <span className="num text-[12.5px] font-semibold text-slate-700" dir="ltr">{row.fileName}</span> },
            { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{dateTime(row.modifiedAt)}</span> },
            { key: 'size', header: 'الحجم', align: 'left', render: (row) => <span className="num">{humanSize(row.sizeBytes)}</span> },
            { key: 'enc', header: 'التشفير', align: 'center', render: (row) => (row.encrypted ? <Badge tone="green">مشفّرة</Badge> : <Badge tone="slate">مضغوطة</Badge>) },
            {
              key: 'actions',
              header: '',
              align: 'left',
              render: (row) => (
                <div className="flex justify-end gap-1">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => void invoke('shell:showInFolder', { path: row.filePath })}>
                    <FolderOpen className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={async () => {
                      const answer = await confirm({
                        title: 'استعادة هذه النسخة',
                        message: `سيُستبدل محتوى قاعدة البيانات الحالية بمحتوى «${row.fileName}». سيأخذ النظام نسخة أمان من البيانات الحالية أولًا، وسيُطلب منك إعادة تشغيل التطبيق.`,
                        confirmLabel: 'استعادة',
                        requireReason: true
                      })
                      if (answer === null) return
                      setBusy('restore')
                      try {
                        await invoke('backup:restore', { filePath: row.filePath })
                        ui.success('تمت الاستعادة', 'أغلق التطبيق وافتحه مجددًا لتحميل البيانات المستعادة.')
                      } catch (error) {
                        ui.error('تعذّرت الاستعادة', errorMessage(error))
                      } finally {
                        setBusy(null)
                      }
                    }}
                    disabled={busy !== null}
                  >
                    <HardDriveDownload className="h-4 w-4" />
                    استعادة
                  </button>
                </div>
              )
            }
          ]}
        />
      </Card>

      <Card title="سجل عمليات النسخ" noPadding>
        <DataTable
          rows={(records.data ?? []).slice(0, 20)}
          loading={records.loading}
          rowKey={(row) => String(row.id)}
          empty={<EmptyState title="لا يوجد سجل بعد" />}
          compact
          columns={[
            { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{dateTime(String(row.created_at))}</span> },
            {
              key: 'type',
              header: 'النوع',
              align: 'center',
              render: (row) => (
                <Badge tone="slate">
                  {({ manual: 'يدوية', scheduled: 'مجدولة', pre_migration: 'قبل ترقية', pre_restore: 'قبل استعادة' } as Record<string, string>)[String(row.backup_type)]}
                </Badge>
              )
            },
            { key: 'dest', header: 'الوجهة', align: 'center', render: (row) => (row.destination === 'cloud' ? <Badge tone="blue">سحابي</Badge> : <Badge tone="slate">محلي</Badge>) },
            { key: 'size', header: 'الحجم', align: 'left', render: (row) => <span className="num">{humanSize(Number(row.size_bytes))}</span> },
            {
              key: 'status',
              header: 'الحالة',
              align: 'center',
              render: (row) =>
                row.status === 'success' ? <Badge tone="green">نجحت</Badge> : row.status === 'failed' ? <Badge tone="red">فشلت</Badge> : <Badge tone="amber">جارية</Badge>
            },
            { key: 'error', header: 'ملاحظات', render: (row) => <span className="text-[12px] text-rose-600">{String(row.error_message ?? '')}</span> }
          ]}
        />
      </Card>

      <RestoreExternalModal open={restoreOpen} onClose={() => setRestoreOpen(false)} />
      {dialog}
    </div>
  )
}

function RestoreExternalModal({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const ui = useUi()
  const [filePath, setFilePath] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [verification, setVerification] = useState<{ ok: boolean; schemaVersion: number; problems: string[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    const path = await invoke<string | null>('dialog:openFile', {
      title: 'اختر ملف النسخة الاحتياطية',
      filters: [{ name: 'نسخ احتياطية', extensions: ['hmbak', 'gz', 'db'] }]
    })
    if (!path) return
    setFilePath(path)
    setVerification(null)
  }

  const verify = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await invoke<{ ok: boolean; schemaVersion: number; problems: string[] }>('backup:verify', { filePath, passphrase: passphrase || undefined })
      setVerification(result)
      if (result.ok) ui.success('الملف سليم وجاهز للاستعادة')
      else ui.error('الملف غير سليم', result.problems[0])
    } catch (error) {
      ui.error('تعذّر التحقق من الملف', errorMessage(error))
      setVerification(null)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('backup:restore', { filePath, passphrase: passphrase || undefined })
      ui.success('تمت الاستعادة', 'أغلق التطبيق وافتحه مجددًا لتحميل البيانات المستعادة.')
      onClose()
    } catch (error) {
      ui.error('تعذّرت الاستعادة', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="استعادة نسخة احتياطية من ملف"
      description="اختر ملف نسخة احتياطية من أي مكان (مثل مجلد المزامنة السحابية)"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>إلغاء</button>
          <button type="button" className="btn-secondary" onClick={() => void verify()} disabled={!filePath || busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            التحقق من الملف
          </button>
          <button type="button" className="btn-danger" onClick={() => void restore()} disabled={!verification?.ok || busy}>
            <RotateCcw className="h-4 w-4" />
            استعادة الآن
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
          <AlertTriangle className="ml-1 inline h-4 w-4" />
          الاستعادة تستبدل كل البيانات الحالية. سيأخذ النظام نسخة أمان تلقائية قبل التنفيذ.
        </div>

        <Field label="ملف النسخة الاحتياطية" required>
          <div className="flex gap-2">
            <Input readOnly value={filePath} placeholder="لم يُختر ملف" dir="ltr" className="text-right" />
            <button type="button" className="btn-secondary shrink-0" onClick={() => void pick()}>
              <FolderOpen className="h-4 w-4" />
              اختيار
            </button>
          </div>
        </Field>

        <Field label="مفتاح الاستعادة" hint="اتركه فارغًا لاستخدام مفتاح هذا الجهاز — املأه إذا كانت النسخة من جهاز آخر">
          <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} dir="ltr" className="text-right" />
        </Field>

        {verification && (
          <div className={cn('rounded-lg border px-3 py-2.5 text-[13px]', verification.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800')}>
            {verification.ok ? (
              <>الملف سليم — إصدار المخطط <span className="num font-bold">{verification.schemaVersion}</span>. يمكنك الاستعادة الآن.</>
            ) : (
              <>الملف غير صالح: {verification.problems.join(' — ')}</>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
