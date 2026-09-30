import React from 'react'
import type { Transaction } from '@/lib/types'
import { useDB } from '@/store/db'
import { fmtDateTime, money } from '@/lib/utils'
import { PAYMENT_LABELS } from '@/lib/pos'

/** Printable thermal-style receipt. Wrap in a container; use `printReceipt()` to open print dialog. */
export function Receipt({ tx, compact }: { tx: Transaction; compact?: boolean }) {
  const db = useDB((s) => s.db)
  const s = db.settings
  const cashier = db.users.find((u) => u.id === tx.userId)
  const customer = tx.customerId ? db.customers.find((c) => c.id === tx.customerId) : undefined
  const register = db.registers.find((r) => r.id === tx.registerId)
  const orig = tx.refundOf ? db.transactions.find((t) => t.id === tx.refundOf) : undefined
  const tendered = tx.payments.reduce((a, p) => a + (p.tendered ?? p.amount), 0)
  return (
    <div id="receipt" className={`bg-white text-slate-900 font-mono text-[12px] leading-relaxed mx-auto ${compact ? 'w-[300px]' : 'w-[340px]'} p-5 border border-dashed border-slate-300 rounded-lg`}>
      <div className="text-center">
        <div className="text-lg font-bold tracking-wide">{s.storeName.toUpperCase()}</div>
        <div className="text-[11px] text-slate-600">{s.address}</div>
        <div className="text-[11px] text-slate-600">{s.phone}</div>
        <div className="mt-2 text-[11px]">{s.receiptHeader}</div>
      </div>
      <div className="border-t border-dashed border-slate-300 my-3" />
      <div className="flex justify-between"><span>{tx.type === 'refund' ? 'REFUND' : tx.status === 'voided' ? 'VOIDED SALE' : 'SALE'}</span><b>{tx.number}</b></div>
      {orig && <div className="flex justify-between text-slate-600"><span>Refund of</span><span>{orig.number}</span></div>}
      <div className="flex justify-between text-slate-600"><span>Date</span><span>{fmtDateTime(tx.createdAt)}</span></div>
      <div className="flex justify-between text-slate-600"><span>Register</span><span>{register?.name ?? tx.registerId}</span></div>
      <div className="flex justify-between text-slate-600"><span>Cashier</span><span>{cashier?.name ?? '—'}</span></div>
      {customer && <div className="flex justify-between text-slate-600"><span>Customer</span><span>{customer.name}</span></div>}
      <div className="border-t border-dashed border-slate-300 my-3" />
      {tx.lines.map((l) => (
        <div key={l.id} className="mb-1.5">
          <div className="flex justify-between gap-2"><span className="flex-1">{l.name}</span><span>{money(l.lineTotal)}</span></div>
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>{Math.abs(l.qty)} × {money(l.unitPrice)}{l.unitPrice !== l.originalPrice ? ` (was ${money(l.originalPrice)})` : ''}{l.serial ? ` · IMEI ${l.serial}` : ''}</span>
            {l.discountAmount !== 0 && <span>-{money(Math.abs(l.discountAmount))}</span>}
          </div>
        </div>
      ))}
      <div className="border-t border-dashed border-slate-300 my-3" />
      <div className="flex justify-between"><span>Subtotal</span><span>{money(tx.subtotal)}</span></div>
      {tx.discountTotal !== 0 && <div className="flex justify-between"><span>Discounts{tx.promoCode ? ` (${tx.promoCode})` : ''}</span><span>-{money(Math.abs(tx.discountTotal))}</span></div>}
      {tx.loyaltyRedeemed > 0 && <div className="flex justify-between"><span>Loyalty points ({tx.loyaltyRedeemed})</span><span>-{money(tx.loyaltyRedeemed * s.loyaltyPointValue)}</span></div>}
      <div className="flex justify-between"><span>{s.taxName} ({s.taxRate}%)</span><span>{money(tx.taxTotal)}</span></div>
      <div className="flex justify-between text-base font-bold mt-1"><span>TOTAL</span><span>{money(tx.total)}</span></div>
      <div className="border-t border-dashed border-slate-300 my-3" />
      {tx.payments.map((p) => (
        <div key={p.id} className="flex justify-between"><span>{PAYMENT_LABELS[p.method] ?? p.method}{p.cardLast4 ? ` •••• ${p.cardLast4}` : ''}{p.reference ? ` ${p.reference}` : ''}</span><span>{money(p.tendered ?? p.amount)}</span></div>
      ))}
      {tx.change > 0 && <div className="flex justify-between"><span>Change</span><span>{money(tx.change)}</span></div>}
      {tendered > tx.total && tx.change === 0 && null}
      {tx.loyaltyEarned > 0 && <div className="flex justify-between text-slate-600 mt-2"><span>Points earned</span><span>+{tx.loyaltyEarned}</span></div>}
      {tx.note && <div className="mt-2 text-[11px] text-slate-600">Note: {tx.note}</div>}
      {tx.status === 'voided' && <div className="mt-2 text-center font-bold text-red-600">*** VOIDED{tx.voidReason ? ` – ${tx.voidReason}` : ''} ***</div>}
      <div className="border-t border-dashed border-slate-300 my-3" />
      <div className="text-center text-[11px] text-slate-600">{s.receiptFooter}</div>
      <div className="text-center text-[11px] text-slate-400 mt-2">{s.website}</div>
      <div className="mt-3 flex justify-center">
        <svg width="180" height="34" aria-hidden>
          {Array.from({ length: 48 }).map((_, i) => <rect key={i} x={i * 3.7} y={0} width={(i * 7) % 3 === 0 ? 2.4 : 1.2} height={26} fill="#0f172a" />)}
          <text x="90" y="33" textAnchor="middle" fontSize="8" fill="#334155">{tx.number}</text>
        </svg>
      </div>
    </div>
  )
}

export function printReceipt() {
  const el = document.getElementById('receipt')
  if (!el) return
  const w = window.open('', '_blank', 'width=420,height=700')
  if (!w) return
  w.document.write(`<!doctype html><html><head><title>Receipt</title><style>body{font-family:ui-monospace,Menlo,monospace;font-size:12px;margin:0;padding:12px;color:#0f172a}.flex{display:flex}.justify-between{justify-content:space-between}.text-center{text-align:center}.font-bold{font-weight:700}.text-lg{font-size:16px}.text-base{font-size:14px}.mt-1{margin-top:4px}.mt-2{margin-top:8px}.mt-3{margin-top:12px}.mb-1\\.5{margin-bottom:6px}.my-3{margin:12px 0}.border-t{border-top:1px dashed #cbd5e1}.text-slate-600,.text-slate-500,.text-slate-400{color:#64748b}.text-red-600{color:#dc2626}.gap-2{gap:8px}.flex-1{flex:1}.text-\\[11px\\]{font-size:11px}</style></head><body>${el.innerHTML}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 250)
}
