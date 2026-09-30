import React, { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Boxes, CircleDollarSign, Tag, AlertTriangle, PackageX, TrendingUp, Download, ClipboardList, ScanLine, SlidersHorizontal, Search, ClipboardCheck, History, X, ExternalLink } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import type { Product, StockMovement, StockMovementType, ID } from '@/lib/types'
import { money, cx, fmtDateTime, fmtDate, ago, round2, daysAgo, toCSV, downloadFile, uid, titleCase } from '@/lib/utils'
import { inventoryValue } from '@/lib/analytics'
import { Card, PageHeader, StatCard, Badge, SearchInput, Select, Tabs, DataTable, Input, confirm, toast, EmptyState, type Column } from '@/components/ui'
import { CategoryBadge, stockStatus, type StockStatus } from './Catalog'
import { StockAdjustModal, MovementTypeBadge, MOVEMENT_TYPES } from './ProductDetail'

type Tab = 'levels' | 'low' | 'movements' | 'count'

function StatusBadge({ s }: { s: StockStatus }) {
  if (s === 'na') return <Badge tone="slate">Service</Badge>
  if (s === 'out') return <Badge tone="red" dot>Out of stock</Badge>
  if (s === 'low') return <Badge tone="amber" dot>Low</Badge>
  return <Badge tone="green" dot>In stock</Badge>
}

export default function Inventory() {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const navigate = useNavigate()
  const adjustStock = useDB((s) => s.adjustStock)
  const upsertPurchaseOrder = useDB((s) => s.upsertPurchaseOrder)

  const [tab, setTab] = useState<Tab>('levels')
  const [adjusting, setAdjusting] = useState<Product | undefined>()

  const inv = useMemo(() => inventoryValue(db.products), [db.products])
  const stockable = useMemo(() => db.products.filter((p) => p.categoryId !== 'cat_service'), [db.products])
  const catById = useMemo(() => Object.fromEntries(db.categories.map((c) => [c.id, c])), [db.categories])
  const userName = (id: ID) => db.users.find((u) => u.id === id)?.name ?? 'System'

  // average daily units sold in the last 30 days per product
  const avgDaily = useMemo(() => {
    const start = daysAgo(29); start.setHours(0, 0, 0, 0)
    const m: Record<ID, number> = {}
    db.transactions.forEach((t) => {
      if (t.type !== 'sale' || t.status === 'voided' || new Date(t.createdAt) < start) return
      t.lines.forEach((l) => { m[l.productId] = (m[l.productId] ?? 0) + l.qty })
    })
    Object.keys(m).forEach((k) => { m[k] = m[k]! / 30 })
    return m
  }, [db.transactions])
  const daysOfCover = (p: Product): number | null => {
    const a = avgDaily[p.id] ?? 0
    if (a <= 0) return null
    return Math.round(p.stock / a)
  }

  const lowProducts = useMemo(() => stockable.filter((p) => p.stock <= p.lowStockThreshold).sort((a, b) => a.stock - b.stock), [stockable])
  const potentialProfit = round2(inv.retail - inv.cost)

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Stock levels, movements and physical counts across the whole catalog"
        actions={<>
          <Link to="/admin/purchase-orders" className="btn-secondary"><ClipboardList size={15} /> Purchase orders</Link>
          <button className="btn-primary" onClick={() => setTab('count')}><ClipboardCheck size={15} /> Start stock count</button>
        </>} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
        <StatCard label="Units on hand" value={inv.units.toLocaleString()} icon={<Boxes size={14} />} hint={`${stockable.length} stocked SKUs`} onClick={() => setTab('levels')} />
        <StatCard label="Value at cost" value={money(inv.cost)} icon={<CircleDollarSign size={14} />} hint="Capital tied up in stock" />
        <StatCard label="Value at retail" value={money(inv.retail)} icon={<Tag size={14} />} hint="If everything sells at list" />
        <StatCard label="Potential profit" value={money(potentialProfit)} icon={<TrendingUp size={14} />} hint={inv.retail ? `${((potentialProfit / inv.retail) * 100).toFixed(0)}% blended margin` : undefined} />
        <StatCard label="Low stock" value={inv.low} icon={<AlertTriangle size={14} className="text-amber-500" />} hint="At or below threshold" onClick={() => setTab('low')} />
        <StatCard label="Out of stock" value={inv.out} icon={<PackageX size={14} className="text-red-500" />} hint="Zero on hand" onClick={() => setTab('low')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
        <div className="card p-5 min-w-0">
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'levels', label: 'Stock levels', count: stockable.length },
            { value: 'low', label: 'Low stock', count: lowProducts.length },
            { value: 'movements', label: 'Stock movements', count: db.stockMovements.length },
            { value: 'count', label: 'Stock count' },
          ]} />
          {tab === 'levels' && <StockLevels products={stockable} catById={catById} daysOfCover={daysOfCover} onAdjust={setAdjusting} />}
          {tab === 'low' && <LowStock products={lowProducts} catById={catById} daysOfCover={daysOfCover} onAdjust={setAdjusting} onCreatePO={async () => {
            const withSupplier = lowProducts.filter((p) => p.supplierId)
            const without = lowProducts.length - withSupplier.length
            if (!withSupplier.length) { toast.error('None of the low-stock products has a supplier assigned. Set a supplier on the product first.'); return }
            const groups = new Map<ID, Product[]>()
            withSupplier.forEach((p) => { const g = groups.get(p.supplierId!) ?? []; g.push(p); groups.set(p.supplierId!, g) })
            const ok = await confirm('Create draft purchase orders?', `${groups.size} draft PO(s) will be created for ${withSupplier.length} product(s), grouped by supplier. Suggested quantity is threshold × 3 − stock.${without ? ` ${without} product(s) without a supplier will be skipped.` : ''}`, { confirmLabel: 'Create drafts' })
            if (!ok) return
            groups.forEach((prods, supplierId) => {
              upsertPurchaseOrder({ supplierId, status: 'draft', notes: 'Auto-generated from low stock report', lines: prods.map((p) => ({ id: uid('pol'), productId: p.id, qty: Math.max(1, p.lowStockThreshold * 3 - p.stock), cost: p.cost, received: 0 })) }, admin.id)
            })
            toast.success(`Created ${groups.size} draft purchase order(s)`)
            navigate('/admin/purchase-orders')
          }} />}
          {tab === 'movements' && <Movements movements={db.stockMovements} products={db.products} userName={userName} />}
          {tab === 'count' && <StockCount products={stockable} catById={catById} onApply={async (changes) => {
            if (!changes.length) { toast.info('No differences to apply'); return }
            const ok = await confirm('Apply stock count?', `${changes.length} product(s) will be adjusted to match the counted quantities. Each change is logged as a "count" movement.`, { confirmLabel: 'Apply count' })
            if (!ok) return false
            changes.forEach((c) => adjustStock(c.productId, c.diff, 'count', 'Stock count', admin.id))
            toast.success(`Stock count applied to ${changes.length} product(s)`)
            return true
          }} />}
        </div>
        <div className="space-y-4">
          <ImeiLookup />
          <RecentMovements movements={db.stockMovements} products={db.products} onSeeAll={() => setTab('movements')} />
        </div>
      </div>

      <StockAdjustModal open={!!adjusting} onClose={() => setAdjusting(undefined)} product={adjusting ? db.products.find((p) => p.id === adjusting.id) : undefined} />
    </div>
  )
}

// ─── Stock levels ────────────────────────────────────────────────────────────
function productCell(p: Product) {
  return (
    <Link to={`/admin/catalog/${p.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-3 min-w-[200px] group">
      <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-lg shrink-0">{p.emoji}</div>
      <div className="min-w-0">
        <div className="font-medium text-slate-800 truncate group-hover:text-brand-700">{p.name}</div>
        <div className="text-[11px] text-slate-400 font-mono">{p.sku}</div>
      </div>
    </Link>
  )
}

function StockLevels({ products, catById, daysOfCover, onAdjust }: { products: Product[]; catById: Record<string, { id: string; name: string; color: string; icon: string; sortOrder: number }>; daysOfCover: (p: Product) => number | null; onAdjust: (p: Product) => void }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [status, setStatus] = useState<'all' | StockStatus>('all')
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return products.filter((p) => (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.barcode.includes(term)) && (!cat || p.categoryId === cat) && (status === 'all' || stockStatus(p) === status))
  }, [products, q, cat, status])
  const cols: Column<Product>[] = [
    { key: 'name', header: 'Product', sortValue: (p) => p.name, render: productCell },
    { key: 'cat', header: 'Category', sortValue: (p) => catById[p.categoryId]?.name ?? '', render: (p) => <CategoryBadge category={catById[p.categoryId]} /> },
    { key: 'stock', header: 'On hand', align: 'right', sortValue: (p) => p.stock, render: (p) => { const s = stockStatus(p); return <span className={cx('font-bold tabular-nums', s === 'out' ? 'text-red-600' : s === 'low' ? 'text-amber-600' : 'text-slate-800')}>{p.stock}</span> } },
    { key: 'thr', header: 'Threshold', align: 'right', sortValue: (p) => p.lowStockThreshold, render: (p) => <span className="text-slate-500 tabular-nums">{p.lowStockThreshold}</span> },
    { key: 'status', header: 'Status', sortValue: (p) => ({ out: 0, low: 1, in: 2, na: 3 })[stockStatus(p)], render: (p) => <StatusBadge s={stockStatus(p)} /> },
    { key: 'cover', header: 'Days of cover', align: 'right', sortValue: (p) => daysOfCover(p) ?? 99999, render: (p) => { const d = daysOfCover(p); return d === null ? <span className="text-slate-300" title="No sales in the last 30 days">—</span> : <span className={cx('tabular-nums font-medium', d < 7 ? 'text-red-600' : d < 21 ? 'text-amber-600' : 'text-slate-700')}>{d}d</span> } },
    { key: 'cost', header: 'Value at cost', align: 'right', sortValue: (p) => Math.max(0, p.stock) * p.cost, render: (p) => <span className="tabular-nums text-slate-700">{money(Math.max(0, p.stock) * p.cost)}</span> },
    { key: 'act', header: '', align: 'right', render: (p) => <button className="btn-secondary !py-1 !px-2 text-xs" onClick={(e) => { e.stopPropagation(); onAdjust(p) }}><SlidersHorizontal size={13} /> Adjust</button> },
  ]
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search product, SKU, barcode…" className="w-full md:w-72" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-auto min-w-[150px]"><option value="">All categories</option>{Object.values(catById).filter((c) => c.id !== 'cat_service').map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="!w-auto"><option value="all">Any status</option><option value="in">In stock</option><option value="low">Low</option><option value="out">Out</option></Select>
        <div className="flex-1" />
        <button className="btn-ghost text-xs" onClick={() => { downloadFile('stock-levels.csv', toCSV(rows.map((p) => ({ name: p.name, sku: p.sku, barcode: p.barcode, category: catById[p.categoryId]?.name ?? '', onHand: p.stock, threshold: p.lowStockThreshold, status: stockStatus(p), daysOfCover: daysOfCover(p) ?? '', cost: p.cost, valueAtCost: round2(Math.max(0, p.stock) * p.cost) }))), 'text/csv'); toast.success('Exported stock levels') }}><Download size={14} /> Export</button>
      </div>
      <DataTable rows={rows} columns={cols} pageSize={15} defaultSort={{ key: 'status', dir: 'asc' }} empty={<EmptyState icon={<Boxes size={20} />} title="No products match" />} />
    </div>
  )
}

// ─── Low stock ───────────────────────────────────────────────────────────────
function LowStock({ products, catById, daysOfCover, onAdjust, onCreatePO }: { products: Product[]; catById: Record<string, { name: string; color: string; icon: string; id: string; sortOrder: number }>; daysOfCover: (p: Product) => number | null; onAdjust: (p: Product) => void; onCreatePO: () => void }) {
  const suppliers = useDB((s) => s.db.suppliers)
  const cols: Column<Product>[] = [
    { key: 'name', header: 'Product', sortValue: (p) => p.name, render: productCell },
    { key: 'cat', header: 'Category', render: (p) => <CategoryBadge category={catById[p.categoryId]} /> },
    { key: 'sup', header: 'Supplier', sortValue: (p) => suppliers.find((s) => s.id === p.supplierId)?.name ?? '', render: (p) => { const s = suppliers.find((x) => x.id === p.supplierId); return s ? <span className="text-slate-600">{s.name}</span> : <span className="text-amber-600 text-xs inline-flex items-center gap-1"><AlertTriangle size={12} /> No supplier</span> } },
    { key: 'stock', header: 'On hand', align: 'right', sortValue: (p) => p.stock, render: (p) => <span className={cx('font-bold tabular-nums', p.stock <= 0 ? 'text-red-600' : 'text-amber-600')}>{p.stock}</span> },
    { key: 'thr', header: 'Threshold', align: 'right', render: (p) => <span className="tabular-nums text-slate-500">{p.lowStockThreshold}</span> },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge s={stockStatus(p)} /> },
    { key: 'cover', header: 'Cover', align: 'right', render: (p) => { const d = daysOfCover(p); return d === null ? <span className="text-slate-300">—</span> : <span className={cx('tabular-nums', d < 7 ? 'text-red-600 font-semibold' : 'text-slate-600')}>{d}d</span> } },
    { key: 'suggest', header: 'Suggested order', align: 'right', sortValue: (p) => Math.max(1, p.lowStockThreshold * 3 - p.stock), render: (p) => <span className="tabular-nums font-medium text-brand-700">+{Math.max(1, p.lowStockThreshold * 3 - p.stock)}</span> },
    { key: 'est', header: 'Est. cost', align: 'right', render: (p) => <span className="tabular-nums text-slate-600">{money(Math.max(1, p.lowStockThreshold * 3 - p.stock) * p.cost)}</span> },
    { key: 'act', header: '', align: 'right', render: (p) => <button className="btn-secondary !py-1 !px-2 text-xs" onClick={(e) => { e.stopPropagation(); onAdjust(p) }}><SlidersHorizontal size={13} /> Adjust</button> },
  ]
  const totalCost = products.reduce((a, p) => a + Math.max(1, p.lowStockThreshold * 3 - p.stock) * p.cost, 0)
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="text-sm text-slate-500">{products.length} product(s) at or below their threshold. Reordering all of them would cost about <span className="font-semibold text-slate-800">{money(totalCost)}</span>.</div>
        <div className="flex-1" />
        <button className="btn-primary" disabled={!products.length} onClick={onCreatePO}><ClipboardList size={15} /> Create purchase order{products.length > 1 ? 's' : ''}</button>
      </div>
      <DataTable rows={products} columns={cols} pageSize={15} defaultSort={{ key: 'stock', dir: 'asc' }} empty={<EmptyState icon={<ClipboardCheck size={20} />} title="Everything is well stocked" description="No products are at or below their low stock threshold." />} />
    </div>
  )
}

// ─── Movements ───────────────────────────────────────────────────────────────
function Movements({ movements, products, userName }: { movements: StockMovement[]; products: Product[]; userName: (id: ID) => string }) {
  const db = useDB((s) => s.db)
  const [type, setType] = useState<'all' | StockMovementType>('all')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products])
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const fromTs = from ? new Date(from + 'T00:00:00').getTime() : 0
    const toTs = to ? new Date(to + 'T23:59:59.999').getTime() : Number.POSITIVE_INFINITY
    return movements.filter((m) => {
      if (type !== 'all' && m.type !== type) return false
      const ts = new Date(m.createdAt).getTime()
      if (ts < fromTs || ts > toTs) return false
      if (term) {
        const p = productById[m.productId]
        const hay = `${p?.name ?? ''} ${p?.sku ?? ''} ${m.reason ?? ''} ${m.serial ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [movements, type, q, from, to, productById])
  const refCell = (m: StockMovement) => {
    if (!m.refId) return <span className="text-slate-300">—</span>
    const tx = db.transactions.find((t) => t.id === m.refId)
    if (tx) return <Link to={`/admin/transactions/${tx.id}`} className="text-brand-700 hover:underline font-mono text-xs inline-flex items-center gap-1">{tx.number} <ExternalLink size={11} /></Link>
    const po = db.purchaseOrders.find((p) => p.id === m.refId)
    if (po) return <Link to="/admin/purchase-orders" className="text-brand-700 hover:underline font-mono text-xs inline-flex items-center gap-1">{po.number} <ExternalLink size={11} /></Link>
    return <span className="font-mono text-xs text-slate-400">{m.refId.slice(0, 12)}</span>
  }
  const cols: Column<StockMovement>[] = [
    { key: 'createdAt', header: 'Date / time', sortValue: (m) => m.createdAt, render: (m) => <div><div className="text-slate-700 whitespace-nowrap">{fmtDateTime(m.createdAt)}</div><div className="text-[11px] text-slate-400">{ago(m.createdAt)}</div></div> },
    { key: 'product', header: 'Product', sortValue: (m) => productById[m.productId]?.name ?? '', render: (m) => { const p = productById[m.productId]; return p ? productCell(p) : <span className="text-slate-400 italic">Deleted product</span> } },
    { key: 'type', header: 'Type', sortValue: (m) => m.type, render: (m) => <MovementTypeBadge type={m.type} /> },
    { key: 'qty', header: 'Qty', align: 'right', sortValue: (m) => m.qty, render: (m) => <span className={cx('font-semibold tabular-nums', m.qty > 0 ? 'text-emerald-600' : 'text-red-600')}>{m.qty > 0 ? '+' : ''}{m.qty}</span> },
    { key: 'ba', header: 'Before → After', align: 'right', render: (m) => <span className="tabular-nums text-slate-500 whitespace-nowrap">{m.before} <span className="text-slate-300">→</span> <span className="text-slate-800 font-medium">{m.after}</span></span> },
    { key: 'reason', header: 'Reason', render: (m) => <div className="max-w-[240px]"><div className="text-slate-600 truncate">{m.reason ?? <span className="text-slate-300">—</span>}</div>{m.serial && <div className="font-mono text-[11px] text-slate-400">{m.serial}</div>}</div> },
    { key: 'user', header: 'User', render: (m) => <span className="text-slate-600 whitespace-nowrap">{userName(m.userId)}</span> },
    { key: 'ref', header: 'Reference', render: refCell },
  ]
  const exportCSV = () => {
    downloadFile(`stock-movements-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows.map((m) => {
      const p = productById[m.productId]
      const tx = m.refId ? db.transactions.find((t) => t.id === m.refId) : undefined
      const po = m.refId && !tx ? db.purchaseOrders.find((x) => x.id === m.refId) : undefined
      return { date: m.createdAt, product: p?.name ?? m.productId, sku: p?.sku ?? '', type: m.type, qty: m.qty, before: m.before, after: m.after, reason: m.reason ?? '', user: userName(m.userId), reference: tx?.number ?? po?.number ?? m.refId ?? '', serial: m.serial ?? '' }
    })), 'text/csv')
    toast.success(`Exported ${rows.length} movements`)
  }
  const net = rows.reduce((a, m) => a + m.qty, 0)
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchInput value={q} onChange={setQ} placeholder="Product, SKU, reason, serial…" className="w-full md:w-64" />
        <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="!w-auto"><option value="all">All types</option>{MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-auto" />
        <span className="text-slate-400 text-xs">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-auto" />
        {(q || type !== 'all' || from || to) && <button className="btn-ghost !px-2" onClick={() => { setQ(''); setType('all'); setFrom(''); setTo('') }}><X size={14} /> Clear</button>}
        <div className="flex-1" />
        <span className="text-xs text-slate-400">{rows.length} movements · net <span className={cx('font-semibold', net >= 0 ? 'text-emerald-600' : 'text-red-600')}>{net > 0 ? '+' : ''}{net}</span></span>
        <button className="btn-secondary !py-1.5 text-xs" onClick={exportCSV}><Download size={14} /> Export CSV</button>
      </div>
      <DataTable rows={rows} columns={cols} pageSize={20} compact empty={<EmptyState icon={<History size={20} />} title="No movements match" />} />
    </div>
  )
}

// ─── Stock count ─────────────────────────────────────────────────────────────
function StockCount({ products, catById, onApply }: { products: Product[]; catById: Record<string, { name: string; color: string; icon: string; id: string; sortOrder: number }>; onApply: (changes: Array<{ productId: ID; diff: number }>) => Promise<boolean | void> }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [onlyVariance, setOnlyVariance] = useState(false)
  const [counts, setCounts] = useState<Record<ID, string>>({})
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return products.filter((p) => (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.barcode.includes(term)) && (!cat || p.categoryId === cat)).filter((p) => !onlyVariance || (counts[p.id] !== undefined && counts[p.id] !== '' && Number(counts[p.id]) !== p.stock))
  }, [products, q, cat, onlyVariance, counts])
  const changes = useMemo(() => products.flatMap((p) => { const v = counts[p.id]; if (v === undefined || v === '') return []; const n = Math.max(0, Math.round(Number(v) || 0)); return n === p.stock ? [] : [{ productId: p.id, diff: n - p.stock, product: p }] }), [products, counts])
  const counted = Object.values(counts).filter((v) => v !== '').length
  const varianceValue = changes.reduce((a, c) => a + c.diff * c.product.cost, 0)
  const cols: Column<Product>[] = [
    { key: 'name', header: 'Product', sortValue: (p) => p.name, render: productCell },
    { key: 'cat', header: 'Category', render: (p) => <CategoryBadge category={catById[p.categoryId]} /> },
    { key: 'system', header: 'System qty', align: 'right', sortValue: (p) => p.stock, render: (p) => <span className="tabular-nums text-slate-600">{p.stock}</span> },
    { key: 'counted', header: 'Counted', align: 'right', render: (p) => <input type="number" min={0} inputMode="numeric" value={counts[p.id] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [p.id]: e.target.value }))} onClick={(e) => e.stopPropagation()} placeholder={String(p.stock)} className={cx('input !w-24 text-right !py-1', counts[p.id] !== undefined && counts[p.id] !== '' && Number(counts[p.id]) !== p.stock && 'border-amber-400 bg-amber-50')} /> },
    { key: 'var', header: 'Variance', align: 'right', render: (p) => { const v = counts[p.id]; if (v === undefined || v === '') return <span className="text-slate-300">—</span>; const d = Math.round(Number(v) || 0) - p.stock; return d === 0 ? <span className="text-emerald-600 text-xs font-medium">Match</span> : <span className={cx('font-semibold tabular-nums', d > 0 ? 'text-emerald-600' : 'text-red-600')}>{d > 0 ? '+' : ''}{d} <span className="text-[11px] font-normal text-slate-400">({money(d * p.cost)})</span></span> } },
  ]
  return (
    <div>
      <div className="rounded-xl bg-brand-50/60 border border-brand-100 px-4 py-3 mb-3 text-sm text-slate-600 flex items-start gap-2">
        <ClipboardCheck size={16} className="text-brand-600 shrink-0 mt-0.5" />
        <span>Walk the shelves and enter the physical quantity for each product. Leave a row blank to skip it. When you apply the count, each variance is written as a <b>count</b> stock movement with the reason “Stock count”.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchInput value={q} onChange={setQ} placeholder="Find product…" className="w-full md:w-64" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-auto min-w-[150px]"><option value="">All categories</option>{Object.values(catById).filter((c) => c.id !== 'cat_service').map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</Select>
        <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" className="accent-brand-600" checked={onlyVariance} onChange={(e) => setOnlyVariance(e.target.checked)} /> Only variances</label>
        <div className="flex-1" />
        <span className="text-xs text-slate-500">{counted} counted · {changes.length} variance(s) · <span className={cx('font-semibold', varianceValue >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(varianceValue)}</span> at cost</span>
        <button className="btn-ghost text-xs" disabled={!counted} onClick={() => setCounts({})}>Reset</button>
        <button className="btn-primary" disabled={!changes.length} onClick={async () => { const ok = await onApply(changes.map((c) => ({ productId: c.productId, diff: c.diff }))); if (ok !== false) setCounts({}) }}><ClipboardCheck size={15} /> Apply count ({changes.length})</button>
      </div>
      <DataTable rows={rows} columns={cols} pageSize={25} compact empty={<EmptyState icon={<Search size={20} />} title="No products match" />} />
    </div>
  )
}

// ─── IMEI lookup ─────────────────────────────────────────────────────────────
function ImeiLookup() {
  const db = useDB((s) => s.db)
  const [q, setQ] = useState('')
  const term = q.trim()
  const result = useMemo(() => {
    if (term.length < 4) return null
    const inStock = db.products.find((p) => p.serials.some((s) => s === term))
    if (inStock) return { kind: 'available' as const, product: inStock }
    for (const t of [...db.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const line = t.lines.find((l) => l.serial === term)
      if (line) return { kind: 'sold' as const, tx: t, line, product: db.products.find((p) => p.id === line.productId) }
    }
    const mv = [...db.stockMovements].reverse().find((m) => m.serial === term)
    if (mv) return { kind: 'movement' as const, mv, product: db.products.find((p) => p.id === mv.productId) }
    const partial = db.products.flatMap((p) => p.serials.filter((s) => s.includes(term)).map((s) => ({ p, s }))).slice(0, 5)
    return { kind: 'none' as const, partial }
  }, [term, db])
  return (
    <Card title="IMEI / serial lookup" subtitle="Find where a device is right now" action={<ScanLine size={16} className="text-slate-400" />}>
      <SearchInput value={q} onChange={setQ} placeholder="Scan or type a serial…" />
      <div className="mt-3 text-sm">
        {!result && <div className="text-xs text-slate-400">Enter at least 4 characters. Matches available stock, sold lines and stock movements.</div>}
        {result?.kind === 'available' && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
            <Badge tone="green" dot>In stock · available</Badge>
            <Link to={`/admin/catalog/${result.product.id}`} className="flex items-center gap-2 mt-2 group"><span className="text-xl">{result.product.emoji}</span><span className="font-medium text-slate-800 group-hover:text-brand-700">{result.product.name}</span></Link>
            <div className="text-xs text-slate-500 mt-1">{result.product.serials.length} unit(s) of this model on hand · {money(result.product.price)}</div>
          </div>
        )}
        {result?.kind === 'sold' && (
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
            <Badge tone="blue" dot>{result.tx.type === 'refund' ? 'Refunded' : 'Sold'}</Badge>
            <div className="flex items-center gap-2 mt-2"><span className="text-xl">{result.line.emoji}</span><span className="font-medium text-slate-800">{result.line.name}</span></div>
            <div className="text-xs text-slate-500 mt-1">{fmtDateTime(result.tx.createdAt)} · {money(result.line.unitPrice)} · by {db.users.find((u) => u.id === result.tx.userId)?.name ?? 'Staff'}{result.tx.customerId && ` · ${db.customers.find((c) => c.id === result.tx.customerId)?.name ?? ''}`}</div>
            <Link to={`/admin/transactions/${result.tx.id}`} className="btn-secondary !py-1 text-xs mt-2"><ExternalLink size={12} /> Open {result.tx.number}</Link>
          </div>
        )}
        {result?.kind === 'movement' && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
            <MovementTypeBadge type={result.mv.type} />
            <div className="font-medium text-slate-800 mt-2">{result.product?.name ?? 'Unknown product'}</div>
            <div className="text-xs text-slate-500 mt-1">{fmtDateTime(result.mv.createdAt)} · {result.mv.qty > 0 ? '+' : ''}{result.mv.qty} · {result.mv.reason ?? ''}</div>
          </div>
        )}
        {result?.kind === 'none' && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
            <div className="text-slate-600">No exact match for <span className="font-mono">{term}</span>.</div>
            {result.partial.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="text-[11px] text-slate-400 uppercase tracking-wide">Similar in stock</div>
                {result.partial.map(({ p, s }) => <button key={s} type="button" onClick={() => setQ(s)} className="block text-xs font-mono text-brand-700 hover:underline">{s} <span className="text-slate-400 font-sans">· {p.name}</span></button>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function RecentMovements({ movements, products, onSeeAll }: { movements: StockMovement[]; products: Product[]; onSeeAll: () => void }) {
  const recent = useMemo(() => [...movements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8), [movements])
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products])
  return (
    <Card title="Latest movements" action={<button className="btn-ghost !py-1 !px-2 text-xs" onClick={onSeeAll}>See all</button>}>
      {recent.length ? (
        <div className="divide-y divide-slate-50 -my-1">
          {recent.map((m) => { const p = byId[m.productId]; return (
            <div key={m.id} className="flex items-center gap-3 py-2">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-base shrink-0">{p?.emoji ?? '📦'}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-800 truncate">{p?.name ?? 'Deleted product'}</div>
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5"><MovementTypeBadge type={m.type} /> {fmtDate(m.createdAt, 'MMM d, HH:mm')}</div>
              </div>
              <span className={cx('font-semibold tabular-nums text-sm', m.qty > 0 ? 'text-emerald-600' : 'text-red-600')}>{m.qty > 0 ? '+' : ''}{m.qty}</span>
            </div>
          ) })}
        </div>
      ) : <div className="text-sm text-slate-400">No movements yet.</div>}
    </Card>
  )
}
