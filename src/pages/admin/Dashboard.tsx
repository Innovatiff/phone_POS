import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight, TrendingUp, TrendingDown, PackageX, Wallet, RotateCcw, Trophy, AlertTriangle, Wrench, Bell, ShoppingBag, Percent, Landmark, Tag, Users, Coins,
} from 'lucide-react'
import { useDB } from '@/store/db'
import { Avatar, Badge, Card, IconBox, Money, PageHeader, ProgressBar, Select, StatCard, EmptyState, statusTone } from '@/components/ui'
import { DonutChart, LegendDots, TrendAreaChart, CHART_COLORS } from '@/components/charts'
import {
  RANGE_OPTIONS, type RangeKey, txInRange, summarize, deltaPct, dailySeries, sparkFrom, topProducts, categoryBreakdown, cashierPerformance, inventoryValue, rangeDays, fmtRangeLabel,
} from '@/lib/analytics'
import { ago, fmtDate, fmtTime, money, nowISO, sameDay, cx } from '@/lib/utils'
import { PAYMENT_LABELS } from '@/lib/pos'
import type { Transaction, Alert } from '@/lib/types'

type Insight = {
  id: string
  priority: 'high' | 'info'
  icon: React.ReactNode
  color: string
  title: string
  detail: string
  cta: string
  to: string
}

const methodTone = (m: string) => (m === 'cash' ? 'green' : m === 'card' ? 'blue' : m === 'mobile' ? 'purple' : m === 'store_credit' ? 'amber' : m === 'gift_card' ? 'pink' : 'cyan') as 'green' | 'blue' | 'purple' | 'amber' | 'pink' | 'cyan'

export default function Dashboard() {
  const db = useDB((s) => s.db)
  const navigate = useNavigate()
  const [range, setRange] = useState<RangeKey>('30d')

  const data = useMemo(() => {
    const cur = txInRange(db.transactions, range)
    const prev = txInRange(db.transactions, range, 1)
    const curS = summarize(cur)
    const prevS = summarize(prev)
    const days = rangeDays(range)
    const series = dailySeries(db.transactions, Math.max(days, range === 'today' ? 14 : days))
    const seriesRange = range === 'today' ? dailySeries(db.transactions, 14) : series
    const sparkPts = range === 'today' ? 14 : Math.min(days, 30)
    const products = topProducts(cur, db.products, 6, 'revenue')
    const totalProductRevenue = products.reduce((a, p) => a + p.revenue, 0) || 1
    const cats = categoryBreakdown(cur, db)
    const cashiers = cashierPerformance(cur, db)
    const inv = inventoryValue(db.products)
    const activeCustomers = new Set(cur.filter((t) => t.type === 'sale' && t.status !== 'voided' && t.customerId).map((t) => t.customerId)).size
    const recent = [...db.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8)
    const unreadAlerts = db.alerts.filter((a) => !a.read).slice(0, 6)
    const today = new Date()
    const todayTx = db.transactions.filter((t) => sameDay(t.createdAt, today) && t.status !== 'voided')
    const registers = db.registers.filter((r) => r.active).map((r) => {
      const open = db.shifts.find((s) => s.registerId === r.id && s.status === 'open')
      const lastToday = [...db.shifts].filter((s) => s.registerId === r.id && sameDay(s.openedAt, today)).sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0]
      const shift = open ?? lastToday
      const cashier = shift ? db.users.find((u) => u.id === shift.userId) : undefined
      const mine = todayTx.filter((t) => t.registerId === r.id)
      const sales = mine.filter((t) => t.type === 'sale').reduce((a, t) => a + t.total, 0) - mine.filter((t) => t.type === 'refund').reduce((a, t) => a + Math.abs(t.total), 0)
      const orders = mine.filter((t) => t.type === 'sale').length
      return { register: r, open: !!open, shift, cashier, sales, orders }
    })
    return { cur, prev, curS, prevS, series: seriesRange, sparkPts, products, totalProductRevenue, cats, cashiers, inv, activeCustomers, recent, unreadAlerts, registers, todayTx }
  }, [db, range])

  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = []
    const { curS, prevS, cur, products, cashiers, inv } = data
    const revDelta = deltaPct(curS.revenue, prevS.revenue)
    if (prevS.revenue > 0) {
      const up = revDelta >= 0
      out.push({
        id: 'rev', priority: !up && revDelta <= -10 ? 'high' : 'info', icon: up ? <TrendingUp size={16} /> : <TrendingDown size={16} />, color: up ? '#22c55e' : '#ef4444',
        title: `Revenue ${up ? 'up' : 'down'} ${Math.abs(revDelta).toFixed(0)}% vs previous period`,
        detail: `${money(curS.revenue)} this period vs ${money(prevS.revenue)} in the ${fmtRangeLabel(range).toLowerCase()} before`,
        cta: 'View analytics', to: '/admin/sales',
      })
    }
    const oos = topProducts(cur, db.products, 50, 'qty').filter((s) => { const p = db.products.find((x) => x.id === s.productId); return p && p.categoryId !== 'cat_service' && p.stock <= 0 })
    if (oos.length) {
      out.push({
        id: 'oos', priority: 'high', icon: <PackageX size={16} />, color: '#ef4444',
        title: `${oos.length} bestseller${oos.length > 1 ? 's are' : ' is'} out of stock`,
        detail: `${oos.slice(0, 2).map((p) => p.name).join(', ')}${oos.length > 2 ? ` +${oos.length - 2} more` : ''} — ${oos.reduce((a, p) => a + p.qty, 0)} units sold in period`,
        cta: 'View inventory', to: '/admin/inventory',
      })
    }
    const varToday = db.shifts.filter((s) => s.status === 'closed' && s.closedAt && sameDay(s.closedAt, new Date()) && (s.difference ?? 0) !== 0).sort((a, b) => Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0))[0]
    const varRecent = varToday ?? db.shifts.filter((s) => s.status === 'closed' && (s.difference ?? 0) !== 0).sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0]
    if (varRecent) {
      const reg = db.registers.find((r) => r.id === varRecent.registerId)
      const u = db.users.find((x) => x.id === varRecent.userId)
      const d = varRecent.difference ?? 0
      out.push({
        id: 'var', priority: Math.abs(d) >= 10 ? 'high' : 'info', icon: <Wallet size={16} />, color: '#f59e0b',
        title: `${reg?.name ?? 'Register'} cash ${d < 0 ? 'shortage' : 'surplus'} of ${money(Math.abs(d))}${varToday ? ' today' : ''}`,
        detail: `${u?.name ?? 'Cashier'} · closed ${fmtDate(varRecent.closedAt)} ${fmtTime(varRecent.closedAt)} · expected ${money(varRecent.expectedCash ?? 0)}, counted ${money(varRecent.closingCount ?? 0)}`,
        cta: 'View shifts', to: '/admin/registers',
      })
    }
    const bigRefund = cur.filter((t) => t.type === 'refund').sort((a, b) => Math.abs(b.total) - Math.abs(a.total))[0]
    if (bigRefund) {
      const u = db.users.find((x) => x.id === bigRefund.userId)
      out.push({
        id: 'ref', priority: Math.abs(bigRefund.total) >= db.settings.largeRefundThreshold ? 'high' : 'info', icon: <RotateCcw size={16} />, color: '#8b5cf6',
        title: `Largest refund: ${money(Math.abs(bigRefund.total))} (${bigRefund.number})`,
        detail: `${u?.name ?? 'Cashier'} · ${ago(bigRefund.createdAt)}${bigRefund.note ? ` · ${bigRefund.note}` : ''}`,
        cta: 'View transaction', to: `/admin/transactions/${bigRefund.id}`,
      })
    }
    if (cashiers[0]) {
      const c = cashiers[0]
      out.push({
        id: 'top', priority: 'info', icon: <Trophy size={16} />, color: '#2563eb',
        title: `${c.name} is the top cashier`,
        detail: `${money(c.revenue)} across ${c.orders} orders · avg ${money(c.avgOrder)}`,
        cta: 'View staff', to: '/admin/staff',
      })
    }
    if (inv.low > 0 && out.length < 5) {
      out.push({
        id: 'low', priority: 'info', icon: <AlertTriangle size={16} />, color: '#f97316',
        title: `${inv.low} products are running low`,
        detail: `Below their reorder threshold · ${inv.out} completely out of stock`,
        cta: 'View inventory', to: '/admin/inventory',
      })
    }
    const ready = db.repairs.filter((r) => r.status === 'ready').length
    if (ready > 0 && out.length < 5) {
      out.push({ id: 'rep', priority: 'info', icon: <Wrench size={16} />, color: '#06b6d4', title: `${ready} repair${ready > 1 ? 's' : ''} ready for pickup`, detail: 'Customers are waiting to be notified', cta: 'View repairs', to: '/admin/repairs' })
    }
    return out.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1)).slice(0, 5)
  }, [data, db, range])

  const { curS, prevS, series } = data
  const highCount = insights.filter((i) => i.priority === 'high').length
  const legend = [
    { name: 'Revenue', color: CHART_COLORS[0]! },
    { name: 'Profit', color: CHART_COLORS[1]! },
    { name: 'Refunds', color: CHART_COLORS[2]! },
  ]
  const chartRows = series.map((p) => ({ ...p })) as Record<string, unknown>[]

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${db.settings.storeName} · ${fmtDate(nowISO(), 'EEEE, MMMM d, yyyy')}`}
        actions={
          <Select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className="w-44">
            {RANGE_OPTIONS.filter((o) => o.value !== 'all').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <StatCard label="Revenue" value={money(curS.revenue)} delta={deltaPct(curS.revenue, prevS.revenue)} trend={sparkFrom(series, 'revenue', data.sparkPts)} hint={`vs ${money(prevS.revenue)} previous period`} onClick={() => navigate('/admin/sales')} />
        <StatCard label="Orders" value={curS.orders.toLocaleString()} delta={deltaPct(curS.orders, prevS.orders)} trend={sparkFrom(series, 'orders', data.sparkPts)} hint={`${curS.items.toLocaleString()} items sold`} onClick={() => navigate('/admin/transactions')} />
        <StatCard label="Avg order value" value={money(curS.avgOrder)} delta={deltaPct(curS.avgOrder, prevS.avgOrder)} trend={series.slice(-data.sparkPts).map((p) => (p.orders ? p.revenue / p.orders : 0))} hint={`vs ${money(prevS.avgOrder)} previous period`} />
        <StatCard label="Refunds" value={money(curS.refunds)} delta={deltaPct(curS.refunds, prevS.refunds)} invert trend={sparkFrom(series, 'refunds', data.sparkPts)} hint={`${curS.refundCount} refund${curS.refundCount === 1 ? '' : 's'} · ${curS.voidCount} void${curS.voidCount === 1 ? '' : 's'}`} onClick={() => navigate('/admin/transactions?type=refund')} />
      </div>

      {/* Secondary KPI strip */}
      <div className="card px-5 py-3 mb-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-y-3 divide-x-0 xl:divide-x divide-slate-100">
        <MiniKpi icon={<ShoppingBag size={14} />} label="Items sold" value={curS.items.toLocaleString()} />
        <MiniKpi icon={<Coins size={14} />} label="Gross profit" value={money(curS.profit)} />
        <MiniKpi icon={<Percent size={14} />} label="Margin" value={`${curS.margin.toFixed(1)}%`} />
        <MiniKpi icon={<Landmark size={14} />} label="Tax collected" value={money(curS.tax)} />
        <MiniKpi icon={<Tag size={14} />} label="Discounts given" value={money(curS.discounts)} />
        <MiniKpi icon={<Users size={14} />} label="Active customers" value={data.activeCustomers.toLocaleString()} />
      </div>

      {/* Trends + insights */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Sales Trends" subtitle={`Daily revenue, profit and refunds · ${fmtRangeLabel(range)}`} action={<LegendDots items={legend} />}>
          <TrendAreaChart data={chartRows} series={[{ key: 'revenue', name: 'Revenue', color: CHART_COLORS[0]! }, { key: 'profit', name: 'Profit', color: CHART_COLORS[1]! }, { key: 'refunds', name: 'Refunds', color: CHART_COLORS[2]! }]} height={280} />
        </Card>
        <Card title="Insights" subtitle="Auto-generated from live store data" action={highCount ? <Badge tone="red" dot>High Priority</Badge> : <Badge tone="blue" dot>Info</Badge>}>
          {insights.length === 0 && <EmptyState title="Nothing to flag" description="Everything looks healthy for this period." />}
          <div className="flex flex-col divide-y divide-slate-100">
            {insights.map((i) => (
              <div key={i.id} className="py-3 first:pt-0 last:pb-0 flex gap-3">
                <IconBox color={i.color} size={34}>{i.icon}</IconBox>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-800 leading-snug">{i.title}</div>
                    {i.priority === 'high' && <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 leading-snug">{i.detail}</div>
                  <button className="btn-secondary !px-2.5 !py-1 !text-xs mt-2" onClick={() => navigate(i.to)}>{i.cta} <ArrowRight size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Products / categories / registers */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
        <Card title="Top Products" subtitle={`By revenue · ${fmtRangeLabel(range)}`} action={<button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => navigate('/admin/sales')}>View all <ArrowRight size={12} /></button>}>
          {data.products.length === 0 && <EmptyState title="No sales in this period" />}
          <div className="flex flex-col gap-3.5">
            {data.products.map((p, i) => {
              const share = (p.revenue / data.totalProductRevenue) * 100
              const color = CHART_COLORS[i % CHART_COLORS.length]!
              return (
                <div key={p.productId} className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate(`/admin/catalog/${p.productId}`)}>
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-xl shrink-0">{p.emoji}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-sm font-medium text-slate-800 truncate group-hover:text-brand-700">{p.name}</div>
                      <div className="text-xs text-slate-500 shrink-0 tabular-nums">{p.qty} sold · <span className="font-semibold text-slate-700">{money(p.revenue)}</span></div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProgressBar value={share} color={color} className="flex-1 !h-2" />
                      <span className="text-[11px] font-semibold text-slate-500 w-9 text-right tabular-nums">{share.toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card title="Sales by Category" subtitle={`Share of revenue · ${fmtRangeLabel(range)}`}>
          {data.cats.length === 0 ? <EmptyState title="No sales in this period" /> : (
            <div className="flex flex-col sm:flex-row xl:flex-col 2xl:flex-row items-center gap-3">
              <div className="w-full sm:w-1/2 xl:w-full 2xl:w-1/2 relative">
                <DonutChart data={data.cats.slice(0, 6).map((c) => ({ name: c.name, value: c.revenue, color: c.color }))} height={190} />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-[11px] text-slate-400">Total</div>
                  <div className="text-base font-bold text-slate-800">{money(data.cats.reduce((a, c) => a + c.revenue, 0))}</div>
                </div>
              </div>
              <div className="w-full sm:w-1/2 xl:w-full 2xl:w-1/2 flex flex-col gap-2">
                {data.cats.slice(0, 6).map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                    <span className="flex-1 truncate text-slate-700">{c.name}</span>
                    <span className="text-xs text-slate-400 tabular-nums">{money(c.revenue)}</span>
                    <span className="text-xs font-semibold text-slate-700 w-10 text-right tabular-nums">{c.share.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title="Registers today" subtitle={`${data.registers.filter((r) => r.open).length} of ${data.registers.length} open · ${money(data.registers.reduce((a, r) => a + r.sales, 0))} taken today`} action={<button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => navigate('/admin/registers')}>Manage <ArrowRight size={12} /></button>}>
          <div className="flex flex-col gap-3">
            {data.registers.map((r) => (
              <div key={r.register.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
                <IconBox color={r.register.color} size={40}><span className="text-[13px] font-bold">{r.register.name.replace(/\D/g, '') || 'R'}</span></IconBox>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{r.register.name}</span>
                    <Badge tone={r.open ? 'green' : 'slate'} dot>{r.open ? 'Open' : 'Closed'}</Badge>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                    {r.cashier ? (
                      <>
                        <Avatar name={r.cashier.name} color={r.cashier.color} size={16} />
                        <span className="truncate">{r.cashier.name}</span>
                        {r.shift && <span>· {r.open ? `since ${fmtTime(r.shift.openedAt)}` : `closed ${fmtTime(r.shift.closedAt)}`}</span>}
                      </>
                    ) : <span>{r.register.location} · no shift today</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-slate-900 tabular-nums">{money(r.sales)}</div>
                  <div className="text-[11px] text-slate-400">{r.orders} order{r.orders === 1 ? '' : 's'}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Recent transactions + attention */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title="Recent Transactions" subtitle="Latest activity across all registers" action={<button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => navigate('/admin/transactions')}>View all <ArrowRight size={12} /></button>} padded={false}>
          <div className="overflow-x-auto pb-2">
            <table className="table">
              <thead>
                <tr><th>Number</th><th>Cashier</th><th className="text-right">Items</th><th className="text-right">Total</th><th>Payment</th><th className="text-right">When</th></tr>
              </thead>
              <tbody>
                {data.recent.map((t) => <RecentRow key={t.id} tx={t} onClick={() => navigate(`/admin/transactions/${t.id}`)} />)}
              </tbody>
            </table>
            {data.recent.length === 0 && <EmptyState title="No transactions yet" />}
          </div>
        </Card>
        <Card title="Needs attention" subtitle={`${db.alerts.filter((a) => !a.read).length} unread alerts`} action={<button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => navigate('/admin/alerts')}>All alerts <ArrowRight size={12} /></button>}>
          <div className="flex flex-col divide-y divide-slate-100">
            {data.unreadAlerts.map((a) => <AlertRow key={a.id} alert={a} onClick={() => navigate(a.link ?? '/admin/alerts')} />)}
            {data.unreadAlerts.length === 0 && <div className="py-6 text-center text-sm text-slate-400">You're all caught up.</div>}
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 p-3 flex items-center gap-3">
            <IconBox color="#f97316" size={34}><AlertTriangle size={16} /></IconBox>
            <div className="flex-1 text-sm">
              <div className="font-semibold text-slate-800">{data.inv.low} low stock · {data.inv.out} out of stock</div>
              <div className="text-xs text-slate-400">{data.inv.units.toLocaleString()} units on hand · {money(data.inv.cost)} at cost</div>
            </div>
            <button className="btn-secondary !px-2.5 !py-1 !text-xs" onClick={() => navigate('/admin/inventory')}>Review</button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function MiniKpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="px-2 xl:px-4 first:pl-0">
      <div className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5 uppercase tracking-wide">{icon}{label}</div>
      <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">{value}</div>
    </div>
  )
}

function RecentRow({ tx, onClick }: { tx: Transaction; onClick: () => void }) {
  const user = useDB((s) => s.db.users.find((u) => u.id === tx.userId))
  const items = tx.lines.reduce((a, l) => a + Math.abs(l.qty), 0)
  const primary = tx.payments[0]
  return (
    <tr onClick={onClick} className="cursor-pointer">
      <td>
        <div className="font-semibold text-slate-800">{tx.number}</div>
        <div className="text-[11px] text-slate-400 capitalize">{tx.type}{tx.status !== 'completed' ? ` · ${tx.status.replace('_', ' ')}` : ''}</div>
      </td>
      <td>
        <div className="flex items-center gap-2">
          <Avatar name={user?.name ?? '?'} color={user?.color} size={26} />
          <span className="text-slate-700 whitespace-nowrap">{user?.name ?? '—'}</span>
        </div>
      </td>
      <td className="text-right tabular-nums">{items}</td>
      <td className="text-right font-semibold"><Money value={tx.total} className={cx(tx.status === 'voided' && 'line-through text-slate-400')} /></td>
      <td>
        <div className="flex items-center gap-1 flex-wrap">
          {primary && <Badge tone={methodTone(primary.method)}>{PAYMENT_LABELS[primary.method] ?? primary.method}</Badge>}
          {tx.payments.length > 1 && <Badge tone="slate">+{tx.payments.length - 1}</Badge>}
          {tx.status === 'voided' && <Badge tone={statusTone('voided')}>Voided</Badge>}
        </div>
      </td>
      <td className="text-right text-slate-500 whitespace-nowrap text-xs">{ago(tx.createdAt)}</td>
    </tr>
  )
}

function AlertRow({ alert, onClick }: { alert: Alert; onClick: () => void }) {
  const color = alert.severity === 'critical' ? '#ef4444' : alert.severity === 'warning' ? '#f59e0b' : '#2563eb'
  return (
    <div className="py-2.5 first:pt-0 flex items-start gap-3 cursor-pointer group" onClick={onClick}>
      <IconBox color={color} size={32}><Bell size={14} /></IconBox>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800 truncate group-hover:text-brand-700">{alert.title}</span>
          <Badge tone={statusTone(alert.severity)}>{alert.severity}</Badge>
        </div>
        <div className="text-xs text-slate-400 truncate">{alert.message}</div>
      </div>
      <span className="text-[11px] text-slate-400 whitespace-nowrap">{ago(alert.createdAt)}</span>
    </div>
  )
}
