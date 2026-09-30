import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Smartphone, Check, Maximize2, CreditCard, Star, Tag, ShoppingBag } from 'lucide-react'
import type { CartLine, DisplayPhase } from '@/lib/types'
import { useDB } from '@/store/db'
import { calcCart } from '@/lib/pos'
import { cx, money } from '@/lib/utils'

const EMPTY: CartLine[] = []

export default function CustomerDisplay() {
  const params = useParams<{ registerId: string }>()
  const db = useDB((s) => s.db)
  const settings = db.settings
  const accent = settings.displayAccent || '#2563eb'
  const register = db.registers.find((r) => r.id === params.registerId) ?? db.registers.find((r) => r.active) ?? db.registers[0]
  const registerId = register?.id
  const display = db.displays.find((d) => d.registerId === registerId)
  const cart = useMemo(() => db.carts.find((c) => c.registerId === registerId && !c.heldAt), [db.carts, registerId])
  const lines = cart?.lines ?? EMPTY
  const promo = cart?.promoCode ? db.promotions.find((p) => p.code === cart.promoCode) : undefined
  const totals = useMemo(() => calcCart({ lines, discount: cart?.discount }, settings, promo, db.products), [lines, cart?.discount, settings, promo, db.products])
  const customer = cart?.customerId ? db.customers.find((c) => c.id === cart.customerId) : undefined
  const tx = display?.transactionId ? db.transactions.find((t) => t.id === display.transactionId) : undefined
  const txCustomer = tx?.customerId ? db.customers.find((c) => c.id === tx.customerId) : undefined

  // Phase: follow the store, but drop back to the idle look 8s after a completed sale (local only)
  const storePhase: DisplayPhase = display?.phase ?? (lines.length ? 'cart' : 'idle')
  const [localIdle, setLocalIdle] = useState(false)
  useEffect(() => {
    setLocalIdle(false)
    if (storePhase !== 'complete') return
    const t = window.setTimeout(() => setLocalIdle(true), 8000)
    return () => window.clearTimeout(t)
  }, [storePhase, display?.updatedAt])
  let phase: DisplayPhase = storePhase
  if (phase === 'complete' && (localIdle || !tx)) phase = lines.length ? 'cart' : 'idle'
  if (phase === 'cart' && !lines.length) phase = 'idle'

  // Fullscreen button visibility
  const [showFs, setShowFs] = useState(true)
  const fsTimer = useRef<number | null>(null)
  useEffect(() => {
    const poke = () => {
      setShowFs(true)
      if (fsTimer.current) window.clearTimeout(fsTimer.current)
      fsTimer.current = window.setTimeout(() => setShowFs(false), 1200)
    }
    poke()
    window.addEventListener('mousemove', poke)
    window.addEventListener('touchstart', poke)
    return () => { window.removeEventListener('mousemove', poke); window.removeEventListener('touchstart', poke); if (fsTimer.current) window.clearTimeout(fsTimer.current) }
  }, [])
  const goFullscreen = () => { try { void document.documentElement.requestFullscreen?.() } catch { /* ignore */ } }

  return (
    <div className="h-screen w-screen overflow-hidden bg-navy-900 text-white flex flex-col select-none" style={{ ['--accent' as string]: accent }}>
      <header className="flex items-center justify-between px-5 md:px-8 h-12 shrink-0 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center text-white" style={{ background: accent }}><Smartphone size={13} /></div>
          <span className="font-semibold text-slate-200">{settings.storeName}</span>
          {register && <span className="opacity-70">· {register.name}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-soft" /> connected</span>
          <button onClick={goFullscreen} className={cx('inline-flex items-center gap-1 rounded-md bg-white/10 hover:bg-white/20 px-2 py-1 text-[11px] text-white transition-opacity', showFs ? 'opacity-100' : 'opacity-0 pointer-events-none')}><Maximize2 size={12} /> Fullscreen</button>
        </div>
      </header>

      <main className="flex-1 min-h-0 relative">
        {phase === 'idle' && <IdleView accent={accent} />}
        {(phase === 'cart' || phase === 'payment') && <CartView lines={lines} totals={totals} accent={accent} payment={phase === 'payment'} customerName={customer?.name} customerPoints={customer?.loyaltyPoints} promoCode={cart?.promoCode} taxName={settings.taxName} />}
        {phase === 'complete' && tx && <CompleteView accent={accent} total={tx.total} change={tx.change} points={tx.loyaltyEarned} customerName={txCustomer?.name} methods={tx.payments.map((p) => p.method)} />}
      </main>
    </div>
  )
}

// ─── Idle ────────────────────────────────────────────────────────────────────
function IdleView({ accent }: { accent: string }) {
  const settings = useDB((s) => s.db.settings)
  const promotions = useDB((s) => s.db.promotions)
  const categories = useDB((s) => s.db.categories)
  const products = useDB((s) => s.db.products)
  const messages = settings.displayIdleMessages.length ? settings.displayIdleMessages : [`Welcome to ${settings.storeName}`]
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(true)
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t) }, [])
  useEffect(() => {
    if (messages.length < 2) return
    const t = window.setInterval(() => {
      setVisible(false)
      window.setTimeout(() => { setIdx((i) => (i + 1) % messages.length); setVisible(true) }, 450)
    }, 5000)
    return () => window.clearInterval(t)
  }, [messages.length])
  const active = useMemo(() => {
    const ts = Date.now()
    return promotions.filter((p) => p.active && new Date(p.startsAt).getTime() <= ts && new Date(p.endsAt).getTime() >= ts).slice(0, 4)
  }, [promotions])
  const describe = (p: (typeof promotions)[number]) => {
    const target = p.scope === 'all' ? 'storewide' : p.scope === 'category' ? p.targetIds.map((id) => categories.find((c) => c.id === id)?.name.toLowerCase()).filter(Boolean).join(' & ') : p.targetIds.map((id) => products.find((x) => x.id === id)?.name).filter(Boolean).slice(0, 2).join(', ')
    const qty = p.minQty && p.minQty > 1 ? ` ${p.minQty}+` : ''
    switch (p.type) {
      case 'percent': return `${p.value}% off${qty} ${target}`
      case 'fixed': return `${money(p.value)} off${qty} ${target}`
      case 'bogo': return `Buy one get one free on ${target}`
      case 'bundle': return `Bundle ${p.minQty ?? 2}+ ${target} and save ${money(p.value)}`
      default: return p.description ?? p.name
    }
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
      <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-20 blur-3xl" style={{ background: accent }} />
      <div className="absolute -bottom-32 -left-20 w-[28rem] h-[28rem] rounded-full opacity-10 blur-3xl" style={{ background: accent }} />
      <div className="relative">
        <div className="w-20 h-20 md:w-24 md:h-24 rounded-3xl flex items-center justify-center mx-auto shadow-2xl" style={{ background: accent, boxShadow: `0 20px 60px ${accent}55` }}><Smartphone size={44} /></div>
        <div className="text-4xl md:text-6xl font-bold tracking-tight mt-6">{settings.storeName}</div>
        <div className="text-slate-400 mt-2 text-base md:text-lg">{settings.tagline}</div>
        <div className={cx('mt-8 text-xl md:text-3xl font-medium text-slate-100 transition-all duration-500 min-h-[2.5rem]', visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2')}>{messages[idx]}</div>
        <div className="mt-8 text-5xl md:text-6xl font-light tabular-nums text-slate-300 tracking-tight">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="text-sm text-slate-500 mt-1">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </div>
      {settings.displayShowPromotions && active.length > 0 && (
        <div className="absolute bottom-6 left-0 right-0 px-6 flex flex-wrap justify-center gap-3">
          {active.map((p) => (
            <div key={p.id} className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-left max-w-xs backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: accent }}><Tag size={13} /> {p.code ?? p.name}</div>
              <div className="text-sm text-slate-200 mt-0.5">{describe(p)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Cart / payment ──────────────────────────────────────────────────────────
function CartView({ lines, totals, accent, payment, customerName, customerPoints, promoCode, taxName }: { lines: CartLine[]; totals: ReturnType<typeof calcCart>; accent: string; payment: boolean; customerName?: string; customerPoints?: number; promoCode?: string; taxName: string }) {
  const listRef = useRef<HTMLDivElement>(null)
  const prev = useRef<Record<string, number>>({})
  const [flashId, setFlashId] = useState<string | undefined>()
  useEffect(() => {
    let changed: string | undefined
    for (const l of lines) if (prev.current[l.id] === undefined || prev.current[l.id] !== l.qty) changed = l.id
    prev.current = Object.fromEntries(lines.map((l) => [l.id, l.qty]))
    if (changed) {
      setFlashId(changed)
      const t = window.setTimeout(() => setFlashId(undefined), 1400)
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) })
      return () => window.clearTimeout(t)
    }
  }, [lines])
  return (
    <div className="absolute inset-0 flex flex-col md:flex-row">
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {payment && (
          <div className="mx-5 mt-3 rounded-2xl px-5 py-3 flex items-center gap-3 fade-up" style={{ background: `${accent}33`, border: `1px solid ${accent}66` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center pulse-soft" style={{ background: accent }}><CreditCard size={20} /></div>
            <div>
              <div className="font-semibold text-lg leading-tight">Please complete payment</div>
              <div className="text-sm text-slate-300">Follow the instructions on the terminal or hand cash to the cashier</div>
            </div>
          </div>
        )}
        <div className="px-5 pt-4 pb-2 text-[11px] uppercase tracking-wider text-slate-400 flex items-center gap-2"><ShoppingBag size={12} /> Your items · {totals.itemCount}</div>
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-5 pb-4">
          <ul className="space-y-2">
            {lines.map((l) => {
              const lt = totals.lines[l.id]
              const isNew = flashId === l.id
              return (
                <li key={l.id} className={cx('flex items-center gap-4 rounded-2xl px-4 py-3 transition-all duration-500', isNew ? 'bg-white/15 scale-[1.01] fade-up' : 'bg-white/5')} style={isNew ? { boxShadow: `0 0 0 1px ${accent}` } : undefined}>
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl shrink-0">{l.emoji}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-medium truncate">{l.name}</div>
                    <div className="text-sm text-slate-400 tabular-nums">{l.qty} × {money(l.unitPrice)}{l.discount && <span className="ml-2 text-emerald-400">−{l.discount.type === 'percent' ? `${l.discount.value}%` : money(l.discount.value)}</span>}{l.serial && <span className="ml-2 font-mono text-xs text-slate-500">{l.serial}</span>}</div>
                  </div>
                  <div className="text-xl font-semibold tabular-nums shrink-0">{money(lt?.total ?? 0)}</div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
      <aside className="w-full md:w-[360px] lg:w-[400px] shrink-0 bg-white/5 border-t md:border-t-0 md:border-l border-white/10 p-6 flex flex-col justify-between">
        <div>
          {customerName && (
            <div className="rounded-2xl bg-white/5 px-4 py-3 mb-5 fade-up">
              <div className="text-lg font-semibold">Hi {customerName.split(' ')[0]} 👋</div>
              {customerPoints !== undefined && <div className="text-sm text-slate-300 inline-flex items-center gap-1 mt-0.5"><Star size={13} className="text-amber-400" /> {customerPoints.toLocaleString()} points</div>}
            </div>
          )}
          <div className="space-y-2 text-slate-300">
            <div className="flex justify-between text-base"><span>Items</span><span className="tabular-nums">{totals.itemCount}</span></div>
            <div className="flex justify-between text-base"><span>Subtotal</span><span className="tabular-nums">{money(totals.subtotal)}</span></div>
            {totals.discountTotal > 0 && <div className="flex justify-between text-base text-emerald-400"><span>Savings{promoCode ? ` · ${promoCode}` : ''}</span><span className="tabular-nums">−{money(totals.discountTotal)}</span></div>}
            <div className="flex justify-between text-base"><span>{taxName}</span><span className="tabular-nums">{money(totals.tax)}</span></div>
          </div>
        </div>
        <div className="mt-6 pt-5 border-t border-white/10">
          <div className="text-xs uppercase tracking-wider text-slate-400">{payment ? 'Amount due' : 'Total'}</div>
          <div className={cx('text-[52px] lg:text-[64px] leading-none font-bold tabular-nums tracking-tight mt-1', payment && 'pulse-soft')} style={{ color: payment ? accent : '#fff' }}>{money(totals.total)}</div>
        </div>
      </aside>
    </div>
  )
}

// ─── Complete ────────────────────────────────────────────────────────────────
function CompleteView({ accent, total, change, points, customerName, methods }: { accent: string; total: number; change: number; points: number; customerName?: string; methods: string[] }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8 fade-up">
      <div className="w-28 h-28 rounded-full flex items-center justify-center bg-emerald-500 shadow-2xl shadow-emerald-500/40"><Check size={64} strokeWidth={3} /></div>
      <div className="text-5xl md:text-6xl font-bold tracking-tight mt-8">Thank you{customerName ? `, ${customerName.split(' ')[0]}` : ''}!</div>
      <div className="text-slate-400 mt-2 text-lg">Your payment was successful{methods.includes('cash') && change > 0 ? '' : '. Have a great day.'}</div>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <div className="rounded-2xl bg-white/5 border border-white/10 px-8 py-4 min-w-[200px]">
          <div className="text-xs uppercase tracking-wider text-slate-400">Total paid</div>
          <div className="text-4xl font-bold tabular-nums mt-1">{money(total)}</div>
        </div>
        {change > 0 && (
          <div className="rounded-2xl px-8 py-4 min-w-[200px]" style={{ background: `${accent}33`, border: `1px solid ${accent}66` }}>
            <div className="text-xs uppercase tracking-wider text-slate-300">Your change</div>
            <div className="text-4xl font-bold tabular-nums mt-1" style={{ color: accent }}>{money(change)}</div>
          </div>
        )}
        {points > 0 && (
          <div className="rounded-2xl bg-amber-500/15 border border-amber-400/30 px-8 py-4 min-w-[200px]">
            <div className="text-xs uppercase tracking-wider text-amber-200 inline-flex items-center gap-1"><Star size={12} /> Points earned</div>
            <div className="text-4xl font-bold tabular-nums mt-1 text-amber-300">+{points.toLocaleString()}</div>
          </div>
        )}
      </div>
    </div>
  )
}
