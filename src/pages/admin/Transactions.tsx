import React, { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download, FilterX, Receipt as ReceiptIcon, RotateCcw, Ban, Hash } from 'lucide-react'
import { format } from 'date-fns'
import { useDB } from '@/store/db'
import { Avatar, Badge, Card, DataTable, EmptyState, Field, Input, Money, PageHeader, SearchInput, Select, statusTone, type Column } from '@/components/ui'
import { ago, downloadFile, fmtDate, fmtTime, money, toCSV, titleCase } from '@/lib/utils'
import { PAYMENT_LABELS } from '@/lib/pos'
import type { Transaction } from '@/lib/types'

const METHODS = Object.keys(PAYMENT_LABELS)
const methodTone = (m: string) => (m === 'cash' ? 'green' : m === 'card' ? 'blue' : m === 'mobile' ? 'purple' : m === 'store_credit' ? 'amber' : m === 'gift_card' ? 'pink' : 'cyan') as 'green' | 'blue' | 'purple' | 'amber' | 'pink' | 'cyan'
const typeTone = (t: string) => (t === 'sale' ? 'blue' : t === 'refund' ? 'red' : t === 'exchange' ? 'purple' : 'slate') as 'blue' | 'red' | 'purple' | 'slate'

const FILTER_KEYS = ['q', 'type', 'status', 'register', 'cashier', 'method', 'from', 'to', 'min', 'max'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

export default function Transactions() {
  const db = useDB((s) => s.db)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const f = useMemo(() => {
    const o = {} as Record<FilterKey, string>
    FILTER_KEYS.forEach((k) => (o[k] = params.get(k) ?? ''))
    return o
  }, [params])
  const set = (k: FilterKey, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const clear = () => setParams(new URLSearchParams(), { replace: true })
  const activeFilters = FILTER_KEYS.filter((k) => f[k]).length

  const users = useMemo(() => new Map(db.users.map((u) => [u.id, u])), [db.users])
  const customers = useMemo(() => new Map(db.customers.map((c) => [c.id, c])), [db.customers])
  const registers = useMemo(() => new Map(db.registers.map((r) => [r.id, r])), [db.registers])

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const fromTs = f.from ? new Date(f.from + 'T00:00:00').getTime() : -Infinity
    const toTs = f.to ? new Date(f.to + 'T23:59:59.999').getTime() : Infinity
    const min = f.min ? Number(f.min) : -Infinity
    const max = f.max ? Number(f.max) : Infinity
    return db.transactions.filter((t) => {
      if (f.type && t.type !== f.type) return false
      if (f.status && t.status !== f.status) return false
      if (f.register && t.registerId !== f.register) return false
      if (f.cashier && t.userId !== f.cashier) return false
      if (f.method && !t.payments.some((p) => p.method === f.method)) return false
      const ts = new Date(t.createdAt).getTime()
      if (ts < fromTs || ts > toTs) return false
      const abs = Math.abs(t.total)
      if (abs < min || abs > max) return false
      if (q) {
        const cust = t.customerId ? customers.get(t.customerId) : undefined
        const user = users.get(t.userId)
        const hay = [t.number, cust?.name, cust?.phone, user?.name, t.note, t.promoCode, ...t.lines.flatMap((l) => [l.name, l.sku, l.serial]), ...t.payments.map((p) => `${p.cardLast4 ?? ''} ${p.reference ?? ''}`)]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [db.transactions, f, users, customers])

  const summary = useMemo(() => {
    const sales = filtered.filter((t) => t.type === 'sale' && t.status !== 'voided')
    const refunds = filtered.filter((t) => t.type === 'refund')
    const voids = filtered.filter((t) => t.status === 'voided')
    const gross = sales.reduce((a, t) => a + t.total, 0)
    const refundTotal = refunds.reduce((a, t) => a + Math.abs(t.total), 0)
    return { count: filtered.length, sales: sales.length, gross, refunds: refunds.length, refundTotal, net: gross - refundTotal, voids: voids.length, voidTotal: voids.reduce((a, t) => a + t.total, 0), items: sales.reduce((a, t) => a + t.lines.reduce((b, l) => b + l.qty, 0), 0) }
  }, [filtered])

  const exportCsv = () => {
    const rows = filtered.map((t) => ({
      number: t.number, date: fmtDate(t.createdAt, 'yyyy-MM-dd'), time: fmtTime(t.createdAt), type: t.type, status: t.status,
      register: registers.get(t.registerId)?.name ?? t.registerId, cashier: users.get(t.userId)?.name ?? t.userId, customer: t.customerId ? customers.get(t.customerId)?.name ?? '' : '',
      items: t.lines.reduce((a, l) => a + Math.abs(l.qty), 0), subtotal: t.subtotal, discount: t.discountTotal, tax: t.taxTotal, total: t.total,
      payments: t.payments.map((p) => `${PAYMENT_LABELS[p.method] ?? p.method} ${money(p.amount)}`).join(' | '), promo: t.promoCode ?? '', note: t.note ?? '', refundOf: t.refundOf ? db.transactions.find((x) => x.id === t.refundOf)?.number ?? '' : '',
    }))
    downloadFile(`transactions-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`, toCSV(rows), 'text/csv')
  }

  const columns: Column<Transaction>[] = [
    { key: 'number', header: 'Number', sortValue: (t) => t.number, render: (t) => <span className="font-semibold text-slate-800 whitespace-nowrap">{t.number}</span> },
    { key: 'date', header: 'Date / time', sortValue: (t) => t.createdAt, render: (t) => <div className="whitespace-nowrap"><div className="text-slate-800">{fmtDate(t.createdAt)} <span className="text-slate-400">{fmtTime(t.createdAt)}</span></div><div className="text-[11px] text-slate-400">{ago(t.createdAt)}</div></div> },
    { key: 'type', header: 'Type', sortValue: (t) => t.type, render: (t) => <Badge tone={typeTone(t.type)}>{titleCase(t.type)}</Badge> },
    { key: 'status', header: 'Status', sortValue: (t) => t.status, render: (t) => <Badge tone={statusTone(t.status)} dot>{titleCase(t.status)}</Badge> },
    { key: 'register', header: 'Register', sortValue: (t) => registers.get(t.registerId)?.name ?? '', render: (t) => { const r = registers.get(t.registerId); return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="w-2 h-2 rounded-full" style={{ background: r?.color ?? '#94a3b8' }} />{r?.name ?? '—'}</span> } },
    { key: 'cashier', header: 'Cashier', sortValue: (t) => users.get(t.userId)?.name ?? '', render: (t) => { const u = users.get(t.userId); return <div className="flex items-center gap-2 whitespace-nowrap"><Avatar name={u?.name ?? '?'} color={u?.color} size={24} /><span>{u?.name ?? '—'}</span></div> } },
    { key: 'customer', header: 'Customer', sortValue: (t) => (t.customerId ? customers.get(t.customerId)?.name ?? '' : ''), render: (t) => { const c = t.customerId ? customers.get(t.customerId) : undefined; return c ? <button className="text-brand-700 hover:underline whitespace-nowrap" onClick={(e) => { e.stopPropagation(); navigate(`/admin/customers/${c.id}`) }}>{c.name}</button> : <span className="text-slate-400">Walk-in</span> } },
    { key: 'items', header: 'Items', align: 'right', sortValue: (t) => t.lines.reduce((a, l) => a + Math.abs(l.qty), 0), render: (t) => <span className="tabular-nums">{t.lines.reduce((a, l) => a + Math.abs(l.qty), 0)}</span> },
    { key: 'payments', header: 'Payment', render: (t) => <div className="flex items-center gap-1 flex-wrap">{t.payments.map((p) => <Badge key={p.id} tone={methodTone(p.method)}>{PAYMENT_LABELS[p.method] ?? p.method}{p.cardLast4 ? ` ${p.cardLast4}` : ''}</Badge>)}</div> },
    { key: 'total', header: 'Total', align: 'right', sortValue: (t) => t.total, render: (t) => <Money value={t.total} className={`font-semibold ${t.status === 'voided' ? 'line-through !text-slate-400' : ''}`} /> },
  ]

  const cashiers = db.users.filter((u) => db.transactions.some((t) => t.userId === u.id))

  return (
    <div>
      <PageHeader title="Transactions" subtitle={`${db.transactions.length.toLocaleString()} transactions on record · every sale, refund and void`}
        actions={<>
          {activeFilters > 0 && <button className="btn-ghost" onClick={clear}><FilterX size={15} /> Clear filters ({activeFilters})</button>}
          <button className="btn-secondary" onClick={exportCsv} disabled={!filtered.length}><Download size={15} /> Export CSV</button>
        </>} />

      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <Field label="Search" className="xl:col-span-2"><SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Number, customer, cashier, product, SKU, serial / IMEI, card last 4…" /></Field>
          <Field label="Type"><Select value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">All types</option><option value="sale">Sale</option><option value="refund">Refund</option><option value="exchange">Exchange</option></Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All statuses</option><option value="completed">Completed</option><option value="partially_refunded">Partially refunded</option><option value="refunded">Refunded</option><option value="voided">Voided</option></Select></Field>
          <Field label="Register"><Select value={f.register} onChange={(e) => set('register', e.target.value)}><option value="">All registers</option>{db.registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="Cashier"><Select value={f.cashier} onChange={(e) => set('cashier', e.target.value)}><option value="">All cashiers</option>{cashiers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <Field label="Payment method"><Select value={f.method} onChange={(e) => set('method', e.target.value)}><option value="">Any method</option>{METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min total"><Input type="number" min={0} step="0.01" value={f.min} onChange={(e) => set('min', e.target.value)} placeholder="0.00" /></Field>
            <Field label="Max total"><Input type="number" min={0} step="0.01" value={f.max} onChange={(e) => set('max', e.target.value)} placeholder="∞" /></Field>
          </div>
          <Field label="From"><Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} max={f.to || undefined} /></Field>
          <Field label="To"><Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} min={f.from || undefined} /></Field>
          <div className="xl:col-span-2 flex items-end gap-2 flex-wrap">
            <QuickRange label="Today" onClick={() => { const d = format(new Date(), 'yyyy-MM-dd'); const n = new URLSearchParams(params); n.set('from', d); n.set('to', d); setParams(n, { replace: true }) }} />
            <QuickRange label="Last 7 days" onClick={() => { const n = new URLSearchParams(params); n.set('from', format(new Date(Date.now() - 6 * 86400000), 'yyyy-MM-dd')); n.set('to', format(new Date(), 'yyyy-MM-dd')); setParams(n, { replace: true }) }} />
            <QuickRange label="This month" onClick={() => { const n = new URLSearchParams(params); n.set('from', format(new Date(), 'yyyy-MM-01')); n.set('to', format(new Date(), 'yyyy-MM-dd')); setParams(n, { replace: true }) }} />
            <QuickRange label="Refunds only" onClick={() => set('type', 'refund')} />
            <QuickRange label="Voids only" onClick={() => set('status', 'voided')} />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Chip icon={<Hash size={14} />} label="Matching" value={summary.count.toLocaleString()} sub={`${summary.sales} sales`} color="#2563eb" />
        <Chip icon={<ReceiptIcon size={14} />} label="Gross sales" value={money(summary.gross)} sub={`${summary.items} items`} color="#22c55e" />
        <Chip icon={<RotateCcw size={14} />} label="Refunds" value={money(summary.refundTotal)} sub={`${summary.refunds} refunds`} color="#ef4444" />
        <Chip icon={<Ban size={14} />} label="Voided" value={money(summary.voidTotal)} sub={`${summary.voids} voids`} color="#64748b" />
        <Chip icon={<ReceiptIcon size={14} />} label="Net" value={money(summary.net)} sub="sales − refunds" color="#8b5cf6" />
        <Chip icon={<Hash size={14} />} label="Avg sale" value={money(summary.sales ? summary.gross / summary.sales : 0)} sub="per completed sale" color="#f59e0b" />
      </div>

      <Card padded={false} className="pb-3">
        <div className="px-2">
          <DataTable rows={filtered} columns={columns} pageSize={20} onRowClick={(t) => navigate(`/admin/transactions/${t.id}`)} defaultSort={{ key: 'date', dir: 'desc' }}
            rowClassName={(t) => (t.status === 'voided' ? 'opacity-70' : '')}
            empty={<EmptyState title="No transactions match" description="Try widening the date range or clearing some filters." action={activeFilters > 0 ? <button className="btn-secondary" onClick={clear}>Clear filters</button> : undefined} />} />
        </div>
      </Card>
    </div>
  )
}

function QuickRange({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="badge bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700 !px-2.5 !py-1 transition-colors" onClick={onClick}>{label}</button>
}

function Chip({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="card px-4 py-3 flex items-center gap-3 min-w-0">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}1a`, color }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] text-slate-400 font-medium">{label}</div>
        <div className="text-base font-bold text-slate-900 tabular-nums truncate leading-tight">{value}</div>
        <div className="text-[11px] text-slate-400 truncate">{sub}</div>
      </div>
    </div>
  )
}
