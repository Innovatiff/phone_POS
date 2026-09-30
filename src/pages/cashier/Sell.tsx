import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ScanBarcode, X, Minus, Plus, UserPlus, User as UserIcon, Percent, StickyNote, PauseCircle, Trash2, CreditCard, Banknote, Smartphone, Wallet, Landmark, Split,
  Check, Printer, Mail, RotateCcw, Tag, Zap, ChevronRight, Star, Hash, Sparkles, Search,
} from 'lucide-react'
import type { Cart, CartLine, Customer, LineDiscount, Payment, PaymentMethod, Product, Transaction } from '@/lib/types'
import { useDB } from '@/store/db'
import { hasPerm, useCashierUser, useSession } from '@/store/session'
import { Avatar, Badge, Drawer, EmptyState, Field, Input, Kbd, Modal, Segmented, Select, Textarea, Toggle, confirm, toast } from '@/components/ui'
import { Receipt, printReceipt } from '@/components/Receipt'
import { calcCart, quickCashOptions, PAYMENT_LABELS, type CartTotals } from '@/lib/pos'
import { ago, cx, money, round2 } from '@/lib/utils'
import { Keypad, beep, discountNeedsManager, isManager, parseAmount, requestManagerPin } from './shared'

const EMPTY_LINES: CartLine[] = []

export default function Sell() {
  const user = useCashierUser()!
  const registerId = useSession((s) => s.registerId)!
  const db = useDB((s) => s.db)
  const { addToCart, updateLine, removeLine, setCartDiscount, setCartCustomer, setCartPromo, setCartNote, clearCart, holdCart, recallCart, deleteHeldCart, setDisplay } = useDB.getState()
  const settings = db.settings
  const [params, setParams] = useSearchParams()

  const cart = useMemo(() => db.carts.find((c) => c.registerId === registerId && !c.heldAt), [db.carts, registerId])
  const lines = cart?.lines ?? EMPTY_LINES
  const promo = useMemo(() => (cart?.promoCode ? db.promotions.find((p) => p.code === cart.promoCode) : undefined), [cart?.promoCode, db.promotions])
  const totals = useMemo(() => calcCart({ lines, discount: cart?.discount }, settings, promo, db.products), [lines, cart?.discount, settings, promo, db.products])
  const customer = useMemo(() => (cart?.customerId ? db.customers.find((c) => c.id === cart.customerId) : undefined), [cart?.customerId, db.customers])
  const heldCarts = useMemo(() => db.carts.filter((c) => c.heldAt).sort((a, b) => (b.heldAt ?? '').localeCompare(a.heldAt ?? '')), [db.carts])

  // ── UI state ──
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('all')
  const [editLineId, setEditLineId] = useState<string | undefined>()
  const [customerOpen, setCustomerOpen] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [holdOpen, setHoldOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [promoInput, setPromoInput] = useState('')
  const [approvedBy, setApprovedBy] = useState<string | undefined>()
  const [flashId, setFlashId] = useState<string | undefined>()
  const searchRef = useRef<HTMLInputElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (params.get('held')) {
      setHeldOpen(true)
      const next = new URLSearchParams(params)
      next.delete('held')
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  // reset manager approval once the cart is gone (after checkout / clear)
  useEffect(() => { if (!lines.length) setApprovedBy(undefined) }, [lines.length])

  // ── Products ──
  const activeProducts = useMemo(() => db.products.filter((p) => p.active), [db.products])
  const brandName = useCallback((id: string) => db.brands.find((b) => b.id === id)?.name ?? '', [db.brands])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = activeProducts
    if (cat !== 'all') list = list.filter((p) => p.categoryId === cat)
    if (needle) {
      list = list.filter((p) => {
        const hay = `${p.name} ${p.sku} ${p.barcode} ${brandName(p.brandId)} ${p.tags.join(' ')} ${p.attrs.storage ?? ''} ${p.attrs.color ?? ''}`.toLowerCase()
        return hay.includes(needle) || p.serials.some((s) => s.includes(needle))
      })
    }
    return [...list].sort((a, b) => b.soldCount - a.soldCount || a.name.localeCompare(b.name))
  }, [activeProducts, cat, q, brandName])
  const quickKeys = useMemo(() => [...activeProducts].filter((p) => p.categoryId === 'cat_service' || p.stock > 0).sort((a, b) => b.soldCount - a.soldCount).slice(0, 8), [activeProducts])
  const categories = useMemo(() => [...db.categories].sort((a, b) => a.sortOrder - b.sortOrder), [db.categories])

  const add = useCallback((productId: string, serial?: string) => {
    const res = addToCart(registerId, user.id, productId, 1, serial)
    if (!res.ok) { toast.error(res.message ?? 'Could not add item'); beep(220, 160); return false }
    beep()
    return true
  }, [addToCart, registerId, user.id])

  // Highlight the most recently changed line & scroll to it
  const prevLines = useRef<Record<string, number>>({})
  useEffect(() => {
    const prev = prevLines.current
    let changed: string | undefined
    for (const l of lines) if (prev[l.id] === undefined || prev[l.id] !== l.qty) changed = l.id
    prevLines.current = Object.fromEntries(lines.map((l) => [l.id, l.qty]))
    if (changed) {
      setFlashId(changed)
      const t = window.setTimeout(() => setFlashId(undefined), 900)
      requestAnimationFrame(() => { const el = linesRef.current?.querySelector(`[data-line="${changed}"]`); el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) })
      return () => window.clearTimeout(t)
    }
  }, [lines])

  const handleScan = () => {
    const needle = q.trim()
    if (!needle) return
    const lower = needle.toLowerCase()
    const exact = activeProducts.find((p) => p.barcode.toLowerCase() === lower || p.sku.toLowerCase() === lower)
    if (exact) { if (add(exact.id)) setQ(''); return }
    const bySerial = activeProducts.find((p) => p.trackSerial && p.serials.includes(needle))
    if (bySerial) { if (add(bySerial.id, needle)) setQ(''); return }
    if (filtered.length === 1) { if (add(filtered[0]!.id)) setQ(''); return }
    if (!filtered.length) { toast.error(`No product matches "${needle}"`); beep(220, 160) }
  }

  const openPayment = useCallback(() => {
    if (!lines.length) { toast.info('Add items to the cart first'); return }
    setPayOpen(true)
    setDisplay(registerId, 'payment')
  }, [lines.length, registerId, setDisplay])
  const cancelPayment = () => {
    setPayOpen(false)
    setDisplay(registerId, lines.length ? 'cart' : 'idle')
    searchRef.current?.focus()
  }
  const finishSale = () => {
    setPayOpen(false)
    setDisplay(registerId, 'idle')
    setApprovedBy(undefined)
    searchRef.current?.focus()
  }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
      else if (e.key === 'F4') { e.preventDefault(); if (!payOpen) openPayment() }
      else if (e.key === 'F8') { e.preventDefault(); if (lines.length && !payOpen) setHoldOpen(true) }
      else if (e.key === 'Escape' && document.activeElement === searchRef.current) { setQ('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPayment, payOpen, lines.length])

  const applyPromo = () => {
    const code = promoInput.trim()
    if (!code) return
    const res = setCartPromo(registerId, code)
    if (!res.ok) { toast.error(res.message ?? 'Invalid promo code'); return }
    toast.success(`Promo ${code.toUpperCase()} applied`)
    setPromoInput('')
  }

  const doClear = async () => {
    if (!lines.length) return
    if (await confirm('Clear cart?', `Remove all ${lines.length} line(s) from this sale.`, { danger: true, confirmLabel: 'Clear cart' })) {
      clearCart(registerId, user.id, 'Cleared by cashier')
      toast.info('Cart cleared')
      searchRef.current?.focus()
    }
  }

  const editLine = editLineId ? lines.find((l) => l.id === editLineId) : undefined
  const discountPct = totals.subtotal > 0 ? ((totals.lineDiscounts + totals.cartDiscount) / totals.subtotal) * 100 : 0

  return (
    <div className="h-full flex flex-col lg:flex-row overflow-hidden">
      {/* ── LEFT: products ─────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col p-3 md:p-4 gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <ScanBarcode size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={searchRef}
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan() } }}
              placeholder="Scan barcode, IMEI or SKU — or search products…"
              className="input !pl-11 !pr-24 h-12 text-base rounded-xl shadow-sm"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {q && <button type="button" onClick={() => { setQ(''); searchRef.current?.focus() }} className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X size={16} /></button>}
              <span className="hidden md:inline-flex"><Kbd>F2</Kbd></span>
            </div>
          </div>
          <button className="btn-secondary h-12 !px-3 hidden md:inline-flex" title="Held sales (F8 to hold current)" onClick={() => setHeldOpen(true)}>
            <PauseCircle size={16} /> Held {heldCarts.length > 0 && <span className="rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold px-1.5">{heldCarts.length}</span>}
          </button>
        </div>

        {/* Category chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1 shrink-0">
          <Chip active={cat === 'all'} onClick={() => setCat('all')}><Sparkles size={13} /> All</Chip>
          {categories.map((c) => (
            <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}><span>{c.icon}</span><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />{c.name}</Chip>
          ))}
        </div>

        {/* Quick keys */}
        {!q && cat === 'all' && quickKeys.length > 0 && (
          <div className="shrink-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1"><Zap size={12} className="text-amber-500" /> Quick keys</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              {quickKeys.map((p) => (
                <button key={p.id} onClick={() => add(p.id)} className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-white border border-slate-200 hover:border-brand-500 hover:bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors max-w-[190px]">
                  <span className="text-base leading-none">{p.emoji}</span><span className="truncate">{p.name}</span><span className="text-slate-400 font-semibold">{money(p.price)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Product grid */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-2">
          {filtered.length === 0 ? (
            <EmptyState icon={<Search size={22} />} title="No products found" description={q ? `Nothing matches "${q}". Try a different search or scan the barcode again.` : 'No products in this category.'} action={q ? <button className="btn-secondary" onClick={() => setQ('')}>Clear search</button> : undefined} />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5">
              {filtered.map((p) => <ProductCard key={p.id} p={p} onAdd={() => add(p.id)} />)}
            </div>
          )}
        </div>
        <div className="hidden md:flex items-center gap-3 text-[11px] text-slate-400 shrink-0">
          <span><Kbd>F2</Kbd> Search</span><span><Kbd>F4</Kbd> Charge</span><span><Kbd>F8</Kbd> Hold</span><span><Kbd>Esc</Kbd> Clear search</span><span><Kbd>Enter</Kbd> Add scanned item</span>
        </div>
      </div>

      {/* ── RIGHT: cart ─────────────────────────────────────────────────── */}
      <aside className="w-full lg:w-[400px] shrink-0 bg-white border-t lg:border-t-0 lg:border-l border-slate-200 flex flex-col min-h-[45vh] lg:min-h-0 max-h-[55vh] lg:max-h-none">
        {/* Customer row */}
        <div className="px-4 py-3 border-b border-slate-100">
          {customer ? (
            <div className="flex items-center gap-3">
              <Avatar name={customer.name} color="#7c3aed" size={36} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900 truncate">{customer.name}</div>
                <div className="text-[11px] text-slate-500 flex items-center gap-2"><span className="inline-flex items-center gap-0.5"><Star size={11} className="text-amber-500" /> {customer.loyaltyPoints.toLocaleString()} pts</span>{customer.storeCredit > 0 && <span className="inline-flex items-center gap-0.5 text-emerald-600 font-medium"><Wallet size={11} /> {money(customer.storeCredit)} credit</span>}</div>
              </div>
              <button className="btn-ghost !px-2" onClick={() => setCustomerOpen(true)} title="Change customer"><UserIcon size={15} /></button>
              <button className="btn-ghost !px-2 text-slate-400 hover:text-red-600" onClick={() => setCartCustomer(registerId, undefined)} title="Remove customer"><X size={15} /></button>
            </div>
          ) : (
            <button className="w-full flex items-center gap-3 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-brand-500 hover:text-brand-700 hover:bg-brand-50 transition-colors" onClick={() => setCustomerOpen(true)}>
              <UserPlus size={16} /> Attach customer <span className="ml-auto text-[11px] text-slate-400">optional</span>
            </button>
          )}
        </div>

        {/* Lines */}
        <div ref={linesRef} className="flex-1 min-h-0 overflow-y-auto">
          {lines.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 text-slate-400">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3"><ScanBarcode size={24} /></div>
              <div className="font-medium text-slate-600">Cart is empty</div>
              <div className="text-xs mt-1">Scan an item or tap a product to start a sale.</div>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lines.map((l) => {
                const lt = totals.lines[l.id]
                return (
                  <li key={l.id} data-line={l.id} onClick={() => setEditLineId(l.id)} className={cx('px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-slate-50 transition-colors', flashId === l.id && 'bg-brand-50')}>
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-xl shrink-0">{l.emoji}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900 truncate">{l.name}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                        <span className="tabular-nums">{money(l.unitPrice)}{l.unitPrice !== l.originalPrice && <span className="line-through text-slate-400 ml-1">{money(l.originalPrice)}</span>}</span>
                        {l.discount && <span className="text-emerald-600 font-medium">−{l.discount.type === 'percent' ? `${l.discount.value}%` : money(l.discount.value)}</span>}
                        {l.serial && <span className="font-mono text-[10px] text-slate-400 truncate">IMEI {l.serial}</span>}
                        {l.note && <span className="text-slate-400 italic truncate">“{l.note}”</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700" onClick={() => (l.qty <= 1 ? removeLine(registerId, l.id) : updateLine(registerId, l.id, { qty: l.qty - 1 }))} aria-label="Decrease"><Minus size={14} /></button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums">{l.qty}</span>
                      <button className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 disabled:opacity-40" disabled={l.serial !== undefined} onClick={() => { const r = addToCart(registerId, user.id, l.productId, 1); if (!r.ok) toast.error(r.message ?? 'Out of stock') }} aria-label="Increase"><Plus size={14} /></button>
                    </div>
                    <div className="w-[76px] text-right text-sm font-semibold tabular-nums text-slate-900 shrink-0">{money(lt?.total ?? 0)}</div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Bottom: discounts, promo, totals, actions */}
        <div className="border-t border-slate-100 px-4 pt-3 pb-3 space-y-2.5 bg-white">
          <div className="flex items-center gap-2">
            <button className={cx('btn-secondary flex-1 !px-2', cart?.discount && '!border-emerald-300 !bg-emerald-50 !text-emerald-700')} onClick={() => setDiscountOpen(true)}><Percent size={14} /> {cart?.discount ? (cart.discount.type === 'percent' ? `${cart.discount.value}% off` : `${money(cart.discount.value)} off`) : 'Discount'}</button>
            <button className={cx('btn-secondary flex-1 !px-2', cart?.note && '!border-amber-300 !bg-amber-50 !text-amber-700')} onClick={() => setNoteOpen(true)}><StickyNote size={14} /> Note</button>
          </div>
          {cart?.promoCode ? (
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-sm">
              <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium"><Tag size={14} /> {cart.promoCode} <span className="text-emerald-600/70 font-normal text-xs">{promo?.name}</span></span>
              <button className="text-emerald-700 hover:text-red-600" onClick={() => setCartPromo(registerId, undefined)}><X size={14} /></button>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') applyPromo() }} placeholder="Promo code" className="input !pl-8 !py-1.5 text-sm uppercase" />
              </div>
              <button className="btn-secondary !py-1.5" onClick={applyPromo} disabled={!promoInput.trim()}>Apply</button>
            </div>
          )}
          <div className="text-sm space-y-1 pt-1">
            <Row label={`Subtotal · ${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'}`} value={money(totals.subtotal)} />
            {totals.discountTotal > 0 && <Row label={`Discounts${totals.promoDiscount > 0 ? ` (incl. ${cart?.promoCode})` : ''}`} value={`−${money(totals.discountTotal)}`} className="text-emerald-600" />}
            <Row label={`${settings.taxName} (${settings.taxRate}%)`} value={money(totals.tax)} />
            <div className="flex items-baseline justify-between pt-1.5 border-t border-slate-100">
              <span className="text-sm font-semibold text-slate-600">TOTAL</span>
              <span className="text-[28px] leading-none font-bold text-slate-900 tabular-nums tracking-tight">{money(totals.total)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button className="btn-secondary" disabled={!lines.length} onClick={() => setHoldOpen(true)}><PauseCircle size={15} /> Hold <Kbd>F8</Kbd></button>
            <button className="btn-secondary text-red-600 hover:!bg-red-50" disabled={!lines.length} onClick={doClear}><Trash2 size={15} /> Clear</button>
          </div>
          <button className="btn-success w-full h-14 text-lg rounded-xl shadow-lg shadow-emerald-600/20 disabled:shadow-none" disabled={!lines.length} onClick={openPayment}>
            <CreditCard size={20} /> Charge {money(totals.total)} <span className="ml-1 text-xs opacity-80 font-normal hidden sm:inline">F4</span>
          </button>
        </div>
      </aside>

      {/* ── Modals & drawers ─────────────────────────────────────────────── */}
      {editLine && <LineEditor line={editLine} product={db.products.find((p) => p.id === editLine.productId)} cart={cart} registerId={registerId} onClose={() => setEditLineId(undefined)} onApproved={(id) => setApprovedBy(id)} />}
      <CustomerPicker open={customerOpen} onClose={() => setCustomerOpen(false)} onPick={(c) => { setCartCustomer(registerId, c.id); setCustomerOpen(false); toast.success(`${c.name} attached to sale`) }} />
      <CartDiscountModal open={discountOpen} onClose={() => setDiscountOpen(false)} current={cart?.discount} subtotal={Math.max(0, totals.subtotal - totals.lineDiscounts)} onApply={(d, approver) => { setCartDiscount(registerId, d); if (approver) setApprovedBy(approver); setDiscountOpen(false) }} />
      <NoteModal open={noteOpen} onClose={() => setNoteOpen(false)} value={cart?.note ?? ''} onSave={(n) => { setCartNote(registerId, n || undefined); setNoteOpen(false) }} />
      <HoldModal open={holdOpen} onClose={() => setHoldOpen(false)} customerName={customer?.name} onHold={(label) => { holdCart(registerId, user.id, label); setHoldOpen(false); toast.success(`Sale put on hold${label ? `: ${label}` : ''}`); searchRef.current?.focus() }} />
      <Drawer open={heldOpen} onClose={() => setHeldOpen(false)} title={<span className="inline-flex items-center gap-2"><PauseCircle size={18} className="text-amber-500" /> Held sales</span>}>
        {heldCarts.length === 0 ? <EmptyState icon={<PauseCircle size={22} />} title="No held sales" description="Press F8 or tap Hold to park the current sale and serve someone else." /> : (
          <div className="space-y-3">
            {heldCarts.map((h) => {
              const t = calcCart(h, settings, h.promoCode ? db.promotions.find((p) => p.code === h.promoCode) : undefined, db.products)
              const reg = db.registers.find((r) => r.id === h.registerId)
              const cust = h.customerId ? db.customers.find((c) => c.id === h.customerId) : undefined
              return (
                <div key={h.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{h.label ?? 'Held sale'}</div>
                      <div className="text-xs text-slate-500">{h.lines.length} line{h.lines.length === 1 ? '' : 's'} · {ago(h.heldAt)}{reg && h.registerId !== registerId ? ` · ${reg.name}` : ''}{cust ? ` · ${cust.name}` : ''}</div>
                    </div>
                    <div className="text-lg font-bold tabular-nums">{money(t.total)}</div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500 truncate">{h.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</div>
                  <div className="mt-3 flex gap-2">
                    <button className="btn-primary flex-1" onClick={() => { recallCart(registerId, user.id, h.id); setHeldOpen(false); toast.success('Sale recalled'); if (lines.length) toast.info('The current cart was put on hold') }}><RotateCcw size={14} /> Recall</button>
                    <button className="btn-secondary text-red-600" onClick={async () => { if (await confirm('Discard held sale?', `${h.label ?? 'This sale'} will be permanently removed.`, { danger: true, confirmLabel: 'Discard' })) deleteHeldCart(h.id, user.id) }}><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Drawer>
      {payOpen && (
        <PaymentModal
          cart={cart}
          totals={totals}
          customer={customer}
          registerId={registerId}
          approvedBy={approvedBy}
          discountPct={discountPct}
          onCancel={cancelPayment}
          onDone={finishSale}
        />
      )}
    </div>
  )
}

// ─── Small pieces ────────────────────────────────────────────────────────────
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cx('shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors', active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300')}>{children}</button>
  )
}
function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return <div className={cx('flex items-center justify-between text-slate-600', className)}><span>{label}</span><span className="tabular-nums font-medium">{value}</span></div>
}

function ProductCard({ p, onAdd }: { p: Product; onAdd: () => void }) {
  const service = p.categoryId === 'cat_service'
  const out = !service && p.stock <= 0
  const low = !service && !out && p.stock <= p.lowStockThreshold
  return (
    <button type="button" disabled={out} onClick={onAdd} className={cx('card p-3 text-left flex flex-col gap-2 min-h-[132px] transition-all active:scale-[0.98]', out ? 'opacity-45 cursor-not-allowed' : 'hover:shadow-pop hover:border-brand-200')}>
      <div className="flex items-start justify-between gap-2">
        <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-2xl">{p.emoji}</div>
        <div className="flex flex-col items-end gap-1">
          {service ? <Badge tone="slate">Service</Badge> : out ? <Badge tone="red">Out</Badge> : low ? <Badge tone="amber">{p.stock} left</Badge> : <Badge tone="green">{p.stock} in stock</Badge>}
          {p.trackSerial && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-400"><Hash size={10} /> IMEI</span>}
        </div>
      </div>
      <div className="text-[13px] font-medium text-slate-800 leading-snug line-clamp-2 flex-1">{p.name}</div>
      <div className="flex items-center justify-between">
        <span className="text-base font-bold text-slate-900 tabular-nums">{money(p.price)}</span>
        {(p.attrs.storage || p.attrs.color) && <span className="text-[10px] text-slate-400 truncate max-w-[55%]">{[p.attrs.storage, p.attrs.color].filter(Boolean).join(' · ')}</span>}
      </div>
    </button>
  )
}

// ─── Line editor ─────────────────────────────────────────────────────────────
function LineEditor({ line, product, cart, registerId, onClose, onApproved }: { line: CartLine; product?: Product; cart?: Cart; registerId: string; onClose: () => void; onApproved: (userId: string) => void }) {
  const user = useCashierUser()!
  const settings = useDB((s) => s.db.settings)
  const { updateLine, removeLine } = useDB.getState()
  const [qty, setQty] = useState(line.qty)
  const [price, setPrice] = useState(String(line.unitPrice))
  const [dType, setDType] = useState<'percent' | 'fixed'>(line.discount?.type ?? 'percent')
  const [dValue, setDValue] = useState(line.discount ? String(line.discount.value) : '')
  const [note, setNote] = useState(line.note ?? '')
  const [serial, setSerial] = useState(line.serial ?? '')
  const isService = product?.categoryId === 'cat_service'
  const inCartOther = (cart?.lines ?? []).filter((l) => l.productId === line.productId && l.id !== line.id).reduce((a, l) => a + l.qty, 0)
  const maxQty = isService ? 999 : Math.max(0, (product?.stock ?? 0) - inCartOther)
  const usedSerials = (cart?.lines ?? []).filter((l) => l.productId === line.productId && l.id !== line.id).map((l) => l.serial)
  const serialOptions = (product?.serials ?? []).filter((s) => !usedSerials.includes(s))
  const canOverride = hasPerm(user, 'price_override')
  const priceNum = parseAmount(price)
  const gross = priceNum * qty
  const dNum = parseAmount(dValue)
  const effPct = dType === 'percent' ? dNum : gross > 0 ? (Math.min(gross, dNum) / gross) * 100 : 0
  const preview = round2(gross - (dType === 'percent' ? gross * Math.min(100, dNum) / 100 : Math.min(gross, dNum)))

  const save = async () => {
    if (qty < 1) { removeLine(registerId, line.id); onClose(); return }
    if (qty > maxQty) { toast.error(`Only ${maxQty} available`); return }
    const patch: Partial<CartLine> = { qty, note: note.trim() || undefined }
    if (product?.trackSerial) patch.serial = serial || undefined
    if (priceNum !== line.unitPrice) {
      if (priceNum <= 0) { toast.error('Price must be greater than zero'); return }
      if (!canOverride) {
        const m = await requestManagerPin('price_override', 'Price override', `Change ${line.name} from ${money(line.originalPrice)} to ${money(priceNum)}`)
        if (!m) return
        onApproved(m.id)
      }
      patch.unitPrice = round2(priceNum)
    }
    const newDisc: LineDiscount | undefined = dNum > 0 ? { type: dType, value: dNum } : undefined
    const changedDisc = JSON.stringify(newDisc ?? null) !== JSON.stringify(line.discount ?? null)
    if (changedDisc && newDisc && discountNeedsManager(user, effPct, settings)) {
      const m = await requestManagerPin('discount', 'Discount approval', `${effPct.toFixed(0)}% off ${line.name} exceeds the ${settings.cashierMaxDiscountPercent}% cashier limit`)
      if (!m) return
      onApproved(m.id)
    }
    if (changedDisc) patch.discount = newDisc
    updateLine(registerId, line.id, patch)
    onClose()
  }

  return (
    <Modal open onClose={onClose} size="md" title={<span className="inline-flex items-center gap-2"><span className="text-2xl">{line.emoji}</span> {line.name}</span>} subtitle={`${line.sku}${product ? ` · ${isService ? 'Service' : `${product.stock} in stock`}` : ''}`}
      footer={<><button className="btn-secondary text-red-600 mr-auto" onClick={() => { removeLine(registerId, line.id); onClose() }}><Trash2 size={14} /> Remove line</button><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}><Check size={15} /> Save</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2">
        <Field label="Quantity">
          <div className="flex items-center gap-2">
            <button className="btn-secondary !px-3 h-10" disabled={product?.trackSerial} onClick={() => setQty((v) => Math.max(1, v - 1))}><Minus size={16} /></button>
            <Input type="number" min={1} max={maxQty} value={qty} disabled={product?.trackSerial} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className="text-center text-lg font-semibold h-10" />
            <button className="btn-secondary !px-3 h-10" disabled={product?.trackSerial || qty >= maxQty} onClick={() => setQty((v) => Math.min(maxQty, v + 1))}><Plus size={16} /></button>
          </div>
          {product?.trackSerial && <span className="block text-[11px] text-slate-400 mt-1">Serialised item — one unit per line</span>}
        </Field>
        <Field label={`Unit price${canOverride ? '' : ' (manager PIN to change)'}`} hint={priceNum !== line.originalPrice ? `List price ${money(line.originalPrice)}` : undefined}>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{settings.currencySymbol}</span>
            <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="pl-7 h-10 text-lg font-semibold" />
          </div>
        </Field>
        <Field label="Line discount" className="sm:col-span-2" hint={!isManager(user) ? `Cashier limit ${settings.cashierMaxDiscountPercent}% — above that a manager PIN is required` : undefined}>
          <div className="flex gap-2">
            <Segmented size="md" value={dType} onChange={setDType} options={[{ value: 'percent', label: '%' }, { value: 'fixed', label: settings.currencySymbol }]} />
            <Input type="number" min={0} step="0.01" value={dValue} onChange={(e) => setDValue(e.target.value)} placeholder="0" className="h-10" />
            <div className="flex gap-1">
              {[5, 10, 15].map((v) => <button key={v} type="button" className="btn-secondary !px-2.5 h-10" onClick={() => { setDType('percent'); setDValue(String(v)) }}>{v}%</button>)}
            </div>
          </div>
          {dNum > 0 && <div className={cx('text-xs mt-1.5', discountNeedsManager(user, effPct, settings) ? 'text-amber-600' : 'text-emerald-600')}>Line total {money(preview)} ({effPct.toFixed(1)}% off){discountNeedsManager(user, effPct, settings) ? ' · manager approval needed' : ''}</div>}
        </Field>
        {product?.trackSerial && (
          <Field label="IMEI / serial" className="sm:col-span-2">
            <Select value={serial} onChange={(e) => setSerial(e.target.value)} className="font-mono">
              <option value="">— no serial —</option>
              {line.serial && !serialOptions.includes(line.serial) && <option value={line.serial}>{line.serial}</option>}
              {serialOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Note" className="sm:col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer requested gift wrap" /></Field>
      </div>
    </Modal>
  )
}

// ─── Customer picker ─────────────────────────────────────────────────────────
function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: Customer) => void }) {
  const user = useCashierUser()!
  const customers = useDB((s) => s.db.customers)
  const upsertCustomer = useDB((s) => s.upsertCustomer)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '' })
  useEffect(() => { if (open) { setQ(''); setCreating(false); setForm({ name: '', phone: '', email: '' }) } }, [open])
  const list = useMemo(() => {
    const n = q.trim().toLowerCase()
    const l = n ? customers.filter((c) => c.name.toLowerCase().includes(n) || c.phone.replace(/\s/g, '').includes(n.replace(/\s/g, '')) || (c.email ?? '').toLowerCase().includes(n)) : [...customers].sort((a, b) => (b.lastVisitAt ?? '').localeCompare(a.lastVisitAt ?? ''))
    return l.slice(0, 30)
  }, [customers, q])
  const create = () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    const c = upsertCustomer({ name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() || undefined }, user.id)
    toast.success(`Customer ${c.name} created`)
    onPick(c)
  }
  return (
    <Modal open={open} onClose={onClose} title="Attach customer" size="md" subtitle="Search by name, phone or email">
      <div className="pb-3">
        {!creating ? (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Emma, 555-0123…" className="input pl-9" onKeyDown={(e) => { if (e.key === 'Enter' && list.length === 1) onPick(list[0]!) }} /></div>
              <button className="btn-primary" onClick={() => { setCreating(true); setForm({ ...form, name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' }) }}><UserPlus size={15} /> New</button>
            </div>
            <div className="mt-3 max-h-[50vh] overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
              {list.length === 0 && <div className="p-6 text-center text-sm text-slate-400">No customers found. <button className="text-brand-600 font-medium" onClick={() => setCreating(true)}>Create one</button></div>}
              {list.map((c) => (
                <button key={c.id} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50" onClick={() => onPick(c)}>
                  <Avatar name={c.name} color="#7c3aed" size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900 truncate">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.phone}{c.email ? ` · ${c.email}` : ''}</div>
                  </div>
                  <div className="text-right text-xs text-slate-500 shrink-0">
                    <div className="inline-flex items-center gap-0.5"><Star size={11} className="text-amber-500" /> {c.loyaltyPoints.toLocaleString()}</div>
                    {c.storeCredit > 0 && <div className="text-emerald-600 font-medium">{money(c.storeCredit)} credit</div>}
                  </div>
                  <ChevronRight size={16} className="text-slate-300" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><UserPlus size={16} /> New customer</div>
            <Field label="Full name" required><Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setCreating(false)}>Back</button>
              <button className="btn-primary" onClick={create}><Check size={15} /> Create & attach</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Cart discount ───────────────────────────────────────────────────────────
function CartDiscountModal({ open, onClose, current, subtotal, onApply }: { open: boolean; onClose: () => void; current?: LineDiscount; subtotal: number; onApply: (d: LineDiscount | undefined, approver?: string) => void }) {
  const user = useCashierUser()!
  const settings = useDB((s) => s.db.settings)
  const [type, setType] = useState<'percent' | 'fixed'>(current?.type ?? 'percent')
  const [value, setValue] = useState(current ? String(current.value) : '')
  const [reason, setReason] = useState(current?.reason ?? '')
  useEffect(() => { if (open) { setType(current?.type ?? 'percent'); setValue(current ? String(current.value) : ''); setReason(current?.reason ?? '') } }, [open, current])
  const n = parseAmount(value)
  const pct = type === 'percent' ? n : subtotal > 0 ? (Math.min(subtotal, n) / subtotal) * 100 : 0
  const amount = type === 'percent' ? round2(subtotal * Math.min(100, n) / 100) : Math.min(subtotal, n)
  const needs = discountNeedsManager(user, pct, settings)
  const apply = async () => {
    if (n <= 0) { onApply(undefined); return }
    if (type === 'percent' && n > 100) { toast.error('Discount cannot exceed 100%'); return }
    let approver: string | undefined
    if (needs) {
      const m = await requestManagerPin('discount', 'Discount approval', `${pct.toFixed(0)}% off the whole sale${!isManager(user) ? ` exceeds the ${settings.cashierMaxDiscountPercent}% cashier limit` : ''}`)
      if (!m) return
      approver = m.id
    }
    onApply({ type, value: n, reason: reason.trim() || undefined }, approver)
    toast.success(`Discount of ${money(amount)} applied`)
  }
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Cart discount" subtitle={`Applied to the whole sale (${money(subtotal)} after line discounts)`}
      footer={<>{current && <button className="btn-secondary text-red-600 mr-auto" onClick={() => onApply(undefined)}>Remove</button>}<button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={apply} disabled={n <= 0}>Apply</button></>}>
      <div className="space-y-4 pb-2">
        <div className="flex gap-2">
          <Segmented size="md" value={type} onChange={setType} options={[{ value: 'percent', label: '%' }, { value: 'fixed', label: settings.currencySymbol }]} />
          <Input autoFocus type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" className="text-lg font-semibold" onKeyDown={(e) => { if (e.key === 'Enter') apply() }} />
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[5, 10, 15, 20].map((v) => <button key={v} type="button" className={cx('rounded-lg border py-2 text-sm font-semibold', type === 'percent' && n === v ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 hover:bg-slate-50')} onClick={() => { setType('percent'); setValue(String(v)) }}>{v}%</button>)}
        </div>
        <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Price match, loyalty, damaged box…" /></Field>
        {n > 0 && <div className={cx('rounded-lg px-3 py-2 text-sm', needs ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>−{money(amount)} ({pct.toFixed(1)}%){needs ? ' · manager approval will be requested' : ''}</div>}
      </div>
    </Modal>
  )
}

function NoteModal({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => { if (open) setV(value) }, [open, value])
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Sale note" subtitle="Printed on the receipt" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => onSave(v.trim())}>Save</button></>}>
      <Textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. Customer will collect the case tomorrow" className="mb-2" />
    </Modal>
  )
}

function HoldModal({ open, onClose, customerName, onHold }: { open: boolean; onClose: () => void; customerName?: string; onHold: (label: string) => void }) {
  const [label, setLabel] = useState('')
  useEffect(() => { if (open) setLabel(customerName ?? '') }, [open, customerName])
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Hold this sale" subtitle="Give it a label so you can find it again" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => onHold(label.trim())}><PauseCircle size={15} /> Hold sale</button></>}>
      <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Blue jacket, waiting for card" className="mb-2" onKeyDown={(e) => { if (e.key === 'Enter') onHold(label.trim()) }} />
    </Modal>
  )
}

// ─── Payment modal ───────────────────────────────────────────────────────────
type PayMode = 'cash' | 'card' | 'mobile' | 'store_credit' | 'bank_transfer' | 'split'
interface SplitRow { id: string; method: PaymentMethod; amount: string; cardLast4: string; reference: string }
const METHODS: Array<{ id: PayMode; label: string; icon: React.ReactNode }> = [
  { id: 'cash', label: 'Cash', icon: <Banknote size={18} /> },
  { id: 'card', label: 'Card', icon: <CreditCard size={18} /> },
  { id: 'mobile', label: 'Mobile', icon: <Smartphone size={18} /> },
  { id: 'store_credit', label: 'Store credit', icon: <Wallet size={18} /> },
  { id: 'bank_transfer', label: 'Bank', icon: <Landmark size={18} /> },
  { id: 'split', label: 'Split', icon: <Split size={18} /> },
]

function PaymentModal({ cart, totals, customer, registerId, approvedBy, discountPct, onCancel, onDone }: { cart?: Cart; totals: CartTotals; customer?: Customer; registerId: string; approvedBy?: string; discountPct: number; onCancel: () => void; onDone: () => void }) {
  const user = useCashierUser()!
  const settings = useDB((s) => s.db.settings)
  const checkout = useDB((s) => s.checkout)
  const [mode, setMode] = useState<PayMode>('cash')
  const [tendered, setTendered] = useState('')
  const [last4, setLast4] = useState('')
  const [reference, setReference] = useState('')
  const [redeem, setRedeem] = useState(false)
  const [splits, setSplits] = useState<SplitRow[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Transaction | undefined>()

  const hasCredit = !!customer && customer.storeCredit > 0
  const maxRedeem = customer ? Math.min(customer.loyaltyPoints, Math.floor(totals.total / Math.max(settings.loyaltyPointValue, 0.0001))) : 0
  const redeemPoints = redeem ? maxRedeem : 0
  const redeemValue = round2(redeemPoints * settings.loyaltyPointValue)
  const due = round2(Math.max(0, totals.total - redeemValue))
  const tenderedNum = tendered === '' ? due : parseAmount(tendered)
  const change = round2(Math.max(0, tenderedNum - due))
  const cashShort = tenderedNum + 0.005 < due
  const quick = useMemo(() => quickCashOptions(due), [due])
  const splitPaid = round2(splits.reduce((a, r) => a + parseAmount(r.amount), 0))
  const remaining = round2(due - splitPaid)

  useEffect(() => { setTendered('') }, [due, mode])
  useEffect(() => {
    if (mode === 'split' && splits.length === 0) setSplits([{ id: 'sp1', method: 'card', amount: String(due), cardLast4: '', reference: '' }])
  }, [mode, splits.length, due])

  const typeKey = (k: string) => setTendered((t) => {
    if (k === '.' && t.includes('.')) return t
    if (t.split('.')[1]?.length === 2) return t
    return (t + k).slice(0, 9)
  })

  const buildPayments = (): Array<Omit<Payment, 'id' | 'createdAt'>> | undefined => {
    if (due === 0) return [{ method: 'cash', amount: 0, tendered: 0 }]
    switch (mode) {
      case 'cash':
        if (cashShort) { toast.error(`Cash tendered is short by ${money(due - tenderedNum)}`); return }
        return [{ method: 'cash', amount: due, tendered: round2(tenderedNum) }]
      case 'card':
        return [{ method: 'card', amount: due, cardLast4: last4.trim() || undefined, reference: reference.trim() || undefined }]
      case 'mobile':
      case 'bank_transfer':
        return [{ method: mode, amount: due, reference: reference.trim() || undefined }]
      case 'store_credit':
        if (!customer || customer.storeCredit + 0.005 < due) { toast.error('Not enough store credit — use Split to pay the rest another way'); return }
        return [{ method: 'store_credit', amount: due }]
      case 'split': {
        const rows = splits.map((r) => ({ method: r.method, amount: round2(parseAmount(r.amount)), tendered: r.method === 'cash' ? round2(parseAmount(r.amount)) : undefined, cardLast4: r.cardLast4.trim() || undefined, reference: r.reference.trim() || undefined })).filter((r) => r.amount > 0)
        if (!rows.length) { toast.error('Add at least one payment'); return }
        if (remaining > 0.005) { toast.error(`Still ${money(remaining)} remaining`); return }
        const credit = rows.filter((r) => r.method === 'store_credit').reduce((a, r) => a + r.amount, 0)
        if (credit > 0 && (!customer || customer.storeCredit + 0.005 < credit)) { toast.error('Not enough store credit'); return }
        return rows
      }
    }
  }

  const confirmPay = async () => {
    if (busy) return
    const payments = buildPayments()
    if (!payments) return
    let approver = approvedBy
    if (discountNeedsManager(user, discountPct, settings) && !approver) {
      const m = await requestManagerPin('discount', 'Discount approval', `This sale carries a ${discountPct.toFixed(0)}% discount, above the ${settings.cashierMaxDiscountPercent}% cashier limit`)
      if (!m) return
      approver = m.id
    }
    setBusy(true)
    const res = checkout({ registerId, userId: user.id, payments, note: cart?.note, redeemPoints, approvedBy: approver })
    setBusy(false)
    if (!res.ok || !res.transaction) { toast.error(res.message ?? 'Checkout failed'); beep(220, 200); return }
    setResult(res.transaction)
    beep(1320, 120)
    if (settings.autoPrintReceipt) window.setTimeout(printReceipt, 400)
  }

  useEffect(() => {
    if (result) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void confirmPay() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, mode, tendered, last4, reference, redeem, splits, busy])

  if (result) {
    return (
      <Modal open onClose={onDone} size="md">
        <div className="flex flex-col items-center text-center pb-4 fade-up">
          <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><Check size={44} strokeWidth={3} /></div>
          <div className="text-2xl font-bold text-slate-900 mt-4">Payment complete</div>
          <div className="text-sm text-slate-500 mt-1">{result.number} · {money(result.total)} · {result.payments.map((p) => PAYMENT_LABELS[p.method] ?? p.method).join(' + ')}</div>
          {result.change > 0 && (
            <div className="mt-4 rounded-2xl bg-emerald-50 border border-emerald-200 px-8 py-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Change due</div>
              <div className="text-[52px] leading-none font-bold text-emerald-600 tabular-nums mt-1">{money(result.change)}</div>
            </div>
          )}
          {result.loyaltyEarned > 0 && <div className="mt-3 text-sm text-amber-600 inline-flex items-center gap-1"><Star size={14} /> {customer?.name.split(' ')[0]} earned {result.loyaltyEarned} points</div>}
          <div className="mt-5 max-h-[38vh] overflow-y-auto w-full flex justify-center"><Receipt tx={result} compact /></div>
          <div className="mt-5 flex flex-wrap justify-center gap-2 w-full">
            <button className="btn-secondary" onClick={printReceipt}><Printer size={15} /> Print</button>
            <button className="btn-secondary" onClick={() => toast.success(customer?.email ? `Receipt emailed to ${customer.email}` : 'Receipt emailed')}><Mail size={15} /> Email</button>
            <button className="btn-primary flex-1 min-w-[160px] h-11 text-base" autoFocus onClick={onDone}><ScanBarcode size={18} /> New sale</button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onCancel} size="lg" title="Take payment" subtitle={customer ? `Customer: ${customer.name}` : 'Walk-in customer'}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-5 pb-3">
        <div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {METHODS.map((m) => {
              const disabled = m.id === 'store_credit' && !hasCredit
              return (
                <button key={m.id} type="button" disabled={disabled} onClick={() => setMode(m.id)} className={cx('rounded-xl border px-2 py-3 flex flex-col items-center gap-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed', mode === m.id ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                  {m.icon}{m.label}
                </button>
              )
            })}
          </div>

          <div className="mt-4">
            {mode === 'cash' && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-4">
                <div>
                  <div className="label">Cash tendered</div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{settings.currencySymbol}</span>
                    <input value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ''))} placeholder={due.toFixed(2)} className="input !pl-7 h-14 text-2xl font-bold tabular-nums" inputMode="decimal" autoFocus />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {quick.map((v) => <button key={v} type="button" onClick={() => setTendered(String(v))} className={cx('rounded-lg border py-2.5 text-sm font-semibold tabular-nums', parseAmount(tendered) === v ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 hover:bg-slate-50')}>{money(v)}</button>)}
                  </div>
                  <div className={cx('mt-4 rounded-xl px-4 py-3 flex items-center justify-between', cashShort ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>
                    <span className="text-sm font-medium">{cashShort ? 'Short by' : 'Change'}</span>
                    <span className="text-3xl font-bold tabular-nums">{money(cashShort ? due - tenderedNum : change)}</span>
                  </div>
                </div>
                <Keypad onKey={typeKey} onBackspace={() => setTendered((t) => t.slice(0, -1))} leftKey="." />
              </div>
            )}
            {mode === 'card' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Card last 4 (optional)"><Input autoFocus value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4242" className="font-mono h-11 text-lg" /></Field>
                <Field label="Auth / reference (optional)"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="A1B2C3" className="font-mono h-11" /></Field>
                <div className="col-span-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 flex items-center gap-2"><CreditCard size={16} className="text-brand-600" /> Present the terminal to the customer for <b className="text-slate-900">{money(due)}</b>, then confirm.</div>
              </div>
            )}
            {(mode === 'mobile' || mode === 'bank_transfer') && (
              <div className="space-y-3">
                <Field label="Reference (optional)"><Input autoFocus value={reference} onChange={(e) => setReference(e.target.value)} placeholder={mode === 'mobile' ? 'Wallet transaction id' : 'Transfer reference'} className="font-mono h-11" /></Field>
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Confirm once <b className="text-slate-900">{money(due)}</b> has been received via {PAYMENT_LABELS[mode]}.</div>
              </div>
            )}
            {mode === 'store_credit' && customer && (
              <div className="space-y-3">
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Available credit</span><b>{money(customer.storeCredit)}</b></div>
                  <div className="flex justify-between mt-1"><span className="text-slate-500">Applied now</span><b className="text-emerald-600">{money(Math.min(customer.storeCredit, due))}</b></div>
                  <div className="flex justify-between mt-1"><span className="text-slate-500">Remaining after</span><b>{money(Math.max(0, customer.storeCredit - due))}</b></div>
                </div>
                {customer.storeCredit + 0.005 < due && <div className="rounded-xl bg-amber-50 text-amber-700 px-4 py-3 text-sm">Credit covers only part of this sale. <button className="font-semibold underline" onClick={() => { setMode('split'); setSplits([{ id: 'sp1', method: 'store_credit', amount: String(customer.storeCredit), cardLast4: '', reference: '' }, { id: 'sp2', method: 'card', amount: String(round2(due - customer.storeCredit)), cardLast4: '', reference: '' }]) }}>Split the remaining {money(due - customer.storeCredit)}</button></div>}
              </div>
            )}
            {mode === 'split' && (
              <div className="space-y-2">
                {splits.map((r, i) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
                    <Select value={r.method} onChange={(e) => setSplits(splits.map((x) => (x.id === r.id ? { ...x, method: e.target.value as PaymentMethod } : x)))} className="!w-36">
                      <option value="cash">Cash</option><option value="card">Card</option><option value="mobile">Mobile Pay</option>{hasCredit && <option value="store_credit">Store credit</option>}<option value="bank_transfer">Bank transfer</option>
                    </Select>
                    <div className="relative w-32"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{settings.currencySymbol}</span><Input type="number" min={0} step="0.01" value={r.amount} onChange={(e) => setSplits(splits.map((x) => (x.id === r.id ? { ...x, amount: e.target.value } : x)))} className="pl-7 font-semibold tabular-nums" /></div>
                    {r.method === 'card' && <Input value={r.cardLast4} onChange={(e) => setSplits(splits.map((x) => (x.id === r.id ? { ...x, cardLast4: e.target.value.replace(/\D/g, '').slice(0, 4) } : x)))} placeholder="Last 4" className="!w-24 font-mono" />}
                    {r.method !== 'cash' && r.method !== 'store_credit' && <Input value={r.reference} onChange={(e) => setSplits(splits.map((x) => (x.id === r.id ? { ...x, reference: e.target.value } : x)))} placeholder="Ref" className="!w-28 font-mono" />}
                    <button className="btn-ghost !px-2 ml-auto text-slate-400 hover:text-red-600" disabled={splits.length === 1} onClick={() => setSplits(splits.filter((x) => x.id !== r.id))}><X size={15} /></button>
                    {i === splits.length - 1 && remaining > 0.005 && <button className="btn-ghost !px-2 text-brand-600" onClick={() => setSplits(splits.map((x) => (x.id === r.id ? { ...x, amount: String(round2(parseAmount(x.amount) + remaining)) } : x)))}>Fill</button>}
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <button className="btn-secondary" disabled={remaining <= 0.005} onClick={() => setSplits([...splits, { id: `sp${Date.now()}`, method: 'cash', amount: String(Math.max(0, remaining)), cardLast4: '', reference: '' }])}><Plus size={14} /> Add payment</button>
                  <div className={cx('text-sm font-semibold tabular-nums', remaining > 0.005 ? 'text-amber-600' : remaining < -0.005 ? 'text-red-600' : 'text-emerald-600')}>{remaining > 0.005 ? `Remaining ${money(remaining)}` : remaining < -0.005 ? `Over by ${money(-remaining)}` : 'Fully allocated'}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Summary column */}
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 flex flex-col">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Amount due</div>
          <div className="text-[40px] leading-none font-bold text-slate-900 tabular-nums mt-1 tracking-tight">{money(due)}</div>
          <div className="mt-4 space-y-1 text-sm">
            <Row label="Subtotal" value={money(totals.subtotal)} />
            {totals.discountTotal > 0 && <Row label="Discounts" value={`−${money(totals.discountTotal)}`} className="text-emerald-600" />}
            <Row label={settings.taxName} value={money(totals.tax)} />
            {redeemValue > 0 && <Row label={`${redeemPoints} points`} value={`−${money(redeemValue)}`} className="text-amber-600" />}
            <div className="flex items-center justify-between font-semibold text-slate-900 pt-1 border-t border-slate-200"><span>Total</span><span className="tabular-nums">{money(totals.total)}</span></div>
          </div>
          {customer && maxRedeem > 0 && (
            <div className="mt-4 rounded-xl bg-white border border-amber-200 p-3">
              <Toggle checked={redeem} onChange={setRedeem} label={<span className="text-sm">Redeem <b>{maxRedeem.toLocaleString()}</b> points <span className="text-slate-500">(= {money(round2(maxRedeem * settings.loyaltyPointValue))})</span></span>} />
            </div>
          )}
          {discountNeedsManager(user, discountPct, settings) && !approvedBy && <div className="mt-3 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">Manager PIN will be requested ({discountPct.toFixed(0)}% discount)</div>}
          <div className="flex-1" />
          <button className="btn-success w-full h-14 text-lg rounded-xl mt-4" disabled={busy || (mode === 'cash' && cashShort) || (mode === 'split' && remaining > 0.005) || (mode === 'store_credit' && (!customer || customer.storeCredit + 0.005 < due))} onClick={confirmPay}>
            <Check size={20} /> Confirm {money(due)}
          </button>
          <button className="btn-ghost w-full mt-2" onClick={onCancel}>Cancel</button>
          <div className="text-center text-[11px] text-slate-400 mt-2"><Kbd>Enter</Kbd> confirm · <Kbd>Esc</Kbd> cancel</div>
        </div>
      </div>
    </Modal>
  )
}
