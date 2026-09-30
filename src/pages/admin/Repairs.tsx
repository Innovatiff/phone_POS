import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wrench, PackageCheck, Hourglass, Coins, Plus, LayoutGrid, List, Printer, Trash2, CheckCircle2, Send, ArrowRight, Smartphone, User as UserIcon, Calendar, Search, Check, Clock, MessageSquare, Save, Pencil } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import { Avatar, Badge, Card, DataTable, Drawer, EmptyState, Field, Input, KV, Modal, PageHeader, SearchInput, Segmented, Select, StatCard, Textarea, confirm, statusTone, toast, type Column } from '@/components/ui'
import { ago, cx, fmtDate, fmtDateTime, money, titleCase } from '@/lib/utils'
import type { Customer, RepairStatus, RepairTicket } from '@/lib/types'

const STATUSES: RepairStatus[] = ['received', 'diagnosing', 'waiting_parts', 'in_progress', 'ready', 'collected']
const ALL_STATUSES: RepairStatus[] = [...STATUSES, 'cancelled']
const STATUS_COLOR: Record<RepairStatus, string> = { received: '#64748b', diagnosing: '#2563eb', waiting_parts: '#f59e0b', in_progress: '#8b5cf6', ready: '#22c55e', collected: '#059669', cancelled: '#ef4444' }
const OPEN = (s: RepairStatus) => s !== 'collected' && s !== 'cancelled'

interface TicketForm { customerId: string; device: string; imei: string; issue: string; estimate: string; deposit: string; technicianId: string; promisedAt: string }
const emptyForm = (): TicketForm => ({ customerId: '', device: '', imei: '', issue: '', estimate: '', deposit: '', technicianId: '', promisedAt: '' })
const toDateInput = (iso?: string) => (iso ? iso.slice(0, 10) : '')
const fromDateInput = (d: string) => (d ? new Date(`${d}T17:00:00`).toISOString() : undefined)

export default function Repairs() {
  const admin = useAdminUser()!
  const db = useDB((s) => s.db)
  const upsertRepair = useDB((s) => s.upsertRepair)
  const setRepairStatus = useDB((s) => s.setRepairStatus)
  const addRepairNote = useDB((s) => s.addRepairNote)
  const deleteRepair = useDB((s) => s.deleteRepair)
  const upsertCustomer = useDB((s) => s.upsertCustomer)

  const [view, setView] = useState<'board' | 'list'>('board')
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [techFilter, setTechFilter] = useState('all')
  const [newOpen, setNewOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [move, setMove] = useState<{ id: string; status: RepairStatus } | null>(null)
  const [moveNote, setMoveNote] = useState('')

  const staff = db.users.filter((u) => u.active)
  const customerOf = (id: string) => db.customers.find((c) => c.id === id)
  const techOf = (id?: string) => db.users.find((u) => u.id === id)

  const monthStart = useMemo(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime() }, [])
  const kpis = useMemo(() => {
    const open = db.repairs.filter((r) => OPEN(r.status)).length
    const ready = db.repairs.filter((r) => r.status === 'ready').length
    const waiting = db.repairs.filter((r) => r.status === 'waiting_parts').length
    const collectedMonth = db.repairs.filter((r) => r.status === 'collected' && new Date(r.updatedAt).getTime() >= monthStart)
    const revenue = collectedMonth.reduce((a, r) => a + r.estimate, 0)
    const overdue = db.repairs.filter((r) => OPEN(r.status) && r.promisedAt && new Date(r.promisedAt).getTime() < Date.now()).length
    return { open, ready, waiting, revenue, collectedCount: collectedMonth.length, overdue }
  }, [db.repairs, monthStart])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return db.repairs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (techFilter !== 'all' && (r.technicianId ?? '') !== techFilter) return false
      if (!term) return true
      const c = customerOf(r.customerId)
      return r.number.toLowerCase().includes(term) || r.device.toLowerCase().includes(term) || r.issue.toLowerCase().includes(term) || (r.imei ?? '').includes(term) || (c?.name.toLowerCase().includes(term) ?? false) || (c?.phone.includes(term) ?? false)
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [db.repairs, db.customers, q, statusFilter, techFilter])

  const detail = detailId ? db.repairs.find((r) => r.id === detailId) : undefined

  const doMove = () => {
    if (!move) return
    setRepairStatus(move.id, move.status, admin.id, moveNote.trim() || undefined)
    const t = db.repairs.find((r) => r.id === move.id)
    toast.success(`${t?.number ?? 'Ticket'} moved to ${titleCase(move.status)}`)
    setMove(null); setMoveNote('')
  }

  const columns: Column<RepairTicket>[] = [
    { key: 'number', header: 'Ticket', sortValue: (r) => r.number, render: (r) => <span className="font-semibold text-slate-800">{r.number}</span> },
    { key: 'device', header: 'Device', sortValue: (r) => r.device, render: (r) => <div className="min-w-[160px]"><div className="font-medium text-slate-800">{r.device}</div>{r.imei && <div className="text-[11px] text-slate-400 font-mono">{r.imei}</div>}</div> },
    { key: 'customer', header: 'Customer', sortValue: (r) => customerOf(r.customerId)?.name ?? '', render: (r) => { const c = customerOf(r.customerId); return c ? <Link to={`/admin/customers/${c.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand-700"><div className="font-medium">{c.name}</div><div className="text-[11px] text-slate-400">{c.phone}</div></Link> : <span className="text-slate-400">Walk-in</span> } },
    { key: 'issue', header: 'Issue', render: (r) => <span className="text-slate-600 block max-w-[220px] truncate">{r.issue}</span> },
    { key: 'tech', header: 'Technician', sortValue: (r) => techOf(r.technicianId)?.name ?? '', render: (r) => { const u = techOf(r.technicianId); return u ? <span className="inline-flex items-center gap-1.5"><Avatar name={u.name} color={u.color} size={22} />{u.name}</span> : <span className="text-slate-400">Unassigned</span> } },
    { key: 'estimate', header: 'Estimate', align: 'right', sortValue: (r) => r.estimate, render: (r) => <div className="tabular-nums"><div className="font-semibold">{money(r.estimate)}</div>{r.deposit > 0 && <div className="text-[11px] text-emerald-600">{money(r.deposit)} deposit</div>}</div> },
    { key: 'promised', header: 'Promised', sortValue: (r) => r.promisedAt ?? '', render: (r) => <PromisedLabel r={r} /> },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, render: (r) => <Badge tone={statusTone(r.status)} dot>{titleCase(r.status)}</Badge> },
    { key: 'age', header: 'Age', sortValue: (r) => r.createdAt, render: (r) => <span className="text-slate-500 whitespace-nowrap">{ago(r.createdAt)}</span> },
  ]

  return (
    <div>
      <PageHeader title="Repairs" subtitle="Repair ticket board · track every device from drop-off to pickup" actions={<>
        <Segmented value={view} onChange={setView} size="md" options={[{ value: 'board', label: <span className="inline-flex items-center gap-1.5"><LayoutGrid size={14} /> Board</span> }, { value: 'list', label: <span className="inline-flex items-center gap-1.5"><List size={14} /> List</span> }]} />
        <button className="btn-primary" onClick={() => setNewOpen(true)}><Plus size={15} /> New ticket</button>
      </>} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard label="Open tickets" value={kpis.open} icon={<Wrench size={14} />} hint={kpis.overdue ? `${kpis.overdue} past promised date` : 'All within promised dates'} />
        <StatCard label="Ready for pickup" value={kpis.ready} icon={<PackageCheck size={14} />} hint="Customer should be notified" />
        <StatCard label="Waiting for parts" value={kpis.waiting} icon={<Hourglass size={14} />} hint="Blocked on suppliers" />
        <StatCard label="Collected this month" value={money(kpis.revenue)} icon={<Coins size={14} />} hint={`${kpis.collectedCount} ticket(s) paid & collected`} />
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search ticket, device, IMEI, customer…" className="w-full sm:w-80" />
        {view === 'list' && (
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-44">
            <option value="all">All statuses</option>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
        )}
        <Select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} className="!w-44">
          <option value="all">All technicians</option>
          <option value="">Unassigned</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <div className="flex-1" />
        <div className="text-xs text-slate-400">{filtered.length} ticket(s)</div>
      </div>

      {view === 'board' ? (
        <div className="overflow-x-auto pb-2 -mx-1 px-1">
          <div className="grid grid-flow-col auto-cols-[minmax(250px,1fr)] gap-4 min-w-[1500px]">
            {STATUSES.map((s) => {
              const items = filtered.filter((r) => r.status === s)
              return (
                <div key={s} className="rounded-xl2 bg-slate-100/70 border border-slate-100 flex flex-col min-h-[300px]">
                  <div className="px-3 py-2.5 flex items-center gap-2 border-b border-slate-200/60">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                    <span className="text-sm font-semibold text-slate-700">{titleCase(s)}</span>
                    <span className="ml-auto text-[11px] font-semibold text-slate-500 bg-white rounded-full px-2 py-0.5">{items.length}</span>
                  </div>
                  <div className="p-2 flex flex-col gap-2 flex-1">
                    {items.map((r) => <TicketCard key={r.id} r={r} customer={customerOf(r.customerId)} tech={techOf(r.technicianId)} onOpen={() => setDetailId(r.id)} onMove={(st) => { setMove({ id: r.id, status: st }); setMoveNote('') }} />)}
                    {!items.length && <div className="text-xs text-slate-400 text-center py-8">No tickets</div>}
                  </div>
                </div>
              )
            })}
          </div>
          {filtered.some((r) => r.status === 'cancelled') && (
            <div className="mt-3 text-xs text-slate-400">{filtered.filter((r) => r.status === 'cancelled').length} cancelled ticket(s) are hidden from the board. Switch to List view to see them.</div>
          )}
        </div>
      ) : (
        <div className="card p-5">
          <DataTable rows={filtered} columns={columns} pageSize={12} onRowClick={(r) => setDetailId(r.id)} empty={<EmptyState icon={<Wrench size={22} />} title="No tickets match" description="Adjust filters or create a new ticket." action={<button className="btn-primary" onClick={() => setNewOpen(true)}><Plus size={15} /> New ticket</button>} />} />
        </div>
      )}

      {/* Move modal */}
      <Modal open={!!move} onClose={() => setMove(null)} title="Move ticket" size="sm" subtitle={move ? `${db.repairs.find((r) => r.id === move.id)?.number} → ${titleCase(move.status)}` : undefined} footer={<>
        <button className="btn-secondary" onClick={() => setMove(null)}>Cancel</button>
        <button className="btn-primary" onClick={doMove}><ArrowRight size={14} /> Move</button>
      </>}>
        <div className="pb-2">
          <Field label="Note (optional, added to ticket timeline)"><Textarea value={moveNote} onChange={(e) => setMoveNote(e.target.value)} placeholder={move?.status === 'waiting_parts' ? 'Which part is on order?' : move?.status === 'ready' ? 'Anything the customer should know?' : 'What changed?'} autoFocus /></Field>
          {move?.status === 'ready' && <div className="text-xs text-slate-500 mt-2 rounded-lg bg-emerald-50 text-emerald-700 p-2.5">An alert will be raised to notify the customer for pickup.</div>}
          {move?.status === 'collected' && <div className="text-xs mt-2 rounded-lg bg-amber-50 text-amber-700 p-2.5">Marking as collected also marks the ticket as paid.</div>}
        </div>
      </Modal>

      <NewTicketDrawer open={newOpen} onClose={() => setNewOpen(false)} customers={db.customers} staff={staff} onCreate={(form, newCustomer) => {
        let customerId = form.customerId
        if (newCustomer) { const c = upsertCustomer({ name: newCustomer.name, phone: newCustomer.phone }, admin.id); customerId = c.id }
        if (!customerId) { toast.error('Select or create a customer'); return false }
        if (!form.device.trim()) { toast.error('Device is required'); return false }
        if (!form.issue.trim()) { toast.error('Describe the issue'); return false }
        const t = upsertRepair({ customerId, device: form.device.trim(), imei: form.imei.trim() || undefined, issue: form.issue.trim(), estimate: Number(form.estimate) || 0, deposit: Number(form.deposit) || 0, technicianId: form.technicianId || undefined, promisedAt: fromDateInput(form.promisedAt) }, admin.id)
        toast.success(`Ticket ${t.number} opened`)
        setDetailId(t.id)
        return true
      }} />

      <TicketDetailDrawer ticket={detail} onClose={() => setDetailId(null)} customer={detail ? customerOf(detail.customerId) : undefined} staff={staff} users={db.users}
        onSave={(patch) => { if (!detail) return; upsertRepair({ id: detail.id, ...patch }, admin.id); toast.success('Ticket updated') }}
        onStatus={(st) => { if (detail) { setMove({ id: detail.id, status: st }); setMoveNote('') } }}
        onNote={(text) => { if (detail) { addRepairNote(detail.id, text, admin.id); toast.success('Note added') } }}
        onCollect={async () => {
          if (!detail) return
          const due = Math.max(0, detail.estimate - detail.deposit)
          if (!(await confirm('Mark collected & paid?', <>Confirm that the customer collected <b>{detail.device}</b> and paid the balance of <b>{money(due)}</b>.</>, { confirmLabel: 'Collected & paid' }))) return
          setRepairStatus(detail.id, 'collected', admin.id, `Collected by customer · balance ${money(due)} paid`)
          toast.success(`${detail.number} collected & paid`)
        }}
        onDelete={async () => {
          if (!detail) return
          if (!(await confirm('Delete ticket?', <>Ticket <b>{detail.number}</b> will be permanently removed.</>, { danger: true, confirmLabel: 'Delete' }))) return
          deleteRepair(detail.id, admin.id)
          setDetailId(null)
          toast.success('Ticket deleted')
        }}
        onPrint={() => { if (detail) printTicket(detail, customerOf(detail.customerId), techOf(detail.technicianId), db.settings.storeName, db.settings.phone) }}
      />
    </div>
  )
}

function PromisedLabel({ r }: { r: RepairTicket }) {
  if (!r.promisedAt) return <span className="text-slate-300">—</span>
  const overdue = OPEN(r.status) && new Date(r.promisedAt).getTime() < Date.now()
  return <span className={cx('whitespace-nowrap text-sm', overdue ? 'text-red-600 font-semibold' : 'text-slate-600')}>{fmtDate(r.promisedAt)}{overdue && ' · overdue'}</span>
}

function TicketCard({ r, customer, tech, onOpen, onMove }: { r: RepairTicket; customer?: Customer; tech?: { name: string; color: string }; onOpen: () => void; onMove: (s: RepairStatus) => void }) {
  const idx = STATUSES.indexOf(r.status)
  const next = STATUSES[idx + 1]
  const prev = idx > 0 ? STATUSES[idx - 1] : undefined
  const overdue = OPEN(r.status) && r.promisedAt && new Date(r.promisedAt).getTime() < Date.now()
  return (
    <div className="card p-3 hover:shadow-pop transition-shadow cursor-pointer group" onClick={onOpen}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500">{r.number}</span>
        <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Clock size={10} />{ago(r.createdAt)}</span>
      </div>
      <div className="mt-1.5 flex items-start gap-2">
        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-lg shrink-0">📱</div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{r.device}</div>
          <div className="text-xs text-slate-500 truncate">{customer?.name ?? 'Walk-in'}</div>
        </div>
      </div>
      <div className="text-xs text-slate-600 mt-2 line-clamp-2">{r.issue}</div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {tech ? <Avatar name={tech.name} color={tech.color} size={22} /> : <div className="w-[22px] h-[22px] rounded-full bg-slate-200 flex items-center justify-center text-slate-400"><UserIcon size={12} /></div>}
          <span className="text-[11px] text-slate-500 truncate">{tech?.name ?? 'Unassigned'}</span>
        </div>
        <span className="text-sm font-semibold text-slate-800 tabular-nums">{money(r.estimate)}</span>
      </div>
      {r.promisedAt && <div className={cx('mt-1.5 text-[11px] inline-flex items-center gap-1', overdue ? 'text-red-600 font-semibold' : 'text-slate-400')}><Calendar size={10} /> Due {fmtDate(r.promisedAt)}{overdue && ' · overdue'}</div>}
      {r.notes.length > 0 && <div className="text-[11px] text-slate-400 mt-1 inline-flex items-center gap-1 ml-2"><MessageSquare size={10} />{r.notes.length}</div>}
      <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {prev && <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => onMove(prev)} title={`Move back to ${titleCase(prev)}`}>← {titleCase(prev)}</button>}
        <div className="flex-1" />
        {next && <button className={cx('!px-2 !py-1 text-[11px]', next === 'collected' ? 'btn-success' : 'btn-primary')} onClick={() => onMove(next)}>{next === 'collected' ? <Check size={11} /> : null}{titleCase(next)} →</button>}
      </div>
    </div>
  )
}

function NewTicketDrawer({ open, onClose, customers, staff, onCreate }: { open: boolean; onClose: () => void; customers: Customer[]; staff: Array<{ id: string; name: string; role: string }>; onCreate: (f: TicketForm, newCustomer: { name: string; phone: string } | null) => boolean }) {
  const [form, setForm] = useState<TicketForm>(emptyForm())
  const [custQ, setCustQ] = useState('')
  const [showList, setShowList] = useState(false)
  const [newCust, setNewCust] = useState<{ name: string; phone: string } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) { setForm(emptyForm()); setCustQ(''); setNewCust(null); setShowList(false) } }, [open])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowList(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const set = (k: keyof TicketForm, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const term = custQ.trim().toLowerCase()
  const matches = term ? customers.filter((c) => c.name.toLowerCase().includes(term) || c.phone.replace(/\s/g, '').includes(term.replace(/\s/g, '')) || (c.email ?? '').toLowerCase().includes(term)).slice(0, 8) : customers.slice(0, 8)
  const selected = customers.find((c) => c.id === form.customerId)
  const balance = Math.max(0, (Number(form.estimate) || 0) - (Number(form.deposit) || 0))
  return (
    <Drawer open={open} onClose={onClose} title="New repair ticket" width="max-w-xl" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" onClick={() => { if (onCreate(form, newCust)) onClose() }}><Plus size={15} /> Open ticket</button>
    </>}>
      <div className="flex flex-col gap-4">
        <div ref={boxRef} className="relative">
          <span className="label">Customer<span className="text-red-500 ml-0.5">*</span></span>
          {selected || newCust ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Avatar name={(selected ?? newCust)!.name} size={30} color={newCust ? '#059669' : undefined} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{(selected ?? newCust)!.name} {newCust && <Badge tone="green" className="ml-1">New</Badge>}</div>
                <div className="text-xs text-slate-500">{(selected ?? newCust)!.phone || 'No phone'}</div>
              </div>
              <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { set('customerId', ''); setNewCust(null); setCustQ('') }}>Change</button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9" value={custQ} onChange={(e) => { setCustQ(e.target.value); setShowList(true) }} onFocus={() => setShowList(true)} placeholder="Type a name or phone to search…" autoFocus />
              </div>
              {showList && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-pop max-h-72 overflow-y-auto py-1">
                  {matches.map((c) => (
                    <button key={c.id} type="button" className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 text-left" onClick={() => { set('customerId', c.id); setShowList(false) }}>
                      <Avatar name={c.name} size={28} />
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium text-slate-800 truncate">{c.name}</div><div className="text-xs text-slate-400">{c.phone} · {c.visits} visits</div></div>
                    </button>
                  ))}
                  {!matches.length && <div className="px-3 py-2 text-sm text-slate-400">No customers found</div>}
                  <div className="border-t border-slate-100 mt-1 pt-1">
                    <button type="button" className="w-full flex items-center gap-2 px-3 py-2 text-sm text-brand-700 hover:bg-brand-50 text-left font-medium" onClick={() => { setNewCust({ name: custQ.trim(), phone: /^[+\d\s()-]+$/.test(custQ.trim()) ? custQ.trim() : '' }); setShowList(false) }}>
                      <Plus size={14} /> Create new customer{custQ.trim() ? ` “${custQ.trim()}”` : ''}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {newCust && (
            <div className="grid grid-cols-2 gap-3 mt-3 rounded-lg border border-dashed border-emerald-300 bg-emerald-50/40 p-3">
              <Field label="Name" required><Input value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} autoFocus /></Field>
              <Field label="Phone" required><Input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} placeholder="+1 555 000 0000" /></Field>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Device" required><Input value={form.device} onChange={(e) => set('device', e.target.value)} placeholder="iPhone 14 Pro, Galaxy S23…" /></Field>
          <Field label="IMEI / Serial"><Input value={form.imei} onChange={(e) => set('imei', e.target.value)} placeholder="35…" className="font-mono" /></Field>
          <Field label="Issue" required className="sm:col-span-2"><Textarea value={form.issue} onChange={(e) => set('issue', e.target.value)} placeholder="Describe the fault and any visible damage" /></Field>
          <Field label="Estimate"><Input type="number" min={0} step="0.01" value={form.estimate} onChange={(e) => set('estimate', e.target.value)} placeholder="0.00" /></Field>
          <Field label="Deposit taken"><Input type="number" min={0} step="0.01" value={form.deposit} onChange={(e) => set('deposit', e.target.value)} placeholder="0.00" /></Field>
          <Field label="Technician"><Select value={form.technicianId} onChange={(e) => set('technicianId', e.target.value)}><option value="">Unassigned</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name} · {titleCase(u.role)}</option>)}</Select></Field>
          <Field label="Promised date"><Input type="date" value={form.promisedAt} onChange={(e) => set('promisedAt', e.target.value)} /></Field>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500 flex items-center justify-between"><span>Balance due on collection</span><b className="text-slate-800 text-sm">{money(balance)}</b></div>
      </div>
    </Drawer>
  )
}

function TicketDetailDrawer({ ticket, onClose, customer, staff, users, onSave, onStatus, onNote, onCollect, onDelete, onPrint }: {
  ticket?: RepairTicket; onClose: () => void; customer?: Customer; staff: Array<{ id: string; name: string; role: string }>; users: Array<{ id: string; name: string; color: string }>
  onSave: (patch: Partial<RepairTicket>) => void; onStatus: (s: RepairStatus) => void; onNote: (text: string) => void; onCollect: () => void; onDelete: () => void; onPrint: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<TicketForm>(emptyForm())
  const [note, setNote] = useState('')
  useEffect(() => {
    if (ticket) { setForm({ customerId: ticket.customerId, device: ticket.device, imei: ticket.imei ?? '', issue: ticket.issue, estimate: String(ticket.estimate), deposit: String(ticket.deposit), technicianId: ticket.technicianId ?? '', promisedAt: toDateInput(ticket.promisedAt) }); setEditing(false); setNote('') }
  }, [ticket?.id])
  if (!ticket) return null
  const set = (k: keyof TicketForm, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const tech = users.find((u) => u.id === ticket.technicianId)
  const idx = STATUSES.indexOf(ticket.status)
  const balance = Math.max(0, ticket.estimate - ticket.deposit)
  const save = () => {
    onSave({ device: form.device.trim(), imei: form.imei.trim() || undefined, issue: form.issue.trim(), estimate: Number(form.estimate) || 0, deposit: Number(form.deposit) || 0, technicianId: form.technicianId || undefined, promisedAt: fromDateInput(form.promisedAt) })
    setEditing(false)
  }
  return (
    <Drawer open={!!ticket} onClose={onClose} width="max-w-2xl" title={<span className="inline-flex items-center gap-2">{ticket.number} <Badge tone={statusTone(ticket.status)} dot>{titleCase(ticket.status)}</Badge>{ticket.paid && <Badge tone="green">Paid</Badge>}</span>} footer={<>
      <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={onDelete}><Trash2 size={15} /> Delete</button>
      <div className="flex-1" />
      <button className="btn-secondary" onClick={onPrint}><Printer size={15} /> Print ticket</button>
      {ticket.status !== 'collected' && ticket.status !== 'cancelled' && <button className="btn-success" onClick={onCollect}><CheckCircle2 size={15} /> Mark collected & paid</button>}
    </>}>
      <div className="flex flex-col gap-5">
        {/* Stepper */}
        <div>
          <div className="flex items-center">
            {STATUSES.map((s, i) => {
              const done = idx >= i && ticket.status !== 'cancelled'
              const current = ticket.status === s
              return (
                <React.Fragment key={s}>
                  <button type="button" title={`Move to ${titleCase(s)}`} disabled={current} onClick={() => onStatus(s)} className="flex flex-col items-center gap-1 group min-w-0">
                    <span className={cx('w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors border-2', current ? 'text-white border-transparent' : done ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-slate-200 text-slate-400 group-hover:border-brand-400')} style={current ? { background: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] } : undefined}>
                      {done && !current ? <Check size={13} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={cx('text-[10px] whitespace-nowrap', current ? 'font-semibold text-slate-800' : 'text-slate-400')}>{titleCase(s)}</span>
                  </button>
                  {i < STATUSES.length - 1 && <div className={cx('flex-1 h-0.5 mx-1 mb-4', idx > i && ticket.status !== 'cancelled' ? 'bg-emerald-400' : 'bg-slate-200')} />}
                </React.Fragment>
              )
            })}
          </div>
          {ticket.status === 'cancelled' ? (
            <div className="mt-3 text-xs rounded-lg bg-red-50 text-red-700 p-2.5 flex items-center justify-between">This ticket was cancelled.<button className="btn-secondary !py-1 !px-2 text-xs" onClick={() => onStatus('received')}>Reopen</button></div>
          ) : ticket.status !== 'collected' && (
            <div className="mt-3 flex justify-end"><button className="btn-ghost !py-1 !px-2 text-xs text-red-600 hover:bg-red-50" onClick={() => onStatus('cancelled')}>Cancel ticket</button></div>
          )}
        </div>

        {/* Details */}
        <Card title="Ticket details" action={editing ? <><button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setEditing(false)}>Cancel</button><button className="btn-primary !py-1 !px-2.5 text-xs" onClick={save}><Save size={13} /> Save</button></> : <button className="btn-secondary !py-1 !px-2.5 text-xs" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>}>
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Device"><Input value={form.device} onChange={(e) => set('device', e.target.value)} /></Field>
              <Field label="IMEI / Serial"><Input value={form.imei} onChange={(e) => set('imei', e.target.value)} className="font-mono" /></Field>
              <Field label="Issue" className="sm:col-span-2"><Textarea value={form.issue} onChange={(e) => set('issue', e.target.value)} /></Field>
              <Field label="Estimate"><Input type="number" min={0} step="0.01" value={form.estimate} onChange={(e) => set('estimate', e.target.value)} /></Field>
              <Field label="Deposit"><Input type="number" min={0} step="0.01" value={form.deposit} onChange={(e) => set('deposit', e.target.value)} /></Field>
              <Field label="Technician"><Select value={form.technicianId} onChange={(e) => set('technicianId', e.target.value)}><option value="">Unassigned</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
              <Field label="Promised date"><Input type="date" value={form.promisedAt} onChange={(e) => set('promisedAt', e.target.value)} /></Field>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              <div className="sm:col-span-2 flex items-center gap-3 mb-2">
                <div className="w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center text-2xl"><Smartphone size={22} className="text-slate-500" /></div>
                <div><div className="font-semibold text-slate-800">{ticket.device}</div><div className="text-xs text-slate-400 font-mono">{ticket.imei ? `IMEI ${ticket.imei}` : 'No IMEI recorded'}</div></div>
              </div>
              <div className="sm:col-span-2 text-sm text-slate-700 rounded-lg bg-slate-50 p-3 mb-2">{ticket.issue}</div>
              <KV label="Customer" value={customer ? <Link to={`/admin/customers/${customer.id}`} className="text-brand-700 hover:underline">{customer.name}</Link> : 'Walk-in'} />
              <KV label="Phone" value={customer?.phone ?? '—'} />
              <KV label="Technician" value={tech ? <span className="inline-flex items-center gap-1.5"><Avatar name={tech.name} color={tech.color} size={18} />{tech.name}</span> : 'Unassigned'} />
              <KV label="Promised" value={<PromisedLabel r={ticket} />} />
              <KV label="Estimate" value={money(ticket.estimate)} />
              <KV label="Deposit" value={money(ticket.deposit)} />
              <KV label="Balance due" value={<span className={cx('font-bold', ticket.paid ? 'text-emerald-600' : 'text-slate-900')}>{ticket.paid ? 'Paid' : money(balance)}</span>} />
              <KV label="Opened" value={fmtDateTime(ticket.createdAt)} />
              <KV label="Last update" value={ago(ticket.updatedAt)} />
            </div>
          )}
        </Card>

        {/* Notes */}
        <Card title="Notes & timeline" subtitle={`${ticket.notes.length} note(s)`}>
          <div className="flex gap-2 mb-4">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the team…" onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) { onNote(note.trim()); setNote('') } }} />
            <button className="btn-primary shrink-0" disabled={!note.trim()} onClick={() => { onNote(note.trim()); setNote('') }}><Send size={14} /> Add</button>
          </div>
          {ticket.notes.length ? (
            <ol className="relative border-l border-slate-200 ml-2">
              {[...ticket.notes].reverse().map((n) => {
                const u = users.find((x) => x.id === n.userId)
                return (
                  <li key={n.id} className="ml-4 pb-4 last:pb-0">
                    <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5">{u && <Avatar name={u.name} color={u.color} size={16} />}<span className="font-medium text-slate-600">{u?.name ?? 'Staff'}</span> · {fmtDateTime(n.createdAt)}</div>
                    <div className="text-sm text-slate-700 mt-0.5">{n.text}</div>
                  </li>
                )
              })}
            </ol>
          ) : <div className="text-sm text-slate-400 text-center py-4">No notes yet</div>}
        </Card>
      </div>
    </Drawer>
  )
}

function printTicket(t: RepairTicket, customer: Customer | undefined, tech: { name: string } | undefined, storeName: string, storePhone: string) {
  const w = window.open('', '_blank', 'width=460,height=720')
  if (!w) { toast.error('Pop-up blocked — allow pop-ups to print'); return }
  const row = (k: string, v: string) => `<tr><td style="color:#64748b;padding:3px 8px 3px 0">${k}</td><td style="font-weight:600">${v}</td></tr>`
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  w.document.write(`<!doctype html><html><head><title>${t.number}</title><style>body{font-family:Inter,system-ui,sans-serif;font-size:13px;color:#0f172a;padding:24px;max-width:400px;margin:0 auto}h1{font-size:18px;margin:0}h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:18px 0 6px}table{border-collapse:collapse}.hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0f172a;padding-bottom:10px}.box{border:1px dashed #94a3b8;border-radius:8px;padding:10px;margin-top:6px}.foot{margin-top:24px;font-size:11px;color:#64748b;border-top:1px solid #cbd5e1;padding-top:10px}</style></head><body>
<div class="hd"><div><h1>${esc(storeName)}</h1><div style="color:#64748b;font-size:11px">Repair desk · ${esc(storePhone)}</div></div><div style="text-align:right"><div style="font-size:20px;font-weight:700">${t.number}</div><div style="font-size:11px;color:#64748b">${fmtDateTime(t.createdAt)}</div></div></div>
<h2>Customer</h2><table>${row('Name', esc(customer?.name ?? 'Walk-in'))}${row('Phone', esc(customer?.phone ?? '—'))}</table>
<h2>Device</h2><table>${row('Device', esc(t.device))}${row('IMEI', esc(t.imei ?? '—'))}${row('Technician', esc(tech?.name ?? 'Unassigned'))}${row('Promised', t.promisedAt ? fmtDate(t.promisedAt) : '—')}${row('Status', titleCase(t.status))}</table>
<h2>Reported issue</h2><div class="box">${esc(t.issue)}</div>
<h2>Charges</h2><table>${row('Estimate', money(t.estimate))}${row('Deposit paid', money(t.deposit))}${row('Balance due', t.paid ? 'PAID' : money(Math.max(0, t.estimate - t.deposit)))}</table>
${t.notes.length ? `<h2>Notes</h2>${t.notes.map((n) => `<div style="margin-bottom:6px"><span style="color:#64748b;font-size:11px">${fmtDateTime(n.createdAt)}</span><br>${esc(n.text)}</div>`).join('')}` : ''}
<div class="foot">Please keep this ticket. Devices not collected within 60 days may be disposed of. Data is not backed up — please ensure your device is backed up before repair.</div>
</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 250)
}
