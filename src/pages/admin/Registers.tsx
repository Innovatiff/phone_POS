import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Monitor, Plus, Pencil, ExternalLink, Power, Download, Clock, Banknote, CreditCard, Wallet, ArrowDownCircle, ArrowUpCircle, Receipt, AlertTriangle, CheckCircle2, MapPin, Save, Printer } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser, hasPerm } from '@/store/session'
import { Avatar, Badge, Card, DataTable, Drawer, EmptyState, Field, Input, KV, PageHeader, Select, StatCard, Toggle, confirm, statusTone, toast, type Column } from '@/components/ui'
import { ago, cx, downloadFile, fmtDateTime, fmtTime, money, round2, toCSV, AVATAR_COLORS, titleCase } from '@/lib/utils'
import type { Register, Shift } from '@/lib/types'

function duration(fromISO: string, toISO?: string): string {
  const ms = (toISO ? new Date(toISO).getTime() : Date.now()) - new Date(fromISO).getTime()
  const m = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(m / 60)
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}
function expectedSoFar(s: Shift): number {
  const ins = s.cashMovements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0)
  const outs = s.cashMovements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0)
  return round2(s.openingFloat + s.cashSales + ins - outs)
}

interface RegForm { name: string; location: string; color: string; active: boolean }

export default function Registers() {
  const admin = useAdminUser()!
  const db = useDB((s) => s.db)
  const upsertRegister = useDB((s) => s.upsertRegister)
  const closeShift = useDB((s) => s.closeShift)
  const canManage = hasPerm(admin, 'cash_drawer') || admin.role !== 'cashier'

  const [regDrawer, setRegDrawer] = useState<{ id?: string } | null>(null)
  const [regForm, setRegForm] = useState<RegForm>({ name: '', location: '', color: AVATAR_COLORS[0]!, active: true })
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [fReg, setFReg] = useState('all')
  const [fCashier, setFCashier] = useState('all')
  const [fDays, setFDays] = useState('30')
  const [varianceOnly, setVarianceOnly] = useState(false)

  const openShifts = db.shifts.filter((s) => s.status === 'open')
  const todayKey = new Date().toISOString().slice(0, 10)
  const closedToday = db.shifts.filter((s) => s.status === 'closed' && (s.closedAt ?? '').slice(0, 10) === todayKey)
  const varianceToday = closedToday.reduce((a, s) => a + (s.difference ?? 0), 0)
  const cashOnHand = openShifts.reduce((a, s) => a + expectedSoFar(s), 0)

  const shifts = useMemo(() => {
    const since = fDays === 'all' ? 0 : Date.now() - Number(fDays) * 86400000
    return db.shifts.filter((s) => {
      if (fReg !== 'all' && s.registerId !== fReg) return false
      if (fCashier !== 'all' && s.userId !== fCashier) return false
      if (new Date(s.openedAt).getTime() < since) return false
      if (varianceOnly && !(s.difference && Math.abs(s.difference) >= 0.01)) return false
      return true
    }).sort((a, b) => b.openedAt.localeCompare(a.openedAt))
  }, [db.shifts, fReg, fCashier, fDays, varianceOnly])

  const regOf = (id: string) => db.registers.find((r) => r.id === id)
  const userOf = (id: string) => db.users.find((u) => u.id === id)

  const openNewReg = () => { setRegForm({ name: `Register ${db.registers.length + 1}`, location: '', color: AVATAR_COLORS[db.registers.length % AVATAR_COLORS.length]!, active: true }); setRegDrawer({}) }
  const openEditReg = (r: Register) => { setRegForm({ name: r.name, location: r.location, color: r.color, active: r.active }); setRegDrawer({ id: r.id }) }
  const saveReg = () => {
    if (!regForm.name.trim()) { toast.error('Name is required'); return }
    upsertRegister({ id: regDrawer?.id, name: regForm.name.trim(), location: regForm.location.trim(), color: regForm.color, active: regForm.active }, admin.id)
    toast.success(regDrawer?.id ? 'Register updated' : 'Register added')
    setRegDrawer(null)
  }
  const forceClose = async (s: Shift) => {
    const reg = regOf(s.registerId)
    const expected = expectedSoFar(s)
    if (!(await confirm('Force close shift?', <>Close the open shift on <b>{reg?.name}</b> ({userOf(s.userId)?.name})? The closing count will be set to the expected cash of <b>{money(expected)}</b>, so no variance is recorded. The active cart on this register will be cleared.</>, { danger: true, confirmLabel: 'Force close' }))) return
    closeShift(s.id, expected, admin.id, 'Force closed by admin')
    toast.success(`${reg?.name} shift closed`)
  }

  const exportCSV = () => {
    downloadFile(`shifts-${todayKey}.csv`, toCSV(shifts.map((s) => ({
      id: s.id, register: regOf(s.registerId)?.name ?? s.registerId, cashier: userOf(s.userId)?.name ?? s.userId, status: s.status, openedAt: s.openedAt, closedAt: s.closedAt ?? '', durationMin: Math.round(((s.closedAt ? new Date(s.closedAt).getTime() : Date.now()) - new Date(s.openedAt).getTime()) / 60000),
      openingFloat: s.openingFloat, salesCount: s.salesCount, salesTotal: s.salesTotal, refundsCount: s.refundsCount, refundsTotal: s.refundsTotal, cash: s.cashSales, card: s.cardSales, other: s.otherSales,
      cashIn: s.cashMovements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0), cashOut: s.cashMovements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0),
      expectedCash: s.expectedCash ?? expectedSoFar(s), countedCash: s.closingCount ?? '', variance: s.difference ?? '', notes: s.notes ?? '',
    }))), 'text/csv')
    toast.success(`Exported ${shifts.length} shifts`)
  }

  const cols: Column<Shift>[] = [
    { key: 'opened', header: 'Opened', sortValue: (s) => s.openedAt, render: (s) => <span className="whitespace-nowrap text-slate-700">{fmtDateTime(s.openedAt)}</span> },
    { key: 'closed', header: 'Closed', sortValue: (s) => s.closedAt ?? '', render: (s) => s.closedAt ? <span className="whitespace-nowrap text-slate-500">{fmtTime(s.closedAt)}{s.closedAt.slice(0, 10) !== s.openedAt.slice(0, 10) && <span className="text-[10px] text-slate-400"> (+1d)</span>}</span> : <Badge tone="green" dot>Open</Badge> },
    { key: 'register', header: 'Register', sortValue: (s) => regOf(s.registerId)?.name ?? '', render: (s) => { const r = regOf(s.registerId); return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="w-2 h-2 rounded-full" style={{ background: r?.color }} />{r?.name ?? s.registerId}</span> } },
    { key: 'cashier', header: 'Cashier', sortValue: (s) => userOf(s.userId)?.name ?? '', render: (s) => { const u = userOf(s.userId); return u ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Avatar name={u.name} color={u.color} size={22} />{u.name}</span> : '—' } },
    { key: 'duration', header: 'Duration', sortValue: (s) => (s.closedAt ? new Date(s.closedAt).getTime() : Date.now()) - new Date(s.openedAt).getTime(), render: (s) => <span className="tabular-nums text-slate-600">{duration(s.openedAt, s.closedAt)}</span> },
    { key: 'count', header: 'Sales', align: 'right', sortValue: (s) => s.salesCount, render: (s) => <span className="tabular-nums">{s.salesCount}{s.refundsCount > 0 && <span className="text-red-500 text-[11px]"> / {s.refundsCount} ref</span>}</span> },
    { key: 'total', header: 'Sales total', align: 'right', sortValue: (s) => s.salesTotal, render: (s) => <span className="tabular-nums font-semibold">{money(s.salesTotal)}</span> },
    { key: 'split', header: 'Cash / Card / Other', align: 'right', render: (s) => <span className="tabular-nums text-xs text-slate-600 whitespace-nowrap">{money(s.cashSales)} · {money(s.cardSales)} · {money(s.otherSales)}</span> },
    { key: 'expected', header: 'Expected', align: 'right', sortValue: (s) => s.expectedCash ?? expectedSoFar(s), render: (s) => <span className="tabular-nums">{money(s.expectedCash ?? expectedSoFar(s))}</span> },
    { key: 'counted', header: 'Counted', align: 'right', sortValue: (s) => s.closingCount ?? -1, render: (s) => <span className="tabular-nums">{s.closingCount !== undefined ? money(s.closingCount) : '—'}</span> },
    { key: 'variance', header: 'Variance', align: 'right', sortValue: (s) => s.difference ?? 0, render: (s) => <VarianceLabel v={s.difference} /> },
    { key: 'status', header: 'Status', render: (s) => <Badge tone={statusTone(s.status)} dot>{titleCase(s.status)}</Badge> },
  ]

  const detail = shiftId ? db.shifts.find((s) => s.id === shiftId) : undefined

  return (
    <div>
      <PageHeader title="Registers & Shifts" subtitle="Live register status, cash control and Z-reports" actions={<>
        <button className="btn-secondary" onClick={exportCSV}><Download size={15} /> Export CSV</button>
        <button className="btn-primary" onClick={openNewReg}><Plus size={15} /> Add register</button>
      </>} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard label="Registers open" value={`${openShifts.length} / ${db.registers.filter((r) => r.active).length}`} icon={<Monitor size={14} />} hint={openShifts.length ? 'Shifts in progress' : 'All registers closed'} />
        <StatCard label="Cash in drawers now" value={money(cashOnHand)} icon={<Banknote size={14} />} hint="Expected across open shifts" />
        <StatCard label="Sales on open shifts" value={money(openShifts.reduce((a, s) => a + s.salesTotal, 0))} icon={<Receipt size={14} />} hint={`${openShifts.reduce((a, s) => a + s.salesCount, 0)} transactions`} />
        <StatCard label="Variance today" value={money(varianceToday)} delta={undefined} icon={<AlertTriangle size={14} />} hint={`${closedToday.length} shift(s) closed today`} color={Math.abs(varianceToday) >= 5 ? '#ef4444' : '#22c55e'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-5">
        {db.registers.map((r) => {
          const s = openShifts.find((x) => x.registerId === r.id)
          const u = s ? userOf(s.userId) : undefined
          const disp = db.displays.find((d) => d.registerId === r.id)
          return (
            <div key={r.id} className={cx('card p-5 flex flex-col gap-4 relative overflow-hidden', !r.active && 'opacity-60')}>
              <div className="absolute top-0 left-0 right-0 h-1" style={{ background: r.color }} />
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${r.color}1a`, color: r.color }}><Monitor size={20} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-slate-900">{r.name}</span>{s ? <Badge tone="green" dot>Open</Badge> : <Badge tone="slate" dot>Closed</Badge>}{!r.active && <Badge tone="red">Inactive</Badge>}</div>
                  <div className="text-xs text-slate-500 inline-flex items-center gap-1 mt-0.5"><MapPin size={11} />{r.location || 'No location'}</div>
                </div>
                <button className="btn-ghost !px-2 !py-1" onClick={() => openEditReg(r)} title="Edit register"><Pencil size={14} /></button>
              </div>

              {s ? (
                <>
                  <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
                    {u && <Avatar name={u.name} color={u.color} size={34} />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{u?.name ?? 'Unknown'}</div>
                      <div className="text-[11px] text-slate-500 inline-flex items-center gap-1"><Clock size={10} /> Opened {fmtTime(s.openedAt)} · {duration(s.openedAt)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Display</div>
                      <div className="text-xs font-medium text-slate-700 capitalize">{disp?.phase ?? 'idle'}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 py-2"><div className="text-base font-bold text-slate-900 leading-none">{money(s.salesTotal)}</div><div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">{s.salesCount} sales</div></div>
                    <div className="rounded-lg bg-slate-50 py-2"><div className="text-base font-bold text-slate-900 leading-none">{money(s.cashSales)}</div><div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">Cash</div></div>
                    <div className="rounded-lg bg-emerald-50 py-2"><div className="text-base font-bold text-emerald-700 leading-none">{money(expectedSoFar(s))}</div><div className="text-[10px] text-emerald-600/70 mt-1 uppercase tracking-wide">In drawer</div></div>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">No open shift{(() => { const last = [...db.shifts].filter((x) => x.registerId === r.id && x.status === 'closed').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0]; return last ? <div className="mt-1">Last closed {ago(last.closedAt)} by {userOf(last.userId)?.name}</div> : null })()}</div>
              )}

              <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                <a href={`/display/${r.id}`} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5 text-xs"><ExternalLink size={13} /> Customer display</a>
                {s && <button className="btn-ghost !py-1.5 text-xs" onClick={() => setShiftId(s.id)}><Receipt size={13} /> Live report</button>}
                <div className="flex-1" />
                {s && canManage && <button className="btn-ghost !py-1.5 text-xs text-red-600 hover:bg-red-50" onClick={() => forceClose(s)} title="Force close shift"><Power size={13} /> Force close</button>}
              </div>
            </div>
          )
        })}
        {!db.registers.length && <Card className="md:col-span-2 xl:col-span-3"><EmptyState icon={<Monitor size={22} />} title="No registers" action={<button className="btn-primary" onClick={openNewReg}><Plus size={15} /> Add register</button>} /></Card>}
      </div>

      <Card title="Shift history" subtitle="Every opened and closed shift with cash reconciliation" padded={false}>
        <div className="px-5 pb-4 flex flex-wrap items-center gap-3">
          <Select value={fReg} onChange={(e) => setFReg(e.target.value)} className="!w-40"><option value="all">All registers</option>{db.registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
          <Select value={fCashier} onChange={(e) => setFCashier(e.target.value)} className="!w-44"><option value="all">All cashiers</option>{db.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          <Select value={fDays} onChange={(e) => setFDays(e.target.value)} className="!w-40"><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></Select>
          <Toggle checked={varianceOnly} onChange={setVarianceOnly} label="Variance only" />
          <div className="flex-1" />
          <span className="text-xs text-slate-400">{shifts.length} shift(s) · total variance <VarianceLabel v={round2(shifts.reduce((a, s) => a + (s.difference ?? 0), 0))} /></span>
        </div>
        <div className="px-2 pb-3">
          <DataTable rows={shifts} columns={cols} pageSize={12} onRowClick={(s) => setShiftId(s.id)} rowClassName={(s) => (s.difference && Math.abs(s.difference) >= 5 ? 'bg-red-50/40' : '')} empty={<EmptyState icon={<Clock size={22} />} title="No shifts match" description="Try widening the date range or clearing filters." />} />
        </div>
      </Card>

      {/* Register drawer */}
      <Drawer open={!!regDrawer} onClose={() => setRegDrawer(null)} title={regDrawer?.id ? 'Edit register' : 'Add register'} footer={<>
        <button className="btn-secondary" onClick={() => setRegDrawer(null)}>Cancel</button>
        <button className="btn-primary" onClick={saveReg}><Save size={15} /> Save</button>
      </>}>
        <div className="flex flex-col gap-4">
          <Field label="Name" required><Input value={regForm.name} onChange={(e) => setRegForm({ ...regForm, name: e.target.value })} autoFocus /></Field>
          <Field label="Location"><Input value={regForm.location} onChange={(e) => setRegForm({ ...regForm, location: e.target.value })} placeholder="Front counter, Repair desk…" /></Field>
          <div>
            <div className="label">Color</div>
            <div className="flex gap-1.5 flex-wrap">{AVATAR_COLORS.map((c) => <button key={c} type="button" onClick={() => setRegForm({ ...regForm, color: c })} className={cx('w-7 h-7 rounded-full border-2 transition-transform', regForm.color === c ? 'border-slate-900 scale-110' : 'border-white')} style={{ background: c }} />)}</div>
          </div>
          <Toggle checked={regForm.active} onChange={(v) => setRegForm({ ...regForm, active: v })} label={<span>Active <span className="text-xs text-slate-400">— inactive registers are hidden from the cashier portal</span></span>} />
          {regDrawer?.id && <div className="text-xs text-slate-500 rounded-lg bg-slate-50 p-3">Customer display URL: <code className="font-mono text-slate-700">/display/{regDrawer.id}</code></div>}
        </div>
      </Drawer>

      <ZReportDrawer shift={detail} onClose={() => setShiftId(null)} />
    </div>
  )
}

function VarianceLabel({ v }: { v?: number }) {
  if (v === undefined || v === null) return <span className="text-slate-300">—</span>
  const abs = Math.abs(v)
  if (abs < 0.01) return <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold tabular-nums"><CheckCircle2 size={12} />{money(0)}</span>
  return <span className={cx('font-semibold tabular-nums', v < 0 ? 'text-red-600' : 'text-emerald-600')}>{v > 0 ? '+' : ''}{money(v)}</span>
}

function ZReportDrawer({ shift, onClose }: { shift?: Shift; onClose: () => void }) {
  const db = useDB((s) => s.db)
  if (!shift) return null
  const reg = db.registers.find((r) => r.id === shift.registerId)
  const u = db.users.find((x) => x.id === shift.userId)
  const txs = db.transactions.filter((t) => t.shiftId === shift.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const ins = shift.cashMovements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0)
  const outs = shift.cashMovements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0)
  const cashRefunds = txs.filter((t) => t.type === 'refund').reduce((a, t) => a + t.payments.filter((p) => p.method === 'cash').reduce((b, p) => b + p.amount, 0), 0)
  const expected = shift.expectedCash ?? round2(shift.openingFloat + shift.cashSales + ins - outs + cashRefunds)
  const byMethod: Record<string, number> = {}
  txs.forEach((t) => { if (t.status === 'voided') return; t.payments.forEach((p) => { byMethod[p.method] = round2((byMethod[p.method] ?? 0) + p.amount) }) })
  const voided = txs.filter((t) => t.status === 'voided')
  const print = () => window.print()
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={<span className="inline-flex items-center gap-2">Z-Report · {reg?.name} <Badge tone={statusTone(shift.status)} dot>{titleCase(shift.status)}</Badge></span>} footer={<>
      <button className="btn-secondary" onClick={print}><Printer size={15} /> Print</button>
      <button className="btn-primary" onClick={onClose}>Close</button>
    </>}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
          {u && <Avatar name={u.name} color={u.color} size={40} />}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-800">{u?.name ?? '—'} <span className="text-slate-400 font-normal">on</span> {reg?.name}</div>
            <div className="text-xs text-slate-500">{fmtDateTime(shift.openedAt)} → {shift.closedAt ? fmtDateTime(shift.closedAt) : 'still open'} · {duration(shift.openedAt, shift.closedAt)}</div>
          </div>
          <div className="text-right"><div className="text-[10px] uppercase tracking-wide text-slate-400">Shift ID</div><div className="text-xs font-mono text-slate-600">{shift.id}</div></div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card title="Sales">
            <KV label="Transactions" value={shift.salesCount} />
            <KV label="Sales total" value={money(shift.salesTotal)} />
            <KV label="Refunds" value={<span className="text-red-600">{shift.refundsCount} · {money(shift.refundsTotal)}</span>} />
            <KV label="Voided" value={voided.length} />
            <div className="border-t border-slate-100 my-1" />
            <KV label={<span className="inline-flex items-center gap-1.5"><Banknote size={13} className="text-emerald-600" />Cash</span>} value={money(shift.cashSales)} />
            <KV label={<span className="inline-flex items-center gap-1.5"><CreditCard size={13} className="text-blue-600" />Card</span>} value={money(shift.cardSales)} />
            <KV label={<span className="inline-flex items-center gap-1.5"><Wallet size={13} className="text-violet-600" />Other</span>} value={money(shift.otherSales)} />
            {Object.keys(byMethod).length > 0 && <div className="text-[11px] text-slate-400 mt-2">By method: {Object.entries(byMethod).map(([m, v]) => `${titleCase(m)} ${money(v)}`).join(' · ')}</div>}
          </Card>
          <Card title="Cash reconciliation">
            <KV label="Opening float" value={money(shift.openingFloat)} />
            <KV label="+ Cash sales" value={money(shift.cashSales)} />
            <KV label="+ Cash in" value={money(ins)} />
            <KV label="− Cash out" value={money(outs)} />
            {cashRefunds !== 0 && <KV label="− Cash refunds" value={money(Math.abs(cashRefunds))} />}
            <div className="border-t border-slate-100 my-1" />
            <KV label="Expected in drawer" value={<b>{money(expected)}</b>} />
            <KV label="Counted" value={shift.closingCount !== undefined ? money(shift.closingCount) : <span className="text-slate-400">not yet counted</span>} />
            <KV label="Variance" value={<VarianceLabel v={shift.difference} />} />
            {shift.difference !== undefined && Math.abs(shift.difference) >= 5 && <div className="mt-2 text-xs rounded-lg bg-red-50 text-red-700 p-2.5 inline-flex items-center gap-1.5"><AlertTriangle size={13} /> Variance exceeds the {money(5)} tolerance — review with the cashier.</div>}
            {shift.notes && <div className="mt-2 text-xs text-slate-600 rounded-lg bg-amber-50 p-2.5"><b>Note:</b> {shift.notes}</div>}
          </Card>
        </div>

        <Card title="Cash movements" subtitle={`${shift.cashMovements.length} movement(s)`}>
          {shift.cashMovements.length ? (
            <div className="divide-y divide-slate-50">
              {shift.cashMovements.map((m) => {
                const mu = db.users.find((x) => x.id === m.userId)
                return (
                  <div key={m.id} className="flex items-center gap-3 py-2">
                    {m.type === 'in' ? <ArrowDownCircle size={18} className="text-emerald-500" /> : <ArrowUpCircle size={18} className="text-red-500" />}
                    <div className="flex-1 min-w-0"><div className="text-sm text-slate-800">{m.reason}</div><div className="text-[11px] text-slate-400">{fmtDateTime(m.createdAt)} · {mu?.name ?? '—'}</div></div>
                    <span className={cx('font-semibold tabular-nums', m.type === 'in' ? 'text-emerald-600' : 'text-red-600')}>{m.type === 'in' ? '+' : '−'}{money(m.amount)}</span>
                  </div>
                )
              })}
            </div>
          ) : <div className="text-sm text-slate-400 text-center py-3">No cash in / out during this shift</div>}
        </Card>

        <Card title="Transactions" subtitle={`${txs.length} in this shift`} padded={false}>
          <div className="max-h-[360px] overflow-y-auto">
            {txs.length ? (
              <table className="table">
                <thead><tr><th>Number</th><th>Time</th><th>Type</th><th className="text-right">Total</th><th>Paid via</th><th></th></tr></thead>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id}>
                      <td className="font-semibold">{t.number}</td>
                      <td className="text-slate-500">{fmtTime(t.createdAt)}</td>
                      <td><Badge tone={statusTone(t.status)} dot>{t.type === 'refund' ? 'Refund' : titleCase(t.status)}</Badge></td>
                      <td className={cx('text-right tabular-nums font-medium', t.total < 0 && 'text-red-600')}>{money(t.total)}</td>
                      <td className="text-xs text-slate-500">{t.payments.map((p) => titleCase(p.method)).join(' + ')}</td>
                      <td className="text-right"><Link to={`/admin/transactions/${t.id}`} className="btn-ghost !px-2 !py-1 text-xs"><ExternalLink size={13} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="text-sm text-slate-400 text-center py-6">No transactions in this shift</div>}
          </div>
        </Card>
      </div>
    </Drawer>
  )
}
