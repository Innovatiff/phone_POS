import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserPlus, Pencil, ScanBarcode, Star, Wallet, Phone, Mail, MapPin, Cake, Users } from 'lucide-react'
import type { Customer } from '@/lib/types'
import { useDB } from '@/store/db'
import { useCashierUser, useSession } from '@/store/session'
import { Avatar, Badge, Card, DataTable, Drawer, EmptyState, Field, Input, KV, Modal, PageHeader, Textarea, toast, type Column } from '@/components/ui'
import { PAYMENT_LABELS } from '@/lib/pos'
import { ago, cx, fmtDate, fmtDateTime, money } from '@/lib/utils'

export default function CashierCustomers() {
  const user = useCashierUser()!
  const registerId = useSession((s) => s.registerId)!
  const db = useDB((s) => s.db)
  const setCartCustomer = useDB((s) => s.setCartCustomer)
  const getActiveCart = useDB((s) => s.getActiveCart)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [editing, setEditing] = useState<Partial<Customer> | undefined>()

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    const list = n
      ? db.customers.filter((c) => c.name.toLowerCase().includes(n) || c.phone.replace(/\s/g, '').includes(n.replace(/\s/g, '')) || (c.email ?? '').toLowerCase().includes(n) || c.tags.some((t) => t.toLowerCase().includes(n)))
      : db.customers
    return [...list].sort((a, b) => (b.lastVisitAt ?? b.createdAt).localeCompare(a.lastVisitAt ?? a.createdAt))
  }, [db.customers, q])
  const selected = selectedId ? db.customers.find((c) => c.id === selectedId) : undefined
  const purchases = useMemo(() => (selected ? db.transactions.filter((t) => t.customerId === selected.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8) : []), [db.transactions, selected])

  const startSale = (c: Customer) => {
    getActiveCart(registerId, user.id)
    setCartCustomer(registerId, c.id)
    toast.success(`${c.name} attached to the sale`)
    navigate('/cashier')
  }

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Customer', render: (c) => <span className="inline-flex items-center gap-2.5"><Avatar name={c.name} color="#7c3aed" size={30} /><span><span className="font-medium text-slate-900 block leading-tight">{c.name}</span><span className="text-xs text-slate-400">{c.email ?? '—'}</span></span></span>, sortValue: (c) => c.name },
    { key: 'phone', header: 'Phone', render: (c) => <span className="text-slate-600 tabular-nums">{c.phone || '—'}</span> },
    { key: 'points', header: 'Points', align: 'right', render: (c) => <span className="inline-flex items-center gap-1 tabular-nums text-slate-700"><Star size={12} className="text-amber-500" />{c.loyaltyPoints.toLocaleString()}</span>, sortValue: (c) => c.loyaltyPoints },
    { key: 'credit', header: 'Credit', align: 'right', render: (c) => <span className={cx('tabular-nums', c.storeCredit > 0 ? 'text-emerald-600 font-medium' : 'text-slate-400')}>{money(c.storeCredit)}</span>, sortValue: (c) => c.storeCredit },
    { key: 'spent', header: 'Spent', align: 'right', render: (c) => <span className="tabular-nums font-medium">{money(c.totalSpent)}</span>, sortValue: (c) => c.totalSpent },
    { key: 'visits', header: 'Visits', align: 'right', render: (c) => <span className="tabular-nums text-slate-600">{c.visits}</span>, sortValue: (c) => c.visits },
    { key: 'last', header: 'Last visit', render: (c) => <span className="text-slate-500 text-xs">{c.lastVisitAt ? ago(c.lastVisitAt) : 'never'}</span>, sortValue: (c) => c.lastVisitAt ?? '' },
    { key: 'go', header: '', align: 'right', render: (c) => <button className="btn-primary !py-1 !px-2.5 text-xs" onClick={(e) => { e.stopPropagation(); startSale(c) }}><ScanBarcode size={13} /> Sell</button> },
  ]

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Customers" subtitle={`${db.customers.length} customers · attach one to a sale to earn points`} actions={<button className="btn-primary" onClick={() => setEditing({})}><UserPlus size={15} /> New customer</button>} />
      <Card padded={false}>
        <div className="px-5 pt-4 pb-3"><div className="relative max-w-md"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone, email or tag…" className="input pl-9" /></div></div>
        <div className="px-2 pb-2">
          <DataTable rows={rows} columns={columns} pageSize={15} onRowClick={(c) => setSelectedId(c.id)} empty={<EmptyState icon={<Users size={22} />} title="No customers found" description="Try a different search or create a new customer." action={<button className="btn-primary" onClick={() => setEditing({ name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' })}><UserPlus size={15} /> New customer</button>} />} />
        </div>
      </Card>

      <Drawer open={!!selected} onClose={() => setSelectedId(undefined)} width="max-w-lg" title={selected?.name ?? ''}
        footer={selected && <><button className="btn-secondary mr-auto" onClick={() => setEditing(selected)}><Pencil size={14} /> Edit</button><button className="btn-primary" onClick={() => startSale(selected)}><ScanBarcode size={15} /> Start sale with {selected.name.split(' ')[0]}</button></>}>
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <Avatar name={selected.name} color="#7c3aed" size={56} />
              <div className="min-w-0">
                <div className="text-lg font-semibold text-slate-900">{selected.name}</div>
                <div className="text-xs text-slate-500">Customer since {fmtDate(selected.createdAt)}{selected.lastVisitAt ? ` · last visit ${ago(selected.lastVisitAt)}` : ''}</div>
                {selected.tags.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{selected.tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>)}</div>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Points" value={selected.loyaltyPoints.toLocaleString()} icon={<Star size={14} className="text-amber-500" />} hint={`= ${money(selected.loyaltyPoints * db.settings.loyaltyPointValue)}`} />
              <Stat label="Store credit" value={money(selected.storeCredit)} icon={<Wallet size={14} className="text-emerald-500" />} />
              <Stat label="Total spent" value={money(selected.totalSpent)} hint={`${selected.visits} visit${selected.visits === 1 ? '' : 's'}`} />
            </div>
            <div className="text-sm">
              <KV label={<span className="inline-flex items-center gap-1.5"><Phone size={13} /> Phone</span>} value={selected.phone || '—'} />
              <KV label={<span className="inline-flex items-center gap-1.5"><Mail size={13} /> Email</span>} value={selected.email ?? '—'} />
              {selected.address && <KV label={<span className="inline-flex items-center gap-1.5"><MapPin size={13} /> Address</span>} value={selected.address} />}
              {selected.birthday && <KV label={<span className="inline-flex items-center gap-1.5"><Cake size={13} /> Birthday</span>} value={fmtDate(selected.birthday)} />}
              {selected.notes && <div className="mt-2 rounded-lg bg-amber-50 text-amber-800 text-xs px-3 py-2">{selected.notes}</div>}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Recent purchases</div>
              {purchases.length === 0 ? <div className="text-sm text-slate-400">No purchases yet.</div> : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                  {purchases.map((t) => (
                    <li key={t.id} className="px-3 py-2 text-sm flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-700">{t.number}</span><span className="text-xs text-slate-400">{fmtDateTime(t.createdAt)}</span></div>
                        <div className="text-xs text-slate-500 truncate">{t.lines.map((l) => `${Math.abs(l.qty)}× ${l.name}`).join(', ')}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={cx('font-semibold tabular-nums', t.total < 0 && 'text-red-600')}>{money(t.total)}</div>
                        <div className="text-[11px] text-slate-400">{t.payments.map((p) => PAYMENT_LABELS[p.method] ?? p.method).join(' + ')}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <CustomerForm value={editing} onClose={() => setEditing(undefined)} onSaved={(c) => { setEditing(undefined); setSelectedId(c.id) }} />
    </div>
  )
}

function Stat({ label, value, icon, hint }: { label: string; value: string; icon?: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
      <div className="text-[11px] font-medium text-slate-500 inline-flex items-center gap-1">{icon}{label}</div>
      <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  )
}

function CustomerForm({ value, onClose, onSaved }: { value?: Partial<Customer>; onClose: () => void; onSaved: (c: Customer) => void }) {
  const user = useCashierUser()!
  const upsertCustomer = useDB((s) => s.upsertCustomer)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', birthday: '', notes: '', tags: '' })
  useEffect(() => {
    if (value) setForm({ name: value.name ?? '', phone: value.phone ?? '', email: value.email ?? '', address: value.address ?? '', birthday: value.birthday ? value.birthday.slice(0, 10) : '', notes: value.notes ?? '', tags: (value.tags ?? []).join(', ') })
  }, [value])
  const save = () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    const c = upsertCustomer({ id: value?.id, name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() || undefined, address: form.address.trim() || undefined, birthday: form.birthday || undefined, notes: form.notes.trim() || undefined, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) }, user.id)
    toast.success(value?.id ? 'Customer updated' : `Customer ${c.name} created`)
    onSaved(c)
  }
  return (
    <Modal open={!!value} onClose={onClose} size="md" title={value?.id ? 'Edit customer' : 'New customer'} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>{value?.id ? 'Save changes' : 'Create customer'}</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2">
        <Field label="Full name" required className="sm:col-span-2"><Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 010 0000" /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <Field label="Birthday"><Input type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} /></Field>
        <Field label="Tags" hint="Comma separated"><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="vip, business" /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="min-h-[64px]" /></Field>
      </div>
    </Modal>
  )
}
