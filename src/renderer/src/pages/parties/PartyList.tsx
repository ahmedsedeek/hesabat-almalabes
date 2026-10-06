import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Plus, Users } from 'lucide-react'
import type { PartyType, PartyWithBalance } from '@shared/types'
import { PERMISSIONS } from '@shared/permissions'
import { useQuery, useDebounced } from '../../lib/hooks'
import { useSession } from '../../store/session'
import { Badge, Card, DataTable, EmptyState, Pagination, SearchInput, Select, StatCard, cn } from '../../components/ui'
import { ExportButtons, PageHeader } from '../../components/common/page'
import { money } from '../../lib/format'
import { PartyFormModal, PARTY_META } from './PartyForm'

export function PartyListPage({ partyType }: { partyType: PartyType }): React.JSX.Element {
  const meta = PARTY_META[partyType]
  const navigate = useNavigate()
  const { can } = useSession()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<'all' | 'active' | 'withBalance'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'balance' | 'code'>('name')
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const debounced = useDebounced(search, 300)
  const pageSize = 50

  const { data, loading, error, reload } = useQuery<{ rows: PartyWithBalance[]; total: number }>(
    'parties:list',
    {
      partyType,
      search: debounced || undefined,
      activeOnly: filter === 'active',
      withBalanceOnly: filter === 'withBalance',
      sortBy,
      sortDir: sortBy === 'balance' ? 'desc' : 'asc',
      page,
      pageSize
    },
    [partyType, debounced, filter, sortBy, page]
  )

  const rows = data?.rows ?? []
  const totalBalance = rows.reduce((sum, row) => sum + row.balance, 0)
  const positives = rows.filter((r) => r.balance > 0)

  return (
    <div>
      <PageHeader
        title={meta.plural}
        subtitle={`إدارة بيانات ${meta.plural} وأرصدتهم وكشوف حساباتهم`}
        actions={
          <>
            <ExportButtons
              title={`قائمة ${meta.plural}`}
              columns={[
                { key: 'code', label: 'الكود' },
                { key: 'name', label: 'الاسم' },
                { key: 'companyName', label: 'الشركة' },
                { key: 'phone', label: 'الهاتف' },
                { key: 'city', label: 'المدينة' },
                { key: 'balance', label: 'الرصيد', type: 'money' }
              ]}
              rows={rows as unknown as Record<string, unknown>[]}
              totals={{ balance: totalBalance }}
              disabled={!rows.length}
            />
            {can(PERMISSIONS.PARTIES_CREATE) && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setEditId(null)
                  setFormOpen(true)
                }}
              >
                <Plus className="h-4 w-4" />
                {`إضافة ${meta.singular}`}
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={`عدد ${meta.plural} (الصفحة الحالية)`} value={rows.length} icon={<Users className="h-5 w-5" />} />
        <StatCard
          label={partyType === 'customer' ? 'إجمالي المستحق لنا' : 'إجمالي المستحق علينا'}
          value={money(positives.reduce((s, r) => s + r.balance, 0))}
          tone={partyType === 'customer' ? 'warning' : 'negative'}
          icon={<Download className="h-5 w-5" />}
        />
        <StatCard label="صافي الأرصدة" value={money(totalBalance)} tone={totalBalance >= 0 ? 'positive' : 'negative'} />
      </div>

      <Card noPadding>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <SearchInput
            className="w-full max-w-sm"
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder="ابحث بالاسم أو الكود أو الهاتف…"
          />
          <Select
            className="h-10 w-44"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as 'all')
              setPage(1)
            }}
          >
            <option value="all">الكل</option>
            <option value="active">النشطون فقط</option>
            <option value="withBalance">من لديهم رصيد</option>
          </Select>
          <Select className="h-10 w-40" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'name')}>
            <option value="name">ترتيب بالاسم</option>
            <option value="balance">ترتيب بالرصيد</option>
            <option value="code">ترتيب بالكود</option>
          </Select>
        </div>

        <DataTable
          rows={rows}
          loading={loading}
          error={error}
          onRetry={reload}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/${partyType === 'customer' ? 'customers' : partyType === 'supplier' ? 'suppliers' : 'factories'}/${row.id}`)}
          empty={
            <EmptyState
              title={`لا يوجد ${meta.plural} بعد`}
              description={`ابدأ بإضافة ${meta.singular} جديد أو استورد قائمتك من ملف Excel من الإعدادات.`}
              action={
                can(PERMISSIONS.PARTIES_CREATE) ? (
                  <button type="button" className="btn-primary" onClick={() => { setEditId(null); setFormOpen(true) }}>
                    <Plus className="h-4 w-4" />
                    {`إضافة ${meta.singular}`}
                  </button>
                ) : undefined
              }
            />
          }
          columns={[
            { key: 'code', header: 'الكود', width: '100px', render: (row) => <span className="num text-[13px] text-slate-500">{row.code}</span> },
            {
              key: 'name',
              header: 'الاسم',
              render: (row) => (
                <div>
                  <span className="font-semibold text-slate-800">{row.name}</span>
                  {!row.isActive && <span className="mr-2"><Badge tone="slate">غير نشط</Badge></span>}
                  {row.companyName && <p className="text-[12px] text-slate-500">{row.companyName}</p>}
                </div>
              )
            },
            { key: 'phone', header: 'الهاتف', render: (row) => <span className="num text-[13px]">{row.phone || '—'}</span> },
            { key: 'city', header: 'المدينة', render: (row) => row.city || '—' },
            {
              key: 'balance',
              header: partyType === 'customer' ? 'الرصيد المستحق' : 'الرصيد المستحق للطرف',
              align: 'left',
              render: (row) => (
                <span className={cn('num font-bold', row.balance > 0 ? 'text-rose-700' : row.balance < 0 ? 'text-emerald-700' : 'text-slate-400')}>
                  {money(row.balance)}
                </span>
              )
            },
            ...(partyType === 'customer'
              ? [
                  {
                    key: 'credit',
                    header: 'حد الائتمان',
                    align: 'left' as const,
                    render: (row: PartyWithBalance) =>
                      row.creditLimit > 0 ? (
                        <span className={cn('num text-[13px]', row.balance > row.creditLimit ? 'font-bold text-rose-600' : 'text-slate-500')}>
                          {money(row.creditLimit)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )
                  }
                ]
              : [])
          ]}
        />
        <div className="px-3">
          <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onChange={setPage} />
        </div>
      </Card>

      <PartyFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        partyType={partyType}
        partyId={editId}
        onSaved={() => reload()}
      />
    </div>
  )
}
