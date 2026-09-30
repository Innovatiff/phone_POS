import React, { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, Phone, Mail, MapPin, Cake, Wallet, Star, CreditCard, Receipt, Wrench, Activity, Plus, Minus, Save, ExternalLink, ShoppingBag, Clock } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import { Avatar, Badge, Card, DataTable, Drawer, EmptyState, Field, Input, KV, Modal, PageHeader, Select, Textarea, confirm, statusTone, toast, type Column } from '@/components/ui'
import { ago, cx, fmtDate, fmtDateTime, money, titleCase } from '@/lib/utils'
import type { Transaction, RepairTicket, ActivityLog } from '@/lib/types'
import { CustomerForm, TagBadges, avatarColor, customerToForm, formToCustomer, emptyCustomerForm, type CustomerFormValue } from './Customers'

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const admin = useAdminUser()!
  const db = useDB((s) => s.db)
  const upsertCustomer = useDB((s) => s.upsertCustomer)
  const deleteCustomer = useDB((s) => s.deleteCustomer)
  const adjustStoreCredit = useDB((s) => s.adjustStoreCredit)
  const mutate = useDB((s) => s.mutate)
  const log = useDB((s) => s.log)

  const customer = db.customers.find((c) => c.id === id)

  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState<CustomerFormValue>(emptyCustomerForm())
  const [pointsModal, setPointsModal] = useState(false)
  const [pointsDelta, setPointsDelta] = useState('')
  const [pointsReason, setPointsReason] = useState('')
  const [creditModal, setCreditModal] = useState<'add' | 'deduct' | null>(null)
  const [creditAmount, setCreditAmount] = useState('')
  const [creditReason, setCreditReason] = useState('')
  const [notes, setNotes] = useState<string | null>(null)

  const txs = useMemo(() => db.transactions.filter((t) => t.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db.transactions, id])
  const repairs = useMemo(() => db.repairs.filter((r) => r.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db.repairs, id])
  const activity = useMemo(() => db.activity.filter((a) => a.entityId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db.activity, id])
  const favorites = useMemo(() => {
    const map = new Map<string, { productId: string; name: string; emoji: string; qty: number; revenue: number }>()
    txs.forEach((t) => { if (t.status === 'voided') return; t.lines.forEach((l) => { const s = map.get(l.productId) ?? { productId: l.productId, name: l.name, emoji: l.emoji, qty: 0, revenue: 0 }; s.qty += l.qty; s.revenue += l.lineTotal; map.set(l.productId, s) }) })
    return Array.from(map.values()).filter((x) => x.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 5)
  }, [txs])
  const sales = txs.filter((t) => t.type === 'sale' && t.status !== 'voided')
  const firstVisit = sales.length ? sales[sales.length - 1]!.createdAt : undefined
  const avgPerVisit = customer && customer.visits ? customer.totalSpent / customer.visits : 0

  if (!customer) {
    return (
      <div>
        <PageHeader title="Customer not found" actions={<Link to="/admin/customers" className="btn-secondary"><ArrowLeft size={15} /> Back to customers</Link>} />
        <Card><EmptyState title="This customer no longer exists" description="It may have been deleted or the link is out of date." /></Card>
      </div>
    )
  }

  const openEdit = () => { setForm(customerToForm(customer)); setEdit(true) }
  const saveEdit = () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    upsertCustomer({ id: customer.id, ...formToCustomer(form) }, admin.id)
    toast.success('Customer updated')
    setEdit(false)
  }
  const remove = async () => {
    if (!(await confirm('Delete customer?', <>This removes <b>{customer.name}</b> from the CRM. Their transactions and repairs are kept but will no longer be linked.</>, { danger: true, confirmLabel: 'Delete' }))) return
    deleteCustomer(customer.id, admin.id)
    toast.success('Customer deleted')
    navigate('/admin/customers')
  }
  const applyPoints = () => {
    const delta = Math.round(Number(pointsDelta))
    if (!delta) { toast.error('Enter a non-zero number of points'); return }
    if (!pointsReason.trim()) { toast.error('A reason is required for the audit log'); return }
    if (customer.loyaltyPoints + delta < 0) { toast.error('Points cannot go below zero'); return }
    const before = customer.loyaltyPoints
    mutate((d) => { const c = d.customers.find((x) => x.id === customer.id); if (c) c.loyaltyPoints = Math.max(0, c.loyaltyPoints + delta) })
    log({ userId: admin.id, action: 'customer.points', entity: 'customer', entityId: customer.id, description: `${delta > 0 ? 'Added' : 'Removed'} ${Math.abs(delta)} loyalty points for ${customer.name} (${before} → ${before + delta}) – ${pointsReason.trim()}`, severity: Math.abs(delta) >= 1000 ? 'warning' : 'info', meta: { before, after: before + delta, reason: pointsReason.trim() } })
    toast.success(`Loyalty points ${delta > 0 ? 'added' : 'removed'}`)
    setPointsModal(false); setPointsDelta(''); setPointsReason('')
  }
  const applyCredit = () => {
    const amt = Number(creditAmount)
    if (!amt || amt <= 0) { toast.error('Enter an amount greater than zero'); return }
    if (!creditReason.trim()) { toast.error('A reason is required'); return }
    const signed = creditModal === 'deduct' ? -amt : amt
    if (customer.storeCredit + signed < 0) { toast.error('Store credit cannot go negative'); return }
    adjustStoreCredit(customer.id, signed, creditReason.trim(), admin.id)
    toast.success(`Store credit ${signed > 0 ? 'added' : 'deducted'}: ${money(amt)}`)
    setCreditModal(null); setCreditAmount(''); setCreditReason('')
  }
  const saveNotes = () => {
    upsertCustomer({ id: customer.id, notes: (notes ?? '').trim() || undefined }, admin.id)
    toast.success('Notes saved')
    setNotes(null)
  }

  const txColumns: Column<Transaction>[] = [
    { key: 'number', header: 'Number', sortValue: (t) => t.number, render: (t) => <span className="font-semibold text-slate-800">{t.number}</span> },
    { key: 'date', header: 'Date', sortValue: (t) => t.createdAt, render: (t) => <span className="text-slate-500 whitespace-nowrap">{fmtDateTime(t.createdAt)}</span> },
    { key: 'cashier', header: 'Cashier', render: (t) => { const u = db.users.find((x) => x.id === t.userId); return u ? <span className="inline-flex items-center gap-1.5"><Avatar name={u.name} color={u.color} size={20} />{u.name}</span> : '—' } },
    { key: 'items', header: 'Items', render: (t) => <span className="text-slate-600 truncate block max-w-[240px]">{t.lines.map((l) => `${l.emoji} ${Math.abs(l.qty)}× ${l.name}`).join(', ')}</span> },
    { key: 'type', header: 'Type', render: (t) => <Badge tone={t.type === 'refund' ? 'red' : 'blue'} className="capitalize">{t.type}</Badge> },
    { key: 'total', header: 'Total', align: 'right', sortValue: (t) => t.total, render: (t) => <span className={cx('tabular-nums font-semibold', t.total < 0 ? 'text-red-600' : 'text-slate-800')}>{money(t.total)}</span> },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={statusTone(t.status)} dot>{titleCase(t.status)}</Badge> },
    { key: 'link', header: '', align: 'right', render: (t) => <Link to={`/admin/transactions/${t.id}`} onClick={(e) => e.stopPropagation()} className="btn-ghost !px-2 !py-1 text-xs"><ExternalLink size={13} /></Link> },
  ]
  const repairColumns: Column<RepairTicket>[] = [
    { key: 'number', header: 'Ticket', render: (r) => <span className="font-semibold">{r.number}</span> },
    { key: 'device', header: 'Device', render: (r) => <span>{r.device}{r.imei && <span className="text-[11px] text-slate-400 block">IMEI {r.imei}</span>}</span> },
    { key: 'issue', header: 'Issue', render: (r) => <span className="text-slate-600">{r.issue}</span> },
    { key: 'tech', header: 'Technician', render: (r) => { const u = db.users.find((x) => x.id === r.technicianId); return u ? <span className="inline-flex items-center gap-1.5"><Avatar name={u.name} color={u.color} size={20} />{u.name}</span> : <span className="text-slate-400">Unassigned</span> } },
    { key: 'estimate', header: 'Estimate', align: 'right', render: (r) => <span className="tabular-nums">{money(r.estimate)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)} dot>{titleCase(r.status)}</Badge> },
    { key: 'created', header: 'Opened', render: (r) => <span className="text-slate-500">{ago(r.createdAt)}</span> },
  ]

  return (
    <div>
      <div className="mb-4"><Link to="/admin/customers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> All customers</Link></div>

      {/* Header */}
      <div className="card p-5 mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={customer.name} color={avatarColor(customer.id)} size={64} />
          <div className="flex-1 min-w-[220px]">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{customer.name}</h1>
              <TagBadges tags={customer.tags} />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5"><Phone size={14} className="text-slate-400" />{customer.phone || '—'}</span>
              <span className="inline-flex items-center gap-1.5"><Mail size={14} className="text-slate-400" />{customer.email ?? '—'}</span>
              {customer.address && <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-slate-400" />{customer.address}</span>}
              {customer.birthday && <span className="inline-flex items-center gap-1.5"><Cake size={14} className="text-slate-400" />{fmtDate(customer.birthday)}</span>}
            </div>
            <div className="text-xs text-slate-400 mt-2">Customer since {fmtDate(customer.createdAt)} · ID {customer.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={openEdit}><Pencil size={15} /> Edit</button>
            <button className="btn-danger" onClick={remove}><Trash2 size={15} /> Delete</button>
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <Card title="Lifetime value" action={<div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Wallet size={18} /></div>}>
          <div className="text-[28px] font-bold text-slate-900 tracking-tight leading-none">{money(customer.totalSpent)}</div>
          <div className="mt-3 divide-y divide-slate-50">
            <KV label="Visits" value={customer.visits} />
            <KV label="Avg. per visit" value={money(avgPerVisit)} />
            <KV label="First visit" value={firstVisit ? fmtDate(firstVisit) : '—'} />
            <KV label="Last visit" value={customer.lastVisitAt ? ago(customer.lastVisitAt) : 'Never'} />
          </div>
        </Card>
        <Card title="Loyalty" action={<div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center"><Star size={18} /></div>}>
          <div className="text-[28px] font-bold text-slate-900 tracking-tight leading-none">{customer.loyaltyPoints.toLocaleString()} <span className="text-sm font-medium text-slate-400">pts</span></div>
          <div className="text-sm text-slate-500 mt-1">Worth {money(customer.loyaltyPoints * db.settings.loyaltyPointValue)} at checkout</div>
          <div className="text-xs text-slate-400 mt-1">Earns {db.settings.loyaltyPointsPerCurrency} pt per {db.settings.currencySymbol}1 spent</div>
          <button className="btn-secondary w-full mt-4" onClick={() => setPointsModal(true)}>Adjust points</button>
        </Card>
        <Card title="Store credit" action={<div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><CreditCard size={18} /></div>}>
          <div className="text-[28px] font-bold text-slate-900 tracking-tight leading-none">{money(customer.storeCredit)}</div>
          <div className="text-sm text-slate-500 mt-1">Usable as a payment method at any register</div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button className="btn-success" onClick={() => setCreditModal('add')}><Plus size={14} /> Add</button>
            <button className="btn-secondary" disabled={customer.storeCredit <= 0} onClick={() => setCreditModal('deduct')}><Minus size={14} /> Deduct</button>
          </div>
        </Card>
        <Card title="Notes" action={notes !== null ? <button className="btn-primary !px-2.5 !py-1 text-xs" onClick={saveNotes}><Save size={13} /> Save</button> : <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setNotes(customer.notes ?? '')}><Pencil size={13} /> Edit</button>}>
          {notes !== null ? (
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[120px]" autoFocus placeholder="Preferences, warranty info, anything staff should know…" />
          ) : (
            <div className="text-sm text-slate-600 whitespace-pre-wrap min-h-[120px]">{customer.notes || <span className="text-slate-400 italic">No notes yet. Click edit to add some.</span>}</div>
          )}
          {notes !== null && <button className="btn-ghost w-full mt-2 text-xs" onClick={() => setNotes(null)}>Cancel</button>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-5">
        <Card title="Purchase history" subtitle={`${txs.length} transactions`} className="xl:col-span-2" padded={false} action={<div className="flex items-center gap-2 text-xs text-slate-500"><Receipt size={14} /> {money(sales.reduce((a, t) => a + t.total, 0))} gross</div>}>
          <div className="px-2 pb-3">
            <DataTable rows={txs} columns={txColumns} pageSize={8} compact onRowClick={(t) => navigate(`/admin/transactions/${t.id}`)} empty={<EmptyState icon={<ShoppingBag size={22} />} title="No purchases yet" description="Sales linked to this customer at the register will appear here." />} />
          </div>
        </Card>
        <Card title="Favorite products" subtitle="Top 5 by quantity">
          {favorites.length ? (
            <div className="flex flex-col gap-3">
              {favorites.map((f, i) => (
                <Link key={f.productId} to={`/admin/catalog/${f.productId}`} className="flex items-center gap-3 group">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-xl">{f.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate group-hover:text-brand-700">{f.name}</div>
                    <div className="text-xs text-slate-400">{f.qty} bought · {money(f.revenue)}</div>
                  </div>
                  <span className="text-xs font-semibold text-slate-400">#{i + 1}</span>
                </Link>
              ))}
            </div>
          ) : <EmptyState icon={<ShoppingBag size={22} />} title="Nothing yet" description="Favorites are computed from purchase history." />}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Repairs" subtitle={`${repairs.length} tickets`} className="xl:col-span-2" padded={false} action={<Link to="/admin/repairs" className="btn-ghost !px-2.5 !py-1 text-xs"><Wrench size={13} /> Repair board</Link>}>
          <div className="px-2 pb-3">
            <DataTable rows={repairs} columns={repairColumns} pageSize={6} compact onRowClick={() => navigate('/admin/repairs')} empty={<EmptyState icon={<Wrench size={22} />} title="No repair tickets" description="Repairs for this customer will show up here." />} />
          </div>
        </Card>
        <Card title="Activity timeline" subtitle="Every change logged against this customer">
          {activity.length ? (
            <ol className="relative border-l border-slate-200 ml-2 max-h-[420px] overflow-y-auto pr-1">
              {activity.map((a) => <TimelineItem key={a.id} a={a} />)}
            </ol>
          ) : <EmptyState icon={<Activity size={22} />} title="No activity yet" />}
        </Card>
      </div>

      {/* Edit drawer */}
      <Drawer open={edit} onClose={() => setEdit(false)} title={`Edit ${customer.name}`} footer={<>
        <button className="btn-secondary" onClick={() => setEdit(false)}>Cancel</button>
        <button className="btn-primary" onClick={saveEdit}><Save size={15} /> Save changes</button>
      </>}>
        <CustomerForm value={form} onChange={setForm} />
      </Drawer>

      {/* Points modal */}
      <Modal open={pointsModal} onClose={() => setPointsModal(false)} title="Adjust loyalty points" subtitle={`Current balance: ${customer.loyaltyPoints.toLocaleString()} pts`} size="sm" footer={<>
        <button className="btn-secondary" onClick={() => setPointsModal(false)}>Cancel</button>
        <button className="btn-primary" onClick={applyPoints}>Apply</button>
      </>}>
        <div className="flex flex-col gap-3 pb-2">
          <Field label="Points (use negative to remove)" required><Input type="number" value={pointsDelta} onChange={(e) => setPointsDelta(e.target.value)} placeholder="e.g. 500 or -200" autoFocus /></Field>
          <div className="flex gap-2 flex-wrap">{[100, 250, 500, -100].map((v) => <button key={v} className="btn-secondary !py-1 !px-2.5 text-xs" onClick={() => setPointsDelta(String(v))}>{v > 0 ? '+' : ''}{v}</button>)}</div>
          <Field label="Reason (logged)" required>
            <Select value={pointsReason} onChange={(e) => setPointsReason(e.target.value)}>
              <option value="">Select a reason…</option>
              <option>Goodwill gesture</option>
              <option>Birthday bonus</option>
              <option>Promotion / campaign</option>
              <option>Correction of error</option>
              <option>Points expired</option>
              <option>Fraud / abuse</option>
            </Select>
          </Field>
          {pointsDelta && <div className="text-xs text-slate-500 rounded-lg bg-slate-50 p-2.5">New balance: <b>{Math.max(0, customer.loyaltyPoints + Math.round(Number(pointsDelta) || 0)).toLocaleString()} pts</b> ({money(Math.max(0, customer.loyaltyPoints + Math.round(Number(pointsDelta) || 0)) * db.settings.loyaltyPointValue)})</div>}
        </div>
      </Modal>

      {/* Credit modal */}
      <Modal open={creditModal !== null} onClose={() => setCreditModal(null)} title={creditModal === 'add' ? 'Add store credit' : 'Deduct store credit'} subtitle={`Current balance: ${money(customer.storeCredit)}`} size="sm" footer={<>
        <button className="btn-secondary" onClick={() => setCreditModal(null)}>Cancel</button>
        <button className={creditModal === 'add' ? 'btn-success' : 'btn-danger'} onClick={applyCredit}>{creditModal === 'add' ? 'Add credit' : 'Deduct credit'}</button>
      </>}>
        <div className="flex flex-col gap-3 pb-2">
          <Field label={`Amount (${db.settings.currencySymbol})`} required><Input type="number" min={0} step="0.01" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="0.00" autoFocus /></Field>
          <div className="flex gap-2 flex-wrap">{[5, 10, 25, 50].map((v) => <button key={v} className="btn-secondary !py-1 !px-2.5 text-xs" onClick={() => setCreditAmount(String(v))}>{money(v)}</button>)}</div>
          <Field label="Reason (logged)" required><Input value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder={creditModal === 'add' ? 'e.g. Refund without receipt, trade-in' : 'e.g. Manual redemption, correction'} /></Field>
          {creditAmount && <div className="text-xs text-slate-500 rounded-lg bg-slate-50 p-2.5">New balance: <b>{money(customer.storeCredit + (creditModal === 'deduct' ? -1 : 1) * (Number(creditAmount) || 0))}</b></div>}
        </div>
      </Modal>
    </div>
  )
}

function TimelineItem({ a }: { a: ActivityLog }) {
  const color = a.severity === 'critical' ? 'bg-red-500' : a.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
  return (
    <li className="ml-4 pb-4 last:pb-0">
      <span className={cx('absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-white', color)} />
      <div className="text-[11px] text-slate-400 flex items-center gap-1"><Clock size={10} />{fmtDateTime(a.createdAt)} · {ago(a.createdAt)}</div>
      <div className="text-sm text-slate-700 mt-0.5">{a.description}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{a.userName} · <span className="font-mono">{a.action}</span></div>
    </li>
  )
}
