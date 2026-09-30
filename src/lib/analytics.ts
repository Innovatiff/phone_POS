import type { Database, Transaction, Product, ID } from './types'
import { daysAgo, dayKey, round2 } from './utils'
import { format, parseISO, subDays, startOfDay } from 'date-fns'

export type RangeKey = 'today' | '7d' | '30d' | '90d' | 'all'
export const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]
export function rangeDays(r: RangeKey): number {
  return r === 'today' ? 1 : r === '7d' ? 7 : r === '30d' ? 30 : r === '90d' ? 90 : 3650
}
export function rangeStart(r: RangeKey): Date {
  const d = rangeDays(r)
  return startOfDay(subDays(new Date(), d - 1))
}

export function txInRange(txs: Transaction[], r: RangeKey, offsetPeriods = 0): Transaction[] {
  const d = rangeDays(r)
  const end = startOfDay(subDays(new Date(), d * offsetPeriods - (offsetPeriods > 0 ? 1 : 0)))
  const endTs = offsetPeriods > 0 ? end.getTime() + 86400000 : Number.POSITIVE_INFINITY
  const start = startOfDay(subDays(new Date(), d * (offsetPeriods + 1) - 1)).getTime()
  return txs.filter((t) => { const ts = parseISO(t.createdAt).getTime(); return ts >= start && ts < endTs })
}

export interface Summary {
  revenue: number // net of refunds & voids
  gross: number
  refunds: number
  orders: number
  items: number
  avgOrder: number
  cost: number
  profit: number
  margin: number
  tax: number
  discounts: number
  refundCount: number
  voidCount: number
  byMethod: Record<string, number>
}

export function summarize(txs: Transaction[]): Summary {
  const sales = txs.filter((t) => t.type === 'sale' && t.status !== 'voided')
  const refunds = txs.filter((t) => t.type === 'refund')
  const gross = round2(sales.reduce((a, t) => a + t.total, 0))
  const refundTotal = round2(refunds.reduce((a, t) => a + Math.abs(t.total), 0))
  const revenue = round2(gross - refundTotal)
  const cost = round2(sales.reduce((a, t) => a + t.costTotal, 0) + refunds.reduce((a, t) => a + t.costTotal, 0))
  const profit = round2(revenue - cost)
  const items = sales.reduce((a, t) => a + t.lines.reduce((b, l) => b + l.qty, 0), 0) - refunds.reduce((a, t) => a + t.lines.reduce((b, l) => b + Math.abs(l.qty), 0), 0)
  const byMethod: Record<string, number> = {}
  sales.forEach((t) => t.payments.forEach((p) => (byMethod[p.method] = round2((byMethod[p.method] ?? 0) + p.amount))))
  return {
    revenue, gross, refunds: refundTotal, orders: sales.length, items, avgOrder: sales.length ? round2(gross / sales.length) : 0, cost, profit,
    margin: revenue ? round2((profit / revenue) * 100) : 0, tax: round2(sales.reduce((a, t) => a + t.taxTotal, 0)), discounts: round2(sales.reduce((a, t) => a + t.discountTotal, 0)),
    refundCount: refunds.length, voidCount: txs.filter((t) => t.status === 'voided').length, byMethod,
  }
}

export function deltaPct(cur: number, prev: number): number {
  if (!prev) return cur ? 100 : 0
  return round2(((cur - prev) / prev) * 100)
}

export interface DayPoint { date: string; label: string; revenue: number; orders: number; refunds: number; profit: number; items: number }
export function dailySeries(txs: Transaction[], days: number): DayPoint[] {
  const map = new Map<string, DayPoint>()
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgo(i)
    const k = dayKey(d.toISOString())
    map.set(k, { date: k, label: format(d, days > 45 ? 'MMM d' : 'MMM d'), revenue: 0, orders: 0, refunds: 0, profit: 0, items: 0 })
  }
  txs.forEach((t) => {
    if (t.status === 'voided') return
    const p = map.get(dayKey(t.createdAt))
    if (!p) return
    if (t.type === 'sale') { p.revenue = round2(p.revenue + t.total); p.orders++; p.profit = round2(p.profit + t.total - t.costTotal); p.items += t.lines.reduce((a, l) => a + l.qty, 0) }
    else if (t.type === 'refund') { p.refunds = round2(p.refunds + Math.abs(t.total)); p.revenue = round2(p.revenue - Math.abs(t.total)); p.profit = round2(p.profit + t.total - t.costTotal) }
  })
  return Array.from(map.values())
}

export function hourlySeries(txs: Transaction[]): Array<{ hour: string; revenue: number; orders: number }> {
  const arr = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, '0')}:00`, revenue: 0, orders: 0 }))
  txs.forEach((t) => {
    if (t.type !== 'sale' || t.status === 'voided') return
    const h = parseISO(t.createdAt).getHours()
    arr[h]!.revenue = round2(arr[h]!.revenue + t.total)
    arr[h]!.orders++
  })
  return arr.filter((x, i) => i >= 8 && i <= 21)
}

export interface ProductStat { productId: ID; name: string; emoji: string; qty: number; revenue: number; profit: number; categoryId: ID }
export function topProducts(txs: Transaction[], products: Product[], limit = 10, by: 'revenue' | 'qty' | 'profit' = 'revenue'): ProductStat[] {
  const map = new Map<ID, ProductStat>()
  txs.forEach((t) => {
    if (t.status === 'voided') return
    t.lines.forEach((l) => {
      const p = products.find((x) => x.id === l.productId)
      const s = map.get(l.productId) ?? { productId: l.productId, name: l.name, emoji: l.emoji, qty: 0, revenue: 0, profit: 0, categoryId: p?.categoryId ?? '' }
      s.qty += l.qty
      s.revenue = round2(s.revenue + l.lineTotal)
      s.profit = round2(s.profit + l.lineTotal - l.taxAmount - l.cost * l.qty)
      map.set(l.productId, s)
    })
  })
  return Array.from(map.values()).sort((a, b) => b[by] - a[by]).slice(0, limit)
}

export function categoryBreakdown(txs: Transaction[], db: Database): Array<{ id: ID; name: string; color: string; revenue: number; qty: number; share: number }> {
  const map = new Map<ID, { revenue: number; qty: number }>()
  txs.forEach((t) => {
    if (t.status === 'voided') return
    t.lines.forEach((l) => {
      const p = db.products.find((x) => x.id === l.productId)
      const cid = p?.categoryId ?? 'unknown'
      const s = map.get(cid) ?? { revenue: 0, qty: 0 }
      s.revenue = round2(s.revenue + l.lineTotal)
      s.qty += l.qty
      map.set(cid, s)
    })
  })
  const total = Array.from(map.values()).reduce((a, s) => a + s.revenue, 0) || 1
  return db.categories.map((c) => ({ id: c.id, name: c.name, color: c.color, revenue: map.get(c.id)?.revenue ?? 0, qty: map.get(c.id)?.qty ?? 0, share: round2(((map.get(c.id)?.revenue ?? 0) / total) * 100) })).filter((c) => c.revenue > 0).sort((a, b) => b.revenue - a.revenue)
}

export function cashierPerformance(txs: Transaction[], db: Database) {
  return db.users.filter((u) => u.role !== 'admin' || txs.some((t) => t.userId === u.id)).map((u) => {
    const mine = txs.filter((t) => t.userId === u.id)
    const s = summarize(mine)
    return { id: u.id, name: u.name, color: u.color, role: u.role, ...s }
  }).filter((x) => x.orders > 0 || x.refundCount > 0).sort((a, b) => b.revenue - a.revenue)
}

export function registerPerformance(txs: Transaction[], db: Database) {
  return db.registers.map((r) => {
    const mine = txs.filter((t) => t.registerId === r.id)
    const s = summarize(mine)
    return { id: r.id, name: r.name, color: r.color, ...s }
  })
}

export function inventoryValue(products: Product[]) {
  const stockable = products.filter((p) => p.categoryId !== 'cat_service')
  return {
    units: stockable.reduce((a, p) => a + Math.max(0, p.stock), 0),
    cost: round2(stockable.reduce((a, p) => a + Math.max(0, p.stock) * p.cost, 0)),
    retail: round2(stockable.reduce((a, p) => a + Math.max(0, p.stock) * p.price, 0)),
    low: stockable.filter((p) => p.stock > 0 && p.stock <= p.lowStockThreshold).length,
    out: stockable.filter((p) => p.stock <= 0).length,
  }
}

export function sparkFrom(series: DayPoint[], key: keyof DayPoint, points = 14): number[] {
  return series.slice(-points).map((p) => Number(p[key]) || 0)
}

export function fmtRangeLabel(r: RangeKey): string {
  return RANGE_OPTIONS.find((x) => x.value === r)?.label ?? r
}
