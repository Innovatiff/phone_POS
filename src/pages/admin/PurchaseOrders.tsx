import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, ClipboardList, Trash2, Pencil, PackageCheck, Send, Ban, Printer, Search, X, Truck, Calendar, FileText, CircleDollarSign, Clock } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import type { PurchaseOrder, POLine, POStatus, Product, ID } from '@/lib/types'
import { money, cx, fmtDate, fmtDateTime, ago, round2, uid } from '@/lib/utils'
import { PageHeader, StatCard, Badge, statusTone, Tabs, DataTable, Drawer, Modal, Field, Input, Select, Textarea, ProgressBar, confirm, toast, EmptyState, KV, type Column } from '@/components/ui'

type TabKey = 'all' | POStatus
const STATUS_LABEL: Record<POStatus, string> = { draft: 'Draft', ordered: 'Ordered', partial: 'Partially received', received: 'Received', cancelled: 'Cancelled' }

const lineTotal = (l: POLine) => round2(l.qty * l.cost)
const poTotal = (po: PurchaseOrder) => round2(po.lines.reduce((a, l) => a + lineTotal(l), 0))
const poOrdered = (po: PurchaseOrder) => po.lines.reduce((a, l) => a + l.qty, 0)
const poReceived = (po: PurchaseOrder) => po.lines.reduce((a, l) => a + Math.min(l.qty, l.received), 0)
const poProgress = (po: PurchaseOrder) => { const o = poOrdered(po); return o ? (poReceived(po) / o) * 100 : 0 }

export default function PurchaseOrders() {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const setPOStatus = useDB((s) => s.setPOStatus)
  const deletePurchaseOrder = useDB((s) => s.deletePurchaseOrder)
  const [tab, setTab] = useState<TabKey>('all')
  const [q, setQ] = useState('')
  const [editor, setEditor] = useState<{ open: boolean; po?: PurchaseOrder }>({ open: false })
  const [detailId, setDetailId] = useState<ID | undefined>()
  const [receiveId, setReceiveId] = useState<ID | undefined>()

  const supplierById = useMemo(() => Object.fromEntries(db.suppliers.map((s) => [s.id, s])), [db.suppliers])
  const counts = useMemo(() => { const c: Record<TabKey, number> = { all: db.purchaseOrders.length, draft: 0, ordered: 0, partial: 0, received: 0, cancelled: 0 }; db.purchaseOrders.forEach((p) => { c[p.status]++ }); return c }, [db.purchaseOrders])
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return db.purchaseOrders.filter((po) => (tab === 'all' || po.status === tab) && (!term || po.number.toLowerCase().includes(term) || (supplierById[po.supplierId]?.name ?? '').toLowerCase().includes(term) || po.lines.some((l) => db.products.find((p) => p.id === l.productId)?.name.toLowerCase().includes(term)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [db.purchaseOrders, db.products, tab, q, supplierById])

  const open = db.purchaseOrders.filter((p) => p.status === 'ordered' || p.status === 'partial')
  const openValue = round2(open.reduce((a, p) => a + poTotal(p), 0))
  const overdue = open.filter((p) => p.expectedAt && new Date(p.expectedAt).getTime() < Date.now()).length
  const receivedThisMonth = db.purchaseOrders.filter((p) => p.status === 'received' && p.receivedAt && new Date(p.receivedAt).getMonth() === new Date().getMonth() && new Date(p.receivedAt).getFullYear() === new Date().getFullYear())
  const detail = db.purchaseOrders.find((p) => p.id === detailId)
  const receiving = db.purchaseOrders.find((p) => p.id === receiveId)

  const cancel = async (po: PurchaseOrder) => {
    if (!(await confirm(`Cancel ${po.number}?`, 'The order will be marked as cancelled. Already-received stock is not reversed.', { danger: true, confirmLabel: 'Cancel order' }))) return
    setPOStatus(po.id, 'cancelled', admin.id)
    toast.success(`${po.number} cancelled`)
  }
  const remove = async (po: PurchaseOrder) => {
    if (!(await confirm(`Delete ${po.number}?`, 'Draft purchase orders can be deleted permanently.', { danger: true, confirmLabel: 'Delete' }))) return
    deletePurchaseOrder(po.id, admin.id)
    setDetailId(undefined)
    toast.success(`${po.number} deleted`)
  }
  const markOrdered = (po: PurchaseOrder) => {
    if (!po.lines.length) { toast.error('Add at least one line before ordering'); return }
    setPOStatus(po.id, 'ordered', admin.id)
    toast.success(`${po.number} marked as ordered`)
  }

  const cols: Column<PurchaseOrder>[] = [
    { key: 'number', header: 'PO #', sortValue: (p) => p.number, render: (p) => <span className="font-mono text-xs font-semibold text-brand-700">{p.number}</span> },
    { key: 'supplier', header: 'Supplier', sortValue: (p) => supplierById[p.supplierId]?.name ?? '', render: (p) => <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center"><Truck size={14} /></div><span className="font-medium text-slate-800">{supplierById[p.supplierId]?.name ?? 'Unknown'}</span></div> },
    { key: 'created', header: 'Created', sortValue: (p) => p.createdAt, render: (p) => <div><div className="text-slate-700">{fmtDate(p.createdAt)}</div><div className="text-[11px] text-slate-400">{db.users.find((u) => u.id === p.userId)?.name ?? ''}</div></div> },
    { key: 'expected', header: 'Expected', sortValue: (p) => p.expectedAt ?? '', render: (p) => { const late = p.expectedAt && (p.status === 'ordered' || p.status === 'partial') && new Date(p.expectedAt).getTime() < Date.now(); return p.expectedAt ? <span className={cx(late ? 'text-red-600 font-medium' : 'text-slate-600')}>{fmtDate(p.expectedAt)}{late && ' · late'}</span> : <span className="text-slate-300">—</span> } },
    { key: 'lines', header: 'Lines', align: 'right', sortValue: (p) => p.lines.length, render: (p) => <span className="tabular-nums text-slate-600">{p.lines.length} <span className="text-slate-400 text-xs">({poOrdered(p)} units)</span></span> },
    { key: 'total', header: 'Total cost', align: 'right', sortValue: poTotal, render: (p) => <span className="font-semibold tabular-nums">{money(poTotal(p))}</span> },
    { key: 'progress', header: 'Received', width: '150px', sortValue: poProgress, render: (p) => <div className="min-w-[120px]"><div className="flex justify-between text-[11px] text-slate-500 mb-1"><span>{poReceived(p)}/{poOrdered(p)}</span><span>{Math.round(poProgress(p))}%</span></div><ProgressBar value={poProgress(p)} color={p.status === 'received' ? '#22c55e' : p.status === 'cancelled' ? '#94a3b8' : '#2563eb'} className="!h-1.5" /></div> },
    { key: 'status', header: 'Status', sortValue: (p) => p.status, render: (p) => <Badge tone={statusTone(p.status)} dot>{STATUS_LABEL[p.status]}</Badge> },
    {
      key: 'actions', header: '', align: 'right', render: (p) => (
        <div className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          {p.status === 'draft' && <button className="btn-secondary !py-1 !px-2 text-xs" onClick={() => markOrdered(p)}><Send size={12} /> Order</button>}
          {(p.status === 'ordered' || p.status === 'partial') && <button className="btn-primary !py-1 !px-2 text-xs" onClick={() => setReceiveId(p.id)}><PackageCheck size={12} /> Receive</button>}
          {p.status === 'draft' && <button className="btn-ghost !py-1 !px-2" title="Edit" onClick={() => setEditor({ open: true, po: p })}><Pencil size={13} /></button>}
          {p.status === 'draft' && <button className="btn-ghost !py-1 !px-2 text-red-600 hover:bg-red-50" title="Delete" onClick={() => remove(p)}><Trash2 size={13} /></button>}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="Purchase orders" subtitle="Order stock from suppliers and receive it into inventory" actions={<button className="btn-primary" onClick={() => setEditor({ open: true })}><Plus size={15} /> New purchase order</button>} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <StatCard label="Open orders" value={open.length} icon={<ClipboardList size={14} />} hint="Ordered or partially received" onClick={() => setTab('ordered')} />
        <StatCard label="On order value" value={money(openValue)} icon={<CircleDollarSign size={14} />} hint="Cost of open orders" />
        <StatCard label="Overdue" value={overdue} icon={<Clock size={14} className={overdue ? 'text-red-500' : undefined} />} hint="Past expected date" />
        <StatCard label="Received this month" value={receivedThisMonth.length} icon={<PackageCheck size={14} />} hint={money(round2(receivedThisMonth.reduce((a, p) => a + poTotal(p), 0)))} onClick={() => setTab('received')} />
      </div>

      <div className="card p-5">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'all', label: 'All', count: counts.all }, { value: 'draft', label: 'Draft', count: counts.draft }, { value: 'ordered', label: 'Ordered', count: counts.ordered },
          { value: 'partial', label: 'Partial', count: counts.partial }, { value: 'received', label: 'Received', count: counts.received }, { value: 'cancelled', label: 'Cancelled', count: counts.cancelled },
        ]} />
        <div className="flex items-center gap-2 mb-3">
          <div className="relative w-full md:w-72"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PO number, supplier, product…" className="input pl-9" />{q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X size={14} /></button>}</div>
          <div className="flex-1" />
          <span className="text-xs text-slate-400">{rows.length} order(s) · {money(round2(rows.reduce((a, p) => a + poTotal(p), 0)))}</span>
        </div>
        <DataTable rows={rows} columns={cols} pageSize={15} onRowClick={(p) => setDetailId(p.id)} empty={<EmptyState icon={<ClipboardList size={22} />} title="No purchase orders" description="Create one to order stock from a supplier, or generate drafts from the low-stock report in Inventory." action={<div className="flex gap-2"><button className="btn-primary" onClick={() => setEditor({ open: true })}><Plus size={15} /> New purchase order</button><Link to="/admin/inventory" className="btn-secondary">Low stock report</Link></div>} />} />
      </div>

      <POEditor open={editor.open} po={editor.po} onClose={() => setEditor({ open: false })} />
      <PODetail po={detail} onClose={() => setDetailId(undefined)} onEdit={(po) => { setDetailId(undefined); setEditor({ open: true, po }) }} onReceive={(po) => setReceiveId(po.id)} onOrder={markOrdered} onCancel={cancel} onDelete={remove} />
      <ReceiveModal po={receiving} onClose={() => setReceiveId(undefined)} />
    </div>
  )
}

// ─── Editor ──────────────────────────────────────────────────────────────────
interface DraftLine { id: ID; productId: ID; qty: string; cost: string; received: number }
export function POEditor({ open, onClose, po, presetSupplierId }: { open: boolean; onClose: () => void; po?: PurchaseOrder; presetSupplierId?: ID }) {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const upsertPurchaseOrder = useDB((s) => s.upsertPurchaseOrder)
  const [supplierId, setSupplierId] = useState('')
  const [expectedAt, setExpectedAt] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [search, setSearch] = useState('')
  const [onlySupplier, setOnlySupplier] = useState(true)
  useEffect(() => {
    if (!open) return
    if (po) {
      setSupplierId(po.supplierId); setExpectedAt(po.expectedAt ? po.expectedAt.slice(0, 10) : ''); setNotes(po.notes ?? '')
      setLines(po.lines.map((l) => ({ id: l.id, productId: l.productId, qty: String(l.qty), cost: String(l.cost), received: l.received })))
    } else {
      setSupplierId(presetSupplierId ?? db.suppliers[0]?.id ?? ''); setExpectedAt(''); setNotes(''); setLines([])
    }
    setSearch('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po?.id])

  const productById = useMemo(() => Object.fromEntries(db.products.map((p) => [p.id, p])), [db.products])
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return []
    return db.products.filter((p) => p.categoryId !== 'cat_service' && !lines.some((l) => l.productId === p.id) && (!onlySupplier || !p.supplierId || p.supplierId === supplierId) && (p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.barcode.includes(term))).slice(0, 8)
  }, [db.products, search, lines, onlySupplier, supplierId])
  const addProduct = (p: Product) => {
    setLines((ls) => [...ls, { id: uid('pol'), productId: p.id, qty: String(Math.max(1, p.lowStockThreshold * 3 - p.stock)), cost: String(p.cost), received: 0 }])
    setSearch('')
  }
  const addLowStock = () => {
    const low = db.products.filter((p) => p.categoryId !== 'cat_service' && p.supplierId === supplierId && p.stock <= p.lowStockThreshold && !lines.some((l) => l.productId === p.id))
    if (!low.length) { toast.info('No low-stock products for this supplier'); return }
    setLines((ls) => [...ls, ...low.map((p) => ({ id: uid('pol'), productId: p.id, qty: String(Math.max(1, p.lowStockThreshold * 3 - p.stock)), cost: String(p.cost), received: 0 }))])
    toast.success(`Added ${low.length} low-stock product(s)`)
  }
  const total = round2(lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0))
  const units = lines.reduce((a, l) => a + (Number(l.qty) || 0), 0)
  const save = (status: POStatus) => {
    if (!supplierId) { toast.error('Choose a supplier'); return }
    if (!lines.length) { toast.error('Add at least one product line'); return }
    if (lines.some((l) => !(Number(l.qty) > 0))) { toast.error('Every line needs a quantity above zero'); return }
    const payload: Partial<PurchaseOrder> & { id?: ID } = {
      id: po?.id, supplierId, expectedAt: expectedAt ? new Date(expectedAt + 'T12:00:00').toISOString() : undefined, notes: notes.trim() || undefined,
      lines: lines.map((l) => ({ id: l.id, productId: l.productId, qty: Math.round(Number(l.qty)), cost: round2(Number(l.cost) || 0), received: l.received })),
      status: po ? (status === 'ordered' ? 'ordered' : po.status) : status,
    }
    const saved = upsertPurchaseOrder(payload, admin.id)
    toast.success(`${saved.number} ${po ? 'updated' : 'created'}${status === 'ordered' ? ' and marked as ordered' : ''}`)
    onClose()
  }
  const supplier = db.suppliers.find((s) => s.id === supplierId)
  return (
    <Drawer open={open} onClose={onClose} title={po ? `Edit ${po.number}` : 'New purchase order'} width="max-w-3xl"
      footer={<>
        <div className="mr-auto text-sm text-slate-500">{lines.length} line(s) · {units} units · <span className="font-semibold text-slate-800">{money(total)}</span></div>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-secondary" onClick={() => save('draft')}><FileText size={14} /> Save draft</button>
        {(!po || po.status === 'draft') && <button className="btn-primary" onClick={() => save('ordered')}><Send size={14} /> Save & mark ordered</button>}
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Supplier" required>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {!db.suppliers.length && <option value="">No suppliers yet</option>}
              {db.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Expected delivery"><Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></Field>
          <div className="flex items-end"><button className="btn-secondary w-full justify-center" onClick={addLowStock} disabled={!supplierId}><Plus size={14} /> Add all low-stock items</button></div>
        </div>
        {supplier && (supplier.contactName || supplier.email || supplier.phone) && <div className="text-xs text-slate-400 -mt-2">{[supplier.contactName, supplier.email, supplier.phone].filter(Boolean).join(' · ')}</div>}

        <div className="rounded-xl border border-slate-100">
          <div className="p-3 border-b border-slate-100 relative">
            <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Add product by name, SKU or barcode…" className="input pl-9" onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { e.preventDefault(); addProduct(matches[0]) } if (e.key === 'Escape') setSearch('') }} /></div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-500 mt-2 cursor-pointer"><input type="checkbox" className="accent-brand-600" checked={onlySupplier} onChange={(e) => setOnlySupplier(e.target.checked)} /> Only show this supplier's products</label>
            {matches.length > 0 && (
              <div className="absolute left-3 right-3 top-[52px] z-10 bg-white rounded-xl border border-slate-200 shadow-pop overflow-hidden fade-up">
                {matches.map((p) => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-brand-50">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-base">{p.emoji}</div>
                    <div className="min-w-0 flex-1"><div className="text-sm font-medium text-slate-800 truncate">{p.name}</div><div className="text-[11px] text-slate-400 font-mono">{p.sku} · stock {p.stock} · thr {p.lowStockThreshold}</div></div>
                    <div className="text-sm text-slate-600 tabular-nums">{money(p.cost)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {lines.length ? (
            <table className="table">
              <thead><tr><th>Product</th><th className="text-right w-24">Qty</th><th className="text-right w-32">Unit cost</th><th className="text-right w-28">Total</th><th className="w-8" /></tr></thead>
              <tbody>
                {lines.map((l) => { const p = productById[l.productId]; return (
                  <tr key={l.id}>
                    <td><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-base">{p?.emoji ?? '📦'}</div><div className="min-w-0"><div className="text-sm font-medium text-slate-800 truncate">{p?.name ?? 'Unknown'}</div><div className="text-[11px] text-slate-400">{p?.sku} · on hand {p?.stock ?? 0}{l.received > 0 && ` · received ${l.received}`}</div></div></div></td>
                    <td className="text-right"><input type="number" min={1} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, qty: e.target.value } : x)))} className="input !w-20 text-right !py-1" /></td>
                    <td className="text-right"><input type="number" min={0} step="0.01" value={l.cost} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, cost: e.target.value } : x)))} className="input !w-28 text-right !py-1" /></td>
                    <td className="text-right font-semibold tabular-nums">{money((Number(l.qty) || 0) * (Number(l.cost) || 0))}</td>
                    <td><button className="btn-ghost !p-1 text-red-500 hover:bg-red-50" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><X size={14} /></button></td>
                  </tr>
                ) })}
              </tbody>
            </table>
          ) : <div className="py-8 text-center text-sm text-slate-400">No lines yet. Search above to add products.</div>}
        </div>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery instructions, reference numbers…" /></Field>
      </div>
    </Drawer>
  )
}

// ─── Detail drawer ───────────────────────────────────────────────────────────
function PODetail({ po, onClose, onEdit, onReceive, onOrder, onCancel, onDelete }: { po?: PurchaseOrder; onClose: () => void; onEdit: (po: PurchaseOrder) => void; onReceive: (po: PurchaseOrder) => void; onOrder: (po: PurchaseOrder) => void; onCancel: (po: PurchaseOrder) => void; onDelete: (po: PurchaseOrder) => void }) {
  const db = useDB((s) => s.db)
  const navigate = useNavigate()
  if (!po) return null
  const supplier = db.suppliers.find((s) => s.id === po.supplierId)
  const creator = db.users.find((u) => u.id === po.userId)
  const productById = Object.fromEntries(db.products.map((p) => [p.id, p]))
  const movements = db.stockMovements.filter((m) => m.refId === po.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const canCancel = po.status !== 'cancelled' && po.status !== 'received'
  return (
    <Drawer open onClose={onClose} title={<span className="inline-flex items-center gap-2">{po.number} <Badge tone={statusTone(po.status)} dot>{STATUS_LABEL[po.status]}</Badge></span>} width="max-w-3xl"
      footer={<>
        <button className="btn-ghost mr-auto" onClick={() => window.print()}><Printer size={14} /> Print</button>
        {po.status === 'draft' && <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => onDelete(po)}><Trash2 size={14} /> Delete</button>}
        {canCancel && <button className="btn-secondary" onClick={() => onCancel(po)}><Ban size={14} /> Cancel order</button>}
        {po.status === 'draft' && <button className="btn-secondary" onClick={() => onEdit(po)}><Pencil size={14} /> Edit</button>}
        {po.status === 'draft' && <button className="btn-primary" onClick={() => onOrder(po)}><Send size={14} /> Mark as ordered</button>}
        {(po.status === 'ordered' || po.status === 'partial') && <button className="btn-primary" onClick={() => onReceive(po)}><PackageCheck size={14} /> Receive items</button>}
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 inline-flex items-center gap-1"><Truck size={12} /> Supplier</div>
            <div className="font-semibold text-slate-900">{supplier?.name ?? 'Unknown supplier'}</div>
            {supplier?.contactName && <div className="text-sm text-slate-600">{supplier.contactName}</div>}
            <div className="text-xs text-slate-400 mt-1">{[supplier?.phone, supplier?.email].filter(Boolean).join(' · ')}</div>
            {supplier?.address && <div className="text-xs text-slate-400">{supplier.address}</div>}
            <button className="text-xs text-brand-700 hover:underline mt-2" onClick={() => { onClose(); navigate('/admin/suppliers') }}>View supplier →</button>
          </div>
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 inline-flex items-center gap-1"><Calendar size={12} /> Timeline</div>
            <div className="divide-y divide-slate-50">
              <KV label="Created" value={<span title={fmtDateTime(po.createdAt)}>{fmtDate(po.createdAt)} · {creator?.name ?? ''}</span>} />
              <KV label="Expected" value={po.expectedAt ? <span className={cx((po.status === 'ordered' || po.status === 'partial') && new Date(po.expectedAt).getTime() < Date.now() && 'text-red-600')}>{fmtDate(po.expectedAt)} <span className="text-slate-400 font-normal">({ago(po.expectedAt)})</span></span> : '—'} />
              <KV label="Received" value={po.receivedAt ? fmtDateTime(po.receivedAt) : po.status === 'partial' ? 'Partially' : '—'} />
            </div>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1"><span>Received {poReceived(po)} of {poOrdered(po)} units</span><span>{Math.round(poProgress(po))}%</span></div>
          <ProgressBar value={poProgress(po)} color={po.status === 'received' ? '#22c55e' : '#2563eb'} />
        </div>

        <div className="rounded-xl border border-slate-100 overflow-hidden">
          <table className="table">
            <thead><tr><th>Product</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Unit cost</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {po.lines.map((l) => { const p = productById[l.productId]; const done = l.received >= l.qty; return (
                <tr key={l.id}>
                  <td>
                    <button type="button" onClick={() => { if (p) { onClose(); navigate(`/admin/catalog/${p.id}`) } }} className="flex items-center gap-2 text-left group">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-base">{p?.emoji ?? '📦'}</div>
                      <div className="min-w-0"><div className="text-sm font-medium text-slate-800 group-hover:text-brand-700 truncate">{p?.name ?? 'Deleted product'}</div><div className="text-[11px] text-slate-400 font-mono">{p?.sku ?? ''}</div></div>
                    </button>
                  </td>
                  <td className="text-right tabular-nums">{l.qty}</td>
                  <td className="text-right tabular-nums"><span className={cx('font-semibold', done ? 'text-emerald-600' : l.received > 0 ? 'text-amber-600' : 'text-slate-400')}>{l.received}</span></td>
                  <td className="text-right tabular-nums text-slate-600">{money(l.cost)}</td>
                  <td className="text-right tabular-nums font-semibold">{money(lineTotal(l))}</td>
                </tr>
              ) })}
            </tbody>
            <tfoot><tr className="bg-slate-50/60"><td className="font-semibold text-slate-700" colSpan={4}>Total</td><td className="text-right font-bold tabular-nums">{money(poTotal(po))}</td></tr></tfoot>
          </table>
        </div>

        {po.notes && <div className="rounded-xl bg-amber-50/60 border border-amber-100 p-3 text-sm text-slate-700"><div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide mb-1">Notes</div>{po.notes}</div>}

        {movements.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Receiving history</div>
            <div className="divide-y divide-slate-50 rounded-xl border border-slate-100 px-3">
              {movements.map((m) => { const p = productById[m.productId]; return (
                <div key={m.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="text-base">{p?.emoji ?? '📦'}</span>
                  <span className="flex-1 truncate text-slate-700">{p?.name ?? 'Product'}</span>
                  <span className="text-emerald-600 font-semibold tabular-nums">+{m.qty}</span>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDateTime(m.createdAt)} · {db.users.find((u) => u.id === m.userId)?.name ?? ''}</span>
                </div>
              ) })}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}

// ─── Receive modal ───────────────────────────────────────────────────────────
function ReceiveModal({ po, onClose }: { po?: PurchaseOrder; onClose: () => void }) {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const receivePO = useDB((s) => s.receivePO)
  const [qty, setQty] = useState<Record<ID, string>>({})
  useEffect(() => { if (po) setQty(Object.fromEntries(po.lines.map((l) => [l.id, String(Math.max(0, l.qty - l.received))]))) }, [po?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!po) return null
  const productById = Object.fromEntries(db.products.map((p) => [p.id, p]))
  const totalNow = po.lines.reduce((a, l) => a + Math.min(Math.max(0, Math.round(Number(qty[l.id]) || 0)), l.qty - l.received), 0)
  const remaining = po.lines.reduce((a, l) => a + Math.max(0, l.qty - l.received), 0)
  const submit = () => {
    const rec: Record<ID, number> = {}
    po.lines.forEach((l) => { rec[l.id] = Math.min(Math.max(0, Math.round(Number(qty[l.id]) || 0)), l.qty - l.received) })
    if (!Object.values(rec).some((v) => v > 0)) { toast.error('Enter a quantity to receive'); return }
    receivePO(po.id, rec, admin.id)
    toast.success(`Received ${totalNow} unit(s) on ${po.number}${totalNow >= remaining ? ' — order complete' : ''}`)
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={`Receive items · ${po.number}`} subtitle="Stock is added immediately and the product cost updates to the PO cost" size="lg"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-ghost" onClick={() => setQty(Object.fromEntries(po.lines.map((l) => [l.id, String(Math.max(0, l.qty - l.received))])))}>Receive all remaining</button><button className="btn-primary" onClick={submit}><PackageCheck size={14} /> Receive {totalNow} unit(s)</button></>}>
      <table className="table">
        <thead><tr><th>Product</th><th className="text-right">Ordered</th><th className="text-right">Already</th><th className="text-right">Remaining</th><th className="text-right w-28">Receive now</th></tr></thead>
        <tbody>
          {po.lines.map((l) => { const p = productById[l.productId]; const rem = Math.max(0, l.qty - l.received); return (
            <tr key={l.id} className={cx(rem === 0 && 'opacity-50')}>
              <td><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-base">{p?.emoji ?? '📦'}</div><div><div className="text-sm font-medium text-slate-800">{p?.name ?? 'Deleted product'}</div><div className="text-[11px] text-slate-400">{p?.trackSerial ? 'IMEI tracked · serials auto-generated' : p?.sku}</div></div></div></td>
              <td className="text-right tabular-nums">{l.qty}</td>
              <td className="text-right tabular-nums text-slate-500">{l.received}</td>
              <td className="text-right tabular-nums font-medium">{rem}</td>
              <td className="text-right"><input type="number" min={0} max={rem} disabled={rem === 0} value={qty[l.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} className="input !w-24 text-right !py-1" /></td>
            </tr>
          ) })}
        </tbody>
      </table>
    </Modal>
  )
}

export { STATUS_LABEL as PO_STATUS_LABEL, poTotal, poReceived, poOrdered }
