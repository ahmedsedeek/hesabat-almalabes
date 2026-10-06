import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Factory, Plus, Trash2, Wrench } from 'lucide-react'
import { PERMISSIONS } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useDebounced, useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Field, Input, Modal, QtyInput, SearchInput, Select, Spinner, StatCard, Textarea, cn } from '../../components/ui'
import { DateRangePicker, ExportButtons, PageHeader } from '../../components/common/page'
import { PartyPicker, ProductSearch, variantLabel, type VariantOption } from '../../components/common/pickers'
import { date, money, qty, today, yearStart } from '../../lib/format'

export const STATUS_TONE: Record<string, 'slate' | 'blue' | 'amber' | 'green' | 'violet' | 'red'> = {
  draft: 'slate',
  sent: 'blue',
  in_production: 'violet',
  partial: 'amber',
  completed: 'green',
  cancelled: 'red'
}

export function ProductionListPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { can } = useSession()
  const [range, setRange] = useState({ from: yearStart(), to: today() })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const debounced = useDebounced(search, 300)

  const orders = useQuery<{ rows: Record<string, unknown>[]; total: number }>(
    'production:list',
    { from: range.from, to: range.to, search: debounced || undefined, status: status || undefined, pageSize: 200 },
    [range.from, range.to, debounced, status]
  )
  const wip = useQuery<{ factoryId: number; factoryName: string; wipValue: number; openOrders: number }[]>('production:factoriesWip')

  const rows = orders.data?.rows ?? []
  const open = rows.filter((r) => r.status !== 'completed' && r.status !== 'cancelled').length
  const totalCost = rows.reduce((s, r) => s + Number(r.total_cost), 0)
  const producedQty = rows.reduce((s, r) => s + Number(r.produced_qty), 0)

  return (
    <div>
      <PageHeader
        title="التصنيع"
        subtitle="أوامر الإنتاج لدى المصانع ومتابعة الخامات والتكاليف"
        actions={
          <>
            <ExportButtons
              title="تقرير أوامر الإنتاج"
              subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
              columns={[
                { key: 'order_number', label: 'رقم الأمر' },
                { key: 'date', label: 'التاريخ', type: 'date' },
                { key: 'factory_name', label: 'المصنع' },
                { key: 'product_name', label: 'المنتج' },
                { key: 'expected_qty', label: 'المتوقع', type: 'qty' },
                { key: 'produced_qty', label: 'المنتج', type: 'qty' },
                { key: 'materials_cost', label: 'تكلفة الخامات', type: 'money' },
                { key: 'factory_cost', label: 'أجر التصنيع', type: 'money' },
                { key: 'total_cost', label: 'إجمالي التكلفة', type: 'money' }
              ]}
              rows={rows}
              totals={{ total_cost: totalCost }}
              disabled={!rows.length}
            />
            {can(PERMISSIONS.PRODUCTION_MANAGE) && (
              <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                أمر إنتاج جديد
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="أوامر مفتوحة" value={open} icon={<Wrench className="h-5 w-5" />} tone={open ? 'warning' : 'default'} />
        <StatCard label="إجمالي الكميات المنتجة" value={qty(producedQty)} />
        <StatCard label="إجمالي تكاليف الإنتاج" value={money(totalCost)} tone="brand" />
        <StatCard
          label="قيمة الخامات لدى المصانع"
          value={money((wip.data ?? []).reduce((s, f) => s + f.wipValue, 0))}
          icon={<Factory className="h-5 w-5" />}
          tone="warning"
        />
      </div>

      {(wip.data?.length ?? 0) > 0 && (
        <Card title="أرصدة المصانع" className="mb-4" noPadding>
          <DataTable
            rows={wip.data ?? []}
            rowKey={(row) => String(row.factoryId)}
            compact
            onRowClick={(row) => navigate(`/factories/${row.factoryId}`)}
            columns={[
              { key: 'name', header: 'المصنع', render: (row) => <span className="font-semibold text-slate-800">{row.factoryName}</span> },
              { key: 'orders', header: 'أوامر مفتوحة', align: 'center', render: (row) => <span className="num">{row.openOrders}</span> },
              { key: 'wip', header: 'قيمة ما لديه من خامات وتكاليف', align: 'left', render: (row) => <span className="num font-semibold text-violet-700">{money(row.wipValue)}</span> }
            ]}
          />
        </Card>
      )}

      <Card noPadding>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <DateRangePicker value={range} onChange={setRange} />
          <SearchInput className="w-full max-w-xs" value={search} onChange={setSearch} placeholder="رقم الأمر أو المصنع أو المنتج…" />
          <Select className="h-10 w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="sent">أُرسل للمصنع</option>
            <option value="in_production">قيد التنفيذ</option>
            <option value="partial">مكتمل جزئيًا</option>
            <option value="completed">مكتمل</option>
            <option value="cancelled">ملغى</option>
          </Select>
        </div>

        <DataTable
          rows={rows}
          loading={orders.loading}
          error={orders.error}
          onRetry={orders.reload}
          rowKey={(row) => String(row.id)}
          onRowClick={(row) => navigate(`/production/${row.id}`)}
          empty={
            <EmptyState
              icon={<Wrench className="h-7 w-7" />}
              title="لا توجد أوامر إنتاج"
              description="أنشئ أمر إنتاج لإرسال الخامات إلى المصنع ومتابعة التكلفة حتى استلام المنتج النهائي."
              action={
                can(PERMISSIONS.PRODUCTION_MANAGE) ? (
                  <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" />
                    أمر إنتاج جديد
                  </button>
                ) : undefined
              }
            />
          }
          columns={[
            { key: 'number', header: 'رقم الأمر', render: (row) => <span className="num font-semibold text-brand-700">{String(row.order_number)}</span> },
            { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
            { key: 'factory', header: 'المصنع', render: (row) => <span className="font-semibold text-slate-800">{String(row.factory_name)}</span> },
            {
              key: 'product',
              header: 'المنتج',
              render: (row) => (
                <div>
                  <span>{String(row.product_name)}</span>
                  {Boolean(row.size || row.color) && <span className="mr-1 text-[12px] text-slate-500">({[row.size, row.color].filter(Boolean).join(' / ')})</span>}
                </div>
              )
            },
            {
              key: 'qty',
              header: 'المنتج / المتوقع',
              align: 'center',
              render: (row) => (
                <span className="num">
                  <span className={cn('font-semibold', Number(row.produced_qty) >= Number(row.expected_qty) ? 'text-emerald-700' : 'text-slate-700')}>{qty(Number(row.produced_qty))}</span>
                  <span className="text-slate-400"> / {qty(Number(row.expected_qty))}</span>
                </span>
              )
            },
            { key: 'cost', header: 'إجمالي التكلفة', align: 'left', render: (row) => <span className="num font-semibold">{money(Number(row.total_cost))}</span> },
            { key: 'unit', header: 'تكلفة الوحدة', align: 'left', render: (row) => (Number(row.unit_cost) ? <span className="num text-brand-700">{money(Math.round(Number(row.unit_cost) / 100))}</span> : <span className="text-slate-300">—</span>) },
            { key: 'status', header: 'الحالة', align: 'center', render: (row) => <Badge tone={STATUS_TONE[String(row.status)]}>{String(row.status_label)}</Badge> }
          ]}
        />
      </Card>

      <CreateOrderModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => navigate(`/production/${id}`)} />
    </div>
  )
}

function CreateOrderModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }): React.JSX.Element {
  const ui = useUi()
  const warehouses = useQuery<Record<string, unknown>[]>(open ? 'warehouses:list' : null, { activeOnly: true }, [open])
  const [factoryId, setFactoryId] = useState<number | null>(null)
  const [output, setOutput] = useState<VariantOption | null>(null)
  const [expectedQty, setExpectedQty] = useState(0)
  const [orderDate, setOrderDate] = useState(today())
  const [expectedDate, setExpectedDate] = useState('')
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [materials, setMaterials] = useState<{ variantId: number; name: string; sku: string; unit: string; available: number; plannedQty: number }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFactoryId(null)
    setOutput(null)
    setExpectedQty(0)
    setOrderDate(today())
    setExpectedDate('')
    setNotes('')
    setMaterials([])
    setError(null)
  }, [open])

  useEffect(() => {
    if (!warehouseId && warehouses.data?.length) {
      setWarehouseId(Number((warehouses.data.find((w) => w.is_default === 1) ?? warehouses.data[0]).id))
    }
  }, [warehouses.data, warehouseId])

  const save = async (): Promise<void> => {
    if (!factoryId) return setError('اختر المصنع.')
    if (!output) return setError('اختر المنتج المطلوب تصنيعه.')
    if (expectedQty <= 0) return setError('أدخل الكمية المتوقعة.')
    setSaving(true)
    setError(null)
    try {
      const result = await invoke<{ id: number; orderNumber: string }>('production:create', {
        date: orderDate,
        factoryId,
        outputVariantId: output.variantId,
        warehouseId,
        expectedQty,
        expectedDate: expectedDate || null,
        notes: notes || null,
        materials: materials.map((m) => ({ variantId: m.variantId, plannedQty: m.plannedQty }))
      })
      ui.success('تم إنشاء أمر الإنتاج', result.orderNumber)
      onCreated(result.id)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="أمر إنتاج جديد"
      description="حدّد المصنع والمنتج المطلوب والخامات المخططة. ستصرف الخامات فعليًا من صفحة الأمر."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            إنشاء الأمر
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="المصنع" required>
          <PartyPicker partyType="factory" value={factoryId} onChange={(id) => setFactoryId(id)} />
        </Field>
        <Field label="تاريخ الأمر" required>
          <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </Field>
        <Field label="المنتج المطلوب تصنيعه" required className="sm:col-span-2">
          {output ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
              <span>
                <span className="block text-sm font-semibold text-slate-800">{variantLabel(output)}</span>
                <span className="num block text-[12px] text-slate-500">{output.sku}</span>
              </span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOutput(null)}>تغيير</button>
            </div>
          ) : (
            <ProductSearch productType="finished" onPick={setOutput} placeholder="ابحث عن المنتج النهائي…" />
          )}
        </Field>
        <Field label="الكمية المتوقعة" required>
          <QtyInput value={expectedQty} onChange={setExpectedQty} />
        </Field>
        <Field label="تاريخ التسليم المتوقع">
          <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </Field>
        <Field label="مخزن الاستلام" required className="sm:col-span-2">
          <Select value={warehouseId ?? ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
            {(warehouses.data ?? []).map((w) => (
              <option key={String(w.id)} value={String(w.id)}>{String(w.name)}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 p-3">
        <h3 className="mb-2 text-[13px] font-bold text-slate-700">الخامات المخططة (اختياري)</h3>
        <ProductSearch
          productType="raw"
          warehouseId={warehouseId ?? undefined}
          onPick={(option) => {
            if (materials.some((m) => m.variantId === option.variantId)) return
            setMaterials([...materials, { variantId: option.variantId, name: variantLabel(option), sku: option.sku, unit: option.unit, available: option.stock, plannedQty: 0 }])
          }}
          placeholder="ابحث عن خامة (قماش، أزرار، سحابات…)"
        />
        {materials.length > 0 && (
          <table className="tbl mt-3">
            <thead>
              <tr>
                <th>الخامة</th>
                <th className="text-center">المتاح</th>
                <th style={{ width: '130px' }}>الكمية المخططة</th>
                <th style={{ width: '44px' }} />
              </tr>
            </thead>
            <tbody>
              {materials.map((material, index) => (
                <tr key={material.variantId}>
                  <td>
                    <p className="font-semibold text-slate-800">{material.name}</p>
                    <p className="num text-[12px] text-slate-500">{material.sku}</p>
                  </td>
                  <td className="text-center"><span className="num">{qty(material.available)} {material.unit}</span></td>
                  <td><QtyInput value={material.plannedQty} onChange={(value) => setMaterials(materials.map((m, i) => (i === index ? { ...m, plannedQty: value } : m)))} /></td>
                  <td>
                    <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => setMaterials(materials.filter((_, i) => i !== index))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Field label="ملاحظات" className="mt-4">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  )
}
