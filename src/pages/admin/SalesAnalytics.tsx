import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, ArrowRight } from 'lucide-react'
import { format, parseISO, startOfDay, subDays } from 'date-fns'
import { useDB } from '@/store/db'
import { Avatar, Badge, Card, EmptyState, IconBox, Money, PageHeader, ProgressBar, Segmented, Select, StatCard, Toggle } from '@/components/ui'
import { CHART_COLORS, DonutChart, LegendDots, SimpleBarChart, TrendAreaChart } from '@/components/charts'
import {
  RANGE_OPTIONS, type RangeKey, txInRange, summarize, deltaPct, dailySeries, hourlySeries, topProducts, cashierPerformance, registerPerformance, rangeDays, fmtRangeLabel, sparkFrom,
} from '@/lib/analytics'
import { dayKey, downloadFile, money, round2, toCSV } from '@/lib/utils'
import { PAYMENT_LABELS } from '@/lib/pos'
import type { Transaction, ID } from '@/lib/types'

type ProductBy = 'revenue' | 'qty' | 'profit'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const rows = <T,>(arr: T[]) => arr as unknown as Record<string, unknown>[]

function periodSeries(txs: Transaction[], days: number, offsetPeriods: number) {
  const end = startOfDay(subDays(new Date(), days * offsetPeriods))
  const map = new Map<string, { date: string; label: string; idx: number; revenue: number; orders: number; profit: number; refunds: number }>()
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(end, i)
    const k = dayKey(d.toISOString())
    map.set(k, { date: k, label: format(d, 'MMM d'), idx: days - 1 - i, revenue: 0, orders: 0, profit: 0, refunds: 0 })
  }
  txs.forEach((t) => {
    if (t.status === 'voided') return
    const p = map.get(dayKey(t.createdAt))
    if (!p) return
    if (t.type === 'sale') { p.revenue = round2(p.revenue + t.total); p.orders++; p.profit = round2(p.profit + t.total - t.costTotal) }
    else if (t.type === 'refund') { p.refunds = round2(p.refunds + Math.abs(t.total)); p.revenue = round2(p.revenue - Math.abs(t.total)); p.profit = round2(p.profit + t.total - t.costTotal) }
  })
  return Array.from(map.values())
}

function exportCsv(name: string, data: Record<string, unknown>[]) {
  if (!data.length) return
  downloadFile(`${name}-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`, toCSV(data), 'text/csv')
}

function ExportBtn({ onClick }: { onClick: () => void }) {
  return <button className="btn-secondary !px-2.5 !py-1 !text-xs" onClick={onClick}><Download size={12} /> CSV</button>
}

export default function SalesAnalytics() {
  const db = useDB((s) => s.db)
  const navigate = useNavigate()
  const [range, setRange] = useState<RangeKey>('30d')
  const [compare, setCompare] = useState(true)
  const [productBy, setProductBy] = useState<ProductBy>('revenue')

  const a = useMemo(() => {
    const cur = txInRange(db.transactions, range)
    const prev = txInRange(db.transactions, range, 1)
    const curS = summarize(cur)
    const prevS = summarize(prev)
    const firstTx = db.transactions.reduce<string | undefined>((m, t) => (!m || t.createdAt < m ? t.createdAt : m), undefined)
    const daysAll = firstTx ? Math.max(1, Math.ceil((Date.now() - parseISO(firstTx).getTime()) / 86400000) + 1) : 30
    const days = range === 'all' ? Math.min(daysAll, 365) : rangeDays(range)
    const curSeries = periodSeries(cur, days, 0)
    const prevSeries = range === 'all' ? [] : periodSeries(prev, days, 1)
    const overlay = curSeries.map((p, i) => ({ label: p.label, current: p.revenue, previous: prevSeries[i]?.revenue ?? 0, previousLabel: prevSeries[i]?.label ?? '' }))
    const hourCur = hourlySeries(cur)
    const hourPrev = hourlySeries(prev)
    const hourOverlay = hourCur.map((h, i) => ({ hour: h.hour, current: h.revenue, previous: hourPrev[i]?.revenue ?? 0, orders: h.orders }))
    const sparkSeries = dailySeries(db.transactions, Math.min(days, 30))

    // day of week
    const dow = DOW.map((d) => ({ day: d, revenue: 0, orders: 0, days: new Set<string>() }))
    cur.forEach((t) => {
      if (t.status === 'voided') return
      const d = parseISO(t.createdAt).getDay()
      const x = dow[d]!
      x.days.add(dayKey(t.createdAt))
      if (t.type === 'sale') { x.revenue = round2(x.revenue + t.total); x.orders++ }
      else if (t.type === 'refund') x.revenue = round2(x.revenue - Math.abs(t.total))
    })
    const dowRows = [...dow.slice(1), dow[0]!].map((x) => ({ day: x.day, revenue: x.revenue, orders: x.orders, avgPerDay: x.days.size ? round2(x.revenue / x.days.size) : 0 }))

    // payment methods
    const byMethod = Object.entries(curS.byMethod).map(([m, v], i) => ({ name: PAYMENT_LABELS[m] ?? m, method: m, value: v, color: CHART_COLORS[i % CHART_COLORS.length]!, count: cur.filter((t) => t.type === 'sale' && t.status !== 'voided' && t.payments.some((p) => p.method === m)).length })).sort((x, y) => y.value - x.value)
    const methodTotal = byMethod.reduce((s, m) => s + m.value, 0) || 1

    // category + brand breakdown with margin
    const catMap = new Map<ID, { revenue: number; units: number; cost: number; tax: number }>()
    const brandMap = new Map<ID, { revenue: number; units: number; cost: number; tax: number }>()
    cur.forEach((t) => {
      if (t.status === 'voided') return
      t.lines.forEach((l) => {
        const p = db.products.find((x) => x.id === l.productId)
        const add = (map: Map<ID, { revenue: number; units: number; cost: number; tax: number }>, key: ID) => {
          const s = map.get(key) ?? { revenue: 0, units: 0, cost: 0, tax: 0 }
          s.revenue = round2(s.revenue + l.lineTotal)
          s.units += l.qty
          s.cost = round2(s.cost + l.cost * l.qty)
          s.tax = round2(s.tax + l.taxAmount)
          map.set(key, s)
        }
        add(catMap, p?.categoryId ?? 'unknown')
        add(brandMap, p?.brandId ?? 'unknown')
      })
    })
    const catTotal = Array.from(catMap.values()).reduce((s, c) => s + c.revenue, 0) || 1
    const cats = db.categories.map((c) => {
      const s = catMap.get(c.id) ?? { revenue: 0, units: 0, cost: 0, tax: 0 }
      const net = s.revenue - s.tax
      return { id: c.id, name: c.name, color: c.color, icon: c.icon, revenue: s.revenue, units: s.units, share: round2((s.revenue / catTotal) * 100), profit: round2(net - s.cost), margin: net ? round2(((net - s.cost) / net) * 100) : 0 }
    }).filter((c) => c.revenue !== 0).sort((x, y) => y.revenue - x.revenue)
    const brandTotal = Array.from(brandMap.values()).reduce((s, c) => s + c.revenue, 0) || 1
    const brands = db.brands.map((b) => {
      const s = brandMap.get(b.id) ?? { revenue: 0, units: 0, cost: 0, tax: 0 }
      const net = s.revenue - s.tax
      return { id: b.id, name: b.name, revenue: s.revenue, units: s.units, share: round2((s.revenue / brandTotal) * 100), profit: round2(net - s.cost), margin: net ? round2(((net - s.cost) / net) * 100) : 0 }
    }).filter((c) => c.revenue !== 0).sort((x, y) => y.revenue - x.revenue)

    const cashiers = cashierPerformance(cur, db)
    const registers = registerPerformance(cur, db)
    const regTotal = registers.reduce((s, r) => s + r.revenue, 0) || 1
    const products = topProducts(cur, db.products, 10, productBy)
    const productMax = Math.max(1, ...products.map((p) => p[productBy]))

    // discounts & refunds
    const sales = cur.filter((t) => t.type === 'sale' && t.status !== 'voided')
    const discounted = sales.filter((t) => t.discountTotal > 0)
    const promoUse = discounted.filter((t) => t.promoCode).length
    const overrides = sales.reduce((s, t) => s + t.lines.filter((l) => l.unitPrice !== l.originalPrice).length, 0)
    const refunds = cur.filter((t) => t.type === 'refund')
    const voids = cur.filter((t) => t.status === 'voided')
    const grossBeforeDiscount = curS.gross + curS.discounts
    const reasonMap = new Map<string, { count: number; total: number }>()
    refunds.forEach((t) => { const k = (t.note ?? 'No reason').trim() || 'No reason'; const s = reasonMap.get(k) ?? { count: 0, total: 0 }; s.count++; s.total = round2(s.total + Math.abs(t.total)); reasonMap.set(k, s) })
    const reasons = Array.from(reasonMap.entries()).map(([reason, s]) => ({ reason, ...s })).sort((x, y) => y.total - x.total).slice(0, 5)
    const discounts = {
      rate: grossBeforeDiscount ? round2((curS.discounts / grossBeforeDiscount) * 100) : 0,
      total: curS.discounts, count: discounted.length, avg: discounted.length ? round2(curS.discounts / discounted.length) : 0, promoUse, overrides,
      share: sales.length ? round2((discounted.length / sales.length) * 100) : 0,
    }
    const refundStats = {
      rate: curS.gross ? round2((curS.refunds / curS.gross) * 100) : 0, total: curS.refunds, count: refunds.length, avg: refunds.length ? round2(curS.refunds / refunds.length) : 0,
      voids: voids.length, voidTotal: round2(voids.reduce((s, t) => s + t.total, 0)), reasons,
      restocked: refunds.filter((t) => db.stockMovements.some((m) => m.refId === t.id && m.type === 'refund')).length,
    }

    return { cur, prev, curS, prevS, days, overlay, hourOverlay, sparkSeries, dowRows, byMethod, methodTotal, cats, brands, cashiers, registers, regTotal, products, productMax, discounts, refundStats }
  }, [db, range, productBy])

  const { curS, prevS } = a
  const cmp = compare && range !== 'all'
  const d = (c: number, p: number) => (cmp ? deltaPct(c, p) : undefined)
  const prevLabel = `previous ${fmtRangeLabel(range).toLowerCase().replace('last ', '')}`

  const cashierChart = a.cashiers.slice(0, 8).map((c) => ({ name: c.name.split(' ')[0]!, revenue: c.revenue, refunds: c.refunds }))

  return (
    <div>
      <PageHeader
        title="Sales Analytics"
        subtitle={`${fmtRangeLabel(range)} · ${a.cur.length.toLocaleString()} transactions${cmp ? ` · compared with the ${prevLabel}` : ''}`}
        actions={
          <>
            <Toggle checked={cmp} disabled={range === 'all'} onChange={setCompare} label="Compare to previous" />
            <Select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className="w-44">
              {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <StatCard label="Net revenue" value={money(curS.revenue)} delta={d(curS.revenue, prevS.revenue)} trend={sparkFrom(a.sparkSeries, 'revenue', 30)} hint={cmp ? `${money(prevS.revenue)} ${prevLabel}` : `${money(curS.gross)} gross`} />
        <StatCard label="Orders" value={curS.orders.toLocaleString()} delta={d(curS.orders, prevS.orders)} trend={sparkFrom(a.sparkSeries, 'orders', 30)} hint={cmp ? `${prevS.orders} ${prevLabel}` : `${curS.items} items`} />
        <StatCard label="Avg order value" value={money(curS.avgOrder)} delta={d(curS.avgOrder, prevS.avgOrder)} trend={a.sparkSeries.slice(-30).map((p) => (p.orders ? p.revenue / p.orders : 0))} hint={cmp ? `${money(prevS.avgOrder)} ${prevLabel}` : undefined} />
        <StatCard label="Gross profit" value={money(curS.profit)} delta={d(curS.profit, prevS.profit)} trend={sparkFrom(a.sparkSeries, 'profit', 30)} hint={`${curS.margin.toFixed(1)}% margin · COGS ${money(curS.cost)}`} />
        <StatCard label="Refunds" value={money(curS.refunds)} delta={d(curS.refunds, prevS.refunds)} invert trend={sparkFrom(a.sparkSeries, 'refunds', 30)} hint={`${curS.refundCount} refunds · ${curS.voidCount} voids`} />
        <StatCard label="Discounts" value={money(curS.discounts)} delta={d(curS.discounts, prevS.discounts)} invert hint={`${a.discounts.rate.toFixed(1)}% of gross · ${a.discounts.count} orders`} />
        <StatCard label="Tax collected" value={money(curS.tax)} delta={d(curS.tax, prevS.tax)} hint={`${db.settings.taxName} at ${db.settings.taxRate}%`} />
        <StatCard label="Items sold" value={curS.items.toLocaleString()} delta={d(curS.items, prevS.items)} trend={sparkFrom(a.sparkSeries, 'items', 30)} hint={`${curS.orders ? (curS.items / curS.orders).toFixed(1) : '0'} per order`} />
      </div>

      {/* Revenue overlay */}
      <Card className="mb-4" title={range === 'today' ? 'Revenue by hour' : 'Revenue vs previous period'} subtitle={range === 'today' ? `Today compared with yesterday` : `Daily net revenue · ${fmtRangeLabel(range)}${cmp ? ` overlaid on the ${prevLabel}` : ''}`}
        action={<LegendDots items={cmp ? [{ name: 'Current', color: CHART_COLORS[0]! }, { name: 'Previous', color: '#94a3b8' }] : [{ name: 'Revenue', color: CHART_COLORS[0]! }]} />}>
        {range === 'today' ? (
          <SimpleBarChart data={rows(a.hourOverlay)} xKey="hour" bars={cmp ? [{ key: 'current', name: 'Today', color: CHART_COLORS[0]! }, { key: 'previous', name: 'Yesterday', color: '#cbd5e1' }] : [{ key: 'current', name: 'Revenue', color: CHART_COLORS[0]! }]} height={280} moneyKeys={['current', 'previous']} />
        ) : (
          <TrendAreaChart data={rows(a.overlay)} series={cmp ? [{ key: 'previous', name: 'Previous period', color: '#94a3b8' }, { key: 'current', name: 'Current period', color: CHART_COLORS[0]! }] : [{ key: 'current', name: 'Revenue', color: CHART_COLORS[0]! }]} height={280} />
        )}
      </Card>

      {/* Hour + DOW + Payment */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
        <Card title="Sales by hour" subtitle="Revenue and order count by hour of day" action={<ExportBtn onClick={() => exportCsv('sales-by-hour', a.hourOverlay.map((h) => ({ hour: h.hour, revenue: h.current, orders: h.orders })))} />}>
          <SimpleBarChart data={rows(a.hourOverlay)} xKey="hour" bars={[{ key: 'current', name: 'Revenue', color: CHART_COLORS[0]! }]} height={220} moneyKeys={['current']} />
          <div className="mt-2 text-xs text-slate-500">Peak hour: <b className="text-slate-700">{[...a.hourOverlay].sort((x, y) => y.current - x.current)[0]?.hour ?? '—'}</b> · {a.hourOverlay.reduce((s, h) => s + h.orders, 0)} orders across opening hours</div>
        </Card>
        <Card title="Sales by day of week" subtitle="Average revenue per trading day" action={<ExportBtn onClick={() => exportCsv('sales-by-weekday', a.dowRows)} />}>
          <SimpleBarChart data={rows(a.dowRows)} xKey="day" bars={[{ key: 'avgPerDay', name: 'Avg / day', color: CHART_COLORS[4]! }]} height={220} moneyKeys={['avgPerDay']} />
          <div className="mt-2 text-xs text-slate-500">Best day: <b className="text-slate-700">{[...a.dowRows].sort((x, y) => y.avgPerDay - x.avgPerDay)[0]?.day ?? '—'}</b> · slowest: <b className="text-slate-700">{[...a.dowRows].filter((x) => x.revenue > 0).sort((x, y) => x.avgPerDay - y.avgPerDay)[0]?.day ?? '—'}</b></div>
        </Card>
        <Card title="Payment methods" subtitle="Share of tendered amount" action={<ExportBtn onClick={() => exportCsv('payment-methods', a.byMethod.map((m) => ({ method: m.name, amount: m.value, transactions: m.count, share: round2((m.value / a.methodTotal) * 100) })))} />}>
          {a.byMethod.length === 0 ? <EmptyState title="No payments in period" /> : (
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="w-full sm:w-1/2 relative">
                <DonutChart data={a.byMethod} height={190} />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-[11px] text-slate-400">Tendered</div>
                  <div className="text-base font-bold text-slate-800">{money(a.methodTotal)}</div>
                </div>
              </div>
              <div className="w-full sm:w-1/2 flex flex-col gap-2">
                {a.byMethod.map((m) => (
                  <div key={m.method} className="flex items-center gap-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: m.color }} />
                    <span className="flex-1 truncate text-slate-700">{m.name}</span>
                    <span className="text-xs text-slate-400 tabular-nums">{m.count} tx</span>
                    <span className="text-xs font-semibold text-slate-700 w-10 text-right tabular-nums">{((m.value / a.methodTotal) * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Category + brand */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-4">
        <Card className="xl:col-span-3" title="Sales by category" subtitle="Revenue, units, share of sales and gross margin" padded={false} action={<ExportBtn onClick={() => exportCsv('sales-by-category', a.cats.map((c) => ({ category: c.name, revenue: c.revenue, units: c.units, share: c.share, profit: c.profit, margin: c.margin })))} />}>
          <div className="overflow-x-auto pb-2">
            <table className="table">
              <thead><tr><th>Category</th><th className="text-right">Revenue</th><th className="text-right">Units</th><th className="w-40">Share</th><th className="text-right">Profit</th><th className="text-right">Margin</th></tr></thead>
              <tbody>
                {a.cats.map((c) => (
                  <tr key={c.id}>
                    <td><div className="flex items-center gap-2.5"><IconBox color={c.color} size={30}><span className="text-sm">{c.icon}</span></IconBox><span className="font-medium text-slate-800">{c.name}</span></div></td>
                    <td className="text-right font-semibold"><Money value={c.revenue} /></td>
                    <td className="text-right tabular-nums">{c.units}</td>
                    <td><div className="flex items-center gap-2"><ProgressBar value={c.share} color={c.color} className="flex-1 !h-2" /><span className="text-xs tabular-nums w-10 text-right">{c.share.toFixed(1)}%</span></div></td>
                    <td className="text-right"><Money value={c.profit} /></td>
                    <td className="text-right"><Badge tone={c.margin >= 30 ? 'green' : c.margin >= 15 ? 'amber' : 'red'}>{c.margin.toFixed(1)}%</Badge></td>
                  </tr>
                ))}
                {a.cats.length > 0 && (
                  <tr className="font-semibold bg-slate-50/60">
                    <td>Total</td>
                    <td className="text-right"><Money value={a.cats.reduce((s, c) => s + c.revenue, 0)} /></td>
                    <td className="text-right tabular-nums">{a.cats.reduce((s, c) => s + c.units, 0)}</td>
                    <td />
                    <td className="text-right"><Money value={a.cats.reduce((s, c) => s + c.profit, 0)} /></td>
                    <td className="text-right">{curS.margin.toFixed(1)}%</td>
                  </tr>
                )}
              </tbody>
            </table>
            {a.cats.length === 0 && <EmptyState title="No sales in this period" />}
          </div>
        </Card>
        <Card className="xl:col-span-2" title="Sales by brand" subtitle="Top brands by revenue" action={<ExportBtn onClick={() => exportCsv('sales-by-brand', a.brands.map((b) => ({ brand: b.name, revenue: b.revenue, units: b.units, share: b.share, margin: b.margin })))} />}>
          <div className="flex flex-col gap-3">
            {a.brands.slice(0, 8).map((b, i) => (
              <div key={b.id}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-slate-800">{b.name} <span className="text-xs text-slate-400 font-normal">· {b.units} units · {b.margin.toFixed(0)}% margin</span></span>
                  <span className="font-semibold tabular-nums">{money(b.revenue)}</span>
                </div>
                <div className="flex items-center gap-2"><ProgressBar value={b.share} color={CHART_COLORS[i % CHART_COLORS.length]} className="flex-1 !h-2" /><span className="text-[11px] text-slate-500 w-9 text-right tabular-nums">{b.share.toFixed(0)}%</span></div>
              </div>
            ))}
            {a.brands.length === 0 && <EmptyState title="No sales in this period" />}
          </div>
        </Card>
      </div>

      {/* Cashiers */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-4">
        <Card className="xl:col-span-3" title="Cashier performance" subtitle="Orders, revenue, refunds and discounts by staff member" padded={false} action={<ExportBtn onClick={() => exportCsv('cashier-performance', a.cashiers.map((c) => ({ cashier: c.name, role: c.role, orders: c.orders, revenue: c.revenue, avgOrder: c.avgOrder, items: c.items, refunds: c.refunds, refundCount: c.refundCount, discounts: c.discounts, profit: c.profit })))} />}>
          <div className="overflow-x-auto pb-2">
            <table className="table">
              <thead><tr><th>Cashier</th><th className="text-right">Orders</th><th className="text-right">Revenue</th><th className="text-right">Avg order</th><th className="text-right">Refunds</th><th className="text-right">Discounts</th><th className="text-right">Margin</th></tr></thead>
              <tbody>
                {a.cashiers.map((c) => (
                  <tr key={c.id}>
                    <td><div className="flex items-center gap-2.5"><Avatar name={c.name} color={c.color} size={28} /><div><div className="font-medium text-slate-800 whitespace-nowrap">{c.name}</div><div className="text-[11px] text-slate-400 capitalize">{c.role}</div></div></div></td>
                    <td className="text-right tabular-nums">{c.orders}</td>
                    <td className="text-right font-semibold"><Money value={c.revenue} /></td>
                    <td className="text-right"><Money value={c.avgOrder} /></td>
                    <td className="text-right"><span className={c.refunds > 0 ? 'text-red-600' : ''}>{money(c.refunds)}</span><span className="text-[11px] text-slate-400"> ({c.refundCount})</span></td>
                    <td className="text-right"><Money value={c.discounts} /></td>
                    <td className="text-right"><Badge tone={c.margin >= 30 ? 'green' : c.margin >= 15 ? 'amber' : 'red'}>{c.margin.toFixed(0)}%</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {a.cashiers.length === 0 && <EmptyState title="No cashier activity" />}
          </div>
        </Card>
        <Card className="xl:col-span-2" title="Revenue by cashier" subtitle="Net revenue and refunds" action={<LegendDots items={[{ name: 'Revenue', color: CHART_COLORS[0]! }, { name: 'Refunds', color: CHART_COLORS[2]! }]} />}>
          <SimpleBarChart data={rows(cashierChart)} xKey="name" bars={[{ key: 'revenue', name: 'Revenue', color: CHART_COLORS[0]! }, { key: 'refunds', name: 'Refunds', color: CHART_COLORS[2]! }]} height={260} layout="vertical" />
        </Card>
      </div>

      {/* Registers + top products */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Register performance" subtitle="Net revenue per register" action={<ExportBtn onClick={() => exportCsv('register-performance', a.registers.map((r) => ({ register: r.name, orders: r.orders, revenue: r.revenue, avgOrder: r.avgOrder, refunds: r.refunds, items: r.items })))} />}>
          <div className="flex flex-col gap-3">
            {a.registers.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-center gap-3">
                  <IconBox color={r.color} size={36}><span className="text-[13px] font-bold">{r.name.replace(/\D/g, '') || 'R'}</span></IconBox>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800">{r.name}</div>
                    <div className="text-xs text-slate-400">{r.orders} orders · avg {money(r.avgOrder)} · {r.items} items</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-slate-900 tabular-nums">{money(r.revenue)}</div>
                    <div className="text-[11px] text-red-500">{r.refunds > 0 ? `-${money(r.refunds)} refunds` : 'no refunds'}</div>
                  </div>
                </div>
                <ProgressBar value={(r.revenue / a.regTotal) * 100} color={r.color} className="mt-2.5 !h-1.5" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="xl:col-span-3" title="Top 10 products" subtitle={`Ranked by ${productBy === 'qty' ? 'units sold' : productBy}`} padded={false}
          action={<><Segmented value={productBy} onChange={setProductBy} options={[{ value: 'revenue', label: 'Revenue' }, { value: 'qty', label: 'Quantity' }, { value: 'profit', label: 'Profit' }]} /><ExportBtn onClick={() => exportCsv('top-products', a.products.map((p, i) => ({ rank: i + 1, product: p.name, qty: p.qty, revenue: p.revenue, profit: p.profit })))} /></>}>
          <div className="overflow-x-auto pb-2">
            <table className="table">
              <thead><tr><th className="w-8">#</th><th>Product</th><th className="text-right">Qty</th><th className="text-right">Revenue</th><th className="text-right">Profit</th><th className="w-36" /></tr></thead>
              <tbody>
                {a.products.map((p, i) => {
                  const prod = db.products.find((x) => x.id === p.productId)
                  return (
                    <tr key={p.productId} className="cursor-pointer" onClick={() => navigate(`/admin/catalog/${p.productId}`)}>
                      <td className="text-slate-400 tabular-nums">{i + 1}</td>
                      <td><div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-lg">{p.emoji}</div><div className="min-w-0"><div className="font-medium text-slate-800 truncate max-w-[260px]">{p.name}</div><div className="text-[11px] text-slate-400">{prod?.sku ?? ''}{prod && prod.categoryId !== 'cat_service' ? ` · ${prod.stock} in stock` : ''}</div></div></div></td>
                      <td className="text-right tabular-nums">{p.qty}</td>
                      <td className="text-right font-semibold"><Money value={p.revenue} /></td>
                      <td className="text-right"><Money value={p.profit} /></td>
                      <td><ProgressBar value={(p[productBy] / a.productMax) * 100} color={CHART_COLORS[0]} className="!h-2" /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {a.products.length === 0 && <EmptyState title="No sales in this period" />}
          </div>
        </Card>
      </div>

      {/* Discounts & refunds */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Discount analysis" subtitle="Line, cart and promo code discounts on completed sales">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat label="Discount rate" value={`${a.discounts.rate.toFixed(1)}%`} sub="of gross sales" />
            <Stat label="Total given" value={money(a.discounts.total)} sub={`${a.discounts.count} orders (${a.discounts.share}%)`} />
            <Stat label="Avg per order" value={money(a.discounts.avg)} sub="discounted orders" />
          </div>
          <div className="flex flex-col divide-y divide-slate-100 text-sm">
            <Row label="Orders using a promo code" value={a.discounts.promoUse.toString()} />
            <Row label="Price overrides on lines" value={a.discounts.overrides.toString()} />
            <Row label="Large-discount threshold" value={`${db.settings.largeDiscountThreshold}%`} />
            <Row label="Cashier max discount" value={`${db.settings.cashierMaxDiscountPercent}%`} />
          </div>
          <button className="btn-ghost !px-2 !py-1 !text-xs mt-3" onClick={() => navigate('/admin/promotions')}>Manage promotions <ArrowRight size={12} /></button>
        </Card>
        <Card title="Refund & void analysis" subtitle="Money returned to customers and cancelled sales">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat label="Refund rate" value={`${a.refundStats.rate.toFixed(1)}%`} sub="of gross sales" tone="red" />
            <Stat label="Refunded" value={money(a.refundStats.total)} sub={`${a.refundStats.count} refunds · avg ${money(a.refundStats.avg)}`} tone="red" />
            <Stat label="Voided" value={money(a.refundStats.voidTotal)} sub={`${a.refundStats.voids} voided sales`} />
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Top refund reasons</div>
          <div className="flex flex-col divide-y divide-slate-100 text-sm">
            {a.refundStats.reasons.map((r) => <Row key={r.reason} label={r.reason} value={`${money(r.total)} · ${r.count}×`} />)}
            {a.refundStats.reasons.length === 0 && <div className="py-2 text-slate-400 text-sm">No refunds in this period.</div>}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => navigate('/admin/transactions?type=refund')}>View refunds <ArrowRight size={12} /></button>
            <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => navigate('/admin/transactions?status=voided')}>View voids <ArrowRight size={12} /></button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${tone === 'red' ? 'text-red-600' : 'text-slate-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between py-1.5"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-800 tabular-nums">{value}</span></div>
}
