import React, { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, BookOpen, Boxes, Building2, ChevronLeft, CreditCard, Factory, FileBarChart, LayoutDashboard,
  LogOut, Menu, Package, Receipt, Search, Settings, ShoppingCart, Store, Truck, Users, Wallet, Wrench
} from 'lucide-react'
import type { Permission } from '@shared/permissions'
import { PERMISSIONS } from '@shared/permissions'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { invoke } from '../../lib/api'
import { cn } from '../ui'
import { GlobalSearch } from './GlobalSearch'

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  permission?: Permission
  end?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    label: 'الرئيسية',
    items: [{ to: '/', label: 'لوحة المعلومات', icon: LayoutDashboard, permission: PERMISSIONS.REPORTS_VIEW, end: true }]
  },
  {
    label: 'العلاقات',
    items: [
      { to: '/customers', label: 'العملاء', icon: Users, permission: PERMISSIONS.PARTIES_VIEW },
      { to: '/suppliers', label: 'الموردون', icon: Truck, permission: PERMISSIONS.PARTIES_VIEW },
      { to: '/factories', label: 'المصانع', icon: Factory, permission: PERMISSIONS.PARTIES_VIEW }
    ]
  },
  {
    label: 'المنتجات والمخزون',
    items: [
      { to: '/products', label: 'المنتجات', icon: Package, permission: PERMISSIONS.PRODUCTS_VIEW },
      { to: '/inventory', label: 'المخزون', icon: Boxes, permission: PERMISSIONS.INVENTORY_VIEW }
    ]
  },
  {
    label: 'العمليات',
    items: [
      { to: '/sales', label: 'المبيعات', icon: ShoppingCart, permission: PERMISSIONS.SALES_VIEW },
      { to: '/purchases', label: 'المشتريات', icon: Store, permission: PERMISSIONS.PURCHASES_VIEW },
      { to: '/production', label: 'التصنيع', icon: Wrench, permission: PERMISSIONS.PRODUCTION_VIEW }
    ]
  },
  {
    label: 'المالية',
    items: [
      { to: '/payments', label: 'المقبوضات والمدفوعات', icon: CreditCard, permission: PERMISSIONS.PAYMENTS_VIEW },
      { to: '/expenses', label: 'المصروفات', icon: Receipt, permission: PERMISSIONS.EXPENSES_VIEW },
      { to: '/treasury', label: 'الخزينة والبنوك', icon: Wallet, permission: PERMISSIONS.PAYMENTS_VIEW }
    ]
  },
  {
    label: 'التحليل',
    items: [
      { to: '/reports', label: 'التقارير', icon: FileBarChart, permission: PERMISSIONS.REPORTS_VIEW },
      { to: '/accounting', label: 'الحسابات والقيود', icon: Building2, permission: PERMISSIONS.ACCOUNTING_VIEW }
    ]
  }
]

export function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user, settings, logout, can } = useSession()
  const { sidebarCollapsed, toggleSidebar, searchOpen, setSearchOpen } = useUi()
  const [unread, setUnread] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const load = (): void => {
      invoke<number>('notifications:count').then(setUnread).catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 60_000)
    const off = window.api.onMessage((message) => {
      if (message.type === 'notifications:updated') load()
      if (message.type === 'navigate' && typeof message.payload === 'string') navigate(message.payload)
      if (message.type === 'open-search') setSearchOpen(true)
    })
    return () => {
      clearInterval(timer)
      off()
    }
  }, [navigate, setSearchOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSearchOpen])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <aside
        className={cn(
          'no-print flex shrink-0 flex-col border-l border-slate-200 bg-white transition-all duration-200',
          sidebarCollapsed ? 'w-[68px]' : 'w-60'
        )}
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            {(settings?.company.name ?? 'ش').slice(0, 2)}
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-bold text-slate-800">{settings?.company.name}</p>
              <p className="truncate text-[11.5px] text-slate-500">نظام إدارة الأعمال</p>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((group) => {
            const items = group.items.filter((item) => !item.permission || can(item.permission))
            if (!items.length) return null
            return (
              <div key={group.label} className="mb-4">
                {!sidebarCollapsed && (
                  <p className="mb-1.5 px-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{group.label}</p>
                )}
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        title={sidebarCollapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-semibold transition-colors',
                            isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800',
                            sidebarCollapsed && 'justify-center'
                          )
                        }
                      >
                        <item.icon className="h-[18px] w-[18px] shrink-0" />
                        {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </nav>

        <div className="space-y-0.5 border-t border-slate-200 p-2">
          <NavLink
            to="/help"
            title={sidebarCollapsed ? 'دليل الاستخدام' : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-semibold',
                isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
                sidebarCollapsed && 'justify-center'
              )
            }
          >
            <BookOpen className="h-[18px] w-[18px] shrink-0" />
            {!sidebarCollapsed && 'دليل الاستخدام'}
          </NavLink>

          {can(PERMISSIONS.SETTINGS_MANAGE) && (
            <NavLink
              to="/settings"
              title={sidebarCollapsed ? 'الإعدادات' : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-semibold',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
                  sidebarCollapsed && 'justify-center'
                )
              }
            >
              <Settings className="h-[18px] w-[18px] shrink-0" />
              {!sidebarCollapsed && 'الإعدادات'}
            </NavLink>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <button type="button" onClick={toggleSidebar} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <Menu className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-9 flex-1 max-w-md items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-400 hover:bg-slate-100"
          >
            <Search className="h-4 w-4" />
            <span>بحث سريع…</span>
            <kbd className="mr-auto rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              Ctrl K
            </kbd>
          </button>

          <div className="mr-auto flex items-center gap-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((o) => !o)}
                className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                  <span className="absolute -left-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
              {notificationsOpen && <NotificationsPanel onClose={() => { setNotificationsOpen(false); invoke<number>('notifications:count').then(setUnread).catch(() => undefined) }} />}
            </div>

            <div className="flex items-center gap-2 rounded-lg px-2 py-1">
              <div className="text-left">
                <p className="text-[13px] font-bold leading-tight text-slate-700">{user?.fullName}</p>
                <p className="text-[11.5px] leading-tight text-slate-500">{user?.roleName}</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-[13px] font-bold text-brand-700">
                {user?.fullName?.slice(0, 1)}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void logout()}
              title="تسجيل الخروج"
              className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        <main key={location.pathname} className="flex-1 overflow-y-auto p-5">
          {children}
        </main>
      </div>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </div>
  )
}

function NotificationsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    invoke<Record<string, unknown>[]>('notifications:list', { limit: 30 })
      .then(setItems)
      .finally(() => setLoading(false))
  }, [])

  const tones: Record<string, string> = {
    info: 'bg-brand-500',
    warning: 'bg-amber-500',
    critical: 'bg-rose-500'
  }

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute left-0 z-40 mt-2 w-[22rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h3 className="text-sm font-bold text-slate-800">التنبيهات</h3>
          <button
            type="button"
            className="text-[12.5px] font-semibold text-brand-600 hover:underline"
            onClick={async () => {
              await invoke('notifications:markRead', {})
              setItems((rows) => rows.map((r) => ({ ...r, is_read: 1 })))
            }}
          >
            تعليم الكل كمقروء
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {loading && <p className="px-4 py-8 text-center text-sm text-slate-500">جارٍ التحميل…</p>}
          {!loading && !items.length && <p className="px-4 py-8 text-center text-sm text-slate-500">لا توجد تنبيهات حاليًا.</p>}
          {items.map((item) => (
            <div key={String(item.id)} className={cn('flex gap-2.5 border-b border-slate-100 px-4 py-2.5', !item.is_read && 'bg-brand-50/40')}>
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', tones[String(item.severity)] ?? 'bg-slate-400')} />
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-slate-800">{String(item.title)}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-600">{String(item.body ?? '')}</p>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={async () => {
            await invoke('notifications:refresh')
            const rows = await invoke<Record<string, unknown>[]>('notifications:list', { limit: 30 })
            setItems(rows)
          }}
          className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          تحديث التنبيهات
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>
    </>
  )
}
