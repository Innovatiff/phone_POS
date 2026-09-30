import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Printer, DoorClosed, Clock, Banknote, CreditCard, Wallet, RotateCcw, Monitor, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { Shift as ShiftT } from '@/lib/types'
import { useDB, useOpenShift } from '@/store/db'
import { hasPerm, useCashierUser, useSession } from '@/store/session'
import { Avatar, Badge, Card, EmptyState, Field, Input, KV, Modal, PageHeader, Segmented, StatCard, Textarea, toast } from '@/components/ui'
import { CASH_DENOMINATIONS, PAYMENT_LABELS } from '@/lib/pos'
import { ago, cx, fmtDateTime, fmtTime, money, round2 } from '@/lib/utils'
import { parseAmount, requestManagerPin } from './shared'

export default function ShiftPage() {
  const user = useCashierUser()!
  const registerId = useSession((s) => s.registerId)!
  const selectRegister = useSession((s) => s.selectRegister)
  const db = useDB((s) => s.db)
  const shift = useOpenShift(registerId)
  const navigate = useNavigate()
  const [closed, setClosed] = useState<ShiftT | undefined>()
  const [movement, setMovement] = useState<'in' | 'out' | undefined>()
  const [closing, setClosing] = useState(false)
  const register = db.registers.find((r) => r.id === registerId)

  const backToRegisters = () => { selectRegister(undefined); navigate('/cashier') }

  if (closed) return <ClosingSummary shift={closed} onBack={backToRegisters} />
  if (!shift) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card><EmptyState icon={<Clock size={22} />} title="No open shift on this register" description="Open a shift from the register selection screen to start selling." action={<button className="btn-primary" onClick={backToRegisters}><Monitor size={15} /> Back to registers</button>} /></Card>
      </div>
    )
  }
  return <OpenShiftPanel shift={shift} onMovement={(t) => setMovement(t)} onClose={() => setClosing(true)} movement={movement} closeMovement={() => setMovement(undefined)} closing={closing} closeClosing={() => setClosing(false)} onClosed={(s) => { setClosing(false); setClosed(s) }} registerName={register?.name ?? ''} userName={user.name} />
}

function shiftCash(shift: ShiftT, cashRefunds: number) {
  const ins = shift.cashMovements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0)
  const outs = shift.cashMovements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0)
  return { ins, outs, expected: round2(shift.openingFloat + shift.cashSales + ins - outs + cashRefunds) }
}

function OpenShiftPanel({ shift, onMovement, onClose, movement, closeMovement, closing, closeClosing, onClosed, registerName, userName }: {
  shift: ShiftT; onMovement: (t: 'in' | 'out') => void; onClose: () => void; movement?: 'in' | 'out'; closeMovement: () => void; closing: boolean; closeClosing: () => void; onClosed: (s: ShiftT) => void; registerName: string; userName: string
}) {
  const user = useCashierUser()!
  const db = useDB((s) => s.db)
  const cashMovement = useDB((s) => s.cashMovement)
  const closeShift = useDB((s) => s.closeShift)
  const opener = db.users.find((u) => u.id === shift.userId)
  const txs = useMemo(() => db.transactions.filter((t) => t.shiftId === shift.id), [db.transactions, shift.id])
  const byMethod = useMemo(() => {
    const m: Record<string, number> = {}
    txs.filter((t) => t.status !== 'voided').forEach((t) => t.payments.forEach((p) => { m[p.method] = round2((m[p.method] ?? 0) + p.amount) }))
    return m
  }, [txs])
  const cashRefunds = txs.filter((t) => t.type === 'refund').reduce((a, t) => a + t.payments.filter((p) => p.method === 'cash').reduce((b, p) => b + p.amount, 0), 0)
  const { ins, outs, expected } = shiftCash(shift, cashRefunds)
  const otherTotal = Object.entries(byMethod).filter(([k]) => k !== 'cash' && k !== 'card').reduce((a, [, v]) => a + Math.max(0, v), 0)
  const hourly = useMemo(() => {
    const start = new Date(shift.openedAt).getHours()
    const now = new Date().getHours()
    const arr: number[] = []
    for (let h = start; h <= now; h++) arr.push(txs.filter((t) => t.type === 'sale' && t.status !== 'voided' && new Date(t.createdAt).getHours() === h).reduce((a, t) => a + t.total, 0))
    return arr
  }, [txs, shift.openedAt])

  const printX = () => {
    const w = window.open('', '_blank', 'width=420,height=720')
    if (!w) { toast.error('Popup blocked'); return }
    const row = (k: string, v: string) => `<div class="r"><span>${k}</span><b>${v}</b></div>`
    const html = `<!doctype html><html><head><title>X report</title><style>body{font-family:ui-monospace,Menlo,monospace;font-size:12px;padding:16px;color:#0f172a}h1{font-size:16px;text-align:center;margin:0 0 4px}h2{font-size:12px;margin:14px 0 6px;border-bottom:1px dashed #cbd5e1;padding-bottom:4px}.r{display:flex;justify-content:space-between;padding:2px 0}.c{text-align:center;color:#64748b}</style></head><body>
      <h1>${db.settings.storeName.toUpperCase()}</h1><div class="c">X REPORT · ${registerName}</div><div class="c">${fmtDateTime(new Date().toISOString())}</div>
      <h2>Shift</h2>${row('Opened', fmtDateTime(shift.openedAt))}${row('Cashier', opener?.name ?? '')}${row('Printed by', userName)}${row('Opening float', money(shift.openingFloat))}
      <h2>Sales</h2>${row('Sales count', String(shift.salesCount))}${row('Sales total', money(shift.salesTotal))}${row('Refunds', `${shift.refundsCount} · ${money(shift.refundsTotal)}`)}${row('Net', money(shift.salesTotal + shift.refundsTotal))}
      <h2>Tenders</h2>${Object.entries(byMethod).map(([k, v]) => row(PAYMENT_LABELS[k] ?? k, money(v))).join('')}
      <h2>Cash drawer</h2>${row('Opening float', money(shift.openingFloat))}${row('Cash sales', money(shift.cashSales))}${row('Cash refunds', money(cashRefunds))}${row('Cash in', money(ins))}${row('Cash out', `-${money(outs)}`)}${row('Expected in drawer', money(expected))}
      ${shift.cashMovements.length ? `<h2>Movements</h2>${shift.cashMovements.map((m) => row(`${fmtTime(m.createdAt)} ${m.type === 'in' ? 'IN' : 'OUT'} · ${m.reason}`, `${m.type === 'in' ? '+' : '-'}${money(m.amount)}`)).join('')}` : ''}
      </body></html>`
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 250)
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Current shift" subtitle={<span className="inline-flex items-center gap-2">{registerName} · opened {fmtTime(shift.openedAt)} ({ago(shift.openedAt)}) by <Avatar name={opener?.name ?? '?'} color={opener?.color} size={18} /> {opener?.name}<Badge tone="green" dot>Open</Badge></span>}
        actions={<>
          <button className="btn-secondary" onClick={() => onMovement('in')}><ArrowDownToLine size={15} /> Cash in</button>
          <button className="btn-secondary" onClick={() => onMovement('out')}><ArrowUpFromLine size={15} /> Cash out</button>
          <button className="btn-secondary" onClick={printX}><Printer size={15} /> Print X report</button>
          <button className="btn-danger" onClick={onClose}><DoorClosed size={15} /> Close shift</button>
        </>} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Sales" value={money(shift.salesTotal)} hint={`${shift.salesCount} transaction${shift.salesCount === 1 ? '' : 's'}`} trend={hourly.length > 1 ? hourly : undefined} color="#2563eb" />
        <StatCard label="Refunds" value={money(Math.abs(shift.refundsTotal))} hint={`${shift.refundsCount} refund${shift.refundsCount === 1 ? '' : 's'}`} color="#ef4444" icon={<RotateCcw size={13} />} />
        <StatCard label="Expected cash" value={money(expected)} hint={`Float ${money(shift.openingFloat)} + cash sales ${money(shift.cashSales)}`} icon={<Banknote size={13} />} />
        <StatCard label="Net takings" value={money(shift.salesTotal + shift.refundsTotal)} hint="Sales minus refunds" color="#22c55e" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card title="Tender breakdown" subtitle="How customers paid this shift">
          <div className="space-y-3">
            <Tender icon={<Banknote size={16} />} color="#22c55e" label="Cash" value={shift.cashSales} total={shift.salesTotal} />
            <Tender icon={<CreditCard size={16} />} color="#2563eb" label="Card" value={shift.cardSales} total={shift.salesTotal} />
            <Tender icon={<Wallet size={16} />} color="#8b5cf6" label="Other (mobile, credit, bank)" value={shift.otherSales} total={shift.salesTotal} />
            <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 space-y-1">
              {Object.entries(byMethod).map(([k, v]) => <div key={k} className="flex justify-between"><span>{PAYMENT_LABELS[k] ?? k}</span><span className={cx('tabular-nums', v < 0 && 'text-red-600')}>{money(v)}</span></div>)}
              {!Object.keys(byMethod).length && <div className="text-slate-400">No payments yet.</div>}
            </div>
          </div>
        </Card>
        <Card title="Cash drawer" subtitle="Expected amount in the drawer right now">
          <div className="text-sm">
            <KV label="Opening float" value={money(shift.openingFloat)} />
            <KV label="Cash sales" value={`+${money(shift.cashSales)}`} />
            {cashRefunds !== 0 && <KV label="Cash refunds" value={<span className="text-red-600">{money(cashRefunds)}</span>} />}
            <KV label="Cash in" value={<span className="text-emerald-600">+{money(ins)}</span>} />
            <KV label="Cash out" value={<span className="text-red-600">−{money(outs)}</span>} />
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-100"><span className="font-semibold text-slate-700">Expected in drawer</span><span className="text-2xl font-bold tabular-nums">{money(expected)}</span></div>
          </div>
        </Card>
        <Card title="Cash movements" subtitle={`${shift.cashMovements.length} this shift`} action={<div className="flex gap-1"><button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => onMovement('in')}><ArrowDownToLine size={13} /> In</button><button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => onMovement('out')}><ArrowUpFromLine size={13} /> Out</button></div>}>
          {shift.cashMovements.length === 0 ? <div className="text-sm text-slate-400 py-6 text-center">No cash in/out yet.</div> : (
            <ul className="divide-y divide-slate-100 -mx-1">
              {[...shift.cashMovements].reverse().map((m) => {
                const by = db.users.find((u) => u.id === m.userId)
                return (
                  <li key={m.id} className="flex items-center gap-3 px-1 py-2 text-sm">
                    <div className={cx('w-8 h-8 rounded-lg flex items-center justify-center', m.type === 'in' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>{m.type === 'in' ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />}</div>
                    <div className="min-w-0 flex-1"><div className="font-medium text-slate-800 truncate">{m.reason}</div><div className="text-xs text-slate-400">{fmtTime(m.createdAt)} · {by?.name ?? '—'}</div></div>
                    <div className={cx('font-semibold tabular-nums', m.type === 'in' ? 'text-emerald-600' : 'text-red-600')}>{m.type === 'in' ? '+' : '−'}{money(m.amount)}</div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Transactions this shift" subtitle={`${txs.length} total`}>
        {txs.length === 0 ? <div className="text-sm text-slate-400 py-4 text-center">Nothing yet — go sell something.</div> : (
          <ul className="divide-y divide-slate-100 -mx-1 max-h-72 overflow-y-auto">
            {[...txs].reverse().map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-1 py-2 text-sm">
                <span className="font-mono text-xs font-semibold text-slate-700 w-24">{t.number}</span>
                <span className="text-xs text-slate-400 w-12">{fmtTime(t.createdAt)}</span>
                <span className="text-slate-600 truncate flex-1">{t.lines.map((l) => `${Math.abs(l.qty)}× ${l.name}`).join(', ')}</span>
                <Badge tone={t.type === 'refund' ? 'purple' : t.status === 'voided' ? 'red' : 'green'}>{t.type === 'refund' ? 'Refund' : t.status === 'voided' ? 'Voided' : t.payments.map((p) => PAYMENT_LABELS[p.method] ?? p.method).join('+')}</Badge>
                <span className={cx('font-semibold tabular-nums w-24 text-right', (t.total < 0 || t.status === 'voided') && 'text-red-600', t.status === 'voided' && 'line-through')}>{money(t.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <CashMovementModal type={movement} onClose={closeMovement} onSubmit={async (amount, reason) => {
        if (!hasPerm(user, 'cash_drawer')) {
          const m = await requestManagerPin('cash_drawer', 'Cash drawer access', `${movement === 'in' ? 'Cash in' : 'Cash out'} of ${money(amount)}`)
          if (!m) return
        }
        cashMovement(shift.id, movement!, amount, reason, user.id)
        toast.success(`${movement === 'in' ? 'Cash in' : 'Cash out'} of ${money(amount)} recorded`)
        closeMovement()
      }} />
      <CloseShiftModal open={closing} onClose={closeClosing} expected={expected} onSubmit={(count, note) => {
        const s = closeShift(shift.id, count, user.id, note || undefined)
        if (!s) { toast.error('Could not close shift'); return }
        toast.success('Shift closed')
        onClosed(s)
      }} />
    </div>
  )
}

function Tender({ icon, color, label, value, total }: { icon: React.ReactNode; color: string; label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="inline-flex items-center gap-2 text-slate-700"><span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}1a`, color }}>{icon}</span>{label}</span>
        <span className="font-semibold tabular-nums">{money(value)} <span className="text-xs text-slate-400 font-normal">{pct.toFixed(0)}%</span></span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  )
}

function CashMovementModal({ type, onClose, onSubmit }: { type?: 'in' | 'out'; onClose: () => void; onSubmit: (amount: number, reason: string) => Promise<void> }) {
  const user = useCashierUser()!
  const settings = useDB((s) => s.db.settings)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const open = !!type
  React.useEffect(() => { if (open) { setAmount(''); setReason('') } }, [open])
  const submit = async () => {
    const n = parseAmount(amount)
    if (n <= 0) { toast.error('Enter an amount'); return }
    if (!reason.trim()) { toast.error('A reason is required'); return }
    setBusy(true)
    await onSubmit(round2(n), reason.trim())
    setBusy(false)
  }
  const presets = type === 'in' ? ['Change from safe', 'Float top-up', 'Petty cash return'] : ['Bank drop', 'Supplier payment', 'Petty cash']
  return (
    <Modal open={open} onClose={onClose} size="sm" title={type === 'in' ? 'Cash in' : 'Cash out'} subtitle={type === 'in' ? 'Add cash to the drawer' : 'Take cash out of the drawer'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className={type === 'in' ? 'btn-success' : 'btn-danger'} disabled={busy} onClick={submit}>{type === 'in' ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />} Record {type === 'in' ? 'cash in' : 'cash out'}</button></>}>
      <div className="space-y-3 pb-2">
        <Field label="Amount">
          <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{settings.currencySymbol}</span><Input autoFocus type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="pl-7 h-12 text-xl font-bold tabular-nums" onKeyDown={(e) => { if (e.key === 'Enter') submit() }} /></div>
        </Field>
        <div className="flex gap-2">{[20, 50, 100, 200].map((v) => <button key={v} type="button" className="btn-secondary flex-1 !px-2" onClick={() => setAmount(String(v))}>{money(v)}</button>)}</div>
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={presets[0]} /></Field>
        <div className="flex flex-wrap gap-1.5">{presets.map((p) => <button key={p} type="button" className="badge bg-slate-100 text-slate-600 hover:bg-slate-200" onClick={() => setReason(p)}>{p}</button>)}</div>
        {!hasPerm(user, 'cash_drawer') && <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">You don't have cash drawer access — a manager PIN will be requested.</div>}
      </div>
    </Modal>
  )
}

function CloseShiftModal({ open, onClose, expected, onSubmit }: { open: boolean; onClose: () => void; expected: number; onSubmit: (count: number, note: string) => void }) {
  const settings = useDB((s) => s.db.settings)
  const [mode, setMode] = useState<'count' | 'amount'>('count')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  React.useEffect(() => { if (open) { setCounts({}); setAmount(''); setNote(''); setMode('count') } }, [open])
  const counted = mode === 'count' ? round2(CASH_DENOMINATIONS.reduce((a, d) => a + d * (parseInt(counts[String(d)] ?? '0', 10) || 0), 0)) : round2(parseAmount(amount))
  const variance = round2(counted - expected)
  const bump = (d: number, delta: number) => setCounts((c) => ({ ...c, [String(d)]: String(Math.max(0, (parseInt(c[String(d)] ?? '0', 10) || 0) + delta)) }))
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Close shift" subtitle="Count the cash in the drawer. The register will be locked afterwards."
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={() => onSubmit(counted, note.trim())}><DoorClosed size={15} /> Close shift with {money(counted)}</button></>}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-5 pb-2">
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="label !mb-0">Cash count</div>
            <Segmented value={mode} onChange={setMode} options={[{ value: 'count', label: 'By denomination' }, { value: 'amount', label: 'Enter total' }]} />
          </div>
          {mode === 'count' ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {CASH_DENOMINATIONS.map((d) => {
                const n = parseInt(counts[String(d)] ?? '0', 10) || 0
                return (
                  <div key={d} className="flex items-center gap-2 text-sm">
                    <span className="w-16 font-semibold text-slate-700 tabular-nums">{d >= 1 ? `${settings.currencySymbol}${d}` : `${Math.round(d * 100)}¢`}</span>
                    <button type="button" className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-base leading-none" onClick={() => bump(d, -1)}>−</button>
                    <input type="number" min={0} value={counts[String(d)] ?? ''} onChange={(e) => setCounts({ ...counts, [String(d)]: e.target.value })} placeholder="0" className="input !w-16 !px-2 !py-1 text-center tabular-nums" />
                    <button type="button" className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-base leading-none" onClick={() => bump(d, 1)}>+</button>
                    <span className="ml-auto text-slate-500 tabular-nums text-xs">{n > 0 ? money(d * n) : ''}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="relative max-w-xs"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{settings.currencySymbol}</span><Input autoFocus type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="pl-7 h-12 text-xl font-bold tabular-nums" /></div>
          )}
          <Field label="Closing note (optional)" className="mt-4"><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[56px]" placeholder="e.g. $20 short — customer disputed change" /></Field>
        </div>
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-sm">
          <KV label="Expected" value={money(expected)} />
          <KV label="Counted" value={<span className="text-lg font-bold">{money(counted)}</span>} />
          <div className={cx('mt-3 rounded-xl px-3 py-3 text-center', Math.abs(variance) < 0.005 ? 'bg-emerald-50 text-emerald-700' : Math.abs(variance) >= 5 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')}>
            <div className="text-[11px] font-semibold uppercase tracking-wider">Variance</div>
            <div className="text-2xl font-bold tabular-nums">{variance > 0 ? '+' : ''}{money(variance)}</div>
            <div className="text-xs mt-0.5">{Math.abs(variance) < 0.005 ? 'Drawer balances' : variance > 0 ? 'Surplus' : 'Shortage'}</div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ClosingSummary({ shift, onBack }: { shift: ShiftT; onBack: () => void }) {
  const db = useDB((s) => s.db)
  const reg = db.registers.find((r) => r.id === shift.registerId)
  const diff = shift.difference ?? 0
  const ok = Math.abs(diff) < 5
  return (
    <div className="max-w-2xl mx-auto fade-up">
      <Card>
        <div className="flex flex-col items-center text-center">
          <div className={cx('w-16 h-16 rounded-full flex items-center justify-center', ok ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600')}>{ok ? <CheckCircle2 size={34} /> : <AlertTriangle size={34} />}</div>
          <div className="text-2xl font-bold text-slate-900 mt-4">Shift closed</div>
          <div className="text-sm text-slate-500 mt-1">{reg?.name} · {fmtDateTime(shift.openedAt)} → {fmtDateTime(shift.closedAt)}</div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 mt-6 text-sm">
          <KV label="Sales" value={`${shift.salesCount} · ${money(shift.salesTotal)}`} />
          <KV label="Refunds" value={`${shift.refundsCount} · ${money(Math.abs(shift.refundsTotal))}`} />
          <KV label="Cash sales" value={money(shift.cashSales)} />
          <KV label="Card sales" value={money(shift.cardSales)} />
          <KV label="Other" value={money(shift.otherSales)} />
          <KV label="Opening float" value={money(shift.openingFloat)} />
          <KV label="Expected cash" value={money(shift.expectedCash ?? 0)} />
          <KV label="Counted" value={money(shift.closingCount ?? 0)} />
        </div>
        <div className={cx('mt-4 rounded-xl px-4 py-3 flex items-center justify-between', Math.abs(diff) < 0.005 ? 'bg-emerald-50 text-emerald-700' : ok ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')}>
          <span className="font-medium">Variance</span><span className="text-2xl font-bold tabular-nums">{diff > 0 ? '+' : ''}{money(diff)}</span>
        </div>
        {shift.notes && <div className="mt-3 text-xs text-slate-500">Note: {shift.notes}</div>}
        <div className="mt-6 flex justify-center"><button className="btn-primary h-11 px-6" onClick={onBack}><Monitor size={16} /> Back to registers</button></div>
      </Card>
    </div>
  )
}
