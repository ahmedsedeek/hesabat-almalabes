import React, { useEffect, useState } from 'react'
import { Ban, FolderTree, Plus, Receipt, Trash2 } from 'lucide-react'
import { PERMISSIONS } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useDebounced, useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Field, Input, Modal, MoneyInput, Pagination, SearchInput, Select, Spinner, StatCard, Switch, Textarea, cn, useConfirm } from '../../components/ui'
import { DateRangePicker, ExportButtons, PageHeader } from '../../components/common/page'
import { PartyPicker } from '../../components/common/pickers'
import { date, money, monthStart, today } from '../../lib/format'

export function ExpensesPage(): React.JSX.Element {
  const { can } = useSession()
  const ui = useUi()
  const { confirm, dialog } = useConfirm()
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const debounced = useDebounced(search, 300)
  const pageSize = 50

  const categories = useQuery<Record<string, unknown>[]>('expenses:categories', { activeOnly: true })
  const expenses = useQuery<{ rows: Record<string, unknown>[]; total: number; summary: Record<string, number> }>(
    'expenses:list',
    { from: range.from, to: range.to, search: debounced || undefined, categoryId: categoryId ? Number(categoryId) : undefined, page, pageSize },
    [range.from, range.to, debounced, categoryId, page]
  )
  const byCategory = useQuery<{ categoryId: number; name: string; total: number; count: number }[]>(
    'expenses:byCategory',
    { from: range.from, to: range.to },
    [range.from, range.to]
  )

  const summary = expenses.data?.summary ?? { total: 0, count: 0 }
  const maxCategory = Math.max(...(byCategory.data ?? []).map((c) => c.total), 1)

  const voidExpense = async (expenseId: number, label: string): Promise<void> => {
    const reason = await confirm({
      title: 'إلغاء المصروف',
      message: `سيُعكس القيد المحاسبي للمصروف ${label} ويعود المبلغ إلى الحساب النقدي.`,
      confirmLabel: 'إلغاء المصروف',
      requireReason: true
    })
    if (reason === null) return
    try {
      await invoke('expenses:void', { id: expenseId, reason })
      ui.success('تم إلغاء المصروف')
      expenses.reload()
      byCategory.reload()
    } catch (error) {
      ui.error('تعذّر الإلغاء', errorMessage(error))
    }
  }

  return (
    <div>
      <PageHeader
        title="المصروفات"
        subtitle="المصروفات التشغيلية وتوزيعها على الفئات"
        actions={
          <>
            <ExportButtons
              title="تقرير المصروفات"
              subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
              columns={[
                { key: 'expense_number', label: 'رقم المصروف' },
                { key: 'date', label: 'التاريخ', type: 'date' },
                { key: 'category_name', label: 'الفئة' },
                { key: 'description', label: 'البيان' },
                { key: 'payment_account_name', label: 'طريقة الدفع' },
                { key: 'total', label: 'المبلغ', type: 'money' }
              ]}
              rows={expenses.data?.rows ?? []}
              totals={{ total: summary.total }}
              disabled={!expenses.data?.rows.length}
            />
            {can(PERMISSIONS.EXPENSES_MANAGE) && (
              <>
                <button type="button" className="btn-secondary" onClick={() => setCategoriesOpen(true)}>
                  <FolderTree className="h-4 w-4" />
                  الفئات
                </button>
                <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4" />
                  تسجيل مصروف
                </button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-[20rem,1fr]">
        <div className="space-y-3">
          <StatCard label="إجمالي المصروفات" value={money(summary.total)} tone="warning" icon={<Receipt className="h-5 w-5" />} />
          <StatCard label="عدد المصروفات" value={summary.count ?? 0} />
        </div>

        <Card title="المصروفات حسب الفئة">
          {byCategory.loading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : !byCategory.data?.length ? (
            <p className="py-6 text-center text-sm text-slate-500">لا توجد مصروفات في هذه الفترة.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {byCategory.data.map((category) => (
                <li key={category.categoryId}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-[13px]">
                    <span className="truncate font-semibold text-slate-700">{category.name}</span>
                    <span className="num shrink-0 font-bold text-slate-800">{money(category.total)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${(category.total / maxCategory) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card noPadding>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <DateRangePicker value={range} onChange={(value) => { setRange(value); setPage(1) }} />
          <SearchInput className="w-full max-w-xs" value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="رقم المصروف أو البيان…" />
          <Select className="h-10 w-48" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1) }}>
            <option value="">كل الفئات</option>
            {(categories.data ?? []).map((c) => (
              <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>
            ))}
          </Select>
        </div>

        <DataTable
          rows={expenses.data?.rows ?? []}
          loading={expenses.loading}
          error={expenses.error}
          onRetry={expenses.reload}
          rowKey={(row) => String(row.id)}
          empty={
            <EmptyState
              icon={<Receipt className="h-7 w-7" />}
              title="لا توجد مصروفات في هذه الفترة"
              action={
                can(PERMISSIONS.EXPENSES_MANAGE) ? (
                  <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
                    <Plus className="h-4 w-4" />
                    تسجيل مصروف
                  </button>
                ) : undefined
              }
            />
          }
          columns={[
            { key: 'number', header: 'الرقم', render: (row) => <span className="num font-semibold text-brand-700">{String(row.expense_number)}</span> },
            { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
            { key: 'category', header: 'الفئة', render: (row) => <Badge tone="amber">{String(row.category_name)}</Badge> },
            { key: 'desc', header: 'البيان', render: (row) => <span className="text-[13px]">{String(row.description ?? '—')}</span> },
            {
              key: 'payment',
              header: 'طريقة الدفع',
              render: (row) => (row.payment_account_name ? <span className="text-[12.5px] text-slate-600">{String(row.payment_account_name)}</span> : <Badge tone="slate">آجل على {String(row.party_name ?? 'طرف')}</Badge>)
            },
            {
              key: 'amount',
              header: 'المبلغ',
              align: 'left',
              render: (row) => <span className={cn('num font-bold', row.status === 'void' ? 'text-slate-400 line-through' : 'text-rose-700')}>{money(Number(row.total))}</span>
            },
            {
              key: 'actions',
              header: '',
              align: 'center',
              width: '60px',
              render: (row) =>
                row.status === 'void' ? (
                  <Badge tone="slate">ملغى</Badge>
                ) : can(PERMISSIONS.EXPENSES_MANAGE) ? (
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    onClick={(e) => {
                      e.stopPropagation()
                      void voidExpense(Number(row.id), String(row.expense_number))
                    }}
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                ) : null
            }
          ]}
        />
        <div className="px-3">
          <Pagination page={page} pageSize={pageSize} total={expenses.data?.total ?? 0} onChange={setPage} />
        </div>
      </Card>

      <ExpenseFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        categories={categories.data ?? []}
        onSaved={() => {
          expenses.reload()
          byCategory.reload()
        }}
      />

      <ExpenseCategoriesModal open={categoriesOpen} onClose={() => setCategoriesOpen(false)} onChanged={() => categories.reload()} />

      {dialog}
    </div>
  )
}

function ExpenseFormModal({
  open,
  onClose,
  categories,
  onSaved
}: {
  open: boolean
  onClose: () => void
  categories: Record<string, unknown>[]
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const { settings } = useSession()
  const accounts = useQuery<{ accountId: number; name: string; balance: number }[]>(open ? 'accounts:cash' : null, undefined, [open])
  const [expenseDate, setExpenseDate] = useState(today())
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [amount, setAmount] = useState(0)
  const [taxAmount, setTaxAmount] = useState(0)
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [onCredit, setOnCredit] = useState(false)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [partyId, setPartyId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setExpenseDate(today())
    setAmount(0)
    setTaxAmount(0)
    setDescription('')
    setNotes('')
    setOnCredit(false)
    setPartyId(null)
    setError(null)
    if (categories.length) setCategoryId(Number(categories[0].id))
  }, [open, categories])

  useEffect(() => {
    if (!accountId && accounts.data?.length) setAccountId(accounts.data[0].accountId)
  }, [accounts.data, accountId])

  const save = async (): Promise<void> => {
    if (!categoryId) return setError('اختر فئة المصروف.')
    if (amount <= 0) return setError('أدخل مبلغًا أكبر من صفر.')
    if (onCredit && !partyId) return setError('حدّد الطرف المستحق عليه المصروف.')
    setSaving(true)
    setError(null)
    try {
      await invoke('expenses:create', {
        date: expenseDate,
        categoryId,
        amount,
        taxAmount,
        description: description || null,
        notes: notes || null,
        paymentAccountId: onCredit ? null : accountId,
        partyId: onCredit ? partyId : null
      })
      ui.success('تم تسجيل المصروف')
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
      title="تسجيل مصروف"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            حفظ
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="الفئة" required>
          <Select value={categoryId ?? ''} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {categories.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>
            ))}
          </Select>
        </Field>
        <Field label="التاريخ" required>
          <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
        </Field>
        <Field label="المبلغ" required>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        {settings?.tax.enabled && (
          <Field label={settings.tax.label}>
            <MoneyInput value={taxAmount} onChange={setTaxAmount} />
          </Field>
        )}
        <Field label="البيان" className="sm:col-span-2">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثال: إيجار شهر مارس" />
        </Field>

        <div className="sm:col-span-2 rounded-xl border border-slate-200 p-3">
          <Switch checked={onCredit} onChange={setOnCredit} label="مصروف آجل على طرف" description="اترك الخيار مغلقًا إذا دُفع المصروف نقدًا أو من البنك." />
          {onCredit ? (
            <Field label="الطرف المستحق" className="mt-3" required>
              <PartyPicker partyType="supplier" value={partyId} onChange={(id) => setPartyId(id)} />
            </Field>
          ) : (
            <Field label="الدفع من حساب" className="mt-3" required>
              <Select value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
                {(accounts.data ?? []).map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.name} — الرصيد {money(a.balance)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <Field label="ملاحظات" className="sm:col-span-2">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      {amount > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
          <span className="text-[13px] font-bold text-slate-700">الإجمالي</span>
          <span className="num text-lg font-bold text-rose-700">{money(amount + taxAmount)}</span>
        </div>
      )}
    </Modal>
  )
}

function ExpenseCategoriesModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }): React.JSX.Element {
  const ui = useUi()
  const { confirm, dialog } = useConfirm()
  const [name, setName] = useState('')
  const categories = useQuery<Record<string, unknown>[]>(open ? 'expenses:categories' : null, undefined, [open])

  const add = async (): Promise<void> => {
    if (!name.trim()) return
    try {
      await invoke('expenses:createCategory', { name: name.trim() })
      setName('')
      categories.reload()
      onChanged()
    } catch (error) {
      ui.error('تعذّرت الإضافة', errorMessage(error))
    }
  }

  const remove = async (id: number, label: string): Promise<void> => {
    const answer = await confirm({ title: 'حذف الفئة', message: `سيُحذف «${label}». لا يمكن حذف فئة مستخدمة في مصروفات.`, confirmLabel: 'حذف' })
    if (answer === null) return
    try {
      await invoke('expenses:deleteCategory', { id })
      categories.reload()
      onChanged()
    } catch (error) {
      ui.error('تعذّر الحذف', errorMessage(error))
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="فئات المصروفات" size="sm" description="كل فئة مرتبطة بحساب في شجرة الحسابات">
      <div className="mb-4 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الفئة الجديدة" onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <button type="button" className="btn-primary shrink-0" onClick={() => void add()}>
          <Plus className="h-4 w-4" />
          إضافة
        </button>
      </div>
      {categories.loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto">
          {(categories.data ?? []).map((category) => (
            <li key={String(category.id)} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <span>
                <span className="block text-sm font-semibold text-slate-700">{String(category.name)}</span>
                <span className="num block text-[11.5px] text-slate-500">{String(category.account_code)} — {String(category.account_name)}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="num text-[12px] text-slate-500">{String(category.usage_count)} مصروف</span>
                <button type="button" className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => void remove(Number(category.id), String(category.name))}>
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
