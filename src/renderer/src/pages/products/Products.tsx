import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FolderTree, Package, Plus, Trash2 } from 'lucide-react'
import type { ProductType } from '@shared/types'
import { PERMISSIONS } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useDebounced, useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Field, Input, Modal, Pagination, RateInput, SearchInput, Select, Spinner, StatCard, Switch, Textarea, cn, useConfirm } from '../../components/ui'
import { ExportButtons, PageHeader } from '../../components/common/page'
import { money, qty, rate } from '../../lib/format'

const TYPE_LABEL: Record<string, string> = { finished: 'بضاعة جاهزة', raw: 'خامة', service: 'خدمة' }

export function ProductsPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { can } = useSession()
  const [search, setSearch] = useState('')
  const [productType, setProductType] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [page, setPage] = useState(1)
  const [formId, setFormId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const debounced = useDebounced(search, 300)
  const pageSize = 50

  const categories = useQuery<{ id: number; name: string; productCount: number }[]>('categories:list')
  const products = useQuery<{ rows: Record<string, unknown>[]; total: number }>(
    'products:list',
    { search: debounced || undefined, productType: productType || undefined, categoryId: categoryId ? Number(categoryId) : undefined, page, pageSize },
    [debounced, productType, categoryId, page]
  )

  useEffect(() => {
    if (id) {
      setFormId(Number(id))
      setFormOpen(true)
    }
  }, [id])

  const rows = products.data?.rows ?? []
  const totalValue = rows.reduce((sum, row) => sum + Math.round((Number(row.stock) * Number(row.avg_cost)) / 100), 0)

  return (
    <div>
      <PageHeader
        title="المنتجات"
        subtitle="البضاعة الجاهزة والخامات والمقاسات والألوان"
        actions={
          <>
            <ExportButtons
              title="قائمة المنتجات"
              columns={[
                { key: 'sku', label: 'الكود' },
                { key: 'name', label: 'اسم المنتج' },
                { key: 'category_name', label: 'التصنيف' },
                { key: 'brand', label: 'الماركة' },
                { key: 'unit', label: 'الوحدة' },
                { key: 'stock', label: 'الرصيد', type: 'qty' },
                { key: 'avg_cost', label: 'متوسط التكلفة', type: 'number' }
              ]}
              rows={rows}
              disabled={!rows.length}
            />
            {can(PERMISSIONS.PRODUCTS_MANAGE) && (
              <>
                <button type="button" className="btn-secondary" onClick={() => setCategoriesOpen(true)}>
                  <FolderTree className="h-4 w-4" />
                  التصنيفات
                </button>
                <button type="button" className="btn-primary" onClick={() => { setFormId(null); setFormOpen(true) }}>
                  <Plus className="h-4 w-4" />
                  منتج جديد
                </button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="عدد المنتجات" value={products.data?.total ?? 0} icon={<Package className="h-5 w-5" />} />
        <StatCard label="عدد التصنيفات" value={categories.data?.length ?? 0} icon={<FolderTree className="h-5 w-5" />} />
        <StatCard label="قيمة المخزون (الصفحة الحالية)" value={money(totalValue)} tone="brand" />
      </div>

      <Card noPadding>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <SearchInput className="w-full max-w-sm" value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="ابحث بالاسم أو الكود أو الباركود…" />
          <Select className="h-10 w-40" value={productType} onChange={(e) => { setProductType(e.target.value); setPage(1) }}>
            <option value="">كل الأنواع</option>
            <option value="finished">بضاعة جاهزة</option>
            <option value="raw">خامات</option>
            <option value="service">خدمات</option>
          </Select>
          <Select className="h-10 w-48" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1) }}>
            <option value="">كل التصنيفات</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </Select>
        </div>

        <DataTable
          rows={rows}
          loading={products.loading}
          error={products.error}
          onRetry={products.reload}
          rowKey={(row) => String(row.id)}
          onRowClick={can(PERMISSIONS.PRODUCTS_MANAGE) ? (row) => { setFormId(Number(row.id)); setFormOpen(true) } : undefined}
          empty={
            <EmptyState
              title="لا توجد منتجات بعد"
              description="أضف منتجاتك يدويًا أو استوردها من ملف Excel من الإعدادات."
              action={
                can(PERMISSIONS.PRODUCTS_MANAGE) ? (
                  <button type="button" className="btn-primary" onClick={() => { setFormId(null); setFormOpen(true) }}>
                    <Plus className="h-4 w-4" />
                    منتج جديد
                  </button>
                ) : undefined
              }
            />
          }
          columns={[
            { key: 'sku', header: 'الكود', width: '110px', render: (row) => <span className="num text-[13px] text-slate-500">{String(row.sku)}</span> },
            {
              key: 'name',
              header: 'اسم المنتج',
              render: (row) => (
                <div>
                  <span className="font-semibold text-slate-800">{String(row.name)}</span>
                  {row.is_active === 0 && <span className="mr-2"><Badge tone="slate">غير نشط</Badge></span>}
                  {row.brand ? <p className="text-[12px] text-slate-500">{String(row.brand)}</p> : null}
                </div>
              )
            },
            { key: 'type', header: 'النوع', align: 'center', render: (row) => <Badge tone={row.product_type === 'raw' ? 'violet' : row.product_type === 'service' ? 'slate' : 'blue'}>{TYPE_LABEL[String(row.product_type)]}</Badge> },
            { key: 'category', header: 'التصنيف', render: (row) => String(row.category_name ?? '—') },
            { key: 'variants', header: 'المقاسات/الألوان', align: 'center', render: (row) => <span className="num">{String(row.variant_count)}</span> },
            { key: 'stock', header: 'الرصيد', align: 'left', render: (row) => <span className={cn('num font-semibold', Number(row.stock) <= 0 ? 'text-rose-600' : 'text-slate-800')}>{qty(Number(row.stock))} <span className="text-[12px] font-normal text-slate-500">{String(row.unit)}</span></span> },
            { key: 'cost', header: 'متوسط التكلفة', align: 'left', render: (row) => <span className="num text-slate-600">{rate(Number(row.avg_cost))}</span> },
            { key: 'price', header: 'سعر البيع', align: 'left', render: (row) => <span className="num font-semibold text-emerald-700">{rate(Number(row.avg_sale_price))}</span> }
          ]}
        />
        <div className="px-3">
          <Pagination page={page} pageSize={pageSize} total={products.data?.total ?? 0} onChange={setPage} />
        </div>
      </Card>

      <ProductFormModal
        open={formOpen}
        productId={formId}
        categories={categories.data ?? []}
        onClose={() => {
          setFormOpen(false)
          if (id) navigate('/products')
        }}
        onSaved={() => {
          products.reload()
          categories.reload()
        }}
      />

      <CategoriesModal open={categoriesOpen} onClose={() => setCategoriesOpen(false)} onChanged={() => { categories.reload(); products.reload() }} />
    </div>
  )
}

interface VariantRow {
  id?: number
  size: string
  color: string
  barcode: string
  purchasePrice: number
  salePrice: number
  minStock: number
  isActive: boolean
  stock?: number
  avgCost?: number
}

function ProductFormModal({
  open,
  productId,
  categories,
  onClose,
  onSaved
}: {
  open: boolean
  productId: number | null
  categories: { id: number; name: string }[]
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [productType, setProductType] = useState<ProductType>('finished')
  const [category, setCategory] = useState('')
  const [brand, setBrand] = useState('')
  const [unit, setUnit] = useState('قطعة')
  const [notes, setNotes] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [variants, setVariants] = useState<VariantRow[]>([])
  const [sizesText, setSizesText] = useState('')
  const [colorsText, setColorsText] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSizesText('')
    setColorsText('')
    if (productId) {
      setLoading(true)
      invoke<Record<string, unknown>>('products:get', { id: productId })
        .then((product) => {
          setName(String(product.name))
          setSku(String(product.sku))
          setProductType(product.product_type as ProductType)
          setCategory(product.category_id ? String(product.category_id) : '')
          setBrand(String(product.brand ?? ''))
          setUnit(String(product.unit))
          setNotes(String(product.notes ?? ''))
          setIsActive(product.is_active === 1)
          setVariants(
            ((product.variants ?? []) as Record<string, unknown>[]).map((v) => ({
              id: Number(v.id),
              size: String(v.size ?? ''),
              color: String(v.color ?? ''),
              barcode: String(v.barcode ?? ''),
              purchasePrice: Number(v.purchase_price),
              salePrice: Number(v.sale_price),
              minStock: Number(v.min_stock),
              isActive: v.is_active === 1,
              stock: Number(v.stock ?? 0),
              avgCost: Number(v.avg_cost)
            }))
          )
        })
        .catch((err) => setError(errorMessage(err)))
        .finally(() => setLoading(false))
    } else {
      setName('')
      setSku('')
      setProductType('finished')
      setCategory('')
      setBrand('')
      setUnit('قطعة')
      setNotes('')
      setIsActive(true)
      setVariants([{ size: '', color: '', barcode: '', purchasePrice: 0, salePrice: 0, minStock: 0, isActive: true }])
      invoke<string>('products:nextSku', { productType: 'finished' }).then(setSku).catch(() => undefined)
    }
  }, [open, productId])

  const generateMatrix = (): void => {
    const sizes = sizesText.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean)
    const colors = colorsText.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean)
    if (!sizes.length && !colors.length) return
    const base = variants[0] ?? { purchasePrice: 0, salePrice: 0, minStock: 0 }
    const generated: VariantRow[] = []
    for (const size of sizes.length ? sizes : ['']) {
      for (const color of colors.length ? colors : ['']) {
        const exists = variants.find((v) => v.size === size && v.color === color)
        generated.push(
          exists ?? {
            size,
            color,
            barcode: '',
            purchasePrice: base.purchasePrice,
            salePrice: base.salePrice,
            minStock: base.minStock,
            isActive: true
          }
        )
      }
    }
    // احتفظ بالمتغيّرات التي لها حركة مخزنية
    const kept = variants.filter((v) => v.id && (v.stock ?? 0) !== 0 && !generated.some((g) => g.id === v.id))
    setVariants([...kept, ...generated])
  }

  const save = async (): Promise<void> => {
    if (!name.trim()) return setError('اسم المنتج مطلوب.')
    if (!variants.length) return setError('أضف مقاسًا/لونًا واحدًا على الأقل، أو اترك سطرًا واحدًا فارغًا لمنتج بلا متغيّرات.')
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: name.trim(),
        sku: sku || undefined,
        productType,
        categoryId: category ? Number(category) : null,
        brand: brand || null,
        unit,
        notes: notes || null,
        isActive,
        variants: variants.map((v) => ({
          id: v.id,
          size: v.size || null,
          color: v.color || null,
          barcode: v.barcode || null,
          purchasePrice: v.purchasePrice,
          salePrice: v.salePrice,
          minStock: v.minStock,
          isActive: v.isActive
        }))
      }
      if (productId) await invoke('products:update', { id: productId, data: payload })
      else await invoke('products:create', payload)
      ui.success(productId ? 'تم حفظ التعديلات' : 'تمت إضافة المنتج')
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
      size="xl"
      title={productId ? 'تعديل المنتج' : 'منتج جديد'}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving || loading}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            حفظ
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-10"><Spinner className="h-7 w-7" /></div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="اسم المنتج" required className="sm:col-span-2">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: تيشيرت قطن رجالي" />
            </Field>
            <Field label="الكود" hint="يُولَّد تلقائيًا">
              <Input dir="ltr" className="text-right" value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} />
            </Field>
            <Field label="النوع" required>
              <Select value={productType} onChange={(e) => setProductType(e.target.value as ProductType)}>
                <option value="finished">بضاعة جاهزة</option>
                <option value="raw">خامة (قماش، أزرار، …)</option>
                <option value="service">خدمة (لا تُتابَع مخزنيًا)</option>
              </Select>
            </Field>
            <Field label="التصنيف">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">بدون تصنيف</option>
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="الوحدة" required>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="قطعة / متر / كيلو" />
            </Field>
            <Field label="الماركة" className="sm:col-span-2">
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <Switch checked={isActive} onChange={setIsActive} label="نشط" />
            </div>
          </div>

          {productType !== 'service' && (
            <div className="mt-5 rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50 p-3">
                <Field label="المقاسات" hint="افصل بينها بفاصلة" className="flex-1 min-w-[10rem]">
                  <Input value={sizesText} onChange={(e) => setSizesText(e.target.value)} placeholder="S, M, L, XL, XXL" />
                </Field>
                <Field label="الألوان" hint="افصل بينها بفاصلة" className="flex-1 min-w-[10rem]">
                  <Input value={colorsText} onChange={(e) => setColorsText(e.target.value)} placeholder="أسود، أبيض، أزرق" />
                </Field>
                <button type="button" className="btn-secondary mb-[22px]" onClick={generateMatrix}>
                  توليد التركيبات
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: '110px' }}>المقاس</th>
                      <th style={{ width: '120px' }}>اللون</th>
                      <th style={{ width: '140px' }}>الباركود</th>
                      <th style={{ width: '120px' }}>سعر الشراء</th>
                      <th style={{ width: '120px' }}>سعر البيع</th>
                      <th style={{ width: '110px' }}>حد الطلب</th>
                      {productId && <th className="text-center" style={{ width: '90px' }}>الرصيد</th>}
                      <th style={{ width: '44px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((variant, index) => (
                      <tr key={variant.id ?? index}>
                        <td><Input value={variant.size} onChange={(e) => setVariants(variants.map((v, i) => (i === index ? { ...v, size: e.target.value } : v)))} /></td>
                        <td><Input value={variant.color} onChange={(e) => setVariants(variants.map((v, i) => (i === index ? { ...v, color: e.target.value } : v)))} /></td>
                        <td><Input dir="ltr" className="text-right" value={variant.barcode} onChange={(e) => setVariants(variants.map((v, i) => (i === index ? { ...v, barcode: e.target.value } : v)))} /></td>
                        <td><RateInput value={variant.purchasePrice} onChange={(value) => setVariants(variants.map((v, i) => (i === index ? { ...v, purchasePrice: value } : v)))} /></td>
                        <td><RateInput value={variant.salePrice} onChange={(value) => setVariants(variants.map((v, i) => (i === index ? { ...v, salePrice: value } : v)))} /></td>
                        <td><Input type="number" dir="ltr" className="text-left" value={variant.minStock} onChange={(e) => setVariants(variants.map((v, i) => (i === index ? { ...v, minStock: Number(e.target.value) } : v)))} /></td>
                        {productId && (
                          <td className="text-center">
                            <span className={cn('num text-[13px] font-semibold', (variant.stock ?? 0) <= 0 ? 'text-rose-600' : 'text-slate-700')}>{qty(variant.stock ?? 0)}</span>
                          </td>
                        )}
                        <td>
                          <button
                            type="button"
                            disabled={variants.length === 1}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                            onClick={() => setVariants(variants.filter((_, i) => i !== index))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 border-t border-slate-200 py-2.5 text-[13px] font-semibold text-brand-600 hover:bg-brand-50"
                onClick={() => setVariants([...variants, { size: '', color: '', barcode: '', purchasePrice: 0, salePrice: 0, minStock: 0, isActive: true }])}
              >
                <Plus className="h-4 w-4" />
                إضافة سطر
              </button>
            </div>
          )}

          <Field label="ملاحظات" className="mt-4">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </>
      )}
    </Modal>
  )
}

function CategoriesModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }): React.JSX.Element {
  const ui = useUi()
  const { confirm, dialog } = useConfirm()
  const [name, setName] = useState('')
  const categories = useQuery<{ id: number; name: string; productCount: number }[]>(open ? 'categories:list' : null, undefined, [open])

  const add = async (): Promise<void> => {
    if (!name.trim()) return
    try {
      await invoke('categories:create', { name: name.trim() })
      setName('')
      categories.reload()
      onChanged()
    } catch (error) {
      ui.error('تعذّرت الإضافة', errorMessage(error))
    }
  }

  const remove = async (id: number, label: string): Promise<void> => {
    const answer = await confirm({ title: 'حذف التصنيف', message: `سيُحذف التصنيف «${label}».`, confirmLabel: 'حذف' })
    if (answer === null) return
    try {
      await invoke('categories:delete', { id })
      categories.reload()
      onChanged()
    } catch (error) {
      ui.error('تعذّر الحذف', errorMessage(error))
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="تصنيفات المنتجات" size="sm">
      <div className="mb-4 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم التصنيف الجديد" onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <button type="button" className="btn-primary shrink-0" onClick={() => void add()}>
          <Plus className="h-4 w-4" />
          إضافة
        </button>
      </div>
      {categories.loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : !categories.data?.length ? (
        <p className="py-6 text-center text-sm text-slate-500">لا توجد تصنيفات بعد.</p>
      ) : (
        <ul className="space-y-1.5">
          {categories.data.map((category) => (
            <li key={category.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm font-semibold text-slate-700">{category.name}</span>
              <span className="flex items-center gap-2">
                <span className="num text-[12px] text-slate-500">{category.productCount} منتج</span>
                <button type="button" className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => void remove(category.id, category.name)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </Modal>
  )
}
