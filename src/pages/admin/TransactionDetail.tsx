import React, { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, RotateCcw, Ban, Mail, ExternalLink, Activity, Boxes, User as UserIcon, Monitor, Clock, StickyNote, Link2 } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import { Avatar, Badge, Card, EmptyState, Field, Input, KV, Modal, Money, PageHeader, Select, Textarea, Toggle, confirm, statusTone, toast } from '@/components/ui'
import { Receipt, printReceipt } from '@/components/Receipt'
import { ago, fmtDateTime, money, round2, titleCase, cx } from '@/lib/utils'
import { PAYMENT_LABELS } from '@/lib/pos'
import type { PaymentMethod, TransactionLine } from '@/lib/types'

const methodTone = (m: string) => (m === 'cash' ? 'green' : m === 'card' ? 'blue' : m === 'mobile' ? 'purple' : m === 'store_credit' ? 'amber' : m === 'gift_card' ? 'pink' : 'cyan') as 'green' | 'blue' | 'purple' | 'amber' | 'pink' | 'cyan'
const typeTone = (t: string) => (t === 'sale' ? 'blue' : t === 'refund' ? 'red' : t === 'exchange' ? 'purple' : 'slate') as 'blue' | 'red' | 'purple' | 'slate'

export default function TransactionDetail() {
  const { id } = useParams<{ id: string }>()
  const db = useDB((s) => s.db)
  const refund = useDB((s) => s.refund)
  const voidTransaction = useDB((s) => s.voidTransaction)
  const admin = useAdminUser()!
  const navigate = useNavigate()
  const tx = db.transactions.find((t) => t.id === id)
  const [refundOpen, setRefundOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [voidReason, setVoidReason] = useState('')

  const rel = useMemo(() => {
    if (!tx) return undefined
    return {
      register: db.registers.find((r) => r.id === tx.registerId),
      cashier: db.users.find((u) => u.id === tx.userId),
      customer: tx.customerId ? db.customers.find((c) => c.id === tx.customerId) : undefined,
      shift: tx.shiftId ? db.shifts.find((s) => s.id === tx.shiftId) : undefined,
      original: tx.refundOf ? db.transactions.find((t) => t.id === tx.refundOf) : undefined,
      refunds: db.transactions.filter((t) => t.refundOf === tx.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      activity: db.activity.filter((a) => a.entityId === tx.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      movements: db.stockMovements.filter((m) => m.refId === tx.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }
  }, [db, tx])

  if (!tx || !rel) {
    return (
      <div>
        <PageHeader title="Transaction not found" subtitle="This transaction may have been removed when demo data was reset." />
        <Card><EmptyState title="Nothing here" action={<Link to="/admin/transactions" className="btn-secondary"><ArrowLeft size={14} /> Back to transactions</Link>} /></Card>
      </div>
    )
  }

  const refundable = tx.type === 'sale' && tx.status !== 'voided' && tx.status !== 'refunded' && tx.lines.some((l) => l.qty - l.refundedQty > 0)
  const voidable = tx.type === 'sale' && tx.status === 'completed' && !tx.lines.some((l) => l.refundedQty > 0)
  const refundedTotal = rel.refunds.reduce((a, t) => a + Math.abs(t.total), 0)
  const net = tx.total - tx.taxTotal
  const margin = net ? ((net - tx.costTotal) / net) * 100 : 0
  const promoDiscount = tx.promoCode ? Math.max(0, tx.discountTotal - tx.lines.reduce((a, l) => a + l.discountAmount, 0)) : 0

  const doVoid = async () => {
    if (!voidReason.trim()) { toast.error('Please give a reason for the void'); return }
    const ok = await confirm('Void this sale?', `${tx.number} for ${money(tx.total)} will be marked as voided and all items returned to stock. This cannot be undone.`, { danger: true, confirmLabel: 'Void sale' })
    if (!ok) return
    const res = voidTransaction(tx.id, admin.id, voidReason.trim(), admin.id)
    if (res.ok) { toast.success(`${tx.number} voided`); setVoidOpen(false); setVoidReason('') }
    else toast.error(res.message ?? 'Could not void transaction')
  }

  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-3 flex-wrap">{tx.number}<Badge tone={typeTone(tx.type)}>{titleCase(tx.type)}</Badge><Badge tone={statusTone(tx.status)} dot>{titleCase(tx.status)}</Badge></span>}
        subtitle={<span className="flex items-center gap-2 flex-wrap"><Link to="/admin/transactions" className="inline-flex items-center gap-1 text-brand-700 hover:underline"><ArrowLeft size={13} /> All transactions</Link><span className="text-slate-300">·</span>{fmtDateTime(tx.createdAt)} ({ago(tx.createdAt)})</span>}
        actions={<>
          <button className="btn-secondary" onClick={() => toast.info(rel.customer?.email ? `Receipt emailed to ${rel.customer.email}` : 'Receipt queued — no customer email on file')}><Mail size={15} /> Email receipt</button>
          <button className="btn-secondary" onClick={printReceipt}><Printer size={15} /> Print</button>
          {refundable && <button className="btn-primary" onClick={() => setRefundOpen(true)}><RotateCcw size={15} /> Refund…</button>}
          {voidable && <button className="btn-danger" onClick={() => setVoidOpen(true)}><Ban size={15} /> Void</button>}
        </>}
      />

      {tx.status === 'voided' && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2"><Ban size={16} /> This sale was voided {fmtDateTime(tx.voidedAt)}{tx.voidReason ? ` — ${tx.voidReason}` : ''}. Stock has been returned.</div>
      )}
      {rel.original && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2 flex-wrap"><RotateCcw size={16} /> This is a refund of <Link to={`/admin/transactions/${rel.original.id}`} className="font-semibold underline">{rel.original.number}</Link> ({money(rel.original.total)}, {fmtDateTime(rel.original.createdAt)}).{tx.note ? ` Reason: ${tx.note}` : ''}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <Card title="Line items" subtitle={`${tx.lines.reduce((a, l) => a + Math.abs(l.qty), 0)} items · ${tx.lines.length} lines`} padded={false}>
            <div className="overflow-x-auto pb-2">
              <table className="table">
                <thead><tr><th>Product</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Discount</th><th className="text-right">Tax</th><th className="text-right">Total</th>{tx.type === 'sale' && <th className="text-right">Refunded</th>}</tr></thead>
                <tbody>
                  {tx.lines.map((l) => <LineRow key={l.id} line={l} showRefunded={tx.type === 'sale'} />)}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Totals">
              <KV label="Subtotal" value={money(tx.subtotal)} />
              {tx.discountTotal !== 0 && <KV label={<>Discounts{tx.cartDiscount ? <span className="text-slate-400"> (cart {tx.cartDiscount.type === 'percent' ? `${tx.cartDiscount.value}%` : money(tx.cartDiscount.value)})</span> : null}</>} value={<span className="text-red-600">-{money(Math.abs(tx.discountTotal))}</span>} />}
              {tx.promoCode && <KV label={<span className="flex items-center gap-1.5">Promo code <Badge tone="purple">{tx.promoCode}</Badge></span>} value={promoDiscount ? `-${money(promoDiscount)}` : 'applied'} />}
              <KV label={`${db.settings.taxName} (${db.settings.taxRate}%)`} value={money(tx.taxTotal)} />
              <div className="flex items-center justify-between py-2 border-t border-slate-100 mt-1">
                <span className="font-semibold text-slate-800">Total</span>
                <span className={cx('text-xl font-bold tabular-nums', tx.total < 0 ? 'text-red-600' : 'text-slate-900')}>{money(tx.total)}</span>
              </div>
              <div className="border-t border-slate-100 pt-2 mt-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Payments</div>
                {tx.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="flex items-center gap-2"><Badge tone={methodTone(p.method)}>{PAYMENT_LABELS[p.method] ?? p.method}</Badge>{p.cardLast4 && <span className="text-slate-500">•••• {p.cardLast4}</span>}{p.reference && <span className="text-slate-400 text-xs">{p.reference}</span>}</span>
                    <span className="font-medium tabular-nums">{money(p.amount)}{p.tendered && p.tendered !== p.amount ? <span className="text-slate-400 text-xs"> (tendered {money(p.tendered)})</span> : null}</span>
                  </div>
                ))}
                {tx.change > 0 && <KV label="Change given" value={money(tx.change)} />}
              </div>
              {(tx.loyaltyEarned > 0 || tx.loyaltyRedeemed > 0) && (
                <div className="border-t border-slate-100 pt-2 mt-1">
                  {tx.loyaltyEarned > 0 && <KV label="Loyalty points earned" value={<span className="text-emerald-600">+{tx.loyaltyEarned}</span>} />}
                  {tx.loyaltyRedeemed > 0 && <KV label="Loyalty points redeemed" value={<span className="text-red-600">-{tx.loyaltyRedeemed} ({money(tx.loyaltyRedeemed * db.settings.loyaltyPointValue)})</span>} />}
                </div>
              )}
              <div className="border-t border-slate-100 pt-2 mt-1">
                <KV label="Cost of goods" value={money(tx.costTotal)} />
                <KV label="Gross margin" value={<span className={margin >= 0 ? 'text-emerald-600' : 'text-red-600'}>{money(net - tx.costTotal)} ({margin.toFixed(1)}%)</span>} />
                {refundedTotal > 0 && <KV label="Refunded so far" value={<span className="text-red-600">-{money(refundedTotal)}</span>} />}
              </div>
            </Card>

            <Card title="Details">
              <MetaRow icon={<Monitor size={14} />} label="Register" value={<span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: rel.register?.color ?? '#94a3b8' }} />{rel.register?.name ?? tx.registerId}<span className="text-slate-400 text-xs">· {rel.register?.location}</span></span>} />
              <MetaRow icon={<UserIcon size={14} />} label="Cashier" value={rel.cashier ? <span className="inline-flex items-center gap-2"><Avatar name={rel.cashier.name} color={rel.cashier.color} size={22} />{rel.cashier.name}<span className="text-xs text-slate-400 capitalize">· {rel.cashier.role}</span></span> : '—'} />
              <MetaRow icon={<UserIcon size={14} />} label="Customer" value={rel.customer ? <Link to={`/admin/customers/${rel.customer.id}`} className="text-brand-700 hover:underline inline-flex items-center gap-1">{rel.customer.name} <ExternalLink size={12} /></Link> : <span className="text-slate-400">Walk-in</span>} />
              <MetaRow icon={<Clock size={14} />} label="Shift" value={rel.shift ? <Link to="/admin/registers" className="text-brand-700 hover:underline inline-flex items-center gap-1">{fmtDateTime(rel.shift.openedAt)} <Badge tone={statusTone(rel.shift.status)}>{rel.shift.status}</Badge></Link> : <span className="text-slate-400">No shift</span>} />
              <MetaRow icon={<Clock size={14} />} label="Created" value={`${fmtDateTime(tx.createdAt)} · ${ago(tx.createdAt)}`} />
              {tx.note && <MetaRow icon={<StickyNote size={14} />} label="Note" value={tx.note} />}
              {tx.voidedAt && <MetaRow icon={<Ban size={14} />} label="Voided" value={`${fmtDateTime(tx.voidedAt)}${tx.voidReason ? ` — ${tx.voidReason}` : ''}`} />}
              {rel.original && <MetaRow icon={<Link2 size={14} />} label="Refund of" value={<Link to={`/admin/transactions/${rel.original.id}`} className="text-brand-700 hover:underline">{rel.original.number}</Link>} />}
              {rel.refunds.length > 0 && (
                <div className="pt-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Linked refunds</div>
                  {rel.refunds.map((r) => (
                    <Link key={r.id} to={`/admin/transactions/${r.id}`} className="flex items-center justify-between py-1.5 text-sm rounded-lg hover:bg-slate-50 -mx-1 px-1">
                      <span className="text-brand-700 font-medium">{r.number}<span className="text-slate-400 font-normal text-xs"> · {fmtDateTime(r.createdAt)}</span></span>
                      <Money value={r.total} />
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Activity" subtitle="Everything logged against this transaction" action={<Activity size={16} className="text-slate-400" />}>
              {rel.activity.length === 0 ? <div className="text-sm text-slate-400 py-2">No activity recorded.</div> : (
                <ol className="relative border-l border-slate-200 ml-2">
                  {rel.activity.map((a) => (
                    <li key={a.id} className="ml-4 pb-4 last:pb-0">
                      <span className={cx('absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-white', a.severity === 'critical' ? 'bg-red-500' : a.severity === 'warning' ? 'bg-amber-500' : 'bg-brand-500')} />
                      <div className="flex items-center gap-2 flex-wrap"><Badge tone={statusTone(a.severity)}>{a.action}</Badge><span className="text-[11px] text-slate-400">{fmtDateTime(a.createdAt)}</span></div>
                      <div className="text-sm text-slate-700 mt-1">{a.description}</div>
                      <div className="text-xs text-slate-400 mt-0.5">by {a.userName}</div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <Card title="Stock movements" subtitle="Inventory changes caused by this transaction" action={<Boxes size={16} className="text-slate-400" />}>
              {rel.movements.length === 0 ? <div className="text-sm text-slate-400 py-2">No stock movements.</div> : (
                <div className="flex flex-col divide-y divide-slate-100">
                  {rel.movements.map((m) => {
                    const p = db.products.find((x) => x.id === m.productId)
                    return (
                      <div key={m.id} className="py-2 flex items-center gap-3 text-sm">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-base shrink-0">{p?.emoji ?? '📦'}</div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-slate-800 truncate">{p?.name ?? m.productId}</div>
                          <div className="text-[11px] text-slate-400">{titleCase(m.type)} · {m.before} → {m.after}{m.serial ? ` · ${m.serial}` : ''}{m.reason ? ` · ${m.reason}` : ''}</div>
                        </div>
                        <span className={cx('font-semibold tabular-nums', m.qty > 0 ? 'text-emerald-600' : m.qty < 0 ? 'text-red-600' : 'text-slate-400')}>{m.qty > 0 ? '+' : ''}{m.qty}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Receipt" action={<button className="btn-secondary !px-2.5 !py-1 !text-xs" onClick={printReceipt}><Printer size={12} /> Print</button>}>
            <Receipt tx={tx} compact />
          </Card>
        </div>
      </div>

      {refundOpen && <RefundModal txId={tx.id} onClose={() => setRefundOpen(false)} onDone={(newId) => { setRefundOpen(false); navigate(`/admin/transactions/${newId}`) }} refund={refund} adminId={admin.id} />}

      <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title={`Void ${tx.number}`} subtitle="Cancel this sale entirely and return all items to stock." size="sm"
        footer={<><button className="btn-secondary" onClick={() => setVoidOpen(false)}>Cancel</button><button className="btn-danger" onClick={doVoid}><Ban size={14} /> Void sale</button></>}>
        <Field label="Reason" required><Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Rang up by mistake, customer changed their mind…" autoFocus /></Field>
        <div className="text-xs text-slate-400 mt-2 pb-2">Voids are logged with your name ({admin.name}) and raise an alert for review.</div>
      </Modal>
    </div>
  )
}

function LineRow({ line: l, showRefunded }: { line: TransactionLine; showRefunded: boolean }) {
  const remaining = l.qty - l.refundedQty
  return (
    <tr className={cx(showRefunded && remaining <= 0 && l.qty > 0 && 'opacity-60')}>
      <td>
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-xl shrink-0">{l.emoji}</div>
          <div className="min-w-0">
            <Link to={`/admin/catalog/${l.productId}`} className="font-medium text-slate-800 hover:text-brand-700 block truncate max-w-[280px]">{l.name}</Link>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap">{l.sku}{l.serial && <span className="font-mono bg-slate-100 rounded px-1">{l.serial}</span>}{l.discount?.reason && <span>· {l.discount.reason}</span>}</div>
          </div>
        </div>
      </td>
      <td className="text-right tabular-nums">{l.qty}</td>
      <td className="text-right tabular-nums">{money(l.unitPrice)}{l.unitPrice !== l.originalPrice && <div className="text-[11px] text-slate-400 line-through">{money(l.originalPrice)}</div>}</td>
      <td className="text-right tabular-nums">{l.discountAmount ? <span className="text-red-600">-{money(Math.abs(l.discountAmount))}</span> : <span className="text-slate-300">—</span>}{l.discount && <div className="text-[11px] text-slate-400">{l.discount.type === 'percent' ? `${l.discount.value}%` : money(l.discount.value)}</div>}</td>
      <td className="text-right tabular-nums">{l.taxable ? money(l.taxAmount) : <span className="text-slate-300">exempt</span>}</td>
      <td className="text-right font-semibold"><Money value={l.lineTotal} /></td>
      {showRefunded && <td className="text-right">{l.refundedQty > 0 ? <Badge tone={remaining <= 0 ? 'red' : 'amber'}>{l.refundedQty} / {l.qty}</Badge> : <span className="text-slate-300">—</span>}</td>}
    </tr>
  )
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2 text-sm border-b border-slate-50 last:border-0">
      <span className="text-slate-400 mt-0.5">{icon}</span>
      <span className="text-slate-500 w-20 shrink-0">{label}</span>
      <span className="text-slate-800 font-medium min-w-0 flex-1 break-words">{value}</span>
    </div>
  )
}

type RefundFn = ReturnType<typeof useDB.getState>['refund']

function RefundModal({ txId, onClose, onDone, refund, adminId }: { txId: string; onClose: () => void; onDone: (newId: string) => void; refund: RefundFn; adminId: string }) {
  const db = useDB((s) => s.db)
  const tx = db.transactions.find((t) => t.id === txId)!
  const [sel, setSel] = useState<Record<string, { qty: number; restock: boolean }>>(() => {
    const o: Record<string, { qty: number; restock: boolean }> = {}
    tx.lines.forEach((l) => { o[l.id] = { qty: 0, restock: true } })
    return o
  })
  const [method, setMethod] = useState<PaymentMethod>(tx.payments[0]?.method ?? 'cash')
  const [reason, setReason] = useState('')
  const openShift = db.shifts.find((s) => s.registerId === tx.registerId && s.status === 'open')
  const register = db.registers.find((r) => r.id === tx.registerId)

  const lines = tx.lines.map((l) => ({ line: l, remaining: l.qty - l.refundedQty, perUnit: l.qty ? l.lineTotal / l.qty : 0 }))
  const total = round2(lines.reduce((a, x) => a + x.perUnit * (sel[x.line.id]?.qty ?? 0), 0))
  const count = lines.reduce((a, x) => a + (sel[x.line.id]?.qty ?? 0), 0)
  const setQty = (id: string, qty: number, max: number) => setSel((s) => ({ ...s, [id]: { ...s[id]!, qty: Math.max(0, Math.min(max, Math.floor(qty) || 0)) } }))
  const selectAll = () => setSel((s) => { const n = { ...s }; lines.forEach((x) => { n[x.line.id] = { ...n[x.line.id]!, qty: x.remaining } }); return n })

  const submit = () => {
    if (!count) { toast.error('Select at least one item to refund'); return }
    if (!reason.trim()) { toast.error('Please enter a refund reason'); return }
    const res = refund({
      transactionId: tx.id, registerId: tx.registerId, userId: adminId, approvedBy: adminId, method, reason: reason.trim(),
      lines: lines.filter((x) => (sel[x.line.id]?.qty ?? 0) > 0).map((x) => ({ lineId: x.line.id, qty: sel[x.line.id]!.qty, restock: sel[x.line.id]!.restock })),
    })
    if (res.ok && res.transaction) { toast.success(`Refund ${res.transaction.number} for ${money(Math.abs(res.transaction.total))} processed`); onDone(res.transaction.id) }
    else toast.error(res.message ?? 'Refund failed')
  }

  return (
    <Modal open onClose={onClose} title={`Refund ${tx.number}`} subtitle={`Original total ${money(tx.total)} · paid by ${tx.payments.map((p) => PAYMENT_LABELS[p.method] ?? p.method).join(', ')}`} size="lg"
      footer={<>
        <div className="flex-1 text-sm text-slate-500">{count} item{count === 1 ? '' : 's'} · refund total <b className="text-slate-900">{money(total)}</b></div>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={!count}><RotateCcw size={14} /> Refund {money(total)}</button>
      </>}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-slate-500">Choose quantities to refund. Items are restocked to inventory unless you switch restock off (e.g. damaged goods).</div>
        <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={selectAll}>Select all</button>
      </div>
      <div className="overflow-x-auto -mx-2">
        <table className="table">
          <thead><tr><th>Item</th><th className="text-right">Sold</th><th className="text-right">Left</th><th className="w-28 text-right">Refund qty</th><th className="text-right">Amount</th><th>Restock</th></tr></thead>
          <tbody>
            {lines.map(({ line: l, remaining, perUnit }) => {
              const s = sel[l.id]!
              const service = db.products.find((p) => p.id === l.productId)?.categoryId === 'cat_service'
              return (
                <tr key={l.id} className={cx(remaining <= 0 && 'opacity-50')}>
                  <td><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-base">{l.emoji}</div><div className="min-w-0"><div className="font-medium text-slate-800 truncate max-w-[220px]">{l.name}</div><div className="text-[11px] text-slate-400">{money(perUnit)} each{l.serial ? ` · ${l.serial}` : ''}</div></div></div></td>
                  <td className="text-right tabular-nums">{l.qty}</td>
                  <td className="text-right tabular-nums">{remaining}</td>
                  <td className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <button type="button" className="btn-secondary !px-2 !py-0.5" disabled={s.qty <= 0} onClick={() => setQty(l.id, s.qty - 1, remaining)}>−</button>
                      <Input type="number" min={0} max={remaining} value={s.qty} onChange={(e) => setQty(l.id, Number(e.target.value), remaining)} className="!w-14 text-center !px-1 !py-1" disabled={remaining <= 0} />
                      <button type="button" className="btn-secondary !px-2 !py-0.5" disabled={s.qty >= remaining} onClick={() => setQty(l.id, s.qty + 1, remaining)}>+</button>
                    </div>
                  </td>
                  <td className="text-right font-medium tabular-nums">{money(perUnit * s.qty)}</td>
                  <td>{service ? <span className="text-xs text-slate-400">n/a</span> : <Toggle checked={s.restock} onChange={(v) => setSel((p) => ({ ...p, [l.id]: { ...p[l.id]!, restock: v } }))} disabled={s.qty <= 0} />}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        <Field label="Refund method" hint={method === 'store_credit' ? 'Amount will be added to the customer\'s store credit' : undefined}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {Object.entries(PAYMENT_LABELS).map(([k, v]) => <option key={k} value={k} disabled={k === 'store_credit' && !tx.customerId}>{v}{k === 'store_credit' && !tx.customerId ? ' (no customer)' : ''}</option>)}
          </Select>
        </Field>
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Faulty on arrival, wrong model, changed mind…" /></Field>
      </div>
      <div className="mt-3 mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 flex items-center gap-2 flex-wrap">
        <span>Approved by <b>{db.users.find((u) => u.id === adminId)?.name}</b></span>
        <span>· Register: <b>{register?.name ?? tx.registerId}</b></span>
        <span>· {openShift ? 'Will be recorded on the open shift' : 'No open shift on this register — refund is recorded without a shift'}</span>
      </div>
    </Modal>
  )
}
