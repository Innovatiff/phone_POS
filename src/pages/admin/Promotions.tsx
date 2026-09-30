import React, { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus, Tag, Pencil, Trash2, Percent, BadgeDollarSign, Gift, Boxes, Clock, CalendarCheck, Sparkles, Search, Info, LayoutGrid, List } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import type { Promotion, PromotionType, PromotionScope, CartLine, ID } from '@/lib/types'
import { money, cx, fmtDate, ago, round2 } from '@/lib/utils'
import { promotionForCart } from '@/lib/pos'
import { PageHeader, StatCard, Badge, SearchInput, Segmented, DataTable, Drawer, Field, Input, Toggle, Checkbox, confirm, toast, EmptyState, Tabs, type Column } from '@/components/ui'

type PromoStatus = 'active' | 'scheduled' | 'expired' | 'inactive'
export function promoStatus(p: Promotion, now = Date.now()): PromoStatus {
  if (!p.active) return 'inactive'
  if (new Date(p.startsAt).getTime() > now) return 'scheduled'
  if (new Date(p.endsAt).getTime() < now) return 'expired'
  return 'active'
}
const STATUS_TONE: Record<PromoStatus, 'green' | 'blue' | 'slate' | 'red'> = { active: 'green', scheduled: 'blue', expired: 'red', inactive: 'slate' }
const TYPE_META: Record<PromotionType, { label: string; icon: React.ReactNode; color: string; blurb: string }> = {
  percent: { label: 'Percent off', icon: <Percent size={15} />, color: '#2563eb', blurb: 'Takes a percentage off the eligible items (after any line discounts).' },
  fixed: { label: 'Fixed amount off', icon: <BadgeDollarSign size={15} />, color: '#059669', blurb: 'Takes a fixed amount off the eligible items, never more than their value.' },
  bogo: { label: 'Buy one get one', icon: <Gift size={15} />, color: '#db2777', blurb: 'For every two eligible units the cheaper one is free. Units are paired highest-price first.' },
  bundle: { label: 'Bundle deal', icon: <Boxes size={15} />, color: '#ea580c', blurb: 'When the customer buys at least the minimum quantity of eligible items, a fixed amount comes off.' },
}
const valueLabel = (p: Pick<Promotion, 'type' | 'value'>) => p.type === 'percent' ? `${p.value}% off` : p.type === 'bogo' ? 'Buy 1 get 1 free' : `${money(p.value)} off`
const toLocalInput = (iso: string) => { try { return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm") } catch { return '' } }
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '')

export default function Promotions() {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const upsertPromotion = useDB((s) => s.upsertPromotion)
  const deletePromotion = useDB((s) => s.deletePromotion)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'all' | PromoStatus>('all')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [editor, setEditor] = useState<{ open: boolean; promo?: Promotion }>({ open: false })

  const catName = (id: ID) => db.categories.find((c) => c.id === id)?.name ?? 'Unknown category'
  const prodName = (id: ID) => db.products.find((p) => p.id === id)?.name ?? 'Unknown product'
  const scopeText = (p: Promotion) => {
    if (p.scope === 'all') return 'All products'
    const names = p.targetIds.map(p.scope === 'category' ? catName : prodName)
    if (!names.length) return p.scope === 'category' ? 'No categories selected' : 'No products selected'
    return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`
  }

  const counts = useMemo(() => { const c: Record<'all' | PromoStatus, number> = { all: db.promotions.length, active: 0, scheduled: 0, expired: 0, inactive: 0 }; db.promotions.forEach((p) => { c[promoStatus(p)]++ }); return c }, [db.promotions])
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const order: Record<PromoStatus, number> = { active: 0, scheduled: 1, inactive: 2, expired: 3 }
    return db.promotions.filter((p) => (tab === 'all' || promoStatus(p) === tab) && (!term || p.name.toLowerCase().includes(term) || (p.code ?? '').toLowerCase().includes(term) || (p.description ?? '').toLowerCase().includes(term)))
      .sort((a, b) => order[promoStatus(a)] - order[promoStatus(b)] || b.usageCount - a.usageCount)
  }, [db.promotions, q, tab])
  const totalUsage = db.promotions.reduce((a, p) => a + p.usageCount, 0)
  const endingSoon = db.promotions.filter((p) => promoStatus(p) === 'active' && new Date(p.endsAt).getTime() - Date.now() < 7 * 86400000).length

  const toggle = (p: Promotion, v: boolean) => { upsertPromotion({ id: p.id, active: v }, admin.id); toast.success(`${p.name} ${v ? 'enabled' : 'disabled'}`) }
  const remove = async (p: Promotion) => {
    if (!(await confirm(`Delete “${p.name}”?`, `This promotion has been used ${p.usageCount} time(s). Past transactions keep their discount.`, { danger: true, confirmLabel: 'Delete' }))) return
    deletePromotion(p.id, admin.id)
    toast.success('Promotion deleted')
  }

  const cols: Column<Promotion>[] = [
    { key: 'name', header: 'Promotion', sortValue: (p) => p.name, render: (p) => <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${TYPE_META[p.type].color}1a`, color: TYPE_META[p.type].color }}>{TYPE_META[p.type].icon}</div><div className="min-w-0"><div className="font-medium text-slate-800 truncate">{p.name}</div>{p.description && <div className="text-[11px] text-slate-400 truncate max-w-[260px]">{p.description}</div>}</div></div> },
    { key: 'code', header: 'Code', sortValue: (p) => p.code ?? '', render: (p) => p.code ? <span className="font-mono text-xs font-semibold bg-slate-100 text-slate-700 rounded px-1.5 py-0.5">{p.code}</span> : <span className="text-slate-300 text-xs">automatic</span> },
    { key: 'type', header: 'Type', sortValue: (p) => p.type, render: (p) => <div><div className="text-slate-700">{TYPE_META[p.type].label}</div><div className="text-[11px] text-slate-400">{valueLabel(p)}</div></div> },
    { key: 'scope', header: 'Applies to', render: (p) => <div><Badge tone={p.scope === 'all' ? 'blue' : p.scope === 'category' ? 'purple' : 'cyan'}>{p.scope === 'all' ? 'Everything' : p.scope === 'category' ? 'Categories' : 'Products'}</Badge><div className="text-[11px] text-slate-400 mt-0.5 max-w-[220px] truncate">{scopeText(p)}</div></div> },
    { key: 'min', header: 'Min qty', align: 'right', render: (p) => <span className="tabular-nums text-slate-600">{p.minQty ?? '—'}</span> },
    { key: 'dates', header: 'Runs', sortValue: (p) => p.startsAt, render: (p) => <div className="text-xs"><div className="text-slate-700">{fmtDate(p.startsAt, 'MMM d, yyyy HH:mm')}</div><div className="text-slate-400">→ {fmtDate(p.endsAt, 'MMM d, yyyy HH:mm')}</div></div> },
    { key: 'status', header: 'Status', sortValue: (p) => promoStatus(p), render: (p) => { const s = promoStatus(p); return <Badge tone={STATUS_TONE[s]} dot>{s[0]!.toUpperCase() + s.slice(1)}</Badge> } },
    { key: 'usage', header: 'Used', align: 'right', sortValue: (p) => p.usageCount, render: (p) => <span className="tabular-nums font-medium">{p.usageCount}×</span> },
    { key: 'active', header: 'On', align: 'center', render: (p) => <div onClick={(e) => e.stopPropagation()} className="inline-flex"><Toggle checked={p.active} onChange={(v) => toggle(p, v)} /></div> },
    { key: 'actions', header: '', align: 'right', render: (p) => <div className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}><button className="btn-ghost !py-1 !px-2" onClick={() => setEditor({ open: true, promo: p })}><Pencil size={13} /></button><button className="btn-ghost !py-1 !px-2 text-red-600 hover:bg-red-50" onClick={() => remove(p)}><Trash2 size={13} /></button></div> },
  ]

  return (
    <div>
      <PageHeader title="Promotions" subtitle="Discount rules the register applies automatically or by code" actions={<button className="btn-primary" onClick={() => setEditor({ open: true })}><Plus size={15} /> New promotion</button>} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <StatCard label="Active now" value={counts.active} icon={<Sparkles size={14} className="text-emerald-500" />} onClick={() => setTab('active')} hint={endingSoon ? `${endingSoon} ending within 7 days` : undefined} />
        <StatCard label="Scheduled" value={counts.scheduled} icon={<CalendarCheck size={14} className="text-blue-500" />} onClick={() => setTab('scheduled')} hint="Starting later" />
        <StatCard label="Total redemptions" value={totalUsage} icon={<Tag size={14} />} hint="Across all promotions" />
        <StatCard label="Expired / inactive" value={counts.expired + counts.inactive} icon={<Clock size={14} />} onClick={() => setTab('expired')} />
      </div>

      <div className="card p-5">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All', count: counts.all }, { value: 'active', label: 'Active', count: counts.active }, { value: 'scheduled', label: 'Scheduled', count: counts.scheduled }, { value: 'expired', label: 'Expired', count: counts.expired }, { value: 'inactive', label: 'Inactive', count: counts.inactive }]} />
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, code…" className="w-full md:w-64" />
          <div className="flex-1" />
          <Segmented value={view} onChange={setView} options={[{ value: 'cards', label: <span className="inline-flex items-center gap-1"><LayoutGrid size={13} /> Cards</span> }, { value: 'table', label: <span className="inline-flex items-center gap-1"><List size={13} /> Table</span> }]} />
        </div>
        {!rows.length ? (
          <EmptyState icon={<Tag size={22} />} title="No promotions here" description="Create percent, fixed, buy-one-get-one or bundle deals and scope them to everything, a category or specific products." action={<button className="btn-primary" onClick={() => setEditor({ open: true })}><Plus size={15} /> New promotion</button>} />
        ) : view === 'table' ? (
          <DataTable rows={rows} columns={cols} pageSize={15} onRowClick={(p) => setEditor({ open: true, promo: p })} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((p) => { const s = promoStatus(p); const meta = TYPE_META[p.type]; return (
              <div key={p.id} className={cx('rounded-xl border border-slate-100 p-4 hover:shadow-pop transition-shadow cursor-pointer group', s !== 'active' && 'bg-slate-50/50')} onClick={() => setEditor({ open: true, promo: p })}>
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${meta.color}1a`, color: meta.color }}>{meta.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 truncate group-hover:text-brand-700">{p.name}</div>
                    <div className="text-sm font-medium" style={{ color: meta.color }}>{valueLabel(p)}</div>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}><Toggle checked={p.active} onChange={(v) => toggle(p, v)} /></div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  <Badge tone={STATUS_TONE[s]} dot>{s[0]!.toUpperCase() + s.slice(1)}</Badge>
                  {p.code ? <span className="font-mono text-[11px] font-semibold bg-slate-100 text-slate-700 rounded px-1.5 py-0.5">{p.code}</span> : <Badge tone="slate">Automatic</Badge>}
                  {p.minQty && <Badge tone="amber">min {p.minQty}</Badge>}
                </div>
                <div className="text-xs text-slate-500 mt-2 truncate"><span className="text-slate-400">Applies to:</span> {scopeText(p)}</div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                  <span>{s === 'scheduled' ? `Starts ${ago(p.startsAt)}` : s === 'expired' ? `Ended ${ago(p.endsAt)}` : `Ends ${ago(p.endsAt)}`}</span>
                  <span className="font-medium text-slate-700">{p.usageCount}× used</span>
                </div>
              </div>
            ) })}
          </div>
        )}
      </div>

      <PromotionEditor open={editor.open} promo={editor.promo} onClose={() => setEditor({ open: false })} onDelete={remove} />
    </div>
  )
}

// ─── Editor ──────────────────────────────────────────────────────────────────
interface Form { name: string; code: string; description: string; type: PromotionType; value: string; scope: PromotionScope; targetIds: ID[]; minQty: string; startsAt: string; endsAt: string; active: boolean }
function PromotionEditor({ open, onClose, promo, onDelete }: { open: boolean; onClose: () => void; promo?: Promotion; onDelete: (p: Promotion) => void }) {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const upsertPromotion = useDB((s) => s.upsertPromotion)
  const blank = (): Form => {
    const start = new Date(); start.setMinutes(0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 30)
    return { name: '', code: '', description: '', type: 'percent', value: '10', scope: 'all', targetIds: [], minQty: '', startsAt: toLocalInput(start.toISOString()), endsAt: toLocalInput(end.toISOString()), active: true }
  }
  const [f, setF] = useState<Form>(blank)
  const [targetSearch, setTargetSearch] = useState('')
  useEffect(() => {
    if (!open) return
    setTargetSearch('')
    if (promo) setF({ name: promo.name, code: promo.code ?? '', description: promo.description ?? '', type: promo.type, value: String(promo.value), scope: promo.scope, targetIds: [...promo.targetIds], minQty: promo.minQty ? String(promo.minQty) : '', startsAt: toLocalInput(promo.startsAt), endsAt: toLocalInput(promo.endsAt), active: promo.active })
    else setF(blank())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, promo?.id])
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }))
  const toggleTarget = (id: ID) => set('targetIds', f.targetIds.includes(id) ? f.targetIds.filter((x) => x !== id) : [...f.targetIds, id])

  const targetList = useMemo(() => {
    const term = targetSearch.trim().toLowerCase()
    if (f.scope === 'category') return db.categories.filter((c) => !term || c.name.toLowerCase().includes(term)).map((c) => ({ id: c.id, label: c.name, sub: `${db.products.filter((p) => p.categoryId === c.id).length} products`, emoji: c.icon }))
    if (f.scope === 'product') return db.products.filter((p) => p.active && (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))).slice(0, 60).map((p) => ({ id: p.id, label: p.name, sub: `${p.sku} · ${money(p.price)}`, emoji: p.emoji }))
    return []
  }, [f.scope, targetSearch, db.categories, db.products])

  // Live preview using the real cart engine
  const draft: Promotion = useMemo(() => ({ id: promo?.id ?? 'preview', name: f.name, code: f.code, type: f.type, value: Number(f.value) || 0, scope: f.scope, targetIds: f.targetIds, minQty: f.minQty ? Number(f.minQty) : undefined, startsAt: new Date(0).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString(), active: true, usageCount: 0 }), [f, promo?.id])
  const example = useMemo(() => {
    let sample = f.scope === 'product' ? db.products.find((p) => f.targetIds.includes(p.id)) : f.scope === 'category' ? db.products.find((p) => f.targetIds.includes(p.categoryId) && p.active) : db.products.find((p) => p.active && p.categoryId !== 'cat_service')
    if (!sample) sample = db.products[0]
    if (!sample) return null
    const qty = Math.max(f.minQty ? Number(f.minQty) || 1 : 1, f.type === 'bogo' ? 2 : 1)
    const line: CartLine = { id: 'l1', productId: sample.id, name: sample.name, sku: sample.sku, emoji: sample.emoji, unitPrice: sample.price, originalPrice: sample.price, qty, taxable: sample.taxable }
    const discount = promotionForCart(draft, [line], db.products)
    const subtotal = round2(sample.price * qty)
    return { sample, qty, subtotal, discount, after: round2(subtotal - discount) }
  }, [draft, db.products, f.scope, f.targetIds, f.minQty, f.type])

  const howItApplies = () => {
    const who = f.scope === 'all' ? 'every item in the cart' : f.scope === 'category' ? `items in ${f.targetIds.length} selected categor${f.targetIds.length === 1 ? 'y' : 'ies'}` : `${f.targetIds.length} selected product${f.targetIds.length === 1 ? '' : 's'}`
    const gate = f.minQty ? ` once at least ${f.minQty} eligible unit${Number(f.minQty) === 1 ? '' : 's'} are in the cart` : ''
    const trigger = f.code.trim() ? `when the cashier enters code ${f.code.trim().toUpperCase()}` : 'automatically at checkout'
    switch (f.type) {
      case 'percent': return `Takes ${Number(f.value) || 0}% off ${who}${gate}, ${trigger}. Applied after line discounts and cart discounts, before tax.`
      case 'fixed': return `Takes ${money(Number(f.value) || 0)} off the total of ${who}${gate}, ${trigger}. Never exceeds the eligible value.`
      case 'bogo': return `Pairs up ${who}${gate} and makes the cheaper unit of each pair free, ${trigger}.`
      case 'bundle': return `Takes ${money(Number(f.value) || 0)} off ${who} when at least ${f.minQty || 2} eligible units are bought, ${trigger}.`
    }
  }

  const save = () => {
    if (!f.name.trim()) { toast.error('Give the promotion a name'); return }
    if (f.type !== 'bogo' && !(Number(f.value) > 0)) { toast.error('Enter a discount value above zero'); return }
    if (f.type === 'percent' && Number(f.value) > 100) { toast.error('Percent cannot exceed 100'); return }
    if (f.scope !== 'all' && !f.targetIds.length) { toast.error(`Select at least one ${f.scope}`); return }
    if (!f.startsAt || !f.endsAt) { toast.error('Set start and end dates'); return }
    if (new Date(f.endsAt) <= new Date(f.startsAt)) { toast.error('End must be after start'); return }
    const code = f.code.trim().toUpperCase()
    if (code && db.promotions.some((p) => p.id !== promo?.id && (p.code ?? '').toUpperCase() === code)) { toast.error('Another promotion already uses that code'); return }
    upsertPromotion({ id: promo?.id, name: f.name.trim(), code: code || undefined, description: f.description.trim() || undefined, type: f.type, value: f.type === 'bogo' ? 0 : round2(Number(f.value)), scope: f.scope, targetIds: f.scope === 'all' ? [] : f.targetIds, minQty: f.minQty ? Math.max(1, Math.round(Number(f.minQty))) : undefined, startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt), active: f.active }, admin.id)
    toast.success(promo ? 'Promotion updated' : 'Promotion created')
    onClose()
  }
  const previewStatus = promoStatus({ ...draft, active: f.active, startsAt: fromLocalInput(f.startsAt) || draft.startsAt, endsAt: fromLocalInput(f.endsAt) || draft.endsAt })

  return (
    <Drawer open={open} onClose={onClose} title={promo ? 'Edit promotion' : 'New promotion'} width="max-w-2xl"
      footer={<>
        {promo && <button className="btn-ghost text-red-600 hover:bg-red-50 mr-auto" onClick={() => { onClose(); onDelete(promo) }}><Trash2 size={14} /> Delete</button>}
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save}>{promo ? 'Save changes' : 'Create promotion'}</button>
      </>}>
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
          <Field label="Name" required><Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Spring accessories sale" /></Field>
          <Field label="Promo code" hint="Blank = applies automatically"><Input value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="SPRING10" className="font-mono uppercase" /></Field>
        </div>
        <Field label="Description" hint="Shown on the customer display when active"><Input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Short customer-facing description" /></Field>

        <section>
          <span className="label">Discount type</span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(Object.keys(TYPE_META) as PromotionType[]).map((t) => { const m = TYPE_META[t]; const on = f.type === t; return (
              <button key={t} type="button" onClick={() => set('type', t)} className={cx('rounded-xl border p-3 text-left transition-colors', on ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20' : 'border-slate-200 hover:bg-slate-50')}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: `${m.color}1a`, color: m.color }}>{m.icon}</div>
                <div className="text-sm font-medium text-slate-800">{m.label}</div>
              </button>
            ) })}
          </div>
          <div className="text-xs text-slate-500 mt-2 flex items-start gap-1.5"><Info size={13} className="shrink-0 mt-px text-slate-400" />{TYPE_META[f.type].blurb}</div>
        </section>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {f.type !== 'bogo' && <Field label={f.type === 'percent' ? 'Percent off' : 'Amount off'} required><div className="relative"><Input type="number" min={0} max={f.type === 'percent' ? 100 : undefined} step={f.type === 'percent' ? 1 : 0.01} value={f.value} onChange={(e) => set('value', e.target.value)} className="pr-8" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{f.type === 'percent' ? '%' : db.settings.currencySymbol}</span></div></Field>}
          <Field label={f.type === 'bundle' ? 'Bundle size (min qty)' : 'Minimum quantity'} hint={f.type === 'bundle' ? 'Required for bundles' : 'Optional'}><Input type="number" min={1} value={f.minQty} onChange={(e) => set('minQty', e.target.value)} placeholder={f.type === 'bundle' ? '2' : 'any'} /></Field>
          <div className="flex items-end pb-2"><Toggle checked={f.active} onChange={(v) => set('active', v)} label="Enabled" /></div>
        </div>

        <section>
          <span className="label">Applies to</span>
          <Segmented value={f.scope} onChange={(v) => { set('scope', v); set('targetIds', []) }} size="md" options={[{ value: 'all', label: 'All products' }, { value: 'category', label: 'Categories' }, { value: 'product', label: 'Specific products' }]} />
          {f.scope !== 'all' && (
            <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-2 border-b border-slate-100 flex items-center gap-2">
                <div className="relative flex-1"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} placeholder={`Filter ${f.scope === 'category' ? 'categories' : 'products'}…`} className="input pl-8 !py-1.5" /></div>
                <span className="text-xs text-slate-500 whitespace-nowrap">{f.targetIds.length} selected</span>
                {f.targetIds.length > 0 && <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => set('targetIds', [])}>Clear</button>}
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
                {targetList.map((t) => (
                  <div key={t.id} className={cx('flex items-center gap-3 px-3 py-1.5 hover:bg-slate-50', f.targetIds.includes(t.id) && 'bg-brand-50/50')}>
                    <Checkbox checked={f.targetIds.includes(t.id)} onChange={() => toggleTarget(t.id)} />
                    <span className="text-base">{t.emoji}</span>
                    <button type="button" className="flex-1 text-left min-w-0" onClick={() => toggleTarget(t.id)}><div className="text-sm text-slate-800 truncate">{t.label}</div><div className="text-[11px] text-slate-400">{t.sub}</div></button>
                  </div>
                ))}
                {!targetList.length && <div className="px-3 py-6 text-center text-sm text-slate-400">Nothing matches</div>}
              </div>
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Starts" required><Input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
          <Field label="Ends" required><Input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
        </div>

        <section className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">How it applies</div>
            <Badge tone={STATUS_TONE[previewStatus]} dot>{previewStatus[0]!.toUpperCase() + previewStatus.slice(1)}</Badge>
          </div>
          <p className="text-sm text-slate-700">{howItApplies()}</p>
          {example && (
            <div className="rounded-lg bg-white border border-slate-100 p-3 text-sm">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Example, computed by the register engine</div>
              <div className="flex items-center gap-2 text-slate-700"><span className="text-lg">{example.sample.emoji}</span><span className="truncate">{example.qty} × {example.sample.name}</span><span className="ml-auto tabular-nums">{money(example.subtotal)}</span></div>
              <div className="flex items-center justify-between text-slate-600 mt-1"><span>Promotion “{f.name || 'Untitled'}”</span><span className={cx('tabular-nums font-medium', example.discount > 0 ? 'text-emerald-600' : 'text-slate-400')}>−{money(example.discount)}</span></div>
              <div className="flex items-center justify-between font-semibold text-slate-900 mt-1 pt-1 border-t border-slate-100"><span>Subtotal before tax</span><span className="tabular-nums">{money(example.after)}</span></div>
              {example.discount === 0 && <div className="text-[11px] text-amber-600 mt-1.5">No discount on this example — check the scope, targets or minimum quantity.</div>}
            </div>
          )}
        </section>
      </div>
    </Drawer>
  )
}

