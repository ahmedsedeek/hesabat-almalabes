import React, { useEffect, useState } from 'react'
import { ArrowLeftRight, Ban, Banknote, Landmark, Plus, Wallet } from 'lucide-react'
import { PERMISSIONS } from '@shared/permissions'
import { invoke, errorMessage } from '../../lib/api'
import { useQuery } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Badge, Card, DataTable, EmptyState, Field, Input, Modal, MoneyInput, Select, Spinner, StatCard, Tabs, Textarea, cn, useConfirm } from '../../components/ui'
import { DateRangePicker, ExportButtons, PageHeader } from '../../components/common/page'
import { date, money, monthStart, today } from '../../lib/format'

export function TreasuryPage(): React.JSX.Element {
  const { can } = useSession()
  const ui = useUi()
  const { confirm, dialog } = useConfirm()
  const [tab, setTab] = useState('transactions')
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [accountId, setAccountId] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  const accounts = useQuery<{ accountId: number; code: string; name: string; subtype: string; balance: number }[]>('accounts:cash')
  const transactions = useQuery<Record<string, unknown>[]>(
    tab === 'transactions' ? 'cash:list' : null,
    { from: range.from, to: range.to, accountId: accountId ? Number(accountId) : undefined },
    [tab, range.from, range.to, accountId]
  )
  const ledger = useQuery<{ opening: number; lines: Record<string, unknown>[]; closing: number }>(
    tab === 'ledger' && accountId ? 'accounts:ledger' : null,
    { accountId: Number(accountId), from: range.from, to: range.to },
    [tab, accountId, range.from, range.to]
  )
  const cashFlow = useQuery<{
    opening: number
    inflows: { label: string; amount: number }[]
    outflows: { label: string; amount: number }[]
    totalIn: number
    totalOut: number
    closing: number
    daily: { date: string; inflow: number; outflow: number; net: number }[]
  }>(tab === 'flow' ? 'reports:cashFlow' : null, { from: range.from, to: range.to }, [tab, range.from, range.to])

  useEffect(() => {
    if (!accountId && accounts.data?.length) setAccountId(String(accounts.data[0].accountId))
  }, [accounts.data, accountId])

  const totalCash = (accounts.data ?? []).filter((a) => a.subtype === 'cash').reduce((s, a) => s + a.balance, 0)
  const totalBank = (accounts.data ?? []).filter((a) => a.subtype === 'bank').reduce((s, a) => s + a.balance, 0)

  const voidTrx = async (id: number, number: string): Promise<void> => {
    const reason = await confirm({ title: 'إلغاء حركة الخزينة', message: `سيُعكس قيد الحركة ${number}.`, confirmLabel: 'إلغاء', requireReason: true })
    if (reason === null) return
    try {
      await invoke('cash:void', { id, reason })
      ui.success('تم إلغاء الحركة')
      transactions.reload()
      accounts.reload()
    } catch (error) {
      ui.error('تعذّر الإلغاء', errorMessage(error))
    }
  }

  return (
    <div>
      <PageHeader
        title="الخزينة والبنوك"
        subtitle="أرصدة النقدية والحسابات البنكية وحركاتها"
        actions={
          can(PERMISSIONS.PAYMENTS_CREATE) ? (
            <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />
              حركة خزينة
            </button>
          ) : undefined
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="إجمالي النقدية" value={money(totalCash)} icon={<Wallet className="h-5 w-5" />} tone={totalCash >= 0 ? 'positive' : 'negative'} />
        <StatCard label="إجمالي البنوك" value={money(totalBank)} icon={<Landmark className="h-5 w-5" />} tone={totalBank >= 0 ? 'positive' : 'negative'} />
        <StatCard label="الإجمالي المتاح" value={money(totalCash + totalBank)} icon={<Banknote className="h-5 w-5" />} tone="brand" />
        <StatCard label="عدد الحسابات" value={accounts.data?.length ?? 0} />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(accounts.data ?? []).map((account) => (
          <div key={account.accountId} className="card p-4">
            <div className="mb-1 flex items-center gap-2">
              {account.subtype === 'bank' ? <Landmark className="h-4 w-4 text-slate-400" /> : <Wallet className="h-4 w-4 text-slate-400" />}
              <span className="text-[13px] font-semibold text-slate-600">{account.name}</span>
            </div>
            <p className={cn('num text-xl font-bold', account.balance >= 0 ? 'text-slate-800' : 'text-rose-700')}>{money(account.balance)}</p>
            <p className="num mt-0.5 text-[11.5px] text-slate-400">{account.code}</p>
          </div>
        ))}
      </div>

      <Card noPadding>
        <div className="px-3 pt-1">
          <Tabs
            tabs={[
              { key: 'transactions', label: 'حركات الخزينة' },
              { key: 'ledger', label: 'كشف حساب' },
              { key: 'flow', label: 'التدفق النقدي' }
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <DateRangePicker value={range} onChange={setRange} />
          {(tab === 'transactions' || tab === 'ledger') && (
            <Select className="h-10 w-52" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {tab === 'transactions' && <option value="">كل الحسابات</option>}
              {(accounts.data ?? []).map((a) => (
                <option key={a.accountId} value={String(a.accountId)}>{a.name}</option>
              ))}
            </Select>
          )}
          {tab === 'ledger' && ledger.data && (
            <ExportButtons
              title="كشف حساب نقدي"
              subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
              meta={[
                { label: 'الرصيد الافتتاحي', value: money(ledger.data.opening) },
                { label: 'الرصيد الختامي', value: money(ledger.data.closing) }
              ]}
              columns={[
                { key: 'date', label: 'التاريخ', type: 'date' },
                { key: 'refNumber', label: 'المستند' },
                { key: 'description', label: 'البيان' },
                { key: 'debit', label: 'وارد', type: 'money' },
                { key: 'credit', label: 'صادر', type: 'money' },
                { key: 'balance', label: 'الرصيد', type: 'money' }
              ]}
              rows={ledger.data.lines}
            />
          )}
        </div>

        {tab === 'transactions' && (
          <DataTable
            rows={transactions.data ?? []}
            loading={transactions.loading}
            error={transactions.error}
            rowKey={(row) => String(row.id)}
            empty={<EmptyState title="لا توجد حركات خزينة" description="سجّل إيداعًا أو سحبًا أو تحويلًا بين حساباتك." />}
            columns={[
              { key: 'number', header: 'رقم الحركة', render: (row) => <span className="num font-semibold text-brand-700">{String(row.trx_number)}</span> },
              { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
              {
                key: 'type',
                header: 'النوع',
                align: 'center',
                render: (row) => (
                  <Badge tone={row.trx_type === 'deposit' ? 'green' : row.trx_type === 'withdraw' ? 'red' : 'blue'}>
                    {({ deposit: 'إيداع', withdraw: 'سحب', transfer: 'تحويل' } as Record<string, string>)[String(row.trx_type)]}
                  </Badge>
                )
              },
              { key: 'from', header: 'من', render: (row) => String(row.from_account_name ?? '—') },
              { key: 'to', header: 'إلى', render: (row) => String(row.to_account_name ?? '—') },
              { key: 'desc', header: 'البيان', render: (row) => <span className="text-[13px]">{String(row.description ?? '—')}</span> },
              { key: 'amount', header: 'المبلغ', align: 'left', render: (row) => <span className={cn('num font-bold', row.status === 'void' && 'text-slate-400 line-through')}>{money(Number(row.amount))}</span> },
              {
                key: 'actions',
                header: '',
                align: 'center',
                width: '60px',
                render: (row) =>
                  row.status === 'void' ? (
                    <Badge tone="slate">ملغاة</Badge>
                  ) : can(PERMISSIONS.PAYMENTS_VOID) ? (
                    <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => void voidTrx(Number(row.id), String(row.trx_number))}>
                      <Ban className="h-4 w-4" />
                    </button>
                  ) : null
              }
            ]}
          />
        )}

        {tab === 'ledger' && (
          <>
            {ledger.data && (
              <div className="grid gap-3 p-3 sm:grid-cols-3">
                <StatCard label="الرصيد الافتتاحي" value={money(ledger.data.opening)} />
                <StatCard label="صافي الحركة" value={money(ledger.data.closing - ledger.data.opening)} tone={ledger.data.closing - ledger.data.opening >= 0 ? 'positive' : 'negative'} />
                <StatCard label="الرصيد الختامي" value={money(ledger.data.closing)} tone="brand" />
              </div>
            )}
            <DataTable
              rows={ledger.data?.lines ?? []}
              loading={ledger.loading}
              error={ledger.error}
              rowKey={(_, index) => index}
              empty={<EmptyState title="لا توجد حركات على هذا الحساب في الفترة المحددة" />}
              columns={[
                { key: 'date', header: 'التاريخ', render: (row) => <span className="num">{date(String(row.date))}</span> },
                { key: 'ref', header: 'المستند', render: (row) => <span className="num text-[12.5px] font-semibold text-brand-700">{String(row.refNumber ?? row.entryNumber)}</span> },
                { key: 'desc', header: 'البيان', render: (row) => <span className="text-[13px]">{String(row.description ?? '—')}</span> },
                { key: 'in', header: 'وارد', align: 'left', render: (row) => (Number(row.debit) ? <span className="num font-semibold text-emerald-700">{money(Number(row.debit), false)}</span> : <span className="text-slate-300">—</span>) },
                { key: 'out', header: 'صادر', align: 'left', render: (row) => (Number(row.credit) ? <span className="num font-semibold text-rose-700">{money(Number(row.credit), false)}</span> : <span className="text-slate-300">—</span>) },
                { key: 'balance', header: 'الرصيد', align: 'left', render: (row) => <span className="num font-bold">{money(Number(row.balance), false)}</span> }
              ]}
            />
          </>
        )}

        {tab === 'flow' && (
          <div className="p-4">
            {cashFlow.loading ? (
              <div className="flex justify-center py-10"><Spinner className="h-7 w-7" /></div>
            ) : !cashFlow.data ? (
              <EmptyState title="لا توجد بيانات" />
            ) : (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-4">
                  <StatCard label="الرصيد الافتتاحي" value={money(cashFlow.data.opening)} />
                  <StatCard label="إجمالي الوارد" value={money(cashFlow.data.totalIn)} tone="positive" />
                  <StatCard label="إجمالي الصادر" value={money(cashFlow.data.totalOut)} tone="negative" />
                  <StatCard label="الرصيد الختامي" value={money(cashFlow.data.closing)} tone="brand" />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title="مصادر الوارد">
                    {cashFlow.data.inflows.length ? (
                      <ul className="space-y-2">
                        {cashFlow.data.inflows.map((row) => (
                          <li key={row.label} className="flex items-center justify-between border-b border-slate-100 pb-2 text-[13px] last:border-0">
                            <span className="text-slate-600">{row.label}</span>
                            <span className="num font-bold text-emerald-700">{money(row.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="py-4 text-center text-sm text-slate-500">لا يوجد وارد</p>
                    )}
                  </Card>

                  <Card title="أوجه الصادر">
                    {cashFlow.data.outflows.length ? (
                      <ul className="space-y-2">
                        {cashFlow.data.outflows.map((row) => (
                          <li key={row.label} className="flex items-center justify-between border-b border-slate-100 pb-2 text-[13px] last:border-0">
                            <span className="text-slate-600">{row.label}</span>
                            <span className="num font-bold text-rose-700">{money(row.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="py-4 text-center text-sm text-slate-500">لا يوجد صادر</p>
                    )}
                  </Card>
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      <CashTransactionModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        accounts={accounts.data ?? []}
        onSaved={() => {
          accounts.reload()
          transactions.reload()
        }}
      />

      {dialog}
    </div>
  )
}

function CashTransactionModal({
  open,
  onClose,
  accounts,
  onSaved
}: {
  open: boolean
  onClose: () => void
  accounts: { accountId: number; name: string; balance: number }[]
  onSaved: () => void
}): React.JSX.Element {
  const ui = useUi()
  const [trxType, setTrxType] = useState<'deposit' | 'withdraw' | 'transfer'>('deposit')
  const [trxDate, setTrxDate] = useState(today())
  const [amount, setAmount] = useState(0)
  const [fromId, setFromId] = useState<number | null>(null)
  const [toId, setToId] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTrxType('deposit')
    setTrxDate(today())
    setAmount(0)
    setDescription('')
    setError(null)
    if (accounts.length) {
      setToId(accounts[0].accountId)
      setFromId(accounts[0].accountId)
    }
  }, [open, accounts])

  const save = async (): Promise<void> => {
    if (amount <= 0) return setError('أدخل مبلغًا أكبر من صفر.')
    setSaving(true)
    setError(null)
    try {
      await invoke('cash:create', {
        date: trxDate,
        trxType,
        amount,
        description: description || null,
        fromAccountId: trxType === 'deposit' ? null : fromId,
        toAccountId: trxType === 'withdraw' ? null : toId
      })
      ui.success('تم تسجيل الحركة')
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
      title="حركة خزينة"
      description="إيداع رأس مال أو سحب شخصي أو تحويل بين الصندوق والبنك"
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
        <Field label="نوع الحركة" required>
          <Select value={trxType} onChange={(e) => setTrxType(e.target.value as 'deposit')}>
            <option value="deposit">إيداع (زيادة رأس المال)</option>
            <option value="withdraw">سحب (مسحوبات شخصية)</option>
            <option value="transfer">تحويل بين الحسابات</option>
          </Select>
        </Field>
        <Field label="التاريخ" required>
          <Input type="date" value={trxDate} onChange={(e) => setTrxDate(e.target.value)} />
        </Field>

        {trxType !== 'deposit' && (
          <Field label="من حساب" required>
            <Select value={fromId ?? ''} onChange={(e) => setFromId(Number(e.target.value))}>
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>{a.name} — {money(a.balance)}</option>
              ))}
            </Select>
          </Field>
        )}
        {trxType !== 'withdraw' && (
          <Field label="إلى حساب" required>
            <Select value={toId ?? ''} onChange={(e) => setToId(Number(e.target.value))}>
              {accounts.filter((a) => trxType !== 'transfer' || a.accountId !== fromId).map((a) => (
                <option key={a.accountId} value={a.accountId}>{a.name} — {money(a.balance)}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="المبلغ" required>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="البيان" className="sm:col-span-2">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

export { ArrowLeftRight }
