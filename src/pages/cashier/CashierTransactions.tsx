import React, { useEffect, useMemo, useState } from 'react'
import { Printer, RotateCcw, Ban, Search, Receipt as ReceiptIcon, Minus, Plus } from 'lucide-react'
import type { PaymentMethod, Transaction } from '@/lib/types'
import { useDB } from '@/store/db'
import { hasPerm, useCashierUser, useSession } from '@/store/session'
import { Avatar, Badge, Card, DataTable, Drawer, EmptyState, Field, Input, KV, Modal, PageHeader, Segmented, Select, Textarea, Toggle, confirm, statusTone, toast, type Column } from '@/components/ui'
import { Receipt, printReceipt } from '@/components/Receipt'
import { PAYMENT_LABELS } from '@/lib/pos'
import { cx, daysAgo, fmtDateTime, fmtTime, money, sameDay, titleCase } from '@/lib/utils'
import { requestManagerPin } from './shared'

type Range = 'today' | 'week' | 'all'

export default function CashierTransactions() {
  const user = useCashierUser()!
  const registerId = useSession((s) => s.registerId)!
  const db = useDB((s) => s.db)
  const [range, setRange] = useState<Range>('today')
  const [allRegisters, setAllRegisters] = useState(false)
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [refunding, setRefunding] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const since = range === 'today' ? null : range === 'week' ? daysAgo(7).getTime() : null
    const now = new Date()
    return db.transactions
      .filter((t) => allRegisters || t.registerId === registerId)
      .filter((t) => (range === 'today' ? sameDay(t.createdAt, now) : since ? new Date(t.createdAt).getTime() >= since : true))
      .filter((t) => {
        if (!needle) return true
        const cust = t.customerId ? db.customers.find((c) => c.id === t.customerId) : undefined
        return t.number.toLowerCase().includes(needle) || (cust?.name.toLowerCase().includes(needle) ?? false) || (cust?.phone.includes(needle) ?? false) || t.lines.some((l) => (l.serial ?? '').includes(needle) || l.name.toLowerCase().includes(needle))
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [db.transactions, db.customers, allRegisters, registerId, range, q])

  const selected = selectedId ? db.transactions.find((t) => t.id === selectedId) : undefined
  const summary = useMemo(() => {
    const sales = rows.filter((t) => t.type === 'sale' && t.status !== 'voided')
    const refunds = rows.filter((t) => t.type === 'refund')
    return { count: sales.length, total: sales.reduce((a, t) => a + t.total, 0), refunds: refunds.reduce((a, t) => a + Math.abs(t.total), 0) }
  }, [rows])

  const columns: Column<Transaction>[] = [
    { key: 'number', header: 'Number', render: (t) => <span className="font-mono text-xs font-semibold text-slate-800">{t.number}</span>, sortValue: (t) => t.number },
    { key: 'time', header: 'Time', render: (t) => <span className="text-slate-600">{range === 'today' ? fmtTime(t.createdAt) : fmtDateTime(t.createdAt)}</span>, sortValue: (t) => t.createdAt },
    { key: 'cashier', header: 'Cashier', render: (t) => { const u = db.users.find((x) => x.id === t.userId); return u ? <span className="inline-flex items-center gap-1.5"><Avatar name={u.name} color={u.color} size={22} /> <span className="text-slate-700">{u.name.split(' ')[0]}</span></span> : '—' } },
    { key: 'customer', header: 'Customer', render: (t) => <span className="text-slate-600">{t.customerId ? db.customers.find((c) => c.id === t.customerId)?.name ?? '—' : <span className="text-slate-400">Walk-in</span>}</span> },
    { key: 'items', header: 'Items', render: (t) => <span className="text-slate-600">{t.lines.reduce((a, l) => a + Math.abs(l.qty), 0)} <span className="text-slate-400 text-xs">· {t.lines.map((l) => l.emoji).slice(0, 4).join(' ')}</span></span> },
    { key: 'payment', header: 'Payment', render: (t) => <span className="text-slate-600 text-xs">{t.payments.map((p) => PAYMENT_LABELS[p.method] ?? p.method).join(' + ')}</span> },
    { key: 'total', header: 'Total', align: 'right', render: (t) => <span className={cx('font-semibold tabular-nums', t.total < 0 && 'text-red-600')}>{money(t.total)}</span>, sortValue: (t) => t.total },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={t.type === 'refund' ? 'purple' : statusTone(t.status)}>{t.type === 'refund' ? 'Refund' : titleCase(t.status)}</Badge> },
  ]

  const canVoid = (t: Transaction) => t.type === 'sale' && t.status === 'completed' && sameDay(t.createdAt, new Date()) && !t.lines.some((l) => l.refundedQty > 0)
  const canRefund = (t: Transaction) => t.type === 'sale' && (t.status === 'completed' || t.status === 'partially_refunded')

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Transactions" subtitle={`${summary.count} sale${summary.count === 1 ? '' : 's'} · ${money(summary.total)}${summary.refunds > 0 ? ` · refunds ${money(summary.refunds)}` : ''}`}
        actions={<>
          <Segmented value={range} onChange={setRange} size="md" options={[{ value: 'today', label: 'Today' }, { value: 'week', label: '7 days' }, { value: 'all', label: 'All' }]} />
          <Toggle checked={allRegisters} onChange={setAllRegisters} label="All registers" />
        </>} />
      <Card padded={false}>
        <div className="px-5 pt-4 pb-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, customer, IMEI or product…" className="input pl-9" /></div>
        </div>
        <div className="px-2 pb-2">
          <DataTable rows={rows} columns={columns} pageSize={20} onRowClick={(t) => setSelectedId(t.id)} empty={<EmptyState icon={<ReceiptIcon size={22} />} title="No transactions" description={range === 'today' ? 'Nothing sold on this register today yet.' : 'No transactions match your filters.'} />} />
        </div>
      </Card>

      <Drawer open={!!selected} onClose={() => setSelectedId(undefined)} width="max-w-xl" title={selected ? <span className="inline-flex items-center gap-2">{selected.number} <Badge tone={selected.type === 'refund' ? 'purple' : statusTone(selected.status)}>{selected.type === 'refund' ? 'Refund' : titleCase(selected.status)}</Badge></span> : ''}
        footer={selected && (
          <>
            <button className="btn-secondary mr-auto" onClick={printReceipt}><Printer size={15} /> Reprint</button>
            {canVoid(selected) && <button className="btn-secondary text-red-600" onClick={() => setVoiding(true)}><Ban size={15} /> Void</button>}
            {canRefund(selected) && <button className="btn-primary" onClick={() => setRefunding(true)}><RotateCcw size={15} /> Refund</button>}
          </>
        )}>
        {selected && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-x-6 text-sm">
              <KV label="Date" value={fmtDateTime(selected.createdAt)} />
              <KV label="Register" value={db.registers.find((r) => r.id === selected.registerId)?.name ?? '—'} />
              <KV label="Cashier" value={db.users.find((u) => u.id === selected.userId)?.name ?? '—'} />
              <KV label="Customer" value={selected.customerId ? db.customers.find((c) => c.id === selected.customerId)?.name ?? '—' : 'Walk-in'} />
              <KV label="Payment" value={selected.payments.map((p) => `${PAYMENT_LABELS[p.method] ?? p.method}${p.cardLast4 ? ` •••• ${p.cardLast4}` : ''} ${money(p.amount)}`).join(', ')} />
              {selected.change > 0 && <KV label="Change" value={money(selected.change)} />}
              {selected.refundOf && <KV label="Refund of" value={db.transactions.find((t) => t.id === selected.refundOf)?.number ?? '—'} />}
              {selected.voidReason && <KV label="Void reason" value={selected.voidReason} />}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Lines</div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {selected.lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-lg">{l.emoji}</div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 truncate">{l.name}</div>
                      <div className="text-xs text-slate-500">{Math.abs(l.qty)} × {money(l.unitPrice)}{l.serial ? <span className="font-mono ml-1.5 text-slate-400">IMEI {l.serial}</span> : null}{l.refundedQty > 0 && <span className="ml-1.5 text-amber-600">· {l.refundedQty} refunded</span>}</div>
                    </div>
                    <div className="font-semibold tabular-nums">{money(l.lineTotal)}</div>
                  </li>
                ))}
              </ul>
            </div>
            {db.transactions.some((t) => t.refundOf === selected.id) && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Refunds</div>
                <ul className="space-y-1 text-sm">
                  {db.transactions.filter((t) => t.refundOf === selected.id).map((r) => <li key={r.id} className="flex justify-between"><button className="text-brand-600 font-mono text-xs" onClick={() => setSelectedId(r.id)}>{r.number}</button><span className="text-slate-500">{fmtDateTime(r.createdAt)}</span><span className="text-red-600 font-medium tabular-nums">{money(r.total)}</span></li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-center"><Receipt tx={selected} compact /></div>
          </div>
        )}
      </Drawer>

      {selected && refunding && <RefundModal tx={selected} registerId={registerId} onClose={() => setRefunding(false)} onDone={(r) => { setRefunding(false); setSelectedId(r.id) }} />}
      {selected && voiding && <VoidModal tx={selected} onClose={() => setVoiding(false)} onDone={() => setVoiding(false)} />}
    </div>
  )
}

// ─── Refund ──────────────────────────────────────────────────────────────────
function RefundModal({ tx, registerId, onClose, onDone }: { tx: Transaction; registerId: string; onClose: () => void; onDone: (r: Transaction) => void }) {
  const user = useCashierUser()!
  const settings = useDB((s) => s.db.settings)
  const customer = useDB((s) => (tx.customerId ? s.db.customers.find((c) => c.id === tx.customerId) : undefined))
  const refund = useDB((s) => s.refund)
  const [lines, setLines] = useState(() => tx.lines.map((l) => ({ lineId: l.id, qty: 0, restock: true, max: l.qty - l.refundedQty })))
  const [method, setMethod] = useState<PaymentMethod>(tx.payments[0]?.method === 'store_credit' ? 'store_credit' : tx.payments[0]?.method ?? 'cash')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (method === 'store_credit' && !customer) setMethod('cash') }, [method, customer])

  const amount = lines.reduce((a, r) => { const ol = tx.lines.find((l) => l.id === r.lineId)!; return a + (ol.lineTotal / ol.qty) * r.qty }, 0)
  const setQty = (id: string, qty: number) => setLines(lines.map((r) => (r.lineId === id ? { ...r, qty: Math.max(0, Math.min(r.max, qty)) } : r)))

  const submit = async () => {
    if (busy) return
    if (!lines.some((r) => r.qty > 0)) { toast.error('Select at least one item to refund'); return }
    if (!reason.trim()) { toast.error('A reason is required'); return }
    let approvedBy: string | undefined
    if (settings.requireManagerForRefund && !hasPerm(user, 'refund')) {
      const m = await requestManagerPin('refund', 'Refund approval', `Refund ${money(amount)} on ${tx.number}`)
      if (!m) return
      approvedBy = m.id
    }
    setBusy(true)
    const res = refund({ transactionId: tx.id, registerId, userId: user.id, approvedBy, lines: lines.filter((r) => r.qty > 0).map(({ lineId, qty, restock }) => ({ lineId, qty, restock })), method, reason: reason.trim() })
    setBusy(false)
    if (!res.ok || !res.transaction) { toast.error(res.message ?? 'Refund failed'); return }
    toast.success(`Refunded ${money(Math.abs(res.transaction.total))} · ${res.transaction.number}`)
    onDone(res.transaction)
  }

  return (
    <Modal open onClose={onClose} size="md" title={`Refund ${tx.number}`} subtitle="Pick the items and quantities to return"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-danger" disabled={busy || amount <= 0} onClick={submit}><RotateCcw size={15} /> Refund {money(amount)}</button></>}>
      <div className="space-y-4 pb-2">
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {lines.map((r) => {
            const ol = tx.lines.find((l) => l.id === r.lineId)!
            return (
              <li key={r.lineId} className={cx('flex items-center gap-3 px-3 py-2 text-sm', r.max === 0 && 'opacity-50')}>
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-lg">{ol.emoji}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-800 truncate">{ol.name}</div>
                  <div className="text-xs text-slate-500">{money(ol.lineTotal / ol.qty)} each · {r.max} of {ol.qty} refundable{ol.serial ? <span className="font-mono ml-1 text-slate-400">· {ol.serial}</span> : null}</div>
                  {r.qty > 0 && <div className="mt-1"><Toggle checked={r.restock} onChange={(v) => setLines(lines.map((x) => (x.lineId === r.lineId ? { ...x, restock: v } : x)))} label={<span className="text-xs">Return to stock</span>} /></div>}
                </div>
                <div className="flex items-center gap-1">
                  <button className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center disabled:opacity-40" disabled={r.qty <= 0} onClick={() => setQty(r.lineId, r.qty - 1)}><Minus size={14} /></button>
                  <span className="w-7 text-center font-semibold tabular-nums">{r.qty}</span>
                  <button className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center disabled:opacity-40" disabled={r.qty >= r.max} onClick={() => setQty(r.lineId, r.qty + 1)}><Plus size={14} /></button>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="flex justify-end"><button className="text-xs text-brand-600 font-medium" onClick={() => setLines(lines.map((r) => ({ ...r, qty: r.max })))}>Refund everything</button></div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Refund method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              <option value="cash">Cash</option><option value="card">Card</option><option value="mobile">Mobile Pay</option>{customer && <option value="store_credit">Store credit ({customer.name.split(' ')[0]})</option>}<option value="bank_transfer">Bank transfer</option>
            </Select>
          </Field>
          <Field label="Amount"><div className="input bg-slate-50 font-semibold tabular-nums text-red-600">−{money(amount)}</div></Field>
        </div>
        <Field label="Reason" required><Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Faulty on arrival, changed mind, wrong model…" className="min-h-[64px]" /></Field>
        {settings.requireManagerForRefund && !hasPerm(user, 'refund') && <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">A manager PIN will be requested to approve this refund.</div>}
      </div>
    </Modal>
  )
}

// ─── Void ────────────────────────────────────────────────────────────────────
function VoidModal({ tx, onClose, onDone }: { tx: Transaction; onClose: () => void; onDone: () => void }) {
  const user = useCashierUser()!
  const settings = useDB((s) => s.db.settings)
  const voidTransaction = useDB((s) => s.voidTransaction)
  const [reason, setReason] = useState('')
  const submit = async () => {
    if (!reason.trim()) { toast.error('A reason is required'); return }
    let approvedBy: string | undefined
    if (settings.requireManagerForVoid && !hasPerm(user, 'void')) {
      const m = await requestManagerPin('void', 'Void approval', `Void ${tx.number} for ${money(tx.total)}`)
      if (!m) return
      approvedBy = m.id
    }
    if (!(await confirm('Void this sale?', `${tx.number} for ${money(tx.total)} will be voided and stock returned. This cannot be undone.`, { danger: true, confirmLabel: 'Void sale' }))) return
    const res = voidTransaction(tx.id, user.id, reason.trim(), approvedBy)
    if (!res.ok) { toast.error(res.message ?? 'Void failed'); return }
    toast.success(`${tx.number} voided`)
    onDone()
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Void ${tx.number}`} subtitle="Only same-day sales without refunds can be voided"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={submit}><Ban size={15} /> Void {money(tx.total)}</button></>}>
      <div className="space-y-3 pb-2">
        <Field label="Reason" required><Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rang up the wrong item, customer walked away…" className="min-h-[64px]" /></Field>
        {settings.requireManagerForVoid && !hasPerm(user, 'void') && <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">A manager PIN will be requested to approve this void.</div>}
      </div>
    </Modal>
  )
}
