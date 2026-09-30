import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Truck, Phone, Mail, MapPin, Pencil, Trash2, Package, ClipboardList, CircleDollarSign, LayoutGrid, List, User, StickyNote, ExternalLink } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import type { Supplier, PurchaseOrder, ID } from '@/lib/types'
import { money, cx, fmtDate, ago, round2 } from '@/lib/utils'
import { PageHeader, StatCard, Badge, statusTone, SearchInput, Segmented, DataTable, Drawer, Field, Input, Textarea, confirm, toast, EmptyState, KV, IconBox, type Column } from '@/components/ui'
import { POEditor, PO_STATUS_LABEL, poTotal } from './PurchaseOrders'
import { stockStatus } from './Catalog'

interface SupplierStats { products: number; openPOs: number; purchased: number; lastOrder?: string; totalPOs: number }

export default function Suppliers() {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const navigate = useNavigate()
  const deleteSupplier = useDB((s) => s.deleteSupplier)
  const [q, setQ] = useState('')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [editor, setEditor] = useState<{ open: boolean; supplier?: Supplier }>({ open: false })
  const [detailId, setDetailId] = useState<ID | undefined>()
  const [poFor, setPoFor] = useState<ID | undefined>()

  const stats = useMemo(() => {
    const m: Record<ID, SupplierStats> = {}
    db.suppliers.forEach((s) => { m[s.id] = { products: 0, openPOs: 0, purchased: 0, totalPOs: 0 } })
    db.products.forEach((p) => { if (p.supplierId && m[p.supplierId]) m[p.supplierId]!.products++ })
    db.purchaseOrders.forEach((po) => {
      const s = m[po.supplierId]; if (!s) return
      s.totalPOs++
      if (po.status === 'ordered' || po.status === 'partial') s.openPOs++
      if (po.status !== 'cancelled') s.purchased = round2(s.purchased + po.lines.reduce((a, l) => a + l.received * l.cost, 0))
      if (!s.lastOrder || po.createdAt > s.lastOrder) s.lastOrder = po.createdAt
    })
    return m
  }, [db.suppliers, db.products, db.purchaseOrders])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return db.suppliers.filter((s) => !term || s.name.toLowerCase().includes(term) || (s.contactName ?? '').toLowerCase().includes(term) || (s.email ?? '').toLowerCase().includes(term) || (s.phone ?? '').includes(term)).sort((a, b) => a.name.localeCompare(b.name))
  }, [db.suppliers, q])

  const totalPurchased = round2(Object.values(stats).reduce((a, s) => a + s.purchased, 0))
  const openPOs = Object.values(stats).reduce((a, s) => a + s.openPOs, 0)
  const withSupplier = db.products.filter((p) => p.supplierId).length

  const remove = async (s: Supplier) => {
    const st = stats[s.id]
    if (!(await confirm(`Delete ${s.name}?`, `${st?.products ?? 0} product(s) will lose their supplier link. Purchase order history is kept.`, { danger: true, confirmLabel: 'Delete supplier' }))) return
    deleteSupplier(s.id, admin.id)
    setDetailId(undefined)
    toast.success('Supplier deleted')
  }

  const cols: Column<Supplier>[] = [
    { key: 'name', header: 'Supplier', sortValue: (s) => s.name, render: (s) => <div className="flex items-center gap-3"><IconBox color="#2563eb"><Truck size={16} /></IconBox><div><div className="font-medium text-slate-800">{s.name}</div><div className="text-[11px] text-slate-400">Since {fmtDate(s.createdAt)}</div></div></div> },
    { key: 'contact', header: 'Contact', sortValue: (s) => s.contactName ?? '', render: (s) => <div><div className="text-slate-700">{s.contactName ?? <span className="text-slate-300">—</span>}</div><div className="text-[11px] text-slate-400">{[s.phone, s.email].filter(Boolean).join(' · ')}</div></div> },
    { key: 'products', header: 'Products', align: 'right', sortValue: (s) => stats[s.id]?.products ?? 0, render: (s) => <span className="tabular-nums">{stats[s.id]?.products ?? 0}</span> },
    { key: 'open', header: 'Open POs', align: 'right', sortValue: (s) => stats[s.id]?.openPOs ?? 0, render: (s) => { const n = stats[s.id]?.openPOs ?? 0; return n ? <Badge tone="amber">{n} open</Badge> : <span className="text-slate-300">—</span> } },
    { key: 'purchased', header: 'Total purchased', align: 'right', sortValue: (s) => stats[s.id]?.purchased ?? 0, render: (s) => <span className="font-semibold tabular-nums">{money(stats[s.id]?.purchased ?? 0)}</span> },
    { key: 'last', header: 'Last order', sortValue: (s) => stats[s.id]?.lastOrder ?? '', render: (s) => <span className="text-slate-500">{stats[s.id]?.lastOrder ? ago(stats[s.id]!.lastOrder) : '—'}</span> },
    { key: 'actions', header: '', align: 'right', render: (s) => <div className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}><button className="btn-ghost !py-1 !px-2" onClick={() => setEditor({ open: true, supplier: s })}><Pencil size={13} /></button><button className="btn-ghost !py-1 !px-2 text-red-600 hover:bg-red-50" onClick={() => remove(s)}><Trash2 size={13} /></button></div> },
  ]

  const detail = db.suppliers.find((s) => s.id === detailId)

  return (
    <div>
      <PageHeader title="Suppliers" subtitle="Who you buy from, what they supply and what you have on order" actions={<button className="btn-primary" onClick={() => setEditor({ open: true })}><Plus size={15} /> Add supplier</button>} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <StatCard label="Suppliers" value={db.suppliers.length} icon={<Truck size={14} />} />
        <StatCard label="Products sourced" value={withSupplier} icon={<Package size={14} />} hint={`${db.products.length - withSupplier} without a supplier`} />
        <StatCard label="Open purchase orders" value={openPOs} icon={<ClipboardList size={14} />} onClick={() => navigate('/admin/purchase-orders')} />
        <StatCard label="Total purchased" value={money(totalPurchased)} icon={<CircleDollarSign size={14} />} hint="Received PO lines × cost" />
      </div>

      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search suppliers…" className="w-full md:w-72" />
        <div className="flex-1" />
        <Segmented value={view} onChange={setView} options={[{ value: 'cards', label: <span className="inline-flex items-center gap-1"><LayoutGrid size={13} /> Cards</span> }, { value: 'table', label: <span className="inline-flex items-center gap-1"><List size={13} /> Table</span> }]} />
      </div>

      {!rows.length ? (
        <div className="card"><EmptyState icon={<Truck size={22} />} title="No suppliers yet" description="Add the businesses you buy stock from so purchase orders and low-stock reordering can be grouped by supplier." action={<button className="btn-primary" onClick={() => setEditor({ open: true })}><Plus size={15} /> Add supplier</button>} /></div>
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((s) => { const st = stats[s.id]!; return (
            <div key={s.id} onClick={() => setDetailId(s.id)} className="card p-5 cursor-pointer hover:shadow-pop transition-shadow group">
              <div className="flex items-start gap-3">
                <IconBox color="#2563eb" size={44}><Truck size={20} /></IconBox>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 truncate group-hover:text-brand-700">{s.name}</div>
                  <div className="text-sm text-slate-500 truncate">{s.contactName ?? 'No contact name'}</div>
                </div>
                {st.openPOs > 0 && <Badge tone="amber">{st.openPOs} open PO{st.openPOs > 1 ? 's' : ''}</Badge>}
              </div>
              <div className="mt-3 space-y-1 text-sm text-slate-600">
                {s.phone && <div className="flex items-center gap-2"><Phone size={13} className="text-slate-400" /> {s.phone}</div>}
                {s.email && <div className="flex items-center gap-2 truncate"><Mail size={13} className="text-slate-400" /> {s.email}</div>}
                {s.address && <div className="flex items-center gap-2 truncate"><MapPin size={13} className="text-slate-400" /> {s.address}</div>}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-100">
                <div><div className="text-[11px] text-slate-400 uppercase tracking-wide">Products</div><div className="font-semibold text-slate-800">{st.products}</div></div>
                <div><div className="text-[11px] text-slate-400 uppercase tracking-wide">Orders</div><div className="font-semibold text-slate-800">{st.totalPOs}</div></div>
                <div><div className="text-[11px] text-slate-400 uppercase tracking-wide">Purchased</div><div className="font-semibold text-slate-800 truncate">{money(st.purchased)}</div></div>
              </div>
            </div>
          ) })}
        </div>
      ) : (
        <div className="card p-3"><DataTable rows={rows} columns={cols} pageSize={20} onRowClick={(s) => setDetailId(s.id)} defaultSort={{ key: 'name', dir: 'asc' }} /></div>
      )}

      <SupplierEditor open={editor.open} supplier={editor.supplier} onClose={() => setEditor({ open: false })} />
      <SupplierDetail supplier={detail} stats={detail ? stats[detail.id] : undefined} onClose={() => setDetailId(undefined)} onEdit={(s) => setEditor({ open: true, supplier: s })} onDelete={remove} onNewPO={(s) => { setPoFor(s.id) }} />
      <POEditor open={!!poFor} onClose={() => setPoFor(undefined)} presetSupplierId={poFor} />
    </div>
  )
}

// ─── Editor ──────────────────────────────────────────────────────────────────
function SupplierEditor({ open, onClose, supplier }: { open: boolean; onClose: () => void; supplier?: Supplier }) {
  const admin = useAdminUser()!
  const upsertSupplier = useDB((s) => s.upsertSupplier)
  const [f, setF] = useState({ name: '', contactName: '', phone: '', email: '', address: '', notes: '' })
  useEffect(() => { if (open) setF({ name: supplier?.name ?? '', contactName: supplier?.contactName ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '', address: supplier?.address ?? '', notes: supplier?.notes ?? '' }) }, [open, supplier])
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }))
  const save = () => {
    if (!f.name.trim()) { toast.error('Supplier name is required'); return }
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { toast.error('Enter a valid email address'); return }
    upsertSupplier({ id: supplier?.id, name: f.name.trim(), contactName: f.contactName.trim() || undefined, phone: f.phone.trim() || undefined, email: f.email.trim() || undefined, address: f.address.trim() || undefined, notes: f.notes.trim() || undefined }, admin.id)
    toast.success(supplier ? 'Supplier updated' : 'Supplier added')
    onClose()
  }
  return (
    <Drawer open={open} onClose={onClose} title={supplier ? 'Edit supplier' : 'New supplier'} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>{supplier ? 'Save changes' : 'Add supplier'}</button></>}>
      <div className="space-y-3">
        <Field label="Company name" required><Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. TechSource Distribution" /></Field>
        <Field label="Contact person"><Input value={f.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Full name" /></Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+1 555 …" /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="orders@supplier.com" /></Field>
        </div>
        <Field label="Address"><Input value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, city" /></Field>
        <Field label="Notes" hint="Payment terms, lead times, account numbers…"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </Drawer>
  )
}

// ─── Detail ──────────────────────────────────────────────────────────────────
function SupplierDetail({ supplier, stats, onClose, onEdit, onDelete, onNewPO }: { supplier?: Supplier; stats?: SupplierStats; onClose: () => void; onEdit: (s: Supplier) => void; onDelete: (s: Supplier) => void; onNewPO: (s: Supplier) => void }) {
  const db = useDB((s) => s.db)
  const navigate = useNavigate()
  const [tab, setTab] = useState<'products' | 'orders'>('products')
  useEffect(() => { setTab('products') }, [supplier?.id])
  if (!supplier || !stats) return null
  const products = db.products.filter((p) => p.supplierId === supplier.id).sort((a, b) => a.name.localeCompare(b.name))
  const pos = db.purchaseOrders.filter((p) => p.supplierId === supplier.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const lowCount = products.filter((p) => stockStatus(p) === 'low' || stockStatus(p) === 'out').length
  const poCols: Column<PurchaseOrder>[] = [
    { key: 'number', header: 'PO #', render: (p) => <span className="font-mono text-xs font-semibold text-brand-700">{p.number}</span> },
    { key: 'date', header: 'Created', sortValue: (p) => p.createdAt, render: (p) => <span className="text-slate-600">{fmtDate(p.createdAt)}</span> },
    { key: 'lines', header: 'Lines', align: 'right', render: (p) => <span className="tabular-nums">{p.lines.length}</span> },
    { key: 'total', header: 'Total', align: 'right', sortValue: poTotal, render: (p) => <span className="font-semibold tabular-nums">{money(poTotal(p))}</span> },
    { key: 'status', header: 'Status', render: (p) => <Badge tone={statusTone(p.status)} dot>{PO_STATUS_LABEL[p.status]}</Badge> },
  ]
  return (
    <Drawer open onClose={onClose} title={supplier.name} width="max-w-2xl"
      footer={<>
        <button className="btn-ghost text-red-600 hover:bg-red-50 mr-auto" onClick={() => onDelete(supplier)}><Trash2 size={14} /> Delete</button>
        <button className="btn-secondary" onClick={() => onEdit(supplier)}><Pencil size={14} /> Edit</button>
        <button className="btn-primary" onClick={() => onNewPO(supplier)}><Plus size={14} /> New purchase order</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-100 p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-slate-700"><User size={14} className="text-slate-400" /> {supplier.contactName ?? <span className="text-slate-300">No contact name</span>}</div>
            <div className="flex items-center gap-2 text-slate-700"><Phone size={14} className="text-slate-400" /> {supplier.phone ? <a href={`tel:${supplier.phone}`} className="hover:text-brand-700">{supplier.phone}</a> : <span className="text-slate-300">—</span>}</div>
            <div className="flex items-center gap-2 text-slate-700"><Mail size={14} className="text-slate-400" /> {supplier.email ? <a href={`mailto:${supplier.email}`} className="hover:text-brand-700 truncate">{supplier.email}</a> : <span className="text-slate-300">—</span>}</div>
            <div className="flex items-center gap-2 text-slate-700"><MapPin size={14} className="text-slate-400" /> {supplier.address ?? <span className="text-slate-300">—</span>}</div>
            {supplier.notes && <div className="flex items-start gap-2 text-slate-600 pt-2 border-t border-slate-50"><StickyNote size={14} className="text-slate-400 mt-0.5" /> <span className="whitespace-pre-wrap">{supplier.notes}</span></div>}
          </div>
          <div className="rounded-xl border border-slate-100 p-4 divide-y divide-slate-50">
            <KV label="Products supplied" value={stats.products} />
            <KV label="Low / out of stock" value={lowCount ? <span className="text-amber-600">{lowCount}</span> : '0'} />
            <KV label="Purchase orders" value={`${stats.totalPOs} (${stats.openPOs} open)`} />
            <KV label="Total purchased" value={money(stats.purchased)} />
            <KV label="Last order" value={stats.lastOrder ? ago(stats.lastOrder) : 'Never'} />
            <KV label="Supplier since" value={fmtDate(supplier.createdAt)} />
          </div>
        </div>
        <div className="flex gap-1 border-b border-slate-200">
          {(['products', 'orders'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cx('px-3.5 py-2 text-sm font-medium border-b-2 -mb-px', tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>{t === 'products' ? `Products (${products.length})` : `Order history (${pos.length})`}</button>
          ))}
        </div>
        {tab === 'products' ? (
          products.length ? (
            <div className="divide-y divide-slate-50">
              {products.map((p) => { const s = stockStatus(p); return (
                <button key={p.id} type="button" onClick={() => { onClose(); navigate(`/admin/catalog/${p.id}`) }} className="w-full flex items-center gap-3 py-2 text-left group">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-lg">{p.emoji}</div>
                  <div className="flex-1 min-w-0"><div className="text-sm font-medium text-slate-800 truncate group-hover:text-brand-700">{p.name}</div><div className="text-[11px] text-slate-400 font-mono">{p.sku} · cost {money(p.cost)}</div></div>
                  {s === 'out' ? <Badge tone="red">Out</Badge> : s === 'low' ? <Badge tone="amber">{p.stock} left</Badge> : <span className="text-sm text-slate-500 tabular-nums">{p.stock} in stock</span>}
                  <ExternalLink size={13} className="text-slate-300 group-hover:text-brand-600" />
                </button>
              ) })}
            </div>
          ) : <EmptyState icon={<Package size={20} />} title="No products linked" description="Set this supplier on a product in the catalog editor." />
        ) : (
          <DataTable rows={pos} columns={poCols} pageSize={8} compact onRowClick={() => { onClose(); navigate('/admin/purchase-orders') }} empty={<EmptyState icon={<ClipboardList size={20} />} title="No purchase orders yet" action={<button className="btn-primary" onClick={() => onNewPO(supplier)}><Plus size={14} /> Create one</button>} />} />
        )}
      </div>
    </Drawer>
  )
}

