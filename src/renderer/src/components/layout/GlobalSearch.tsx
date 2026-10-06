import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Factory, Package, Receipt, ShoppingCart, Store, Truck, Users, Wrench } from 'lucide-react'
import { invoke } from '../../lib/api'
import { useDebounced, useEscapeKey } from '../../lib/hooks'
import { cn, SearchInput, Spinner } from '../ui'
import { date, money } from '../../lib/format'

interface SearchHit {
  kind: string
  id: number
  title: string
  subtitle: string
  route: string
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  customer: Users,
  supplier: Truck,
  factory: Factory,
  product: Package,
  sale: ShoppingCart,
  purchase: Store,
  payment: Receipt,
  production: Wrench
}

const KIND_LABEL: Record<string, string> = {
  customer: 'عميل',
  supplier: 'مورد',
  factory: 'مصنع',
  product: 'منتج',
  sale: 'فاتورة بيع',
  purchase: 'فاتورة شراء',
  payment: 'سند',
  production: 'أمر إنتاج'
}

/** بحث موحّد يغطي العملاء والموردين والمنتجات والفواتير والسندات وأوامر الإنتاج */
export function GlobalSearch({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const debounced = useDebounced(term, 250)
  const navigate = useNavigate()
  useEscapeKey(onClose)

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setHits([])
      return
    }
    setLoading(true)
    void (async () => {
      const results: SearchHit[] = []
      try {
        const [customers, suppliers, factories, products, sales, purchases, payments, production] = await Promise.all([
          invoke<Record<string, unknown>[]>('parties:search', { partyType: 'customer', term: debounced, limit: 5 }).catch(() => []),
          invoke<Record<string, unknown>[]>('parties:search', { partyType: 'supplier', term: debounced, limit: 5 }).catch(() => []),
          invoke<Record<string, unknown>[]>('parties:search', { partyType: 'factory', term: debounced, limit: 3 }).catch(() => []),
          invoke<{ variantId: number; productId: number; name: string; sku: string; stock: number }[]>('products:searchVariants', {
            term: debounced,
            limit: 5
          }).catch(() => []),
          invoke<{ rows: Record<string, unknown>[] }>('sales:list', { search: debounced, pageSize: 5 }).catch(() => ({ rows: [] })),
          invoke<{ rows: Record<string, unknown>[] }>('purchases:list', { search: debounced, pageSize: 5 }).catch(() => ({ rows: [] })),
          invoke<{ rows: Record<string, unknown>[] }>('payments:list', { search: debounced, pageSize: 5 }).catch(() => ({ rows: [] })),
          invoke<{ rows: Record<string, unknown>[] }>('production:list', { search: debounced, pageSize: 5 }).catch(() => ({ rows: [] }))
        ])

        for (const row of customers) results.push({ kind: 'customer', id: Number(row.id), title: String(row.name), subtitle: `${row.code}${row.phone ? ` · ${row.phone}` : ''}`, route: `/customers/${row.id}` })
        for (const row of suppliers) results.push({ kind: 'supplier', id: Number(row.id), title: String(row.name), subtitle: `${row.code}${row.phone ? ` · ${row.phone}` : ''}`, route: `/suppliers/${row.id}` })
        for (const row of factories) results.push({ kind: 'factory', id: Number(row.id), title: String(row.name), subtitle: String(row.code), route: `/factories/${row.id}` })
        for (const row of products) results.push({ kind: 'product', id: row.productId, title: row.name, subtitle: `${row.sku} · الرصيد ${row.stock}`, route: `/products/${row.productId}` })
        for (const row of sales.rows) results.push({ kind: 'sale', id: Number(row.id), title: String(row.invoice_number), subtitle: `${row.customer_name} · ${money(Number(row.total))} · ${date(String(row.date))}`, route: `/sales/${row.id}` })
        for (const row of purchases.rows) results.push({ kind: 'purchase', id: Number(row.id), title: String(row.invoice_number), subtitle: `${row.supplier_name} · ${money(Number(row.total))}`, route: `/purchases/${row.id}` })
        for (const row of payments.rows) results.push({ kind: 'payment', id: Number(row.id), title: String(row.payment_number), subtitle: `${row.party_name ?? ''} · ${money(Number(row.amount))}`, route: `/payments/${row.id}` })
        for (const row of production.rows) results.push({ kind: 'production', id: Number(row.id), title: String(row.order_number), subtitle: `${row.factory_name} · ${row.product_name}`, route: `/production/${row.id}` })
      } finally {
        setHits(results)
        setHighlight(0)
        setLoading(false)
      }
    })()
  }, [debounced])

  const go = (hit: SearchHit): void => {
    navigate(hit.route)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 p-4 pt-24 backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 p-3">
          <SearchInput
            autoFocus
            value={term}
            onChange={setTerm}
            placeholder="ابحث عن عميل أو مورد أو منتج أو فاتورة أو سند…"
          />
        </div>
        <div className="max-h-[26rem] overflow-y-auto">
          {loading && (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          )}
          {!loading && term.trim().length < 2 && (
            <p className="px-4 py-10 text-center text-sm text-slate-500">اكتب حرفين على الأقل لبدء البحث.</p>
          )}
          {!loading && term.trim().length >= 2 && !hits.length && (
            <p className="px-4 py-10 text-center text-sm text-slate-500">لا توجد نتائج مطابقة.</p>
          )}
          {hits.map((hit, index) => {
            const Icon = ICONS[hit.kind] ?? Package
            return (
              <button
                key={`${hit.kind}-${hit.id}`}
                type="button"
                onMouseEnter={() => setHighlight(index)}
                onClick={() => go(hit)}
                className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-right', index === highlight ? 'bg-brand-50' : 'hover:bg-slate-50')}
              >
                <span className="rounded-lg bg-slate-100 p-2 text-slate-500">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">{hit.title}</span>
                  <span className="block truncate text-[12px] text-slate-500">{hit.subtitle}</span>
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                  {KIND_LABEL[hit.kind]}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
