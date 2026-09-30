import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, UserPlus, Repeat, Wallet, Download, Plus, Star, Briefcase, Tag } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import { Avatar, Badge, DataTable, Drawer, EmptyState, Field, Input, PageHeader, SearchInput, Select, StatCard, Textarea, toast, type Column } from '@/components/ui'
import { ago, downloadFile, fmtDate, money, toCSV, cx } from '@/lib/utils'
import type { Customer } from '@/lib/types'

type SortKey = 'recent' | 'spent' | 'visits' | 'name' | 'points'

const TAG_TONE: Record<string, 'purple' | 'blue' | 'amber' | 'green' | 'slate'> = { vip: 'purple', business: 'blue', wholesale: 'amber', staff: 'green' }

export function TagBadges({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return (
    <span className="inline-flex gap-1 flex-wrap">
      {tags.map((t) => (
        <Badge key={t} tone={TAG_TONE[t] ?? 'slate'} className="capitalize">
          {t === 'vip' && <Star size={10} className="mr-0.5" />}
          {t === 'business' && <Briefcase size={10} className="mr-0.5" />}
          {t}
        </Badge>
      ))}
    </span>
  )
}

export interface CustomerFormValue { name: string; phone: string; email: string; address: string; birthday: string; notes: string; tags: string }
export function CustomerForm({ value, onChange }: { value: CustomerFormValue; onChange: (v: CustomerFormValue) => void }) {
  const set = (k: keyof CustomerFormValue, v: string) => onChange({ ...value, [k]: v })
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Full name" required className="sm:col-span-2"><Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Jane Doe" autoFocus /></Field>
      <Field label="Phone" required><Input value={value.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+1 555 000 0000" /></Field>
      <Field label="Email"><Input type="email" value={value.email} onChange={(e) => set('email', e.target.value)} placeholder="jane@example.com" /></Field>
      <Field label="Address" className="sm:col-span-2"><Input value={value.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, city" /></Field>
      <Field label="Birthday"><Input type="date" value={value.birthday} onChange={(e) => set('birthday', e.target.value)} /></Field>
      <Field label="Tags" hint="Comma separated, e.g. vip, business"><Input value={value.tags} onChange={(e) => set('tags', e.target.value)} placeholder="vip, business" /></Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea value={value.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Preferences, history, anything useful for staff" /></Field>
    </div>
  )
}
export const emptyCustomerForm = (): CustomerFormValue => ({ name: '', phone: '', email: '', address: '', birthday: '', notes: '', tags: '' })
export const customerToForm = (c: Customer): CustomerFormValue => ({ name: c.name, phone: c.phone, email: c.email ?? '', address: c.address ?? '', birthday: c.birthday ?? '', notes: c.notes ?? '', tags: c.tags.join(', ') })
export const formToCustomer = (f: CustomerFormValue): Partial<Customer> => ({
  name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() || undefined, address: f.address.trim() || undefined, birthday: f.birthday || undefined, notes: f.notes.trim() || undefined,
  tags: f.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
})

export default function Customers() {
  const navigate = useNavigate()
  const admin = useAdminUser()!
  const customers = useDB((s) => s.db.customers)
  const transactions = useDB((s) => s.db.transactions)
  const upsertCustomer = useDB((s) => s.upsertCustomer)

  const [q, setQ] = useState('')
  const [tag, setTag] = useState('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [drawer, setDrawer] = useState(false)
  const [form, setForm] = useState<CustomerFormValue>(emptyCustomerForm())

  const monthStart = useMemo(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime() }, [])
  const kpis = useMemo(() => {
    const total = customers.length
    const newThisMonth = customers.filter((c) => new Date(c.createdAt).getTime() >= monthStart).length
    const withVisit = customers.filter((c) => c.visits > 0)
    const repeat = withVisit.filter((c) => c.visits > 1).length
    const repeatRate = withVisit.length ? Math.round((repeat / withVisit.length) * 100) : 0
    const avgSpend = withVisit.length ? withVisit.reduce((a, c) => a + c.totalSpent, 0) / withVisit.length : 0
    // sparkline: new customers per week over last 8 weeks
    const weeks = Array.from({ length: 8 }, (_, i) => { const start = Date.now() - (8 - i) * 7 * 86400000; const end = start + 7 * 86400000; return customers.filter((c) => { const t = new Date(c.createdAt).getTime(); return t >= start && t < end }).length })
    const visitsWeeks = Array.from({ length: 8 }, (_, i) => { const start = Date.now() - (8 - i) * 7 * 86400000; const end = start + 7 * 86400000; return transactions.filter((t) => t.customerId && t.type === 'sale' && new Date(t.createdAt).getTime() >= start && new Date(t.createdAt).getTime() < end).length })
    return { total, newThisMonth, repeatRate, avgSpend, weeks, visitsWeeks }
  }, [customers, transactions, monthStart])

  const allTags = useMemo(() => Array.from(new Set(customers.flatMap((c) => c.tags))).sort(), [customers])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    let list = customers.filter((c) => {
      if (tag !== 'all' && !c.tags.includes(tag)) return false
      if (!term) return true
      return c.name.toLowerCase().includes(term) || c.phone.replace(/\s/g, '').includes(term.replace(/\s/g, '')) || (c.email ?? '').toLowerCase().includes(term)
    })
    const byRecent = (a: Customer, b: Customer) => (b.lastVisitAt ?? b.createdAt).localeCompare(a.lastVisitAt ?? a.createdAt)
    list = [...list].sort(sort === 'recent' ? byRecent : sort === 'spent' ? (a, b) => b.totalSpent - a.totalSpent : sort === 'visits' ? (a, b) => b.visits - a.visits : sort === 'points' ? (a, b) => b.loyaltyPoints - a.loyaltyPoints : (a, b) => a.name.localeCompare(b.name))
    return list
  }, [customers, q, tag, sort])

  const exportCSV = () => {
    downloadFile(`customers-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows.map((c) => ({
      id: c.id, name: c.name, phone: c.phone, email: c.email ?? '', tags: c.tags.join('|'), visits: c.visits, totalSpent: c.totalSpent, loyaltyPoints: c.loyaltyPoints, storeCredit: c.storeCredit, lastVisit: c.lastVisitAt ?? '', createdAt: c.createdAt, address: c.address ?? '', birthday: c.birthday ?? '',
    }))), 'text/csv')
    toast.success(`Exported ${rows.length} customers`)
  }

  const save = () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (!form.phone.trim()) { toast.error('Phone is required'); return }
    const c = upsertCustomer(formToCustomer(form), admin.id)
    toast.success(`Customer ${c.name} created`)
    setDrawer(false)
    setForm(emptyCustomerForm())
    navigate(`/admin/customers/${c.id}`)
  }

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Customer', sortValue: (c) => c.name, render: (c) => (
      <div className="flex items-center gap-3 min-w-[200px]">
        <Avatar name={c.name} color={avatarColor(c.id)} size={34} />
        <div className="min-w-0">
          <div className="font-semibold text-slate-800 truncate flex items-center gap-2">{c.name}<TagBadges tags={c.tags} /></div>
          <div className="text-[11px] text-slate-400">Since {fmtDate(c.createdAt)}</div>
        </div>
      </div>
    ) },
    { key: 'phone', header: 'Phone', sortValue: (c) => c.phone, render: (c) => <span className="tabular-nums text-slate-700">{c.phone || '—'}</span> },
    { key: 'email', header: 'Email', sortValue: (c) => c.email ?? '', render: (c) => <span className="text-slate-500 truncate block max-w-[220px]">{c.email ?? '—'}</span> },
    { key: 'visits', header: 'Visits', align: 'right', sortValue: (c) => c.visits, render: (c) => <span className="tabular-nums font-medium">{c.visits}</span> },
    { key: 'spent', header: 'Total spent', align: 'right', sortValue: (c) => c.totalSpent, render: (c) => <span className="tabular-nums font-semibold text-slate-800">{money(c.totalSpent)}</span> },
    { key: 'points', header: 'Points', align: 'right', sortValue: (c) => c.loyaltyPoints, render: (c) => <span className="tabular-nums text-violet-700 font-medium">{c.loyaltyPoints.toLocaleString()}</span> },
    { key: 'credit', header: 'Store credit', align: 'right', sortValue: (c) => c.storeCredit, render: (c) => c.storeCredit > 0 ? <Badge tone="green">{money(c.storeCredit)}</Badge> : <span className="text-slate-300">—</span> },
    { key: 'last', header: 'Last visit', sortValue: (c) => c.lastVisitAt ?? '', render: (c) => <span className="text-slate-500 whitespace-nowrap">{c.lastVisitAt ? ago(c.lastVisitAt) : 'Never'}</span> },
  ]

  return (
    <div>
      <PageHeader title="Customers" subtitle={`${customers.length} customers · CRM, loyalty and store credit`} actions={<>
        <button className="btn-secondary" onClick={exportCSV}><Download size={15} /> Export CSV</button>
        <button className="btn-primary" onClick={() => { setForm(emptyCustomerForm()); setDrawer(true) }}><Plus size={15} /> New customer</button>
      </>} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard label="Total customers" value={kpis.total.toLocaleString()} icon={<Users size={14} />} trend={kpis.weeks} color="#2563eb" hint="New sign-ups per week" />
        <StatCard label="New this month" value={kpis.newThisMonth} icon={<UserPlus size={14} />} hint={`Since ${fmtDate(new Date(monthStart).toISOString())}`} color="#22c55e" trend={kpis.weeks} />
        <StatCard label="Repeat rate" value={`${kpis.repeatRate}%`} icon={<Repeat size={14} />} hint="Customers with 2+ visits" color="#8b5cf6" trend={kpis.visitsWeeks} />
        <StatCard label="Avg. lifetime spend" value={money(kpis.avgSpend)} icon={<Wallet size={14} />} hint="Per customer with purchases" color="#f59e0b" />
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, phone or email…" className="w-full sm:w-80" />
          <div className="flex items-center gap-2">
            <Tag size={14} className="text-slate-400" />
            <Select value={tag} onChange={(e) => setTag(e.target.value)} className="!w-40">
              <option value="all">All tags</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="!w-44">
            <option value="recent">Most recent visit</option>
            <option value="spent">Highest spend</option>
            <option value="visits">Most visits</option>
            <option value="points">Most points</option>
            <option value="name">Name A–Z</option>
          </Select>
          <div className="flex-1" />
          <div className="text-xs text-slate-400">{rows.length} of {customers.length}</div>
        </div>
        <DataTable rows={rows} columns={columns} pageSize={15} onRowClick={(c) => navigate(`/admin/customers/${c.id}`)} empty={<EmptyState icon={<Users size={22} />} title="No customers match" description="Try a different search or clear the tag filter." action={<button className="btn-secondary" onClick={() => { setQ(''); setTag('all') }}>Clear filters</button>} />} />
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="New customer" footer={<>
        <button className="btn-secondary" onClick={() => setDrawer(false)}>Cancel</button>
        <button className="btn-primary" onClick={save}>Create customer</button>
      </>}>
        <CustomerForm value={form} onChange={setForm} />
        <div className={cx('mt-4 rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500')}>New customers start with 0 loyalty points and no store credit. Both can be adjusted from the customer's profile.</div>
      </Drawer>
    </div>
  )
}

export function avatarColor(id: string): string {
  const palette = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#ca8a04']
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return palette[h % palette.length]!
}
