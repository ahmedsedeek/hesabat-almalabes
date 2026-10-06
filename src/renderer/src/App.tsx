import React, { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './store/session'
import { Shell } from './components/layout/Shell'
import { Spinner, ToastHost } from './components/ui'
import { Login } from './pages/Login'
import { SetupWizard } from './pages/SetupWizard'
import { Dashboard } from './pages/Dashboard'
import { PartyListPage } from './pages/parties/PartyList'
import { PartyDetailPage } from './pages/parties/PartyDetail'
import { ProductsPage } from './pages/products/Products'
import { InventoryPage } from './pages/inventory/Inventory'
import { SalesListPage } from './pages/sales/SalesList'
import { SaleFormPage } from './pages/sales/SaleForm'
import { SaleDetailPage } from './pages/sales/SaleDetail'
import { PurchasesListPage } from './pages/purchases/PurchasesList'
import { PurchaseFormPage } from './pages/purchases/PurchaseForm'
import { PurchaseDetailPage } from './pages/purchases/PurchaseDetail'
import { ProductionListPage } from './pages/production/ProductionList'
import { ProductionDetailPage } from './pages/production/ProductionDetail'
import { PaymentsPage } from './pages/payments/Payments'
import { ExpensesPage } from './pages/expenses/Expenses'
import { TreasuryPage } from './pages/treasury/Treasury'
import { ReportsPage } from './pages/reports/Reports'
import { AccountingPage } from './pages/accounting/Accounting'
import { SettingsPage } from './pages/settings/Settings'
import { HelpPage } from './pages/Help'

export default function App(): React.JSX.Element {
  const { booted, user, info, boot } = useSession()

  useEffect(() => {
    void boot()
  }, [boot])

  if (!booted) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="h-9 w-9" />
          <p className="text-sm font-semibold text-slate-600">جارٍ تشغيل النظام…</p>
        </div>
      </div>
    )
  }

  if (!info?.setupCompleted || !info?.hasUsers) {
    return (
      <>
        <SetupWizard />
        <ToastHost />
      </>
    )
  }

  if (!user) {
    return (
      <>
        <Login />
        <ToastHost />
      </>
    )
  }

  return (
    <>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard />} />

          <Route path="/customers" element={<PartyListPage partyType="customer" />} />
          <Route path="/customers/:id" element={<PartyDetailPage partyType="customer" />} />
          <Route path="/suppliers" element={<PartyListPage partyType="supplier" />} />
          <Route path="/suppliers/:id" element={<PartyDetailPage partyType="supplier" />} />
          <Route path="/factories" element={<PartyListPage partyType="factory" />} />
          <Route path="/factories/:id" element={<PartyDetailPage partyType="factory" />} />

          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:id" element={<ProductsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />

          <Route path="/sales" element={<SalesListPage />} />
          <Route path="/sales/new" element={<SaleFormPage />} />
          <Route path="/sales/:id" element={<SaleDetailPage />} />

          <Route path="/purchases" element={<PurchasesListPage />} />
          <Route path="/purchases/new" element={<PurchaseFormPage />} />
          <Route path="/purchases/:id" element={<PurchaseDetailPage />} />

          <Route path="/production" element={<ProductionListPage />} />
          <Route path="/production/:id" element={<ProductionDetailPage />} />

          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/payments/:id" element={<PaymentsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/treasury" element={<TreasuryPage />} />

          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:reportKey" element={<ReportsPage />} />
          <Route path="/accounting" element={<AccountingPage />} />

          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:tab" element={<SettingsPage />} />
          <Route path="/help" element={<HelpPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
      <ToastHost />
    </>
  )
}
