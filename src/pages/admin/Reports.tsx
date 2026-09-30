import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarDays, FileText, Package, Layers, Users, Boxes, AlertTriangle, ArrowLeftRight, UserCheck, Landmark, RotateCcw, Tag, Wrench, Download, Printer, ChevronUp, ChevronDown, ChevronsUpDown, type LucideIcon,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useDB } from '@/store/db'
import { Avatar, Badge, Card, EmptyState, Field, IconBox, Input, KV, PageHeader, Segmented, Select, statusTone } from '@/components/ui'
import { cx, dayKey, downloadFile, fmtDate, fmtDateTime, fmtTime, money, round2, titleCase, toCSV } from '@/lib/utils'
import { PAYMENT_LABELS } from '@/lib/pos'
import type { Database, Shift, Transaction } from '@/lib/types'

// ─── Report registry ─────────────────────────────────────────────────────────
type ReportId = 'daily' | 'zreport' | 'product' | 'category' | 'cashier' | 'inventory' | 'lowstock' | 'movements' | 'customers' | 'tax' | 'refunds' | 'discounts' | 'repairs'
interface ReportDef { id: ReportId; title: string; description: string; icon: LucideIcon; color: string; ranged: boolean; group: 'Sales' | 'Inventory' | 'People & finance' }
const REPORTS: ReportDef[] = [
  { id: 'daily', title: 'Daily sales summary', description: 'Orders, revenue, tax, refunds and profit per day', icon: CalendarDays, color: '#2563eb', ranged: true, group: 'Sales' },
  { id: 'zreport', title: 'Z-report (shift close)', description: 'End-of-shift cash reconciliation per register', icon: FileText, color: '#0891b2', ranged: false, group: 'Sales' },
  { id: 'product', title: 'Sales by product', description: 'Units, revenue, cost and margin per product', icon: Package, color: '#7c3aed', ranged: true, group: 'Sales' },
  { id: 'category', title: 'Sales by category', description: 'Revenue share and margin per category', icon: Layers, color: '#db2777', ranged: true, group: 'Sales' },
  { id: 'cashier', title: 'Sales by cashier', description: 'Performance, refunds and discounts per staff member', icon: Users, color: '#ea580c', ranged: true, group: 'Sales' },
  { id: 'discounts', title: 'Discounts', description: 'Every discounted sale, promo codes and overrides', icon: Tag, color: '#ca8a04', ranged: true, group: 'Sales' },
  { id: 'refunds', title: 'Refunds & voids', description: 'Money returned and cancelled sales with reasons', icon: RotateCcw, color: '#ef4444', ranged: true, group: 'Sales' },
  { id: 'inventory', title: 'Inventory valuation', description: 'Stock on hand at cost and retail value', icon: Boxes, color: '#059669', ranged: false, group: 'Inventory' },
  { id: 'lowstock', title: 'Low stock', description: 'Products at or below their reorder threshold', icon: AlertTriangle, color: '#f97316', ranged: false, group: 'Inventory' },
  { id: 'movements', title: 'Stock movements', description: 'Every unit in and out: sales, refunds, purchases, adjustments', icon: ArrowLeftRight, color: '#4f46e5', ranged: true, group: 'Inventory' },
  { id: 'customers', title: 'Customer purchases', description: 'Spend, visits and loyalty per customer', icon: UserCheck, color: '#0891b2', ranged: true, group: 'People & finance' },
  { id: 'tax', title: 'Tax report', description: 'Taxable vs exempt sales and tax collected per day', icon: Landmark, color: '#64748b', ranged: true, group: 'People & finance' },
  { id: 'repairs', title: 'Repairs', description: 'Repair tickets, status, estimates and deposits', icon: Wrench, color: '#2563eb', ranged: false, group: 'People & finance' },
]

type Fmt = 'money' | 'int' | 'pct' | 'date' | 'datetime' | 'text' | 'signed'
interface Col { key: string; header: string; fmt?: Fmt; total?: 'sum' | 'avg' | 'count' | 'label'; width?: string }
type Row = Record<string, unknown>
interface ReportData { columns: Col[]; rows: Row[]; note?: string }

type Preset = 'today' | '7d' | '30d' | '90d' | 'all'
const presetRange = (p: Preset): { from: string; to: string } => {
  const to = format(new Date(), 'yyyy-MM-dd')
  if (p === 'all') return { from: '', to: '' }
  const days = p === 'today' ? 0 : p === '7d' ? 6 : p === '30d' ? 29 : 89
  return { from: format(new Date(Date.now() - days * 86400000), 'yyyy-MM-dd'), to }
}

function inRange(iso: string, from: string, to: string) {
  const d = dayKey(iso)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

function fmtCell(v: unknown, fmt?: Fmt): React.ReactNode {
  if (v === undefined || v === null || v === '') return <span className="text-slate-300">—</span>
  switch (fmt) {
    case 'money': return <span className={cx('tabular-nums', Number(v) < 0 && 'text-red-600')}>{money(Number(v))}</span>
    case 'signed': { const n = Number(v); return <span className={cx('tabular-nums font-medium', n > 0 ? 'text-emerald-600' : n < 0 ? 'text-red-600' : 'text-slate-400')}>{n > 0 ? '+' : ''}{n}</span> }
    case 'int': return <span className="tabular-nums">{Number(v).toLocaleString()}</span>
    case 'pct': return <span className="tabular-nums">{Number(v).toFixed(1)}%</span>
    case 'date': return fmtDate(String(v))
    case 'datetime': return fmtDateTime(String(v))
    default: return String(v)
  }
}
const numeric = (f?: Fmt) => f === 'money' || f === 'int' || f === 'pct' || f === 'signed'

// ─── Report builders ─────────────────────────────────────────────────────────
function buildReport(id: ReportId, db: Database, from: string, to: string): ReportData {
  const txs = db.transactions.filter((t) => inRange(t.createdAt, from, to))
  const sales = txs.filter((t) => t.type === 'sale' && t.status !== 'voided')
  const refunds = txs.filter((t) => t.type === 'refund')
  const prod = (pid: string) => db.products.find((p) => p.id === pid)
  const user = (uid: string) => db.users.find((u) => u.id === uid)
  const cat = (cid?: string) => db.categories.find((c) => c.id === cid)

  switch (id) {
    case 'daily': {
      const map = new Map<string, Row & { date: string; orders: number; items: number; gross: number; discounts: number; tax: number; refunds: number; net: number; profit: number; voids: number }>()
      const get = (k: string) => { let r = map.get(k); if (!r) { r = { date: k, orders: 0, items: 0, gross: 0, discounts: 0, tax: 0, refunds: 0, net: 0, profit: 0, voids: 0 }; map.set(k, r) } return r }
      txs.forEach((t) => {
        const r = get(dayKey(t.createdAt))
        if (t.status === 'voided') { r.voids++; return }
        if (t.type === 'sale') { r.orders++; r.items += t.lines.reduce((a, l) => a + l.qty, 0); r.gross = round2(r.gross + t.total); r.discounts = round2(r.discounts + t.discountTotal); r.tax = round2(r.tax + t.taxTotal); r.profit = round2(r.profit + t.total - t.taxTotal - t.costTotal) }
        else if (t.type === 'refund') { r.refunds = round2(r.refunds + Math.abs(t.total)); r.profit = round2(r.profit + (t.total - t.taxTotal) - t.costTotal) }
      })
      const rows = Array.from(map.values()).map((r) => ({ ...r, net: round2(r.gross - r.refunds), avg: r.orders ? round2(r.gross / r.orders) : 0 })).sort((a, b) => b.date.localeCompare(a.date))
      return { columns: [
        { key: 'date', header: 'Date', fmt: 'date', total: 'label' }, { key: 'orders', header: 'Orders', fmt: 'int', total: 'sum' }, { key: 'items', header: 'Items', fmt: 'int', total: 'sum' }, { key: 'gross', header: 'Gross sales', fmt: 'money', total: 'sum' },
        { key: 'avg', header: 'Avg ticket', fmt: 'money', total: 'avg' }, { key: 'discounts', header: 'Discounts', fmt: 'money', total: 'sum' }, { key: 'tax', header: 'Tax', fmt: 'money', total: 'sum' }, { key: 'refunds', header: 'Refunds', fmt: 'money', total: 'sum' },
        { key: 'voids', header: 'Voids', fmt: 'int', total: 'sum' }, { key: 'net', header: 'Net sales', fmt: 'money', total: 'sum' }, { key: 'profit', header: 'Gross profit', fmt: 'money', total: 'sum' },
      ], rows }
    }
    case 'product': {
      const map = new Map<string, { productId: string; product: string; sku: string; category: string; qty: number; revenue: number; cost: number; tax: number; refundedQty: number }>()
      txs.forEach((t) => {
        if (t.status === 'voided') return
        t.lines.forEach((l) => {
          const p = prod(l.productId)
          const s = map.get(l.productId) ?? { productId: l.productId, product: l.name, sku: l.sku, category: cat(p?.categoryId)?.name ?? '—', qty: 0, revenue: 0, cost: 0, tax: 0, refundedQty: 0 }
          s.qty += l.qty; s.revenue = round2(s.revenue + l.lineTotal); s.cost = round2(s.cost + l.cost * l.qty); s.tax = round2(s.tax + l.taxAmount)
          if (t.type === 'refund') s.refundedQty += Math.abs(l.qty)
          map.set(l.productId, s)
        })
      })
      const total = Array.from(map.values()).reduce((a, s) => a + s.revenue, 0) || 1
      const rows = Array.from(map.values()).map((s) => { const net = s.revenue - s.tax; return { ...s, share: round2((s.revenue / total) * 100), profit: round2(net - s.cost), margin: net ? round2(((net - s.cost) / net) * 100) : 0, stock: prod(s.productId)?.categoryId === 'cat_service' ? '' : prod(s.productId)?.stock ?? '' } }).sort((a, b) => b.revenue - a.revenue)
      return { columns: [
        { key: 'product', header: 'Product', total: 'label' }, { key: 'sku', header: 'SKU' }, { key: 'category', header: 'Category' }, { key: 'qty', header: 'Units', fmt: 'int', total: 'sum' }, { key: 'refundedQty', header: 'Refunded', fmt: 'int', total: 'sum' },
        { key: 'revenue', header: 'Revenue', fmt: 'money', total: 'sum' }, { key: 'share', header: 'Share', fmt: 'pct' }, { key: 'cost', header: 'Cost', fmt: 'money', total: 'sum' }, { key: 'profit', header: 'Profit', fmt: 'money', total: 'sum' }, { key: 'margin', header: 'Margin', fmt: 'pct' }, { key: 'stock', header: 'In stock', fmt: 'int' },
      ], rows }
    }
    case 'category': {
      const map = new Map<string, { qty: number; revenue: number; cost: number; tax: number; orders: Set<string> }>()
      txs.forEach((t) => {
        if (t.status === 'voided') return
        t.lines.forEach((l) => {
          const cid = prod(l.productId)?.categoryId ?? 'unknown'
          const s = map.get(cid) ?? { qty: 0, revenue: 0, cost: 0, tax: 0, orders: new Set<string>() }
          s.qty += l.qty; s.revenue = round2(s.revenue + l.lineTotal); s.cost = round2(s.cost + l.cost * l.qty); s.tax = round2(s.tax + l.taxAmount); s.orders.add(t.id)
          map.set(cid, s)
        })
      })
      const total = Array.from(map.values()).reduce((a, s) => a + s.revenue, 0) || 1
      const rows = Array.from(map.entries()).map(([cid, s]) => { const net = s.revenue - s.tax; return { category: cat(cid)?.name ?? 'Unknown', products: db.products.filter((p) => p.categoryId === cid).length, orders: s.orders.size, qty: s.qty, revenue: s.revenue, share: round2((s.revenue / total) * 100), tax: s.tax, cost: s.cost, profit: round2(net - s.cost), margin: net ? round2(((net - s.cost) / net) * 100) : 0 } }).sort((a, b) => b.revenue - a.revenue)
      return { columns: [
        { key: 'category', header: 'Category', total: 'label' }, { key: 'products', header: 'Products', fmt: 'int' }, { key: 'orders', header: 'Orders', fmt: 'int' }, { key: 'qty', header: 'Units', fmt: 'int', total: 'sum' }, { key: 'revenue', header: 'Revenue', fmt: 'money', total: 'sum' },
        { key: 'share', header: 'Share', fmt: 'pct' }, { key: 'tax', header: 'Tax', fmt: 'money', total: 'sum' }, { key: 'cost', header: 'Cost', fmt: 'money', total: 'sum' }, { key: 'profit', header: 'Profit', fmt: 'money', total: 'sum' }, { key: 'margin', header: 'Margin', fmt: 'pct' },
      ], rows }
    }
    case 'cashier': {
      const rows = db.users.map((u) => {
        const mine = txs.filter((t) => t.userId === u.id)
        const s = mine.filter((t) => t.type === 'sale' && t.status !== 'voided')
        const r = mine.filter((t) => t.type === 'refund')
        const v = mine.filter((t) => t.status === 'voided')
        const gross = round2(s.reduce((a, t) => a + t.total, 0))
        const refunded = round2(r.reduce((a, t) => a + Math.abs(t.total), 0))
        const shifts = db.shifts.filter((sh) => sh.userId === u.id && inRange(sh.openedAt, from, to))
        return { cashier: u.name, role: titleCase(u.role), shifts: shifts.length, orders: s.length, items: s.reduce((a, t) => a + t.lines.reduce((b, l) => b + l.qty, 0), 0), gross, avg: s.length ? round2(gross / s.length) : 0, discounts: round2(s.reduce((a, t) => a + t.discountTotal, 0)), refunds: refunded, refundCount: r.length, voids: v.length, net: round2(gross - refunded), variance: round2(shifts.reduce((a, sh) => a + (sh.difference ?? 0), 0)) }
      }).filter((r) => r.orders || r.refundCount || r.shifts).sort((a, b) => b.net - a.net)
      return { columns: [
        { key: 'cashier', header: 'Cashier', total: 'label' }, { key: 'role', header: 'Role' }, { key: 'shifts', header: 'Shifts', fmt: 'int', total: 'sum' }, { key: 'orders', header: 'Orders', fmt: 'int', total: 'sum' }, { key: 'items', header: 'Items', fmt: 'int', total: 'sum' }, { key: 'gross', header: 'Gross', fmt: 'money', total: 'sum' },
        { key: 'avg', header: 'Avg ticket', fmt: 'money', total: 'avg' }, { key: 'discounts', header: 'Discounts', fmt: 'money', total: 'sum' }, { key: 'refunds', header: 'Refunds', fmt: 'money', total: 'sum' }, { key: 'refundCount', header: '# Ref.', fmt: 'int', total: 'sum' }, { key: 'voids', header: 'Voids', fmt: 'int', total: 'sum' }, { key: 'net', header: 'Net', fmt: 'money', total: 'sum' }, { key: 'variance', header: 'Cash variance', fmt: 'money', total: 'sum' },
      ], rows }
    }
    case 'inventory': {
      const rows = db.products.filter((p) => p.categoryId !== 'cat_service').map((p) => {
        const stock = Math.max(0, p.stock)
        return { product: p.name, sku: p.sku, category: cat(p.categoryId)?.name ?? '—', brand: db.brands.find((b) => b.id === p.brandId)?.name ?? '—', stock, threshold: p.lowStockThreshold, cost: p.cost, price: p.price, costValue: round2(stock * p.cost), retailValue: round2(stock * p.price), potential: round2(stock * (p.price - p.cost)), status: p.stock <= 0 ? 'Out' : p.stock <= p.lowStockThreshold ? 'Low' : 'OK', serials: p.trackSerial ? p.serials.length : '' }
      }).sort((a, b) => b.costValue - a.costValue)
      return { columns: [
        { key: 'product', header: 'Product', total: 'label' }, { key: 'sku', header: 'SKU' }, { key: 'category', header: 'Category' }, { key: 'brand', header: 'Brand' }, { key: 'status', header: 'Status' }, { key: 'stock', header: 'On hand', fmt: 'int', total: 'sum' }, { key: 'serials', header: 'Serials', fmt: 'int' },
        { key: 'cost', header: 'Unit cost', fmt: 'money' }, { key: 'price', header: 'Unit price', fmt: 'money' }, { key: 'costValue', header: 'Value @ cost', fmt: 'money', total: 'sum' }, { key: 'retailValue', header: 'Value @ retail', fmt: 'money', total: 'sum' }, { key: 'potential', header: 'Potential profit', fmt: 'money', total: 'sum' },
      ], rows, note: 'Services are excluded. Negative stock is counted as zero.' }
    }
    case 'lowstock': {
      const last30 = db.transactions.filter((t) => t.type === 'sale' && t.status !== 'voided' && Date.now() - parseISO(t.createdAt).getTime() < 30 * 86400000)
      const rows = db.products.filter((p) => p.categoryId !== 'cat_service' && p.active && p.stock <= p.lowStockThreshold).map((p) => {
        const sold30 = last30.reduce((a, t) => a + t.lines.filter((l) => l.productId === p.id).reduce((b, l) => b + l.qty, 0), 0)
        const lastSale = db.transactions.filter((t) => t.type === 'sale' && t.lines.some((l) => l.productId === p.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        const onOrder = db.purchaseOrders.filter((po) => po.status === 'ordered' || po.status === 'partial').reduce((a, po) => a + po.lines.filter((l) => l.productId === p.id).reduce((b, l) => b + (l.qty - l.received), 0), 0)
        const daysLeft = sold30 > 0 ? Math.round((Math.max(0, p.stock) / sold30) * 30) : ''
        return { product: p.name, sku: p.sku, category: cat(p.categoryId)?.name ?? '—', supplier: db.suppliers.find((s) => s.id === p.supplierId)?.name ?? '—', stock: p.stock, threshold: p.lowStockThreshold, shortfall: Math.max(0, p.lowStockThreshold - p.stock), onOrder, sold30, daysLeft, lastSold: lastSale?.createdAt ?? '', reorderCost: round2(Math.max(0, p.lowStockThreshold * 2 - p.stock) * p.cost) }
      }).sort((a, b) => a.stock - b.stock)
      return { columns: [
        { key: 'product', header: 'Product', total: 'label' }, { key: 'sku', header: 'SKU' }, { key: 'category', header: 'Category' }, { key: 'supplier', header: 'Supplier' }, { key: 'stock', header: 'On hand', fmt: 'int', total: 'sum' }, { key: 'threshold', header: 'Threshold', fmt: 'int' }, { key: 'shortfall', header: 'Shortfall', fmt: 'int', total: 'sum' },
        { key: 'onOrder', header: 'On order', fmt: 'int', total: 'sum' }, { key: 'sold30', header: 'Sold 30d', fmt: 'int', total: 'sum' }, { key: 'daysLeft', header: 'Days cover', fmt: 'int' }, { key: 'lastSold', header: 'Last sold', fmt: 'date' }, { key: 'reorderCost', header: 'Suggested reorder @ cost', fmt: 'money', total: 'sum' },
      ], rows, note: 'Suggested reorder brings stock up to twice the threshold.' }
    }
    case 'movements': {
      const rows = db.stockMovements.filter((m) => inRange(m.createdAt, from, to)).map((m) => {
        const p = prod(m.productId)
        const ref = m.refId ? db.transactions.find((t) => t.id === m.refId)?.number ?? db.purchaseOrders.find((po) => po.id === m.refId)?.number ?? '' : ''
        return { date: m.createdAt, product: p?.name ?? m.productId, sku: p?.sku ?? '', type: titleCase(m.type), qty: m.qty, before: m.before, after: m.after, value: round2(m.qty * (p?.cost ?? 0)), reason: m.reason ?? '', reference: ref, serial: m.serial ?? '', user: user(m.userId)?.name ?? '' }
      }).sort((a, b) => b.date.localeCompare(a.date))
      return { columns: [
        { key: 'date', header: 'Date', fmt: 'datetime', total: 'label' }, { key: 'product', header: 'Product' }, { key: 'sku', header: 'SKU' }, { key: 'type', header: 'Type' }, { key: 'qty', header: 'Qty', fmt: 'signed', total: 'sum' }, { key: 'before', header: 'Before', fmt: 'int' }, { key: 'after', header: 'After', fmt: 'int' },
        { key: 'value', header: 'Value @ cost', fmt: 'money', total: 'sum' }, { key: 'reason', header: 'Reason' }, { key: 'reference', header: 'Ref' }, { key: 'serial', header: 'Serial' }, { key: 'user', header: 'By' },
      ], rows }
    }
    case 'customers': {
      const rows = db.customers.map((c) => {
        const mine = txs.filter((t) => t.customerId === c.id)
        const s = mine.filter((t) => t.type === 'sale' && t.status !== 'voided')
        const r = mine.filter((t) => t.type === 'refund')
        const spent = round2(s.reduce((a, t) => a + t.total, 0))
        const refunded = round2(r.reduce((a, t) => a + Math.abs(t.total), 0))
        const last = [...s].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        return { customer: c.name, phone: c.phone, email: c.email ?? '', orders: s.length, items: s.reduce((a, t) => a + t.lines.reduce((b, l) => b + l.qty, 0), 0), spent, refunds: refunded, net: round2(spent - refunded), avg: s.length ? round2(spent / s.length) : 0, lastPurchase: last?.createdAt ?? '', lifetime: c.totalSpent, points: c.loyaltyPoints, credit: c.storeCredit }
      }).filter((r) => r.orders || r.refunds).sort((a, b) => b.net - a.net)
      return { columns: [
        { key: 'customer', header: 'Customer', total: 'label' }, { key: 'phone', header: 'Phone' }, { key: 'orders', header: 'Orders', fmt: 'int', total: 'sum' }, { key: 'items', header: 'Items', fmt: 'int', total: 'sum' }, { key: 'spent', header: 'Spent', fmt: 'money', total: 'sum' }, { key: 'refunds', header: 'Refunds', fmt: 'money', total: 'sum' },
        { key: 'net', header: 'Net', fmt: 'money', total: 'sum' }, { key: 'avg', header: 'Avg order', fmt: 'money', total: 'avg' }, { key: 'lastPurchase', header: 'Last purchase', fmt: 'date' }, { key: 'lifetime', header: 'Lifetime spend', fmt: 'money', total: 'sum' }, { key: 'points', header: 'Points', fmt: 'int', total: 'sum' }, { key: 'credit', header: 'Store credit', fmt: 'money', total: 'sum' },
      ], rows }
    }
    case 'tax': {
      const map = new Map<string, { date: string; orders: number; taxable: number; exempt: number; tax: number; refundTax: number }>()
      txs.forEach((t) => {
        if (t.status === 'voided' || (t.type !== 'sale' && t.type !== 'refund')) return
        const k = dayKey(t.createdAt)
        const r = map.get(k) ?? { date: k, orders: 0, taxable: 0, exempt: 0, tax: 0, refundTax: 0 }
        if (t.type === 'sale') {
          r.orders++
          t.lines.forEach((l) => { const net = l.lineTotal - l.taxAmount; if (l.taxable) r.taxable = round2(r.taxable + net); else r.exempt = round2(r.exempt + net) })
          r.tax = round2(r.tax + t.taxTotal)
        } else {
          r.refundTax = round2(r.refundTax + Math.abs(t.taxTotal))
          t.lines.forEach((l) => { const net = l.lineTotal - l.taxAmount; if (l.taxable) r.taxable = round2(r.taxable + net); else r.exempt = round2(r.exempt + net) })
        }
        map.set(k, r)
      })
      const rows = Array.from(map.values()).map((r) => ({ ...r, netTax: round2(r.tax - r.refundTax), total: round2(r.taxable + r.exempt + r.tax - r.refundTax) })).sort((a, b) => b.date.localeCompare(a.date))
      return { columns: [
        { key: 'date', header: 'Date', fmt: 'date', total: 'label' }, { key: 'orders', header: 'Orders', fmt: 'int', total: 'sum' }, { key: 'taxable', header: 'Taxable sales (ex tax)', fmt: 'money', total: 'sum' }, { key: 'exempt', header: 'Exempt sales', fmt: 'money', total: 'sum' },
        { key: 'tax', header: `${db.settings.taxName} collected`, fmt: 'money', total: 'sum' }, { key: 'refundTax', header: 'Tax refunded', fmt: 'money', total: 'sum' }, { key: 'netTax', header: 'Net tax payable', fmt: 'money', total: 'sum' }, { key: 'total', header: 'Total inc. tax', fmt: 'money', total: 'sum' },
      ], rows, note: `${db.settings.taxName} at ${db.settings.taxRate}% · ${db.settings.taxInclusive ? 'tax-inclusive pricing' : 'tax-exclusive pricing'}. Refund lines are netted into taxable/exempt columns.` }
    }
    case 'refunds': {
      const rows = txs.filter((t) => t.type === 'refund' || t.status === 'voided').map((t) => {
        const orig = t.refundOf ? db.transactions.find((x) => x.id === t.refundOf) : undefined
        return { date: t.createdAt, number: t.number, kind: t.type === 'refund' ? 'Refund' : 'Void', original: orig?.number ?? (t.type === 'sale' ? t.number : ''), cashier: user(t.userId)?.name ?? '', register: db.registers.find((r) => r.id === t.registerId)?.name ?? '', customer: t.customerId ? db.customers.find((c) => c.id === t.customerId)?.name ?? '' : 'Walk-in', items: t.lines.reduce((a, l) => a + Math.abs(l.qty), 0), amount: t.type === 'refund' ? -Math.abs(t.total) : -t.total, method: t.type === 'refund' ? PAYMENT_LABELS[t.payments[0]?.method ?? ''] ?? '' : '', reason: t.type === 'refund' ? t.note ?? '' : t.voidReason ?? '', restocked: t.type === 'refund' ? (db.stockMovements.some((m) => m.refId === t.id && m.type === 'refund') ? 'Yes' : 'No') : 'Yes' }
      }).sort((a, b) => b.date.localeCompare(a.date))
      return { columns: [
        { key: 'date', header: 'Date', fmt: 'datetime', total: 'label' }, { key: 'number', header: 'Number' }, { key: 'kind', header: 'Kind' }, { key: 'original', header: 'Original sale' }, { key: 'cashier', header: 'Cashier' }, { key: 'register', header: 'Register' }, { key: 'customer', header: 'Customer' },
        { key: 'items', header: 'Items', fmt: 'int', total: 'sum' }, { key: 'amount', header: 'Amount', fmt: 'money', total: 'sum' }, { key: 'method', header: 'Refund method' }, { key: 'restocked', header: 'Restocked' }, { key: 'reason', header: 'Reason' },
      ], rows }
    }
    case 'discounts': {
      const rows = sales.filter((t) => t.discountTotal > 0 || t.lines.some((l) => l.unitPrice !== l.originalPrice)).map((t) => {
        const lineDisc = round2(t.lines.reduce((a, l) => a + l.discountAmount, 0))
        const overrides = t.lines.filter((l) => l.unitPrice !== l.originalPrice)
        const overrideAmt = round2(overrides.reduce((a, l) => a + (l.originalPrice - l.unitPrice) * l.qty, 0))
        const kind = [lineDisc > 0 && 'Line', t.cartDiscount && 'Cart', t.promoCode && 'Promo', overrides.length && 'Override'].filter(Boolean).join(' + ')
        return { date: t.createdAt, number: t.number, cashier: user(t.userId)?.name ?? '', customer: t.customerId ? db.customers.find((c) => c.id === t.customerId)?.name ?? '' : 'Walk-in', kind, promo: t.promoCode ?? '', subtotal: t.subtotal, discount: t.discountTotal, override: overrideAmt, rate: t.subtotal ? round2(((t.discountTotal + overrideAmt) / (t.subtotal + overrideAmt)) * 100) : 0, total: t.total, reasons: Array.from(new Set([t.cartDiscount?.reason, ...t.lines.map((l) => l.discount?.reason)].filter(Boolean))).join('; ') }
      }).sort((a, b) => b.date.localeCompare(a.date))
      return { columns: [
        { key: 'date', header: 'Date', fmt: 'datetime', total: 'label' }, { key: 'number', header: 'Number' }, { key: 'cashier', header: 'Cashier' }, { key: 'customer', header: 'Customer' }, { key: 'kind', header: 'Type' }, { key: 'promo', header: 'Promo code' },
        { key: 'subtotal', header: 'Subtotal', fmt: 'money', total: 'sum' }, { key: 'discount', header: 'Discount', fmt: 'money', total: 'sum' }, { key: 'override', header: 'Price override', fmt: 'money', total: 'sum' }, { key: 'rate', header: 'Rate', fmt: 'pct', total: 'avg' }, { key: 'total', header: 'Paid', fmt: 'money', total: 'sum' }, { key: 'reasons', header: 'Reasons' },
      ], rows }
    }
    case 'repairs': {
      const rows = db.repairs.map((r) => ({ number: r.number, created: r.createdAt, customer: db.customers.find((c) => c.id === r.customerId)?.name ?? '', device: r.device, imei: r.imei ?? '', issue: r.issue, status: titleCase(r.status), technician: r.technicianId ? user(r.technicianId)?.name ?? '' : '', estimate: r.estimate, deposit: r.deposit, balance: round2(r.estimate - r.deposit), paid: r.paid ? 'Yes' : 'No', promised: r.promisedAt ?? '', updated: r.updatedAt, notes: r.notes.length })).sort((a, b) => b.created.localeCompare(a.created))
      return { columns: [
        { key: 'number', header: 'Ticket', total: 'label' }, { key: 'created', header: 'Received', fmt: 'date' }, { key: 'customer', header: 'Customer' }, { key: 'device', header: 'Device' }, { key: 'imei', header: 'IMEI' }, { key: 'issue', header: 'Issue' }, { key: 'status', header: 'Status' }, { key: 'technician', header: 'Technician' },
        { key: 'estimate', header: 'Estimate', fmt: 'money', total: 'sum' }, { key: 'deposit', header: 'Deposit', fmt: 'money', total: 'sum' }, { key: 'balance', header: 'Balance', fmt: 'money', total: 'sum' }, { key: 'paid', header: 'Paid' }, { key: 'promised', header: 'Promised', fmt: 'date' }, { key: 'notes', header: 'Notes', fmt: 'int' },
      ], rows }
    }
    default:
      return { columns: [], rows: [] }
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function Reports() {
  const db = useDB((s) => s.db)
  const [active, setActive] = useState<ReportId>('daily')
  const [preset, setPreset] = useState<Preset>('30d')
  const [range, setRange] = useState(() => presetRange('30d'))
  const def = REPORTS.find((r) => r.id === active)!

  const applyPreset = (p: Preset) => { setPreset(p); setRange(presetRange(p)) }
  const report = useMemo(() => (active === 'zreport' ? null : buildReport(active, db, def.ranged ? range.from : '', def.ranged ? range.to : '')), [active, db, range, def.ranged])

  const rangeLabel = !def.ranged ? 'As of now' : range.from || range.to ? `${range.from ? fmtDate(range.from) : 'Start'} → ${range.to ? fmtDate(range.to) : 'Today'}` : 'All time'
  const exportCsv = () => {
    if (!report?.rows.length) return
    const rows = report.rows.map((r) => Object.fromEntries(report.columns.map((c) => [c.header, r[c.key] ?? ''])))
    downloadFile(`${active}-report-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`, toCSV(rows), 'text/csv')
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle="Every movement and every transaction, exportable and printable" />

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 print:hidden">
        <div className="xl:col-span-1 flex flex-col gap-3">
          {(['Sales', 'Inventory', 'People & finance'] as const).map((g) => (
            <div key={g}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 px-1 mb-1.5">{g}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-2">
                {REPORTS.filter((r) => r.group === g).map((r) => (
                  <button key={r.id} onClick={() => setActive(r.id)} className={cx('card p-3 flex items-center gap-3 text-left transition-all hover:shadow-pop', active === r.id && 'ring-2 ring-brand-500/40 border-brand-200')}>
                    <IconBox color={r.color} size={36}><r.icon size={17} /></IconBox>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800">{r.title}</div>
                      <div className="text-[11px] text-slate-400 leading-snug">{r.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="xl:col-span-3 min-w-0">
          <Card padded={false}>
            <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <IconBox color={def.color} size={40}><def.icon size={19} /></IconBox>
                <div>
                  <h2 className="card-title">{def.title}</h2>
                  <p className="text-xs text-slate-400">{def.description} · <span className="text-slate-600 font-medium">{rangeLabel}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {active !== 'zreport' && <button className="btn-secondary" onClick={exportCsv} disabled={!report?.rows.length}><Download size={15} /> Export CSV</button>}
                <button className="btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>
              </div>
            </div>
            {def.ranged && (
              <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-end gap-3 bg-slate-50/50">
                <Segmented value={preset} onChange={applyPreset} options={[{ value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: 'all', label: 'All time' }]} />
                <Field label="From"><Input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="!py-1.5" /></Field>
                <Field label="To"><Input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="!py-1.5" /></Field>
              </div>
            )}
            <div className="p-5">
              {active === 'zreport' ? <ZReport /> : report && <ReportTable key={active} data={report} />}
            </div>
          </Card>
        </div>
      </div>
      <div className="hidden print:block">
        <h2 className="text-xl font-bold">{db.settings.storeName} — {def.title}</h2>
        <p className="text-sm text-slate-500 mb-4">{rangeLabel} · printed {fmtDateTime(new Date().toISOString())}</p>
        {active === 'zreport' ? <ZReport /> : report && <ReportTable key={`print-${active}`} data={report} showAll />}
      </div>
    </div>
  )
}

// ─── Generic report table ────────────────────────────────────────────────────
function ReportTable({ data, showAll: forceAll }: { data: ReportData; showAll?: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const [showAll, setShowAll] = useState(!!forceAll)
  const PAGE = 60
  const rows = useMemo(() => {
    if (!sort) return data.rows
    const col = data.columns.find((c) => c.key === sort.key)
    return [...data.rows].sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key]
      const r = numeric(col?.fmt) ? Number(va ?? 0) - Number(vb ?? 0) : String(va ?? '').localeCompare(String(vb ?? ''))
      return sort.dir === 'asc' ? r : -r
    })
  }, [data, sort])
  const visible = showAll ? rows : rows.slice(0, PAGE)
  const totals = useMemo(() => {
    const t: Record<string, React.ReactNode> = {}
    data.columns.forEach((c) => {
      if (c.total === 'label') t[c.key] = `Total (${data.rows.length})`
      else if (c.total === 'sum') t[c.key] = fmtCell(round2(data.rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0)), c.fmt)
      else if (c.total === 'avg') t[c.key] = fmtCell(data.rows.length ? round2(data.rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0) / data.rows.length) : 0, c.fmt)
      else if (c.total === 'count') t[c.key] = data.rows.length
    })
    return t
  }, [data])
  if (!data.rows.length) return <EmptyState title="No data for this selection" description="Try a wider date range." />
  return (
    <div>
      {data.note && <div className="text-xs text-slate-400 mb-3">{data.note}</div>}
      <div className="overflow-x-auto -mx-2">
        <table className="table">
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th key={c.key} className={cx('cursor-pointer select-none hover:text-slate-600', numeric(c.fmt) && 'text-right')} onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: numeric(c.fmt) ? 'desc' : 'asc' }))}>
                  <span className="inline-flex items-center gap-1">{c.header}{sort?.key === c.key ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} className="opacity-40 print:hidden" />}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={i}>
                {data.columns.map((c) => <td key={c.key} className={cx(numeric(c.fmt) && 'text-right', (c.key === 'status' || c.fmt === 'date' || c.fmt === 'datetime') && 'whitespace-nowrap')}>{c.key === 'status' && typeof r[c.key] === 'string' ? <Badge tone={statusTone(String(r[c.key]).toLowerCase().replace(' ', '_'))}>{String(r[c.key])}</Badge> : fmtCell(r[c.key], c.fmt)}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold bg-slate-50/70">
              {data.columns.map((c) => <td key={c.key} className={cx('!border-t border-slate-200', numeric(c.fmt) && 'text-right')}>{totals[c.key] ?? ''}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      {rows.length > PAGE && (
        <div className="flex items-center justify-between pt-3 text-xs text-slate-500 print:hidden">
          <span>Showing {visible.length.toLocaleString()} of {rows.length.toLocaleString()} rows</span>
          <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => setShowAll((v) => !v)}>{showAll ? `Show first ${PAGE}` : 'Show all rows'}</button>
        </div>
      )}
    </div>
  )
}

// ─── Z-report ────────────────────────────────────────────────────────────────
function ZReport() {
  const db = useDB((s) => s.db)
  const navigate = useNavigate()
  const closed = useMemo(() => db.shifts.filter((s) => s.status === 'closed').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')), [db.shifts])
  const [shiftId, setShiftId] = useState<string>(closed[0]?.id ?? '')
  const shift = closed.find((s) => s.id === shiftId) ?? closed[0]
  const z = useMemo(() => (shift ? computeZ(shift, db) : null), [shift, db])

  if (!shift || !z) return <EmptyState title="No closed shifts yet" description="Close a shift from the cashier portal to generate a Z-report." />
  const reg = db.registers.find((r) => r.id === shift.registerId)
  const cashier = db.users.find((u) => u.id === shift.userId)
  const exportCsv = () => {
    const rows = Object.entries(z.kv).map(([k, v]) => ({ field: k, value: v }))
    downloadFile(`z-report-${reg?.name.replace(/\s+/g, '-') ?? 'register'}-${fmtDate(shift.closedAt, 'yyyyMMdd-HHmm')}.csv`, toCSV(rows), 'text/csv')
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-5 print:hidden">
        <Field label="Shift" className="min-w-[320px]">
          <Select value={shift.id} onChange={(e) => setShiftId(e.target.value)}>
            {closed.map((s) => { const r = db.registers.find((x) => x.id === s.registerId); const u = db.users.find((x) => x.id === s.userId); return <option key={s.id} value={s.id}>{fmtDate(s.closedAt)} {fmtTime(s.openedAt)}–{fmtTime(s.closedAt)} · {r?.name} · {u?.name}{s.difference ? ` · variance ${money(s.difference)}` : ''}</option> })}
          </Select>
        </Field>
        <button className="btn-secondary" onClick={exportCsv}><Download size={15} /> Export CSV</button>
        <button className="btn-ghost" onClick={() => navigate('/admin/registers')}>All shifts</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 flex flex-col gap-4">
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="flex items-center gap-3 mb-3">
              <IconBox color={reg?.color ?? '#2563eb'} size={40}><span className="text-sm font-bold">{reg?.name.replace(/\D/g, '') || 'R'}</span></IconBox>
              <div>
                <div className="font-semibold text-slate-800">{reg?.name ?? shift.registerId}</div>
                <div className="text-xs text-slate-400">{reg?.location}</div>
              </div>
              <Badge tone={statusTone(shift.status)} className="ml-auto">{shift.status}</Badge>
            </div>
            <KV label="Cashier" value={cashier ? <span className="inline-flex items-center gap-2"><Avatar name={cashier.name} color={cashier.color} size={20} />{cashier.name}</span> : '—'} />
            <KV label="Opened" value={fmtDateTime(shift.openedAt)} />
            <KV label="Closed" value={fmtDateTime(shift.closedAt)} />
            <KV label="Duration" value={z.duration} />
            <KV label="Sales count" value={z.salesCount} />
            <KV label="Avg ticket" value={money(z.avgTicket)} />
            <KV label="Items sold" value={z.items} />
            {shift.notes && <div className="text-xs text-slate-500 mt-2 rounded-lg bg-slate-50 p-2">{shift.notes}</div>}
          </div>
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Sales by tender</div>
            <KV label="Cash sales" value={money(shift.cashSales)} />
            <KV label="Card sales" value={money(shift.cardSales)} />
            <KV label="Other (mobile, credit, gift…)" value={money(shift.otherSales)} />
            <KV label="Refunds" value={<span className="text-red-600">-{money(Math.abs(shift.refundsTotal))} ({shift.refundsCount})</span>} />
            <KV label="Discounts given" value={money(z.discounts)} />
            <KV label={`${db.settings.taxName} collected`} value={money(z.tax)} />
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-100"><span className="font-semibold text-slate-800">Net sales</span><span className="font-bold text-slate-900 tabular-nums">{money(shift.salesTotal + shift.refundsTotal)}</span></div>
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Cash drawer reconciliation</div>
            <KV label="Opening float" value={money(shift.openingFloat)} />
            <KV label="+ Cash sales" value={money(shift.cashSales)} />
            <KV label="− Cash refunds" value={<span className="text-red-600">-{money(z.cashRefunds)}</span>} />
            <KV label="+ Cash in" value={money(z.cashIn)} />
            <KV label="− Cash out" value={<span className="text-red-600">-{money(z.cashOut)}</span>} />
            <div className="flex items-center justify-between py-2 mt-1 border-t border-slate-100"><span className="font-semibold text-slate-800">Expected cash</span><span className="font-bold tabular-nums">{money(z.expected)}</span></div>
            <div className="flex items-center justify-between py-1"><span className="font-semibold text-slate-800">Counted</span><span className="font-bold tabular-nums">{money(shift.closingCount ?? 0)}</span></div>
            <div className={cx('flex items-center justify-between py-2 px-3 rounded-lg mt-2', z.variance === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
              <span className="font-semibold">Variance</span>
              <span className="font-bold tabular-nums text-lg">{z.variance > 0 ? '+' : ''}{money(z.variance)}{z.variance !== 0 && <span className="text-xs font-medium ml-2">({z.variance > 0 ? 'surplus' : 'shortage'})</span>}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Cash movements</div>
              {shift.cashMovements.length === 0 && <div className="text-sm text-slate-400 py-2">No cash in/out during this shift.</div>}
              {shift.cashMovements.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-1.5 text-sm border-b border-slate-50 last:border-0">
                  <div><Badge tone={m.type === 'in' ? 'green' : 'red'}>{m.type === 'in' ? 'Cash in' : 'Cash out'}</Badge><span className="ml-2 text-slate-700">{m.reason}</span><div className="text-[11px] text-slate-400">{fmtTime(m.createdAt)} · {db.users.find((u) => u.id === m.userId)?.name}</div></div>
                  <span className={cx('font-semibold tabular-nums', m.type === 'in' ? 'text-emerald-600' : 'text-red-600')}>{m.type === 'in' ? '+' : '-'}{money(m.amount)}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Transactions in shift</div>
              {z.txs.length === 0 && <div className="text-sm text-slate-400 py-2">No transactions linked to this shift.</div>}
              <div className="max-h-64 overflow-y-auto">
                {z.txs.map((t) => (
                  <button key={t.id} onClick={() => navigate(`/admin/transactions/${t.id}`)} className="w-full flex items-center justify-between py-1.5 text-sm border-b border-slate-50 last:border-0 hover:bg-slate-50 text-left">
                    <span><span className="font-medium text-slate-800">{t.number}</span><span className="text-[11px] text-slate-400 ml-2">{fmtTime(t.createdAt)} · {t.payments.map((p) => PAYMENT_LABELS[p.method] ?? p.method).join('+')}</span></span>
                    <span className={cx('tabular-nums font-medium', t.status === 'voided' ? 'line-through text-slate-400' : t.total < 0 ? 'text-red-600' : '')}>{money(t.total)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function computeZ(shift: Shift, db: Database) {
  const txs: Transaction[] = db.transactions.filter((t) => t.shiftId === shift.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const sales = txs.filter((t) => t.type === 'sale' && t.status !== 'voided')
  const cashIn = round2(shift.cashMovements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0))
  const cashOut = round2(shift.cashMovements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0))
  const cashRefunds = round2(Math.abs(txs.filter((t) => t.type === 'refund').reduce((a, t) => a + t.payments.filter((p) => p.method === 'cash').reduce((b, p) => b + p.amount, 0), 0)))
  const expected = shift.expectedCash ?? round2(shift.openingFloat + shift.cashSales - cashRefunds + cashIn - cashOut)
  const variance = shift.difference ?? round2((shift.closingCount ?? 0) - expected)
  const salesCount = shift.salesCount || sales.length
  const gross = shift.salesTotal || round2(sales.reduce((a, t) => a + t.total, 0))
  const mins = shift.closedAt ? Math.round((parseISO(shift.closedAt).getTime() - parseISO(shift.openedAt).getTime()) / 60000) : 0
  const duration = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
  const reg = db.registers.find((r) => r.id === shift.registerId)?.name ?? shift.registerId
  const cashier = db.users.find((u) => u.id === shift.userId)?.name ?? shift.userId
  const discounts = round2(sales.reduce((a, t) => a + t.discountTotal, 0))
  const tax = round2(sales.reduce((a, t) => a + t.taxTotal, 0))
  const items = sales.reduce((a, t) => a + t.lines.reduce((b, l) => b + l.qty, 0), 0)
  const kv: Record<string, string | number> = {
    Register: reg, Cashier: cashier, Opened: fmtDateTime(shift.openedAt), Closed: fmtDateTime(shift.closedAt), Duration: duration,
    'Opening float': shift.openingFloat, 'Cash sales': shift.cashSales, 'Card sales': shift.cardSales, 'Other sales': shift.otherSales, 'Gross sales': gross, Refunds: Math.abs(shift.refundsTotal), 'Refund count': shift.refundsCount,
    'Cash refunds': cashRefunds, 'Cash in': cashIn, 'Cash out': cashOut, 'Expected cash': expected, 'Counted cash': shift.closingCount ?? 0, Variance: variance,
    'Sales count': salesCount, 'Avg ticket': salesCount ? round2(gross / salesCount) : 0, 'Items sold': items, Discounts: discounts, Tax: tax, Notes: shift.notes ?? '',
  }
  return { txs, cashIn, cashOut, cashRefunds, expected, variance, salesCount, avgTicket: salesCount ? round2(gross / salesCount) : 0, duration, discounts, tax, items, kv }
}
