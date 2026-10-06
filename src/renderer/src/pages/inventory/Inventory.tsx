import React, { useEffect, useState } from 'react'
import { ArrowLeftRight, Boxes, ClipboardCheck, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { PERMISSIONS } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useDebounced, useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Field, Input, Modal, QtyInput, RateInput, SearchInput, Select, Spinner, StatCard, Tabs, Textarea, cn, useConfirm } from '../../components/ui'
import { DateRangePicker, ExportButtons, PageHeader } from '../../components/common/page'
import { ProductSearch, variantLabel, type VariantOption } from '../../components/common/pickers'
import { date, dateTime, money, monthStart, qty, rate, today } from '../../lib/format'

const MOVEMENT_LABEL: Record<string, string> = {
  purchase: 'شراء',
  purchase_return: 'مردود شراء',
  sale: 'بيع',
  sale_return: 'مردود بيع',
  adjustment: 'تسوية',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
  production_issue: 'صرف للمصنع',
  production_receipt: 'استلام إنتاج',
  production_return: 'ارتجاع من المصنع',
  opening: 'رصيد افتتاحي',
  damage: 'تالف'
}

export function InventoryPage(): React.JSX.Element {
  const { can } = useSession()
  const [tab, setTab] = useState('stock')
  const [warehouseId, setWarehouseId] = useState('')
  const [search, setSearch] = useState('')
  const [productType, setProductType] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [movementType, setMovementType] = useState('')
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const debounced = useDebounced(search, 300)

  const warehouses = useQuery<Record<string, unknown>[]>('warehouses:list', { activeOnly: true })
  const stock = useQuery<Record<string, unknown>[]>(
    tab === 'stock' ? 'inventory:stock' : null,
    { warehouseId: warehouseId ? Number(warehouseId) : undefined, search: debounced || undefined, productType: productType || undefined, lowOnly },
    [tab, warehouseId, debounced, productType, lowOnly]
  )
  const movements = useQuery<{ rows: Record<string, unknown>[]; total: number }>(
    tab === 'movements' ? 'inventory:movements' : null,
    { warehouseId: warehouseId ? Number(warehouseId) : undefined, from: range.from, to: range.to, movementType: movementType || undefined, pageSize: 300 },
    [tab, warehouseId, range.from, range.to, movementType]
  )
  const adjustments = useQuery<Record<string, unknown>[]>(
    tab === 'adjustments' ? 'stock:adjustments' : null,
    { from: range.from, to: range.to, warehouseId: warehouseId ? Number(warehouseId) : undefined },
    [tab, range.from, range.to, warehouseId]
  )
  const transfers = useQuery<Record<string, unknown>[]>(tab === 'transfers' ? 'stock:transfers' : null, { from: range.from, to: range.to }, [tab, range.from, range.to])
  const factories = useQuery<{ factoryId: number; factoryName: string; wipValue: number; openOrders: number }[]>(tab === 'factories' ? 'production:factoriesWip' : null, undefined, [tab])

  const rows = stock.data ?? []
  const totalValue = rows.reduce((sum, row) => sum + Number(row.value), 0)
  const lowCount = rows.filter((row) => row.isLow === 1).length
  const negativeCount = rows.filter((row) => Number(row.quantity) < 0).length

  return (
    <div>
      <PageHeader
        title="المخزون"
        subtitle="أرصدة الأصناف وحركاتها وتسوياتها"
        actions={
          <>
            {tab === 'stock' && (
              <ExportButtons
                title="تقرير أرصدة المخزون"
                columns={[
                  { key: 'sku', label: 'الكود' },
                  { key: 'name', label: 'الصنف' },
                  { key: 'size', label: 'المقاس' },
                  { key: 'color', label: 'اللون' },
                  { key: 'quantity', label: 'الرصيد', type: 'qty' },
                  { key: 'unit', label: 'الوحدة' },
                  { key: 'value', label: 'القيمة', type: 'money' }
                ]}
                rows={rows}
                totals={{ value: totalValue }}
                disabled={!rows.length}
              />
            )}
            {can(PERMISSIONS.INVENTORY_MANAGE) && (
              <>
                <button type="button" className="btn-secondary" onClick={() => setTransferOpen(true)}>
                  <ArrowLeftRight className="h-4 w-4" />
                  تحويل بين المخازن
                </button>
                <button type="button" className="btn-primary" onClick={() => setAdjustOpen(true)}>
                  <ClipboardCheck className="h-4 w-4" />
                  تسوية جرد
                </button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="قيمة المخزون" value={money(totalValue)} icon={<Boxes className="h-5 w-5" />} tone="brand" />
        <StatCard label="عدد الأصناف" value={rows.length} />
        <StatCard label="أصناف تحت حد الطلب" value={lowCount} tone={lowCount ? 'warning' : 'default'} icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="أرصدة سالبة" value={negativeCount} tone={negativeCount ? 'negative' : 'default'} />
      </div>

      <Card noPadding>
        <div className="px-3 pt-1">
          <Tabs
            tabs={[
              { key: 'stock', label: 'الأرصدة' },
              { key: 'movements', label: 'حركة المخزون' },
              { key: 'adjustments', label: 'التسويات' },
              { key: 'transfers', label: 'التحويلات' },
              { key: 'factories', label: 'لدى المصانع' }
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          {(tab === 'stock' || tab === 'movements' || tab === 'adjustments') && (
            <Select className="h-10 w-44" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">كل المخازن</option>
              {(warehouses.data ?? []).map((w) => (
                <option key={String(w.id)} value={String(w.id)}>{String(w.name)}</option>
              ))}
            </Select>
          )}
          {tab === 'stock' && (
            <>
              <SearchInput className="w-full max-w-xs" value={search} onChange={setSearch} placeholder="ابحث عن صنف…" />
              <Select className="h-10 w-40" value={productType} onChange={(e) => setProductType(e.target.value)}>
                <option value="">كل الأنواع</option>
                <option value="finished">بضاعة جاهزة</option>
                <option value="raw">خامات</option>
              </Select>
              <button
                type="button"
                onClick={() => setLowOnly(!lowOnly)}
                className={cn('btn-secondary btn-sm h-10', lowOnly && 'border-amber-400 bg-amber-50 text-amber-800')}
              >
                <TriangleAlert className="h-4 w-4" />
                تحت حد الطلب فقط
              </button>
            </>
          )}
          {(tab === 'movements' || tab === 'adjustments' || tab === 'transfers') && <DateRangePicker value={range} onChange={setRange} />}
          {tab === 'movements' && (
            <Select className="h-10 w-44" value={movementType} onChange={(e) => setMovementType(e.target.value)}>
              <option value="">كل الحركات</option>
              {Object.entries(MOVEMENT_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          )}
        </div>

        {tab === 'stock' && (
          <DataTable
            rows={rows}
            loading={stock.loading}
            error={stock.error}
            onRetry={stock.reload}
            rowKey={(row) => String(row.variantId)}
            empty={<EmptyState title="لا توجد أصناف" description="أضف منتجاتك أولًا ثم سجّل أرصدة افتتاحية أو فواتير شراء." />}
            columns={[
              { key: 'sku', header: 'الكود', width: '120px', render: (row) => <span className="num text-[13px] text-slate-500">{String(row.sku)}</span> },
              {
                key: 'name',
                header: 'الصنف',
                render: (row) => (
                  <div>
                    <span className="font-semibold text-slate-800">{String(row.name)}</span>
                    {Boolean(row.size || row.color) && <span className="mr-1 text-[12px] text-slate-500">({[row.size, row.color].filter(Boolean).join(' / ')})</span>}
                  </div>
                )
              },
              { key: 'type', header: 'النوع', align: 'center', render: (row) => <Badge tone={row.productType === 'raw' ? 'violet' : 'blue'}>{row.productType === 'raw' ? 'خامة' : 'جاهز'}</Badge> },
              {
                key: 'qty',
                header: 'الرصيد',
                align: 'left',
                render: (row) => (
                  <span className={cn('num font-bold', Number(row.quantity) < 0 ? 'text-rose-700' : row.isLow ? 'text-amber-700' : 'text-slate-800')}>
                    {qty(Number(row.quantity))} <span className="text-[12px] font-normal text-slate-500">{String(row.unit)}</span>
                  </span>
                )
              },
              { key: 'min', header: 'حد الطلب', align: 'left', render: (row) => (Number(row.minStock) > 0 ? <span className="num text-slate-500">{qty(Number(row.minStock))}</span> : <span className="text-slate-300">—</span>) },
              { key: 'cost', header: 'متوسط التكلفة', align: 'left', render: (row) => <span className="num text-slate-600">{rate(Number(row.avgCost))}</span> },
              { key: 'value', header: 'قيمة المخزون', align: 'left', render: (row) => <span className="num font-semibold">{money(Number(row.value))}</span> },
              { key: 'flag', header: '', align: 'center', render: (row) => (row.isLow ? <Badge tone="amber">تحت الحد</Badge> : Number(row.quantity) < 0 ? <Badge tone="red">سالب</Badge> : null) }
            ]}
          />
        )}

        {tab === 'movements' && (
          <DataTable
            rows={movements.data?.rows ?? []}
            loading={movements.loading}
            error={movements.error}
            rowKey={(row) => String(row.id)}
            empty={<EmptyState title="لا توجد حركات في هذه الفترة" />}
            columns={[
              { key: 'date', header: 'التاريخ', width: '110px', render: (row) => <span className="num">{date(String(row.date))}</span> },
              { key: 'type', header: 'نوع الحركة', align: 'center', render: (row) => <Badge tone={Number(row.qty_in) > 0 ? 'green' : 'red'}>{MOVEMENT_LABEL[String(row.movement_type)] ?? String(row.movement_type)}</Badge> },
              {
                key: 'product',
                header: 'الصنف',
                render: (row) => (
                  <div>
                    <span className="font-semibold text-slate-800">{String(row.product_name)}</span>
                    {Boolean(row.size || row.color) && <span className="mr-1 text-[12px] text-slate-500">({[row.size, row.color].filter(Boolean).join(' / ')})</span>}
                    <p className="num text-[12px] text-slate-500">{String(row.sku)}</p>
                  </div>
                )
              },
              { key: 'warehouse', header: 'المخزن', render: (row) => String(row.warehouse_name) },
              { key: 'in', header: 'وارد', align: 'left', render: (row) => (Number(row.qty_in) > 0 ? <span className="num font-semibold text-emerald-700">+{qty(Number(row.qty_in))}</span> : <span className="text-slate-300">—</span>) },
              { key: 'out', header: 'صادر', align: 'left', render: (row) => (Number(row.qty_out) > 0 ? <span className="num font-semibold text-rose-700">−{qty(Number(row.qty_out))}</span> : <span className="text-slate-300">—</span>) },
              { key: 'balance', header: 'الرصيد بعدها', align: 'left', render: (row) => <span className="num">{qty(Number(row.balance_after))}</span> },
              { key: 'cost', header: 'تكلفة الوحدة', align: 'left', render: (row) => <span className="num text-slate-500">{rate(Number(row.unit_cost))}</span> },
              { key: 'ref', header: 'المستند', render: (row) => <span className="num text-[12.5px] font-semibold text-brand-700">{String(row.ref_number ?? '—')}</span> },
              { key: 'user', header: 'المستخدم', render: (row) => <span className="text-[12.5px] text-slate-500">{String(row.user_name ?? '—')}</span> }
            ]}
          />
        )}

        {tab === 'adjustments' && (
          <DataTable
            rows={adjustments.data ?? []}
            loading={adjustments.loading}
            error={adjustments.error}
            rowKey={(row) => String(row.id)}
            empty={<EmptyState title="لا توجد تسويات" description="سجّل تسوية جرد لتصحيح الفروقات بين الرصيد الدفتري والفعلي." />}
            columns={[
              { key: 'number', header: 'رقم التسوية', render: (row) => <span className="num font-semibold text-brand-700">{String(row.adjustment_number)}</span> },
              { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
              { key: 'type', header: 'النوع', align: 'center', render: (row) => <Badge tone="slate">{({ count: 'جرد', damage: 'تالف', loss: 'فاقد', opening: 'رصيد افتتاحي', other: 'أخرى' } as Record<string, string>)[String(row.adjustment_type)]}</Badge> },
              { key: 'warehouse', header: 'المخزن', render: (row) => String(row.warehouse_name) },
              { key: 'items', header: 'عدد الأصناف', align: 'center', render: (row) => <span className="num">{String(row.item_count)}</span> },
              { key: 'value', header: 'أثر القيمة', align: 'left', render: (row) => <span className={cn('num font-semibold', Number(row.total_value) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{money(Number(row.total_value))}</span> },
              { key: 'reason', header: 'السبب', render: (row) => <span className="text-[12.5px] text-slate-600">{String(row.reason ?? '—')}</span> },
              { key: 'user', header: 'المستخدم', render: (row) => <span className="text-[12.5px] text-slate-500">{String(row.created_by_name ?? '—')}</span> }
            ]}
          />
        )}

        {tab === 'transfers' && (
          <DataTable
            rows={transfers.data ?? []}
            loading={transfers.loading}
            error={transfers.error}
            rowKey={(row) => String(row.id)}
            empty={<EmptyState title="لا توجد تحويلات" />}
            columns={[
              { key: 'number', header: 'رقم التحويل', render: (row) => <span className="num font-semibold text-brand-700">{String(row.transfer_number)}</span> },
              { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
              { key: 'from', header: 'من مخزن', render: (row) => String(row.from_warehouse_name) },
              { key: 'to', header: 'إلى مخزن', render: (row) => String(row.to_warehouse_name) },
              { key: 'items', header: 'عدد الأصناف', align: 'center', render: (row) => <span className="num">{String(row.item_count)}</span> },
              { key: 'notes', header: 'ملاحظات', render: (row) => <span className="text-[12.5px] text-slate-600">{String(row.notes ?? '—')}</span> }
            ]}
          />
        )}

        {tab === 'factories' && (
          <DataTable
            rows={factories.data ?? []}
            loading={factories.loading}
            error={factories.error}
            rowKey={(row) => String(row.factoryId)}
            empty={<EmptyState title="لا توجد خامات أو تكاليف لدى المصانع حاليًا" />}
            columns={[
              { key: 'name', header: 'المصنع', render: (row) => <span className="font-semibold text-slate-800">{row.factoryName}</span> },
              { key: 'orders', header: 'أوامر مفتوحة', align: 'center', render: (row) => <span className="num">{row.openOrders}</span> },
              { key: 'value', header: 'قيمة الخامات والتكاليف لديه', align: 'left', render: (row) => <span className="num font-semibold text-violet-700">{money(row.wipValue)}</span> }
            ]}
          />
        )}
      </Card>

      <AdjustmentModal open={adjustOpen} onClose={() => setAdjustOpen(false)} warehouses={warehouses.data ?? []} onSaved={() => { stock.reload(); adjustments.reload() }} />
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} warehouses={warehouses.data ?? []} onSaved={() => { stock.reload(); transfers.reload() }} />
    </div>
  )
}

function AdjustmentModal({
  open,
  onClose,
  warehouses,
  onSaved
}: {
  open: boolean
  onClose: () => void
  warehouses: Record<string, unknown>[]
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [adjustmentType, setAdjustmentType] = useState<'count' | 'damage' | 'loss' | 'opening'>('count')
  const [adjDate, setAdjDate] = useState(today())
  const [reason, setReason] = useState('')
  const [items, setItems] = useState<{ key: string; variantId: number; name: string; sku: string; unit: string; current: number; quantity: number; unitCost: number }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setItems([])
    setReason('')
    setError(null)
    setAdjDate(today())
    if (warehouses.length) setWarehouseId(Number((warehouses.find((w) => w.is_default === 1) ?? warehouses[0]).id))
  }, [open, warehouses])

  const add = (option: VariantOption): void => {
    if (items.some((i) => i.variantId === option.variantId)) return
    setItems([
      ...items,
      {
        key: `${option.variantId}`,
        variantId: option.variantId,
        name: variantLabel(option),
        sku: option.sku,
        unit: option.unit,
        current: option.stock,
        quantity: adjustmentType === 'count' ? option.stock : 0,
        unitCost: option.avgCost
      }
    ])
  }

  const save = async (): Promise<void> => {
    if (!items.length) return setError('أضف صنفًا واحدًا على الأقل.')
    if (!reason.trim()) return setError('اكتب سبب التسوية — سيُحفظ في سجل المراجعة.')
    setSaving(true)
    setError(null)
    try {
      await invoke('stock:adjust', {
        date: adjDate,
        warehouseId,
        adjustmentType,
        reason,
        items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, unitCost: adjustmentType === 'opening' ? i.unitCost : undefined }))
      })
      ui.success('تم حفظ التسوية')
      onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const hint: Record<string, string> = {
    count: 'أدخل الكمية الفعلية بعد الجرد، وسيحسب النظام الفرق تلقائيًا.',
    damage: 'أدخل الكمية التالفة التي ستُخصم من المخزون.',
    loss: 'أدخل الكمية المفقودة التي ستُخصم من المخزون.',
    opening: 'أدخل كميات بداية التشغيل مع تكلفة الوحدة.'
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="تسوية مخزون"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            حفظ التسوية
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>}

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Field label="نوع التسوية" required>
          <Select value={adjustmentType} onChange={(e) => { setAdjustmentType(e.target.value as 'count'); setItems([]) }}>
            <option value="count">جرد فعلي</option>
            <option value="damage">تالف</option>
            <option value="loss">فاقد</option>
            <option value="opening">رصيد افتتاحي</option>
          </Select>
        </Field>
        <Field label="المخزن" required>
          <Select value={warehouseId ?? ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
            {warehouses.map((w) => (
              <option key={String(w.id)} value={String(w.id)}>{String(w.name)}</option>
            ))}
          </Select>
        </Field>
        <Field label="التاريخ" required>
          <Input type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} />
        </Field>
      </div>

      <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-[12.5px] text-brand-900">{hint[adjustmentType]}</p>

      <ProductSearch warehouseId={warehouseId ?? undefined} onPick={add} placeholder="ابحث عن الصنف لإضافته…" />

      {items.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>الصنف</th>
                <th className="text-center">الرصيد الحالي</th>
                <th style={{ width: '130px' }}>{adjustmentType === 'count' ? 'الكمية الفعلية' : 'الكمية'}</th>
                {adjustmentType === 'opening' && <th style={{ width: '130px' }}>تكلفة الوحدة</th>}
                <th className="text-center">الفرق</th>
                <th style={{ width: '44px' }} />
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const diff = adjustmentType === 'count' ? item.quantity - item.current : adjustmentType === 'opening' ? item.quantity : -item.quantity
                return (
                  <tr key={item.key}>
                    <td>
                      <p className="font-semibold text-slate-800">{item.name}</p>
                      <p className="num text-[12px] text-slate-500">{item.sku}</p>
                    </td>
                    <td className="text-center"><span className="num">{qty(item.current)} {item.unit}</span></td>
                    <td><QtyInput value={item.quantity} onChange={(value) => setItems(items.map((i, idx) => (idx === index ? { ...i, quantity: value } : i)))} /></td>
                    {adjustmentType === 'opening' && (
                      <td><RateInput value={item.unitCost} onChange={(value) => setItems(items.map((i, idx) => (idx === index ? { ...i, unitCost: value } : i)))} /></td>
                    )}
                    <td className="text-center">
                      <span className={cn('num font-bold', diff > 0 ? 'text-emerald-700' : diff < 0 ? 'text-rose-700' : 'text-slate-400')}>
                        {diff > 0 ? '+' : ''}{qty(diff)}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => setItems(items.filter((_, i) => i !== index))}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Field label="سبب التسوية" required className="mt-4">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: جرد نهاية الشهر — فروقات فعلية" />
      </Field>
    </Modal>
  )
}

function TransferModal({
  open,
  onClose,
  warehouses,
  onSaved
}: {
  open: boolean
  onClose: () => void
  warehouses: Record<string, unknown>[]
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const [fromId, setFromId] = useState<number | null>(null)
  const [toId, setToId] = useState<number | null>(null)
  const [trDate, setTrDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<{ variantId: number; name: string; sku: string; unit: string; available: number; quantity: number }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setItems([])
    setNotes('')
    setError(null)
    setTrDate(today())
    if (warehouses.length) {
      setFromId(Number(warehouses[0].id))
      setToId(warehouses[1] ? Number(warehouses[1].id) : null)
    }
  }, [open, warehouses])

  const save = async (): Promise<void> => {
    if (!fromId || !toId) return setError('حدّد المخزن المصدر والمخزن المستقبل.')
    if (fromId === toId) return setError('لا يمكن التحويل إلى نفس المخزن.')
    if (!items.length) return setError('أضف صنفًا واحدًا على الأقل.')
    setSaving(true)
    setError(null)
    try {
      await invoke('stock:transfer', {
        date: trDate,
        fromWarehouseId: fromId,
        toWarehouseId: toId,
        notes: notes || null,
        items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity }))
      })
      ui.success('تم التحويل بنجاح')
      onSaved()
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
      title="تحويل بين المخازن"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            تنفيذ التحويل
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>}

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Field label="من مخزن" required>
          <Select value={fromId ?? ''} onChange={(e) => { setFromId(Number(e.target.value)); setItems([]) }}>
            {warehouses.map((w) => (
              <option key={String(w.id)} value={String(w.id)}>{String(w.name)}</option>
            ))}
          </Select>
        </Field>
        <Field label="إلى مخزن" required>
          <Select value={toId ?? ''} onChange={(e) => setToId(Number(e.target.value))}>
            <option value="">اختر…</option>
            {warehouses.filter((w) => Number(w.id) !== fromId).map((w) => (
              <option key={String(w.id)} value={String(w.id)}>{String(w.name)}</option>
            ))}
          </Select>
        </Field>
        <Field label="التاريخ" required>
          <Input type="date" value={trDate} onChange={(e) => setTrDate(e.target.value)} />
        </Field>
      </div>

      <ProductSearch
        warehouseId={fromId ?? undefined}
        onPick={(option) => {
          if (items.some((i) => i.variantId === option.variantId)) return
          setItems([...items, { variantId: option.variantId, name: variantLabel(option), sku: option.sku, unit: option.unit, available: option.stock, quantity: 1 }])
        }}
        placeholder="ابحث عن الصنف المراد تحويله…"
      />

      {items.length > 0 && (
        <table className="tbl mt-4">
          <thead>
            <tr>
              <th>الصنف</th>
              <th className="text-center">المتاح</th>
              <th style={{ width: '130px' }}>الكمية المحوَّلة</th>
              <th style={{ width: '44px' }} />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.variantId}>
                <td>
                  <p className="font-semibold text-slate-800">{item.name}</p>
                  <p className="num text-[12px] text-slate-500">{item.sku}</p>
                </td>
                <td className="text-center"><span className="num">{qty(item.available)} {item.unit}</span></td>
                <td>
                  <QtyInput
                    value={item.quantity}
                    max={item.available}
                    onChange={(value) => setItems(items.map((i, idx) => (idx === index ? { ...i, quantity: Math.min(value, i.available) } : i)))}
                  />
                </td>
                <td>
                  <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => setItems(items.filter((_, i) => i !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Field label="ملاحظات" className="mt-4">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  )
}

export { dateTime, Plus }
