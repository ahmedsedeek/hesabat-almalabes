import React, { useEffect, useState } from 'react'
import { Building2, ScrollText } from 'lucide-react'
import { useQuery } from '../../lib/hooks'
import { Badge, Card, DataTable, EmptyState, Select, StatCard, Tabs, cn } from '../../components/ui'
import { DateRangePicker, ExportButtons, PageHeader } from '../../components/common/page'
import { date, money, monthStart, today } from '../../lib/format'

const TYPE_LABEL: Record<string, string> = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات'
}

const TYPE_TONE: Record<string, 'blue' | 'red' | 'violet' | 'green' | 'amber'> = {
  asset: 'blue',
  liability: 'red',
  equity: 'violet',
  revenue: 'green',
  expense: 'amber'
}

export function AccountingPage(): React.JSX.Element {
  const [tab, setTab] = useState('chart')
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [accountId, setAccountId] = useState('')

  const accounts = useQuery<Record<string, unknown>[]>('accounts:list', {})
  const ledger = useQuery<{ opening: number; lines: Record<string, unknown>[]; closing: number }>(
    tab === 'ledger' && accountId ? 'accounts:ledger' : null,
    { accountId: Number(accountId), from: range.from, to: range.to },
    [tab, accountId, range.from, range.to]
  )

  useEffect(() => {
    if (!accountId && accounts.data?.length) {
      const first = accounts.data.find((a) => a.is_group === 0)
      if (first) setAccountId(String(first.id))
    }
  }, [accounts.data, accountId])

  return (
    <div>
      <PageHeader title="الحسابات والقيود" subtitle="شجرة الحسابات وحركة كل حساب — مصدر كل الأرقام المالية في النظام" />

      <Card noPadding>
        <div className="px-3 pt-1">
          <Tabs
            tabs={[
              { key: 'chart', label: 'شجرة الحسابات', icon: <Building2 className="h-4 w-4" /> },
              { key: 'ledger', label: 'حركة حساب', icon: <ScrollText className="h-4 w-4" /> }
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'chart' && (
          <>
            <div className="flex justify-end border-b border-slate-200 p-3">
              <ExportButtons
                title="شجرة الحسابات"
                columns={[
                  { key: 'code', label: 'رقم الحساب' },
                  { key: 'name', label: 'اسم الحساب' },
                  { key: 'type_label', label: 'النوع' }
                ]}
                rows={(accounts.data ?? []).map((a) => ({ ...a, type_label: TYPE_LABEL[String(a.type)] }))}
                disabled={!accounts.data?.length}
              />
            </div>
            <DataTable
              rows={accounts.data ?? []}
              loading={accounts.loading}
              error={accounts.error}
              rowKey={(row) => String(row.id)}
              onRowClick={(row) => {
                if (row.is_group === 0) {
                  setAccountId(String(row.id))
                  setTab('ledger')
                }
              }}
              columns={[
                { key: 'code', header: 'رقم الحساب', width: '130px', render: (row) => <span className="num font-semibold text-slate-600">{String(row.code)}</span> },
                {
                  key: 'name',
                  header: 'اسم الحساب',
                  render: (row) => (
                    <span className={cn(row.is_group === 1 ? 'font-bold text-slate-800' : 'text-slate-700', row.parent_id ? 'pr-4' : '')}>
                      {String(row.name)}
                      {row.name_en ? <span className="mr-2 text-[11.5px] text-slate-400" dir="ltr">{String(row.name_en)}</span> : null}
                    </span>
                  )
                },
                { key: 'type', header: 'النوع', align: 'center', render: (row) => <Badge tone={TYPE_TONE[String(row.type)]}>{TYPE_LABEL[String(row.type)]}</Badge> },
                { key: 'group', header: '', align: 'center', render: (row) => (row.is_group === 1 ? <Badge tone="slate">مجموعة</Badge> : null) }
              ]}
            />
          </>
        )}

        {tab === 'ledger' && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
              <Select className="h-10 w-72" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {(accounts.data ?? []).filter((a) => a.is_group === 0).map((a) => (
                  <option key={String(a.id)} value={String(a.id)}>
                    {String(a.code)} — {String(a.name)}
                  </option>
                ))}
              </Select>
              <DateRangePicker value={range} onChange={setRange} />
              {ledger.data && (
                <ExportButtons
                  title="حركة حساب"
                  subtitle={`من ${date(range.from)} إلى ${date(range.to)}`}
                  meta={[
                    { label: 'الرصيد الافتتاحي', value: money(ledger.data.opening) },
                    { label: 'الرصيد الختامي', value: money(ledger.data.closing) }
                  ]}
                  columns={[
                    { key: 'date', label: 'التاريخ', type: 'date' },
                    { key: 'entryNumber', label: 'رقم القيد' },
                    { key: 'refNumber', label: 'المستند' },
                    { key: 'description', label: 'البيان' },
                    { key: 'debit', label: 'مدين', type: 'money' },
                    { key: 'credit', label: 'دائن', type: 'money' },
                    { key: 'balance', label: 'الرصيد', type: 'money' }
                  ]}
                  rows={ledger.data.lines}
                />
              )}
            </div>

            {ledger.data && (
              <div className="grid gap-3 p-3 sm:grid-cols-3">
                <StatCard label="الرصيد الافتتاحي" value={money(ledger.data.opening)} />
                <StatCard label="صافي حركة الفترة" value={money(ledger.data.closing - ledger.data.opening)} />
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
                { key: 'date', header: 'التاريخ', width: '110px', render: (row) => <span className="num">{date(String(row.date))}</span> },
                { key: 'entry', header: 'رقم القيد', width: '130px', render: (row) => <span className="num text-[12.5px] text-slate-500">{String(row.entryNumber)}</span> },
                { key: 'ref', header: 'المستند', width: '140px', render: (row) => <span className="num text-[12.5px] font-semibold text-brand-700">{String(row.refNumber ?? '—')}</span> },
                { key: 'desc', header: 'البيان', render: (row) => <span className="text-[13px]">{String(row.description ?? '—')}</span> },
                { key: 'debit', header: 'مدين', align: 'left', render: (row) => (Number(row.debit) ? <span className="num font-semibold">{money(Number(row.debit), false)}</span> : <span className="text-slate-300">—</span>) },
                { key: 'credit', header: 'دائن', align: 'left', render: (row) => (Number(row.credit) ? <span className="num font-semibold">{money(Number(row.credit), false)}</span> : <span className="text-slate-300">—</span>) },
                { key: 'balance', header: 'الرصيد', align: 'left', render: (row) => <span className="num font-bold">{money(Number(row.balance), false)}</span> }
              ]}
            />
          </>
        )}
      </Card>
    </div>
  )
}
