import React, { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ConfirmHost, Spinner, ToastHost } from '@/components/ui'
import { AdminLayout } from '@/pages/admin/AdminLayout'
import Landing from '@/pages/Landing'
import AdminLogin from '@/pages/admin/AdminLogin'

const Dashboard = lazy(() => import('@/pages/admin/Dashboard'))
const SalesAnalytics = lazy(() => import('@/pages/admin/SalesAnalytics'))
const Transactions = lazy(() => import('@/pages/admin/Transactions'))
const TransactionDetail = lazy(() => import('@/pages/admin/TransactionDetail'))
const Alerts = lazy(() => import('@/pages/admin/Alerts'))
const Catalog = lazy(() => import('@/pages/admin/Catalog'))
const ProductDetail = lazy(() => import('@/pages/admin/ProductDetail'))
const Inventory = lazy(() => import('@/pages/admin/Inventory'))
const PurchaseOrders = lazy(() => import('@/pages/admin/PurchaseOrders'))
const Suppliers = lazy(() => import('@/pages/admin/Suppliers'))
const Promotions = lazy(() => import('@/pages/admin/Promotions'))
const Customers = lazy(() => import('@/pages/admin/Customers'))
const CustomerDetail = lazy(() => import('@/pages/admin/CustomerDetail'))
const Repairs = lazy(() => import('@/pages/admin/Repairs'))
const Staff = lazy(() => import('@/pages/admin/Staff'))
const Registers = lazy(() => import('@/pages/admin/Registers'))
const ActivityLog = lazy(() => import('@/pages/admin/ActivityLog'))
const Reports = lazy(() => import('@/pages/admin/Reports'))
const SettingsPage = lazy(() => import('@/pages/admin/Settings'))

const CashierApp = lazy(() => import('@/pages/cashier/CashierApp'))
const CustomerDisplay = lazy(() => import('@/pages/display/CustomerDisplay'))

function Loading() {
  return <div className="h-full min-h-[40vh] flex items-center justify-center"><Spinner /></div>
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="sales" element={<SalesAnalytics />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="transactions/:id" element={<TransactionDetail />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="catalog" element={<Catalog />} />
            <Route path="catalog/:id" element={<ProductDetail />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="purchase-orders" element={<PurchaseOrders />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="promotions" element={<Promotions />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="repairs" element={<Repairs />} />
            <Route path="staff" element={<Staff />} />
            <Route path="registers" element={<Registers />} />
            <Route path="shifts" element={<Navigate to="/admin/registers" replace />} />
            <Route path="activity" element={<ActivityLog />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="/cashier/*" element={<CashierApp />} />
          <Route path="/display/:registerId" element={<CustomerDisplay />} />
          <Route path="/display" element={<CustomerDisplay />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastHost />
      <ConfirmHost />
    </BrowserRouter>
  )
}
