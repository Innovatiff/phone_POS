import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, Eye, EyeOff, Mail, Phone, Clock, ShieldCheck, Activity, Monitor, TrendingUp, Users, UserCheck, Save, KeyRound, Lock } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import { Avatar, Badge, Card, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Select, StatCard, Toggle, confirm, toast, type Column } from '@/components/ui'
import { ago, cx, fmtDateTime, money, titleCase, AVATAR_COLORS } from '@/lib/utils'
import { cashierPerformance, txInRange, RANGE_OPTIONS, type RangeKey } from '@/lib/analytics'
import type { Permission, Role, User } from '@/lib/types'

const PERMISSIONS: Array<{ key: Permission; label: string; desc: string }> = [
  { key: 'sell', label: 'Sell', desc: 'Ring up sales at the register' },
  { key: 'refund', label: 'Refund', desc: 'Process returns and refunds' },
  { key: 'discount', label: 'Discount', desc: 'Apply line & cart discounts (up to max %)' },
  { key: 'price_override', label: 'Price override', desc: 'Change unit prices at checkout' },
  { key: 'void', label: 'Void', desc: 'Void completed transactions' },
  { key: 'cash_drawer', label: 'Cash drawer', desc: 'Open drawer, cash in / out, close shift' },
  { key: 'reports', label: 'Reports', desc: 'View sales analytics and reports' },
  { key: 'catalog', label: 'Catalog', desc: 'Create and edit products & prices' },
  { key: 'inventory', label: 'Inventory', desc: 'Adjust stock, receive purchase orders' },
  { key: 'customers', label: 'Customers', desc: 'Create and edit customer profiles' },
  { key: 'staff', label: 'Staff', desc: 'Manage staff accounts and permissions' },
  { key: 'settings', label: 'Settings', desc: 'Change store configuration' },
]
const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  admin: PERMISSIONS.map((p) => p.key),
  manager: ['sell', 'refund', 'discount', 'price_override', 'void', 'cash_drawer', 'reports', 'catalog', 'inventory', 'customers'],
  cashier: ['sell', 'discount', 'customers'],
}
const roleTone = (r: Role) => (r === 'admin' ? 'purple' : r === 'manager' ? 'blue' : 'slate')

interface StaffForm { name: string; email: string; phone: string; role: Role; pin: string; password: string; color: string; active: boolean; permissions: Permission[] }
const emptyForm = (): StaffForm => ({ name: '', email: '', phone: '', role: 'cashier', pin: '', password: '', color: AVATAR_COLORS[0]!, active: true, permissions: ROLE_DEFAULTS.cashier })

export default function Staff() {
  const admin = useAdminUser()!
  const db = useDB((s) => s.db)
  const upsertUser = useDB((s) => s.upsertUser)
  const deleteUser = useDB((s) => s.deleteUser)

  const [drawer, setDrawer] = useState<{ id?: string } | null>(null)
  const [form, setForm] = useState<StaffForm>(emptyForm())
  const [showPass, setShowPass] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [feedUser, setFeedUser] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('30d')

  const last30 = useMemo(() => txInRange(db.transactions, '30d'), [db.transactions])
  const statsFor = (id: string) => {
    const mine = last30.filter((t) => t.userId === id && t.type === 'sale' && t.status !== 'voided')
    const refunds = last30.filter((t) => t.userId === id && t.type === 'refund')
    return { count: mine.length, revenue: mine.reduce((a, t) => a + t.total, 0) - refunds.reduce((a, t) => a + Math.abs(t.total), 0), refunds: refunds.length }
  }
  const openShiftFor = (id: string) => db.shifts.find((s) => s.status === 'open' && s.userId === id)

  const perf = useMemo(() => cashierPerformance(txInRange(db.transactions, range), db), [db, range])
  const users = useMemo(() => [...db.users].sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : ['admin', 'manager', 'cashier'].indexOf(a.role) - ['admin', 'manager', 'cashier'].indexOf(b.role))), [db.users])

  const openNew = () => { setForm(emptyForm()); setShowPass(false); setDrawer({}) }
  const openEdit = (u: User) => { setForm({ name: u.name, email: u.email, phone: u.phone ?? '', role: u.role, pin: u.pin, password: u.password ?? '', color: u.color, active: u.active, permissions: u.permissions }); setShowPass(false); setDrawer({ id: u.id }) }

  const save = () => {
    const name = form.name.trim()
    if (!name) { toast.error('Name is required'); return }
    if (!/^\d{4,6}$/.test(form.pin)) { toast.error('PIN must be 4–6 digits'); return }
    if (db.users.some((u) => u.pin === form.pin && u.id !== drawer?.id)) { toast.error('That PIN is already in use by another staff member'); return }
    if (form.email && db.users.some((u) => u.email.toLowerCase() === form.email.trim().toLowerCase() && u.id !== drawer?.id)) { toast.error('That email is already in use'); return }
    if (form.role !== 'cashier' && !form.email.trim()) { toast.error('Admins and managers need an email to sign in'); return }
    if (form.role !== 'cashier' && form.password.length < 6) { toast.error('Password must be at least 6 characters for admin/manager'); return }
    if (drawer?.id === 'u_admin' && (form.role !== 'admin' || !form.active)) { toast.error('The primary admin must stay an active admin'); return }
    const u = upsertUser({ id: drawer?.id, name, email: form.email.trim(), phone: form.phone.trim() || undefined, role: form.role, pin: form.pin, password: form.role === 'cashier' ? undefined : form.password, color: form.color, active: form.active, permissions: form.permissions }, admin.id)
    toast.success(drawer?.id ? `${u.name} updated` : `${u.name} added to staff`)
    setDrawer(null)
  }
  const toggleActive = (u: User, v: boolean) => {
    if (u.id === 'u_admin') { toast.error('The primary admin cannot be deactivated'); return }
    if (u.id === admin.id && !v) { toast.error('You cannot deactivate yourself'); return }
    upsertUser({ id: u.id, active: v }, admin.id)
    toast.success(`${u.name} ${v ? 'activated' : 'deactivated'}`)
  }
  const remove = async (u: User) => {
    if (u.id === 'u_admin') { toast.error('The primary admin account cannot be deleted'); return }
    if (u.id === admin.id) { toast.error('You cannot delete your own account'); return }
    if (!(await confirm('Remove staff member?', <>Remove <b>{u.name}</b>? Their historical sales and activity stay in the log. Consider deactivating instead.</>, { danger: true, confirmLabel: 'Remove' }))) return
    deleteUser(u.id, admin.id)
    toast.success(`${u.name} removed`)
  }
  const setRole = (r: Role) => setForm((f) => ({ ...f, role: r, permissions: ROLE_DEFAULTS[r] }))
  const togglePerm = (p: Permission) => setForm((f) => ({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p] }))

  const activeCount = db.users.filter((u) => u.active).length
  const onShift = db.shifts.filter((s) => s.status === 'open').length

  type PerfRow = ReturnType<typeof cashierPerformance>[number]
  const perfCols: Column<PerfRow>[] = [
    { key: 'name', header: 'Staff', sortValue: (r) => r.name, render: (r) => <span className="inline-flex items-center gap-2"><Avatar name={r.name} color={r.color} size={26} /><span className="font-medium">{r.name}</span><Badge tone={roleTone(r.role)} className="capitalize">{r.role}</Badge></span> },
    { key: 'orders', header: 'Sales', align: 'right', sortValue: (r) => r.orders, render: (r) => <span className="tabular-nums">{r.orders}</span> },
    { key: 'revenue', header: 'Revenue', align: 'right', sortValue: (r) => r.revenue, render: (r) => <span className="tabular-nums font-semibold">{money(r.revenue)}</span> },
    { key: 'avg', header: 'Avg. ticket', align: 'right', sortValue: (r) => r.avgOrder, render: (r) => <span className="tabular-nums">{money(r.avgOrder)}</span> },
    { key: 'items', header: 'Items', align: 'right', sortValue: (r) => r.items, render: (r) => <span className="tabular-nums">{r.items}</span> },
    { key: 'discounts', header: 'Discounts', align: 'right', sortValue: (r) => r.discounts, render: (r) => <span className={cx('tabular-nums', r.discounts > 0 && 'text-amber-600')}>{money(r.discounts)}</span> },
    { key: 'refunds', header: 'Refunds', align: 'right', sortValue: (r) => r.refunds, render: (r) => <span className={cx('tabular-nums', r.refundCount > 0 && 'text-red-600')}>{r.refundCount} · {money(r.refunds)}</span> },
    { key: 'voids', header: 'Voids', align: 'right', sortValue: (r) => r.voidCount, render: (r) => <span className={cx('tabular-nums', r.voidCount > 0 && 'text-red-600 font-semibold')}>{r.voidCount}</span> },
    { key: 'margin', header: 'Margin', align: 'right', sortValue: (r) => r.margin, render: (r) => <span className="tabular-nums">{r.margin.toFixed(1)}%</span> },
  ]

  const feed = useMemo(() => (feedUser ? db.activity.filter((a) => a.userId === feedUser).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200) : []), [db.activity, feedUser])
  const feedU = db.users.find((u) => u.id === feedUser)

  return (
    <div>
      <PageHeader title="Staff" subtitle="Accounts, roles, permissions and performance" actions={<button className="btn-primary" onClick={openNew}><Plus size={15} /> Add staff</button>} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard label="Staff accounts" value={db.users.length} icon={<Users size={14} />} hint={`${activeCount} active`} />
        <StatCard label="On shift now" value={onShift} icon={<Monitor size={14} />} hint={onShift ? db.shifts.filter((s) => s.status === 'open').map((s) => db.users.find((u) => u.id === s.userId)?.name?.split(' ')[0]).join(', ') : 'No open registers'} />
        <StatCard label="Sales last 30 days" value={last30.filter((t) => t.type === 'sale' && t.status !== 'voided').length} icon={<TrendingUp size={14} />} hint="All cashiers combined" />
        <StatCard label="Managers & admins" value={db.users.filter((u) => u.role !== 'cashier').length} icon={<ShieldCheck size={14} />} hint="Can approve refunds & voids" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-5">
        {users.map((u) => {
          const st = statsFor(u.id)
          const shift = openShiftFor(u.id)
          const reg = shift ? db.registers.find((r) => r.id === shift.registerId) : undefined
          const shown = revealed.has(u.id)
          return (
            <div key={u.id} className={cx('card p-5 flex flex-col gap-4', !u.active && 'opacity-70')}>
              <div className="flex items-start gap-3">
                <Avatar name={u.name} color={u.color} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 truncate">{u.name}</span>
                    <Badge tone={roleTone(u.role)} className="capitalize">{u.role}</Badge>
                    {u.id === admin.id && <Badge tone="green">You</Badge>}
                    {!u.active && <Badge tone="red">Inactive</Badge>}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex flex-col gap-0.5">
                    <span className="inline-flex items-center gap-1.5 truncate"><Mail size={12} className="text-slate-400" />{u.email || '—'}</span>
                    {u.phone && <span className="inline-flex items-center gap-1.5"><Phone size={12} className="text-slate-400" />{u.phone}</span>}
                    <span className="inline-flex items-center gap-1.5"><Clock size={12} className="text-slate-400" />{u.lastLoginAt ? `Last login ${ago(u.lastLoginAt)}` : 'Never logged in'}</span>
                  </div>
                </div>
                <Toggle checked={u.active} onChange={(v) => toggleActive(u, v)} disabled={u.id === 'u_admin'} />
              </div>

              <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <span className="text-xs text-slate-500 inline-flex items-center gap-1.5"><KeyRound size={12} /> PIN</span>
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono text-sm tracking-[0.2em] text-slate-800">{shown ? u.pin : '•'.repeat(u.pin.length)}</span>
                  <button className="text-slate-400 hover:text-slate-700" onClick={() => setRevealed((s) => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n })} title={shown ? 'Hide PIN' : 'Reveal PIN'}>{shown ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                </span>
              </div>

              <div className="flex flex-wrap gap-1">
                {u.role === 'admin' ? <Badge tone="purple"><ShieldCheck size={10} className="mr-1" />All permissions</Badge> : u.permissions.length ? u.permissions.map((p) => <Badge key={p} tone="slate">{titleCase(p)}</Badge>) : <span className="text-xs text-slate-400">No permissions</span>}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 py-2"><div className="text-lg font-bold text-slate-900 leading-none">{st.count}</div><div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">Sales 30d</div></div>
                <div className="rounded-lg bg-slate-50 py-2"><div className="text-lg font-bold text-slate-900 leading-none truncate px-1">{money(st.revenue)}</div><div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">Revenue 30d</div></div>
                <div className="rounded-lg bg-slate-50 py-2"><div className={cx('text-lg font-bold leading-none', st.refunds ? 'text-red-600' : 'text-slate-900')}>{st.refunds}</div><div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">Refunds 30d</div></div>
              </div>

              {shift && reg && (
                <Link to="/admin/registers" className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-100">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 pulse-soft" /> On shift at <b>{reg.name}</b> since {ago(shift.openedAt)} · {money(shift.salesTotal)} sold
                </Link>
              )}

              <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                <button className="btn-secondary !py-1.5 text-xs" onClick={() => openEdit(u)}><Pencil size={13} /> Edit</button>
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => setFeedUser(u.id)}><Activity size={13} /> Activity</button>
                <div className="flex-1" />
                <button className="btn-ghost !py-1.5 !px-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40" disabled={u.id === 'u_admin'} onClick={() => remove(u)} title={u.id === 'u_admin' ? 'Primary admin cannot be deleted' : 'Remove'}><Trash2 size={13} /></button>
              </div>
            </div>
          )
        })}
      </div>

      <Card title="Performance" subtitle="Sales, discounts, refunds and voids per cashier" padded={false} action={<Select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className="!w-40">{RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}>
        <div className="px-2 pb-3">
          <DataTable rows={perf} columns={perfCols} pageSize={10} defaultSort={{ key: 'revenue', dir: 'desc' }} empty={<EmptyState icon={<UserCheck size={22} />} title="No sales in this range" />} />
        </div>
      </Card>

      {/* Edit / add drawer */}
      <Drawer open={!!drawer} onClose={() => setDrawer(null)} title={drawer?.id ? `Edit ${form.name || 'staff'}` : 'Add staff member'} width="max-w-xl" footer={<>
        <button className="btn-secondary" onClick={() => setDrawer(null)}>Cancel</button>
        <button className="btn-primary" onClick={save}><Save size={15} /> {drawer?.id ? 'Save changes' : 'Create account'}</button>
      </>}>
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Avatar name={form.name || 'New Staff'} color={form.color} size={56} />
            <div>
              <div className="label">Avatar color</div>
              <div className="flex gap-1.5 flex-wrap">
                {AVATAR_COLORS.map((c) => <button key={c} type="button" onClick={() => setForm((f) => ({ ...f, color: c }))} className={cx('w-7 h-7 rounded-full border-2 transition-transform', form.color === c ? 'border-slate-900 scale-110' : 'border-white')} style={{ background: c }} />)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name" required className="sm:col-span-2"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus /></Field>
            <Field label="Email" required={form.role !== 'cashier'} hint={form.role !== 'cashier' ? 'Used to sign in to the admin console' : undefined}><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
            <Field label="Role" required hint="Changing role resets permissions to the role default">
              <Select value={form.role} onChange={(e) => setRole(e.target.value as Role)} disabled={drawer?.id === 'u_admin'}>
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            <Field label="Cashier PIN" required hint="4–6 digits, must be unique">
              <Input inputMode="numeric" maxLength={6} value={form.pin} onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))} className={cx('font-mono tracking-widest', form.pin && !/^\d{4,6}$/.test(form.pin) && 'border-red-400')} />
            </Field>
            {form.role !== 'cashier' && (
              <Field label="Password" required hint="Min. 6 characters · admin/manager console login" className="sm:col-span-2">
                <div className="relative">
                  <Input type={showPass ? 'text' : 'password'} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="pr-10" />
                  <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">{showPass ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                </div>
              </Field>
            )}
          </div>
          <Toggle checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} disabled={drawer?.id === 'u_admin'} label={<span>Account active <span className="text-slate-400 text-xs">— inactive accounts cannot sign in</span></span>} />

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="label !mb-0">Permissions <span className="text-slate-400 font-normal">({form.role === 'admin' ? 'all' : form.permissions.length}/{PERMISSIONS.length})</span></div>
              <div className="flex gap-1">
                <button type="button" className="btn-ghost !py-0.5 !px-2 text-[11px]" onClick={() => setForm((f) => ({ ...f, permissions: PERMISSIONS.map((p) => p.key) }))} disabled={form.role === 'admin'}>All</button>
                <button type="button" className="btn-ghost !py-0.5 !px-2 text-[11px]" onClick={() => setForm((f) => ({ ...f, permissions: ROLE_DEFAULTS[f.role] }))} disabled={form.role === 'admin'}>Role default</button>
                <button type="button" className="btn-ghost !py-0.5 !px-2 text-[11px]" onClick={() => setForm((f) => ({ ...f, permissions: [] }))} disabled={form.role === 'admin'}>None</button>
              </div>
            </div>
            {form.role === 'admin' && <div className="text-xs text-violet-700 bg-violet-50 rounded-lg p-2.5 mb-2 inline-flex items-center gap-1.5"><Lock size={12} /> Admins implicitly have every permission.</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PERMISSIONS.map((p) => {
                const on = form.role === 'admin' || form.permissions.includes(p.key)
                return (
                  <button key={p.key} type="button" disabled={form.role === 'admin'} onClick={() => togglePerm(p.key)} className={cx('text-left rounded-lg border p-2.5 transition-colors flex items-start gap-2.5', on ? 'border-brand-500 bg-brand-50/60' : 'border-slate-200 hover:border-slate-300', form.role === 'admin' && 'cursor-not-allowed')}>
                    <span className={cx('mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0', on ? 'bg-brand-600 border-brand-600' : 'border-slate-300 bg-white')}>{on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M5 12l5 5L20 7" /></svg>}</span>
                    <span><span className="text-sm font-medium text-slate-800 block">{p.label}</span><span className="text-[11px] text-slate-500 block">{p.desc}</span></span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </Drawer>

      {/* Activity feed drawer */}
      <Drawer open={!!feedUser} onClose={() => setFeedUser(null)} title={feedU ? <span className="inline-flex items-center gap-2"><Avatar name={feedU.name} color={feedU.color} size={26} />{feedU.name}'s activity</span> : 'Activity'} width="max-w-xl">
        {feed.length ? (
          <ol className="relative border-l border-slate-200 ml-2">
            {feed.map((a) => (
              <li key={a.id} className="ml-4 pb-4 last:pb-0">
                <span className={cx('absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-white', a.severity === 'critical' ? 'bg-red-500' : a.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500')} />
                <div className="text-[11px] text-slate-400">{fmtDateTime(a.createdAt)} · {ago(a.createdAt)}{a.registerId && <> · {db.registers.find((r) => r.id === a.registerId)?.name}</>}</div>
                <div className="text-sm text-slate-700 mt-0.5">{a.description}</div>
                <div className="mt-1 flex items-center gap-1.5"><Badge tone="slate" className="font-mono !font-medium">{a.action}</Badge><Badge tone="blue" className="capitalize">{a.entity}</Badge></div>
              </li>
            ))}
          </ol>
        ) : <EmptyState icon={<Activity size={22} />} title="No activity recorded" description="Actions performed by this staff member will appear here." />}
        <div className="mt-4 text-center"><Link to="/admin/activity" className="text-xs text-brand-700 hover:underline">Open full activity log →</Link></div>
      </Drawer>
    </div>
  )
}
