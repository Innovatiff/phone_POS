import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Copy, Trash2, SlidersHorizontal, AlertTriangle, Barcode, ClipboardCopy, ExternalLink, Package, TrendingUp, History, ShoppingBag } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import type { Product, StockMovement, StockMovementType, Transaction } from '@/lib/types'
import { money, cx, fmtDateTime, ago, round2, daysAgo, dayKey } from '@/lib/utils'
import { Card, PageHeader, Badge, Sparkline, Modal, Field, Input, Select, Textarea, confirm, toast, EmptyState, DataTable, KV, ProgressBar, type Column } from '@/components/ui'
import { ProductEditor, CategoryBadge, stockStatus, marginPct, attrsLabel } from './Catalog'

// ─── Shared: movement type badge ─────────────────────────────────────────────
const MOVEMENT_TONE: Record<StockMovementType, { tone: 'slate' | 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'orange' | 'cyan' | 'pink'; label: string }> = {
  sale: { tone: 'blue', label: 'Sale' },
  refund: { tone: 'purple', label: 'Refund' },
  purchase: { tone: 'green', label: 'Purchase' },
  adjustment: { tone: 'slate', label: 'Adjustment' },
  damage: { tone: 'red', label: 'Damage' },
  return_to_supplier: { tone: 'orange', label: 'Return to supplier' },
  initial: { tone: 'cyan', label: 'Initial' },
  transfer: { tone: 'amber', label: 'Transfer' },
  count: { tone: 'pink', label: 'Stock count' },
}
export function MovementTypeBadge({ type }: { type: StockMovementType }) {
  const m = MOVEMENT_TONE[type] ?? { tone: 'slate' as const, label: type }
  return <Badge tone={m.tone} dot>{m.label}</Badge>
}
export const MOVEMENT_TYPES = Object.keys(MOVEMENT_TONE) as StockMovementType[]

// ─── Shared: stock adjust modal ──────────────────────────────────────────────
type AdjustType = Extract<StockMovementType, 'purchase' | 'adjustment' | 'damage' | 'return_to_supplier' | 'count'>
const ADJUST_TYPES: Array<{ value: AdjustType; label: string; hint: string }> = [
  { value: 'purchase', label: 'Purchase / received', hint: 'Adds units received outside a purchase order' },
  { value: 'adjustment', label: 'Manual adjustment', hint: 'Signed quantity: + adds, − removes' },
  { value: 'damage', label: 'Damaged / write-off', hint: 'Removes units from stock' },
  { value: 'return_to_supplier', label: 'Return to supplier', hint: 'Removes units sent back' },
  { value: 'count', label: 'Stock count', hint: 'Enter the physical count; the difference is applied' },
]
export function StockAdjustModal({ open, onClose, product }: { open: boolean; onClose: () => void; product?: Product }) {
  const admin = useAdminUser()!
  const adjustStock = useDB((s) => s.adjustStock)
  const [type, setType] = useState<AdjustType>('adjustment')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [serials, setSerials] = useState('')
  useEffect(() => { if (open) { setType('adjustment'); setQty(''); setReason(''); setSerials('') } }, [open, product?.id])
  if (!product) return null
  const n = Number(qty)
  const serialList = serials.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean)
  const signed = (): number => {
    if (Number.isNaN(n) || qty === '') return 0
    switch (type) {
      case 'purchase': return Math.abs(Math.round(n))
      case 'damage': case 'return_to_supplier': return -Math.abs(Math.round(n))
      case 'count': return Math.round(n) - product.stock
      default: return Math.round(n)
    }
  }
  const delta = signed()
  const after = product.stock + delta
  const submit = () => {
    if (qty === '' || Number.isNaN(n)) { toast.error('Enter a quantity'); return }
    if (delta === 0) { toast.error('No change to apply'); return }
    if (after < 0) { toast.error(`Cannot go below zero (would be ${after})`); return }
    if (product.trackSerial && serialList.length && serialList.length !== Math.abs(delta)) { toast.error(`You entered ${serialList.length} serial(s) but the quantity change is ${Math.abs(delta)}`); return }
    if (product.trackSerial && delta < 0 && serialList.some((s) => !product.serials.includes(s))) { toast.error('One or more serials are not currently in stock'); return }
    const why = reason.trim() || ADJUST_TYPES.find((t) => t.value === type)!.label
    adjustStock(product.id, delta, type, why, admin.id, undefined, product.trackSerial && serialList.length ? serialList : undefined)
    toast.success(`${delta > 0 ? '+' : ''}${delta} × ${product.name} — stock is now ${after}`)
    onClose()
  }
  const meta = ADJUST_TYPES.find((t) => t.value === type)!
  return (
    <Modal open={open} onClose={onClose} title="Adjust stock" subtitle={`${product.emoji} ${product.name} · currently ${product.stock} on hand`} size="md"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={submit}>Apply {delta !== 0 && <span className={cx('ml-1 font-mono', delta > 0 ? 'text-emerald-200' : 'text-red-200')}>{delta > 0 ? '+' : ''}{delta}</span>}</button></>}>
      <div className="space-y-3 pb-2">
        <Field label="Movement type" hint={meta.hint}>
          <Select value={type} onChange={(e) => setType(e.target.value as AdjustType)}>
            {ADJUST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={type === 'count' ? 'Counted quantity' : type === 'adjustment' ? 'Quantity (signed)' : 'Quantity'}>
            <Input type="number" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} placeholder={type === 'count' ? String(product.stock) : type === 'adjustment' ? '+5 or -2' : '0'} />
          </Field>
          <div>
            <span className="label">Result</span>
            <div className="input !bg-slate-50 flex items-center justify-between tabular-nums">
              <span className="text-slate-500">{product.stock}</span>
              <span className="text-slate-300">→</span>
              <span className={cx('font-semibold', after < 0 ? 'text-red-600' : after <= product.lowStockThreshold ? 'text-amber-600' : 'text-slate-800')}>{after}</span>
            </div>
          </div>
        </div>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Found extra unit in back room" /></Field>
        {product.trackSerial && (
          <Field label={`Serial / IMEI numbers (one per line)`} hint={delta > 0 ? 'Serials to add to available stock' : delta < 0 ? 'Serials to remove from available stock' : 'Optional — must match the quantity change'}>
            <Textarea value={serials} onChange={(e) => setSerials(e.target.value)} className="font-mono text-xs min-h-[100px]" placeholder={'350000000000001\n350000000000002'} />
          </Field>
        )}
        {product.trackSerial && delta < 0 && product.serials.length > 0 && (
          <div className="text-xs text-slate-500">Available: {product.serials.slice(0, 6).map((s) => <button key={s} type="button" className="font-mono text-brand-700 hover:underline mr-2" onClick={() => setSerials((v) => (v ? v + '\n' : '') + s)}>{s}</button>)}{product.serials.length > 6 && `+${product.serials.length - 6} more`}</div>
        )}
      </div>
    </Modal>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const upsertProduct = useDB((s) => s.upsertProduct)
  const deleteProduct = useDB((s) => s.deleteProduct)
  const product = db.products.find((p) => p.id === id)
  const [edit, setEdit] = useState(false)
  const [adjust, setAdjust] = useState(false)

  const category = db.categories.find((c) => c.id === product?.categoryId)
  const brand = db.brands.find((b) => b.id === product?.brandId)
  const supplier = db.suppliers.find((s) => s.id === product?.supplierId)

  const movements = useMemo(() => db.stockMovements.filter((m) => m.productId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db.stockMovements, id])
  const txRows = useMemo(() => {
    const out: Array<{ id: string; tx: Transaction; qty: number; unitPrice: number; total: number }> = []
    db.transactions.forEach((t) => {
      const lines = t.lines.filter((l) => l.productId === id)
      if (!lines.length) return
      out.push({ id: t.id, tx: t, qty: lines.reduce((a, l) => a + l.qty, 0), unitPrice: lines[0]!.unitPrice, total: round2(lines.reduce((a, l) => a + l.lineTotal, 0)) })
    })
    return out.sort((a, b) => b.tx.createdAt.localeCompare(a.tx.createdAt))
  }, [db.transactions, id])

  const perf = useMemo(() => {
    const calc = (days: number) => {
      const start = daysAgo(days - 1); start.setHours(0, 0, 0, 0)
      let units = 0, revenue = 0
      txRows.forEach((r) => { if (r.tx.status !== 'voided' && new Date(r.tx.createdAt) >= start) { units += r.qty; revenue += r.total } })
      return { units, revenue: round2(revenue) }
    }
    const daily = new Map<string, number>()
    for (let i = 29; i >= 0; i--) daily.set(dayKey(daysAgo(i).toISOString()), 0)
    txRows.forEach((r) => { if (r.tx.status === 'voided' || r.tx.type !== 'sale') return; const k = dayKey(r.tx.createdAt); if (daily.has(k)) daily.set(k, (daily.get(k) ?? 0) + r.qty) })
    const lastSale = txRows.find((r) => r.tx.type === 'sale' && r.tx.status !== 'voided')
    return { d30: calc(30), d90: calc(90), spark: Array.from(daily.values()), lastSold: lastSale?.tx.createdAt, allUnits: txRows.filter((r) => r.tx.status !== 'voided').reduce((a, r) => a + r.qty, 0) }
  }, [txRows])

  if (!product) {
    return (
      <div>
        <PageHeader title="Product not found" actions={<Link to="/admin/catalog" className="btn-secondary"><ArrowLeft size={15} /> Back to catalog</Link>} />
        <Card><EmptyState icon={<Package size={22} />} title="This product no longer exists" description="It may have been deleted. Head back to the catalog to find what you need." action={<Link to="/admin/catalog" className="btn-primary">Open catalog</Link>} /></Card>
      </div>
    )
  }

  const status = stockStatus(product)
  const margin = marginPct(product.price, product.cost)
  const taxAmount = product.taxable ? round2(product.price * db.settings.taxRate / 100) : 0

  const duplicate = () => {
    const { id: _id, sku: _sku, barcode: _bc, serials: _s, stock: _st, soldCount: _sc, createdAt: _c, updatedAt: _u, ...rest } = product
    const np = upsertProduct({ ...rest, name: `${product.name} (copy)`, stock: 0, serials: [] }, admin.id)
    toast.success(`Duplicated as ${np.name}`)
    navigate(`/admin/catalog/${np.id}`)
  }
  const remove = async () => {
    if (!(await confirm(`Delete ${product.name}?`, 'The product is removed from the catalog. Past transactions and stock movements keep their history.', { danger: true, confirmLabel: 'Delete product' }))) return
    deleteProduct(product.id, admin.id)
    toast.success('Product deleted')
    navigate('/admin/catalog')
  }
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); toast.info('Copied to clipboard') }

  const userName = (uid: string) => db.users.find((u) => u.id === uid)?.name ?? 'System'
  const refCell = (m: StockMovement) => {
    if (!m.refId) return <span className="text-slate-300">—</span>
    const tx = db.transactions.find((t) => t.id === m.refId)
    if (tx) return <Link to={`/admin/transactions/${tx.id}`} onClick={(e) => e.stopPropagation()} className="text-brand-700 hover:underline font-mono text-xs inline-flex items-center gap-1">{tx.number} <ExternalLink size={11} /></Link>
    const po = db.purchaseOrders.find((p) => p.id === m.refId)
    if (po) return <Link to="/admin/purchase-orders" className="text-brand-700 hover:underline font-mono text-xs inline-flex items-center gap-1">{po.number} <ExternalLink size={11} /></Link>
    return <span className="font-mono text-xs text-slate-400">{m.refId.slice(0, 12)}</span>
  }

  const movementCols: Column<StockMovement>[] = [
    { key: 'createdAt', header: 'Date', sortValue: (m) => m.createdAt, render: (m) => <div><div className="text-slate-700">{fmtDateTime(m.createdAt)}</div><div className="text-[11px] text-slate-400">{ago(m.createdAt)}</div></div> },
    { key: 'type', header: 'Type', sortValue: (m) => m.type, render: (m) => <MovementTypeBadge type={m.type} /> },
    { key: 'qty', header: 'Qty', align: 'right', sortValue: (m) => m.qty, render: (m) => <span className={cx('font-semibold tabular-nums', m.qty > 0 ? 'text-emerald-600' : 'text-red-600')}>{m.qty > 0 ? '+' : ''}{m.qty}</span> },
    { key: 'ba', header: 'Before → After', align: 'right', render: (m) => <span className="tabular-nums text-slate-500">{m.before} <span className="text-slate-300">→</span> <span className="text-slate-800 font-medium">{m.after}</span></span> },
    { key: 'reason', header: 'Reason', render: (m) => <span className="text-slate-600">{m.reason ?? <span className="text-slate-300">—</span>}{m.serial && <span className="ml-2 font-mono text-[11px] text-slate-400">{m.serial}</span>}</span> },
    { key: 'user', header: 'By', render: (m) => <span className="text-slate-600">{userName(m.userId)}</span> },
    { key: 'ref', header: 'Reference', render: refCell },
  ]
  const salesCols: Column<(typeof txRows)[number]>[] = [
    { key: 'number', header: 'Transaction', sortValue: (r) => r.tx.number, render: (r) => <span className="font-mono text-xs text-brand-700">{r.tx.number}</span> },
    { key: 'date', header: 'Date', sortValue: (r) => r.tx.createdAt, render: (r) => <span className="text-slate-600">{fmtDateTime(r.tx.createdAt)}</span> },
    { key: 'type', header: 'Type', render: (r) => <Badge tone={r.tx.type === 'refund' ? 'purple' : r.tx.status === 'voided' ? 'red' : 'green'}>{r.tx.status === 'voided' ? 'Voided' : r.tx.type === 'refund' ? 'Refund' : 'Sale'}</Badge> },
    { key: 'cashier', header: 'Cashier', render: (r) => <span className="text-slate-600">{userName(r.tx.userId)}</span> },
    { key: 'qty', header: 'Qty', align: 'right', sortValue: (r) => r.qty, render: (r) => <span className="tabular-nums font-medium">{r.qty}</span> },
    { key: 'unit', header: 'Unit price', align: 'right', render: (r) => <span className="tabular-nums text-slate-600">{money(r.unitPrice)}</span> },
    { key: 'total', header: 'Line total', align: 'right', sortValue: (r) => r.total, render: (r) => <span className="tabular-nums font-semibold">{money(r.total)}</span> },
  ]

  return (
    <div>
      <div className="mb-3"><Link to="/admin/catalog" className="text-sm text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"><ArrowLeft size={14} /> Catalog</Link></div>
      <div className="card p-5 mb-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-5xl shrink-0" style={{ background: `${category?.color ?? '#64748b'}14` }}>{product.emoji}</div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[24px] leading-tight font-bold text-slate-900 tracking-tight">{product.name}</h1>
            <div className="text-sm text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs">{product.sku}</span>
              <span className="font-mono text-xs inline-flex items-center gap-1"><Barcode size={12} /> {product.barcode}</span>
              {attrsLabel(product.attrs).map((a) => <span key={a} className="text-[11px] font-medium bg-slate-100 text-slate-600 rounded px-1.5 py-px">{a}</span>)}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <CategoryBadge category={category} />
              {brand && <Badge tone="slate">{brand.name}</Badge>}
              <Badge tone={product.active ? 'green' : 'slate'} dot>{product.active ? 'Active' : 'Inactive'}</Badge>
              {product.trackSerial && <Badge tone="blue">IMEI tracked</Badge>}
              {!product.taxable && <Badge tone="amber">Tax exempt</Badge>}
              {product.tags.map((t) => <Badge key={t} tone="purple">#{t}</Badge>)}
            </div>
            {product.description && <p className="text-sm text-slate-600 mt-3 max-w-2xl">{product.description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary" onClick={() => setAdjust(true)}><SlidersHorizontal size={15} /> Adjust stock</button>
            <button className="btn-secondary" onClick={duplicate}><Copy size={15} /> Duplicate</button>
            <button className="btn-secondary text-red-600 hover:bg-red-50" onClick={remove}><Trash2 size={15} /> Delete</button>
            <button className="btn-primary" onClick={() => setEdit(true)}><Pencil size={15} /> Edit</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <Card title="Pricing">
          <div className="text-[28px] font-bold text-slate-900 leading-none tracking-tight">{money(product.price)}</div>
          <div className="text-xs text-slate-400 mt-1">Selling price ex tax{product.taxable && ` · ${money(round2(product.price + taxAmount))} inc ${db.settings.taxName}`}</div>
          <div className="mt-3 divide-y divide-slate-50">
            <KV label="Cost" value={money(product.cost)} />
            <KV label="Profit / unit" value={<span className={product.price - product.cost < 0 ? 'text-red-600' : 'text-emerald-600'}>{money(round2(product.price - product.cost))}</span>} />
            <KV label="Margin" value={<span className={margin < 10 ? 'text-red-600' : margin < 25 ? 'text-amber-600' : 'text-emerald-600'}>{margin.toFixed(1)}%</span>} />
            <KV label={db.settings.taxName} value={product.taxable ? `${db.settings.taxRate}% (${money(taxAmount)})` : 'Exempt'} />
            {supplier && <KV label="Supplier" value={<Link to="/admin/suppliers" className="text-brand-700 hover:underline">{supplier.name}</Link>} />}
          </div>
        </Card>

        <Card title="Stock" action={<button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setAdjust(true)}>Adjust</button>}>
          {status === 'na' ? (
            <div className="text-sm text-slate-500">Service item — not stock-tracked.</div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <div className={cx('text-[28px] font-bold leading-none tracking-tight', status === 'out' ? 'text-red-600' : status === 'low' ? 'text-amber-600' : 'text-slate-900')}>{product.stock}</div>
                <div className="text-sm text-slate-400">units on hand</div>
              </div>
              <div className="mt-2">
                <ProgressBar value={product.lowStockThreshold ? Math.min(100, (product.stock / (product.lowStockThreshold * 3)) * 100) : 100} color={status === 'out' ? '#ef4444' : status === 'low' ? '#f59e0b' : '#22c55e'} />
                <div className="text-[11px] text-slate-400 mt-1">Threshold {product.lowStockThreshold} · target {product.lowStockThreshold * 3}</div>
              </div>
              {status !== 'in' && (
                <div className={cx('mt-3 rounded-lg px-3 py-2 text-xs flex items-start gap-2', status === 'out' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')}>
                  <AlertTriangle size={14} className="shrink-0 mt-px" />
                  <span>{status === 'out' ? 'Out of stock. Customers cannot buy this until it is restocked.' : `Low stock: at or below the threshold of ${product.lowStockThreshold}. Consider a purchase order.`}</span>
                </div>
              )}
              <div className="mt-3 divide-y divide-slate-50">
                <KV label="Value at cost" value={money(round2(Math.max(0, product.stock) * product.cost))} />
                <KV label="Value at retail" value={money(round2(Math.max(0, product.stock) * product.price))} />
                <KV label="Sold all time" value={product.soldCount} />
              </div>
            </>
          )}
        </Card>

        <Card title="Sales performance" subtitle="Units sold from completed sales" className="md:col-span-2 xl:col-span-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Last 30 days</div>
              <div className="text-2xl font-bold text-slate-900 mt-0.5">{perf.d30.units} <span className="text-sm font-medium text-slate-400">units</span></div>
              <div className="text-sm text-emerald-600 font-semibold">{money(perf.d30.revenue)}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Last 90 days</div>
              <div className="text-2xl font-bold text-slate-900 mt-0.5">{perf.d90.units} <span className="text-sm font-medium text-slate-400">units</span></div>
              <div className="text-sm text-emerald-600 font-semibold">{money(perf.d90.revenue)}</div>
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 p-3">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1"><span className="inline-flex items-center gap-1"><TrendingUp size={12} /> Daily units, last 30 days</span><span>peak {Math.max(0, ...perf.spark)}/day</span></div>
            <Sparkline data={perf.spark} width={420} height={56} color="#2563eb" />
          </div>
          <div className="mt-3 divide-y divide-slate-50">
            <KV label="Last sold" value={perf.lastSold ? <span title={fmtDateTime(perf.lastSold)}>{ago(perf.lastSold)}</span> : 'Never'} />
            <KV label="Avg daily (30d)" value={(perf.d30.units / 30).toFixed(2)} />
            <KV label="Days of cover" value={status === 'na' ? '—' : perf.d30.units > 0 ? `${Math.round(product.stock / (perf.d30.units / 30))} days` : product.stock > 0 ? '∞' : '0 days'} />
          </div>
        </Card>
      </div>

      {product.trackSerial && (
        <Card title={`Serial / IMEI numbers`} subtitle={`${product.serials.length} available (unsold)`} className="mb-4" action={product.serials.length > 0 && <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => copy(product.serials.join('\n'))}><ClipboardCopy size={13} /> Copy all</button>}>
          {product.serials.length ? (
            <div className="flex flex-wrap gap-1.5">
              {product.serials.map((s) => (
                <button key={s} type="button" onClick={() => copy(s)} title="Click to copy" className="font-mono text-xs bg-slate-50 border border-slate-100 hover:border-brand-300 hover:bg-brand-50 rounded-md px-2 py-1 text-slate-700 transition-colors">{s}</button>
              ))}
            </div>
          ) : <div className="text-sm text-slate-400">No serial numbers on hand. Add some via Adjust stock or by receiving a purchase order.</div>}
        </Card>
      )}

      <Card title="Stock movement history" subtitle={`${movements.length} movements · every change to on-hand quantity`} className="mb-4" action={<History size={16} className="text-slate-400" />}>
        <DataTable rows={movements} columns={movementCols} pageSize={10} compact empty={<EmptyState icon={<History size={20} />} title="No stock movements yet" />} />
      </Card>

      <Card title="Recent sales" subtitle={`${txRows.length} transactions include this product`} action={<ShoppingBag size={16} className="text-slate-400" />}>
        <DataTable rows={txRows} columns={salesCols} pageSize={10} compact onRowClick={(r) => navigate(`/admin/transactions/${r.tx.id}`)} empty={<EmptyState icon={<ShoppingBag size={20} />} title="Not sold yet" description="Sales at the register will show up here." />} />
      </Card>

      <ProductEditor open={edit} onClose={() => setEdit(false)} product={product} />
      <StockAdjustModal open={adjust} onClose={() => setAdjust(false)} product={product} />
    </div>
  )
}

