import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Smartphone, Monitor, Lock, PauseCircle, Receipt as ReceiptIcon, Clock, Wrench, Plus, ScanBarcode, Users, DoorOpen, ArrowRight, UserCheck } from 'lucide-react'
import type { RepairStatus, Register } from '@/lib/types'
import { useDB, useOpenShift } from '@/store/db'
import { useCashierUser, useSession } from '@/store/session'
import { Avatar, Badge, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea, statusTone, toast } from '@/components/ui'
import { ago, cx, fmtDateTime, fmtTime, money, titleCase } from '@/lib/utils'
import { Keypad, ManagerPinHost, PinDots, parseAmount, shake } from './shared'
import Sell from './Sell'
import CashierTransactions from './CashierTransactions'
import CashierCustomers from './CashierCustomers'
import ShiftPage from './Shift'

export default function CashierApp() {
  const user = useCashierUser()
  const registerId = useSession((s) => s.registerId)
  const register = useDB((s) => s.db.registers.find((r) => r.id === registerId && r.active))
  const shift = useOpenShift(registerId)
  const location = useLocation()
  if (!user) return <PinLogin />
  if (!register) return <RegisterSelect />
  // The shift page may render after a shift was just closed (to show the closing summary)
  if (!shift && !location.pathname.startsWith('/cashier/shift')) return <RegisterSelect />
  return <Layout />
}

// ─── PIN login ───────────────────────────────────────────────────────────────
function PinLogin() {
  const users = useDB((s) => s.db.users)
  const settings = useDB((s) => s.db.settings)
  const login = useSession((s) => s.loginCashier)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const staff = useMemo(() => users.filter((u) => u.active && (u.role !== 'cashier' || u.permissions.includes('sell'))), [users])

  const submit = (p: string) => {
    const r = login(p)
    if (!r.ok) {
      setError(r.message ?? 'Invalid PIN')
      shake(boxRef.current)
      setPin('')
      return
    }
    toast.success(`Welcome back, ${r.user?.name.split(' ')[0]}`)
  }
  useEffect(() => {
    if (pin.length !== 4) return
    const t = window.setTimeout(() => submit(pin), 120)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) { setError(''); setPin((p) => (p.length < 6 ? p + e.key : p)) }
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Escape') setPin('')
      else if (e.key === 'Enter' && pin.length >= 4) submit(pin)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  return (
    <div className="min-h-full bg-navy-900 text-white flex flex-col">
      <header className="flex items-center justify-between px-6 md:px-10 py-6">
        <NavLink to="/" className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-600/30"><Smartphone size={22} /></div>
          <div>
            <div className="text-lg font-bold leading-tight">{settings.storeName} POS</div>
            <div className="text-xs text-slate-400">Cashier portal</div>
          </div>
        </NavLink>
        <LiveClock className="text-sm text-slate-400 tabular-nums" />
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-12">
        <div ref={boxRef} className="w-full max-w-sm rounded-3xl bg-white/5 border border-white/10 p-8 fade-up">
          <div className="text-center">
            <div className="text-2xl font-bold tracking-tight">Enter your PIN</div>
            <div className="text-sm text-slate-400 mt-1">Sign in to start selling</div>
          </div>
          <div className="mt-7"><PinDots length={pin.length} variant="dark" /></div>
          <div className={cx('text-center text-xs mt-3 h-4', error ? 'text-red-400 font-medium' : 'text-slate-500')}>{error || ' '}</div>
          <Keypad className="mt-4" variant="dark" size="lg" onKey={(k) => { setError(''); setPin((p) => (p.length < 6 ? p + k : p)) }} onBackspace={() => setPin((p) => p.slice(0, -1))} onClear={() => setPin('')} />
        </div>
        <div className="mt-8 flex flex-col items-center gap-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">On shift today</div>
          <div className="flex flex-wrap justify-center gap-4">
            {staff.map((u) => (
              <div key={u.id} className="flex flex-col items-center gap-1.5 w-16">
                <Avatar name={u.name} color={u.color} size={40} className="ring-2 ring-white/10" />
                <div className="text-[11px] text-slate-300 truncate w-full text-center">{u.name.split(' ')[0]}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
      <footer className="text-center text-[11px] text-slate-500 pb-6 font-mono">Demo PINs: 1111 / 2222 / 3333 / 9999 (manager)</footer>
    </div>
  )
}

function LiveClock({ className, withDate }: { className?: string; withDate?: boolean }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t) }, [])
  return <span className={className}>{withDate && <span className="opacity-70 mr-2">{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>}{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
}

// ─── Register selection ──────────────────────────────────────────────────────
function RegisterSelect() {
  const user = useCashierUser()!
  const db = useDB((s) => s.db)
  const openShift = useDB((s) => s.openShift)
  const log = useDB((s) => s.log)
  const selectRegister = useSession((s) => s.selectRegister)
  const logout = useSession((s) => s.logoutCashier)
  const [opening, setOpening] = useState<Register | undefined>()
  const registers = db.registers.filter((r) => r.active)

  const pick = (r: Register) => {
    const shift = db.shifts.find((s) => s.registerId === r.id && s.status === 'open')
    if (!shift) { setOpening(r); return }
    if (shift.userId !== user.id) {
      const other = db.users.find((u) => u.id === shift.userId)
      log({ userId: user.id, action: 'shift.takeover', entity: 'shift', entityId: shift.id, description: `${user.name} took over ${r.name} from ${other?.name ?? 'another cashier'}`, severity: 'info', registerId: r.id })
      toast.info(`You took over ${r.name}`)
    }
    selectRegister(r.id)
  }

  return (
    <div className="min-h-full bg-[#f4f6fa] flex flex-col">
      <header className="bg-white border-b border-slate-200 px-5 md:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-600 text-white flex items-center justify-center"><Smartphone size={18} /></div>
          <div>
            <div className="font-bold leading-tight text-slate-900">{db.settings.storeName} POS</div>
            <div className="text-[11px] text-slate-400">Choose a register</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-sm">
            <Avatar name={user.name} color={user.color} size={30} />
            <div><div className="font-medium text-slate-800 leading-tight">{user.name}</div><div className="text-[11px] text-slate-400 capitalize">{user.role}</div></div>
          </div>
          <button className="btn-secondary" onClick={logout}><Lock size={14} /> Lock</button>
        </div>
      </header>
      <main className="flex-1 p-5 md:p-8 max-w-5xl w-full mx-auto">
        <PageHeader title={`Hi ${user.name.split(' ')[0]}, pick a register`} subtitle="Select the register you are working on. Registers without an open shift will ask for an opening float." />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {registers.map((r) => {
            const shift = db.shifts.find((s) => s.registerId === r.id && s.status === 'open')
            const by = shift ? db.users.find((u) => u.id === shift.userId) : undefined
            const mine = shift?.userId === user.id
            return (
              <button key={r.id} onClick={() => pick(r)} className="card p-5 text-left hover:shadow-pop transition-shadow group flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ background: r.color }}><Monitor size={20} /></div>
                    <div>
                      <div className="font-semibold text-slate-900">{r.name}</div>
                      <div className="text-xs text-slate-400">{r.location || '—'}</div>
                    </div>
                  </div>
                  {shift ? <Badge tone="green" dot>Open</Badge> : <Badge tone="slate">Closed</Badge>}
                </div>
                <div className="text-sm text-slate-600 min-h-[40px]">
                  {shift ? (
                    <div className="flex items-center gap-2">
                      <Avatar name={by?.name ?? '?'} color={by?.color} size={24} />
                      <div><span className="font-medium text-slate-800">{mine ? 'You' : by?.name}</span> <span className="text-slate-400">· since {fmtTime(shift.openedAt)} ({ago(shift.openedAt)})</span></div>
                    </div>
                  ) : (
                    <span className="text-slate-400">No open shift. Opening float {money(db.settings.openingFloatDefault)} by default.</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm font-medium">
                  {shift ? (
                    <span className="text-slate-500">{shift.salesCount} sale{shift.salesCount === 1 ? '' : 's'} · {money(shift.salesTotal)}</span>
                  ) : <span className="text-slate-400">Ready to open</span>}
                  <span className={cx('inline-flex items-center gap-1 group-hover:gap-2 transition-all', mine || !shift ? 'text-brand-600' : 'text-amber-600')}>
                    {!shift ? <><DoorOpen size={15} /> Open shift</> : mine ? <>Continue <ArrowRight size={15} /></> : <><UserCheck size={15} /> Take over</>}
                  </span>
                </div>
              </button>
            )
          })}
          {!registers.length && <div className="md:col-span-2 xl:col-span-3"><EmptyState title="No active registers" description="Ask an admin to add a register in Admin → Registers." /></div>}
        </div>
      </main>
      <OpenShiftModal register={opening} onClose={() => setOpening(undefined)} onOpen={(float, note) => {
        if (!opening) return
        openShift(opening.id, user.id, float, note || undefined)
        selectRegister(opening.id)
        toast.success(`${opening.name} opened with ${money(float)} float`)
        setOpening(undefined)
      }} />
    </div>
  )
}

function OpenShiftModal({ register, onClose, onOpen }: { register?: Register; onClose: () => void; onOpen: (float: number, note: string) => void }) {
  const settings = useDB((s) => s.db.settings)
  const [float, setFloat] = useState(String(settings.openingFloatDefault))
  const [note, setNote] = useState('')
  useEffect(() => { if (register) { setFloat(String(settings.openingFloatDefault)); setNote('') } }, [register, settings.openingFloatDefault])
  return (
    <Modal open={!!register} onClose={onClose} size="sm" title={`Open shift on ${register?.name ?? ''}`} subtitle="Count the cash in the drawer before you start."
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => onOpen(parseAmount(float), note.trim())}><DoorOpen size={15} /> Open shift</button></>}>
      <div className="space-y-4 pb-2">
        <Field label="Opening float">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{settings.currencySymbol}</span>
            <Input autoFocus type="number" min={0} step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} className="pl-7 text-lg font-semibold" onKeyDown={(e) => { if (e.key === 'Enter') onOpen(parseAmount(float), note.trim()) }} />
          </div>
        </Field>
        <div className="flex gap-2">
          {[100, 200, 300].map((v) => (
            <button key={v} type="button" className={cx('flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors', parseAmount(float) === v ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 hover:bg-slate-50 text-slate-700')} onClick={() => setFloat(String(v))}>{money(v)}</button>
          ))}
        </div>
        <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Float counted with Priya" className="min-h-[60px]" /></Field>
      </div>
    </Modal>
  )
}

// ─── Main layout ─────────────────────────────────────────────────────────────
const TABS = [
  { to: '/cashier', label: 'Sell', icon: ScanBarcode, end: true },
  { to: '/cashier/transactions', label: 'Transactions', icon: ReceiptIcon },
  { to: '/cashier/customers', label: 'Customers', icon: Users },
  { to: '/cashier/shift', label: 'Shift', icon: Clock },
  { to: '/cashier/repairs', label: 'Repairs', icon: Wrench },
]

function Layout() {
  const user = useCashierUser()!
  const registerId = useSession((s) => s.registerId)!
  const logout = useSession((s) => s.logoutCashier)
  const settings = useDB((s) => s.db.settings)
  const register = useDB((s) => s.db.registers.find((r) => r.id === registerId))!
  const shift = useOpenShift(registerId)
  const heldCount = useDB((s) => s.db.carts.filter((c) => c.heldAt).length)
  const navigate = useNavigate()

  const openDisplay = () => {
    const w = window.open(`/display/${registerId}`, `phoneman_display_${registerId}`, 'width=1024,height=640')
    if (!w) toast.error('Popup blocked — allow popups to open the customer display')
    else w.focus()
  }

  return (
    <div className="h-full flex flex-col bg-[#f4f6fa] overflow-hidden">
      <header className="bg-white border-b border-slate-200 h-14 px-3 md:px-5 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center shrink-0"><Smartphone size={16} /></div>
          <div className="font-bold text-slate-900 truncate hidden sm:block">{settings.storeName}</div>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white shrink-0" style={{ background: register.color }}><Monitor size={12} /> {register.name}</span>
          <div className="hidden md:flex items-center gap-2 pl-3 border-l border-slate-200 min-w-0">
            <Avatar name={user.name} color={user.color} size={28} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-800 leading-tight truncate">{user.name}</div>
              <div className="text-[11px] text-slate-400 leading-tight">{shift ? <>Shift since {fmtTime(shift.openedAt)} · {ago(shift.openedAt).replace(' ago', '')}</> : 'No open shift'}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <LiveClock className="hidden lg:block text-sm font-medium text-slate-600 tabular-nums mr-2" withDate />
          <button className="btn-ghost !px-2.5" title="Open customer display in a new window" onClick={openDisplay}><Monitor size={16} /><span className="hidden xl:inline">Customer display</span></button>
          <button className="btn-ghost !px-2.5 relative" title="Held sales" onClick={() => navigate('/cashier?held=1')}>
            <PauseCircle size={16} /><span className="hidden xl:inline">Held</span>
            {heldCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center px-1">{heldCount}</span>}
          </button>
          <button className="btn-ghost !px-2.5" onClick={() => navigate('/cashier/transactions')}><ReceiptIcon size={16} /><span className="hidden xl:inline">Transactions</span></button>
          <button className="btn-ghost !px-2.5" onClick={() => navigate('/cashier/shift')}><Clock size={16} /><span className="hidden xl:inline">Shift</span></button>
          <button className="btn-secondary !px-2.5 ml-1" onClick={() => { logout(); navigate('/cashier') }} title="Lock the register (sign out)"><Lock size={15} /><span className="hidden sm:inline">Lock</span></button>
        </div>
      </header>
      <nav className="bg-white border-b border-slate-200 px-3 md:px-5 flex items-center gap-1 h-11 shrink-0 overflow-x-auto">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('inline-flex items-center gap-1.5 px-3.5 h-full text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors', isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            <t.icon size={15} /> {t.label}
          </NavLink>
        ))}
      </nav>
      <main className="flex-1 min-h-0 overflow-hidden">
        <Routes>
          <Route index element={<Sell />} />
          <Route path="transactions" element={<Scroll><CashierTransactions /></Scroll>} />
          <Route path="customers" element={<Scroll><CashierCustomers /></Scroll>} />
          <Route path="shift" element={<Scroll><ShiftPage /></Scroll>} />
          <Route path="repairs" element={<Scroll><CashierRepairs /></Scroll>} />
          <Route path="*" element={<Navigate to="/cashier" replace />} />
        </Routes>
      </main>
      <ManagerPinHost />
    </div>
  )
}

function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto p-4 md:p-6">{children}</div>
}

// ─── Repairs (light) ─────────────────────────────────────────────────────────
const OPEN_STATUSES: RepairStatus[] = ['received', 'diagnosing', 'waiting_parts', 'in_progress', 'ready']

function CashierRepairs() {
  const user = useCashierUser()!
  const db = useDB((s) => s.db)
  const setRepairStatus = useDB((s) => s.setRepairStatus)
  const upsertRepair = useDB((s) => s.upsertRepair)
  const [showDone, setShowDone] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ customerId: '', device: '', imei: '', issue: '', estimate: '', deposit: '' })
  const repairs = useMemo(() => [...db.repairs].filter((r) => showDone || OPEN_STATUSES.includes(r.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [db.repairs, showDone])
  const custName = (id: string) => db.customers.find((c) => c.id === id)?.name ?? 'Walk-in'

  const create = () => {
    if (!form.device.trim() || !form.issue.trim()) { toast.error('Device and issue are required'); return }
    const t = upsertRepair({ customerId: form.customerId || undefined, device: form.device.trim(), imei: form.imei.trim() || undefined, issue: form.issue.trim(), estimate: parseAmount(form.estimate), deposit: parseAmount(form.deposit), technicianId: user.id }, user.id)
    toast.success(`Ticket ${t.number} opened`)
    setCreating(false)
    setForm({ customerId: '', device: '', imei: '', issue: '', estimate: '', deposit: '' })
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Repairs" subtitle="Tickets at the repair desk. Mark them ready or collected when the customer picks up." actions={<><button className="btn-secondary" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Hide' : 'Show'} collected</button><button className="btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> New ticket</button></>} />
      {!repairs.length ? (
        <Card><EmptyState icon={<Wrench size={22} />} title="No open repair tickets" description="Create a ticket when a customer drops off a device." action={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> New ticket</button>} /></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {repairs.map((r) => (
            <Card key={r.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-xs text-slate-400">{r.number}</div>
                  <div className="font-semibold text-slate-900">{r.device}</div>
                  <div className="text-xs text-slate-500">{custName(r.customerId)}{r.imei ? ` · IMEI ${r.imei}` : ''}</div>
                </div>
                <Badge tone={statusTone(r.status)}>{titleCase(r.status)}</Badge>
              </div>
              <div className="text-sm text-slate-600 line-clamp-2">{r.issue}</div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Est. <b className="text-slate-800">{money(r.estimate)}</b>{r.deposit > 0 && <> · Deposit {money(r.deposit)}</>}</span>
                <span>{ago(r.updatedAt)}</span>
              </div>
              <div className="flex gap-2 pt-1">
                {r.status !== 'ready' && r.status !== 'collected' && r.status !== 'cancelled' && <button className="btn-secondary flex-1" onClick={() => { setRepairStatus(r.id, 'ready', user.id); toast.success(`${r.number} marked ready`) }}>Mark ready</button>}
                {r.status === 'ready' && <button className="btn-success flex-1" onClick={() => { setRepairStatus(r.id, 'collected', user.id); toast.success(`${r.number} collected`) }}>Collected · {money(Math.max(0, r.estimate - r.deposit))}</button>}
                {r.status === 'collected' && <span className="text-xs text-emerald-600 font-medium">Collected {fmtDateTime(r.updatedAt)}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New repair ticket" size="md" footer={<><button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="btn-primary" onClick={create}>Create ticket</button></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2">
          <Field label="Customer" className="sm:col-span-2">
            <Select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              <option value="">Walk-in customer</option>
              {db.customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
            </Select>
          </Field>
          <Field label="Device" required><Input autoFocus value={form.device} onChange={(e) => setForm({ ...form, device: e.target.value })} placeholder="iPhone 13 128GB" /></Field>
          <Field label="IMEI / serial"><Input value={form.imei} onChange={(e) => setForm({ ...form, imei: e.target.value })} className="font-mono" /></Field>
          <Field label="Issue" required className="sm:col-span-2"><Textarea value={form.issue} onChange={(e) => setForm({ ...form, issue: e.target.value })} placeholder="Cracked screen, touch not responding" /></Field>
          <Field label="Estimate"><Input type="number" min={0} step="0.01" value={form.estimate} onChange={(e) => setForm({ ...form, estimate: e.target.value })} /></Field>
          <Field label="Deposit taken"><Input type="number" min={0} step="0.01" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  )
}

