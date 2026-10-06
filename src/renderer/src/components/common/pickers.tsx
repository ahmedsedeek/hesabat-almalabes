import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Search, X } from 'lucide-react'
import type { PartyRecord, PartyType, ProductType } from '@shared/types'
import { invoke } from '../../lib/api'
import { useDebounced } from '../../lib/hooks'
import { cn, Input, Spinner } from '../ui'
import { money, qty, rate } from '../../lib/format'

const PARTY_LABEL: Record<PartyType, string> = { customer: 'عميل', supplier: 'مورد', factory: 'مصنع' }

/** اختيار عميل أو مورد أو مصنع مع بحث فوري */
export function PartyPicker({
  partyType,
  value,
  onChange,
  onCreateNew,
  disabled,
  invalid,
  placeholder
}: {
  partyType: PartyType
  value: number | null
  onChange: (id: number | null, party: PartyRecord | null) => void
  onCreateNew?: () => void
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [selected, setSelected] = useState<PartyRecord | null>(null)
  const [results, setResults] = useState<PartyRecord[]>([])
  const [loading, setLoading] = useState(false)
  const debounced = useDebounced(term, 220)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!value) {
      setSelected(null)
      return
    }
    if (selected?.id === value) return
    invoke<PartyRecord>('parties:get', { id: value }).then(setSelected).catch(() => setSelected(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    invoke<PartyRecord[]>('parties:search', { partyType, term: debounced, limit: 30 })
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [debounced, open, partyType])

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'input flex items-center justify-between text-right',
          invalid && 'input-error',
          disabled && 'cursor-not-allowed bg-slate-50'
        )}
      >
        <span className={cn('truncate', !selected && 'text-slate-400')}>
          {selected ? `${selected.name} — ${selected.code}` : placeholder ?? `اختر ${PARTY_LABEL[partyType]}…`}
        </span>
        <span className="flex items-center gap-1">
          {selected && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onChange(null, null)
                setSelected(null)
              }}
              onKeyDown={() => undefined}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="relative border-b border-slate-100 p-2">
            <Search className="pointer-events-none absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input autoFocus className="h-9 pr-9" placeholder="ابحث بالاسم أو الكود أو الهاتف…" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading && (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            )}
            {!loading && results.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">لا توجد نتائج مطابقة.</p>}
            {results.map((party) => (
              <button
                key={party.id}
                type="button"
                onClick={() => {
                  onChange(party.id, party)
                  setSelected(party)
                  setOpen(false)
                  setTerm('')
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-right hover:bg-brand-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-800">{party.name}</span>
                  <span className="block truncate text-[12px] text-slate-500">
                    {party.code}
                    {party.phone ? ` · ${party.phone}` : ''}
                    {party.companyName ? ` · ${party.companyName}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {onCreateNew && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onCreateNew()
              }}
              className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50"
            >
              <Plus className="h-4 w-4" />
              إضافة {PARTY_LABEL[partyType]} جديد
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export interface VariantOption {
  variantId: number
  productId: number
  sku: string
  name: string
  size: string | null
  color: string | null
  unit: string
  salePrice: number
  purchasePrice: number
  avgCost: number
  stock: number
}

export function variantLabel(option: { name: string; size?: string | null; color?: string | null }): string {
  const attrs = [option.size, option.color].filter(Boolean).join(' / ')
  return attrs ? `${option.name} (${attrs})` : option.name
}

/** بحث سريع عن صنف لإضافته إلى فاتورة — يعرض الرصيد والسعر لتفادي الأخطاء */
export function ProductSearch({
  warehouseId,
  productType,
  onPick,
  placeholder = 'ابحث عن صنف بالاسم أو الكود أو الباركود…',
  priceField = 'salePrice',
  autoFocus
}: {
  warehouseId?: number
  productType?: ProductType
  onPick: (option: VariantOption) => void
  placeholder?: string
  priceField?: 'salePrice' | 'purchasePrice'
  autoFocus?: boolean
}): React.JSX.Element {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<VariantOption[]>([])
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const debounced = useDebounced(term, 200)

  useEffect(() => {
    if (debounced.trim().length < 1) {
      setResults([])
      return
    }
    setLoading(true)
    invoke<VariantOption[]>('products:searchVariants', { term: debounced, warehouseId, productType, limit: 20 })
      .then((rows) => {
        setResults(rows)
        setHighlight(0)
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [debounced, warehouseId, productType])

  const pick = (option: VariantOption): void => {
    onPick(option)
    setTerm('')
    setResults([])
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        className="pr-9"
        autoFocus={autoFocus}
        value={term}
        placeholder={placeholder}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (!results.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(results[highlight])
          } else if (e.key === 'Escape') {
            setResults([])
          }
        }}
      />
      {loading && <Spinner className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />}

      {results.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
          {results.map((option, index) => (
            <button
              key={option.variantId}
              type="button"
              onMouseEnter={() => setHighlight(index)}
              onClick={() => pick(option)}
              className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-right', index === highlight ? 'bg-brand-50' : 'hover:bg-slate-50')}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">{variantLabel(option)}</span>
                <span className="block truncate text-[12px] text-slate-500">{option.sku}</span>
              </span>
              <span className="shrink-0 text-left">
                <span className="block text-[13px] font-semibold text-slate-700">{rate(option[priceField])}</span>
                <span className={cn('block text-[12px]', option.stock > 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  الرصيد: <span className="num">{qty(option.stock)}</span> {option.unit}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** عرض سريع لمبلغ مع تسمية — يُستخدم في ملخصات الفواتير */
export function SummaryRow({
  label,
  value,
  strong,
  tone
}: {
  label: string
  value: number
  strong?: boolean
  tone?: 'positive' | 'negative'
}): React.JSX.Element {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-1.5', strong && 'border-t border-slate-200 pt-2.5')}>
      <span className={cn('text-[13px]', strong ? 'font-bold text-slate-700' : 'text-slate-500')}>{label}</span>
      <span
        className={cn(
          'num text-sm font-semibold',
          strong && 'text-[17px] font-bold text-brand-700',
          tone === 'positive' && 'text-emerald-700',
          tone === 'negative' && 'text-rose-700'
        )}
      >
        {money(value)}
      </span>
    </div>
  )
}
