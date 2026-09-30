import React, { useMemo, useRef, useState } from 'react'
import { Store, Percent, Receipt as ReceiptIcon, Star, Monitor, Database, Save, RotateCcw, Download, Upload, Trash2, Plus, X, AlertTriangle, ExternalLink, Info } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import { Card, Field, Input, KV, PageHeader, Select, Tabs, Textarea, Toggle, confirm, toast } from '@/components/ui'
import { cx, downloadFile, fmtDateTime, money, round2 } from '@/lib/utils'
import type { Database as DBType, Settings as SettingsType } from '@/lib/types'

type Tab = 'store' | 'tax' | 'receipt' | 'loyalty' | 'display' | 'data'
type Draft = SettingsType
const TAB_KEYS: Record<Exclude<Tab, 'data'>, Array<keyof SettingsType>> = {
  store: ['storeName', 'tagline', 'address', 'phone', 'email', 'website'],
  tax: ['currency', 'currencySymbol', 'locale', 'taxName', 'taxRate', 'taxInclusive', 'numberPrefix', 'openingFloatDefault', 'cashierMaxDiscountPercent', 'requireManagerForRefund', 'requireManagerForVoid'],
  receipt: ['receiptHeader', 'receiptFooter', 'autoPrintReceipt'],
  loyalty: ['loyaltyPointsPerCurrency', 'loyaltyPointValue'],
  display: ['displayIdleMessages', 'displayShowPromotions', 'displayAccent'],
}
const CURRENCIES: Array<[string, string, string]> = [['USD', '$', 'en-US'], ['EUR', '€', 'de-DE'], ['GBP', '£', 'en-GB'], ['CAD', 'CA$', 'en-CA'], ['AUD', 'A$', 'en-AU'], ['INR', '₹', 'en-IN'], ['NGN', '₦', 'en-NG'], ['KES', 'KSh', 'en-KE'], ['ZAR', 'R', 'en-ZA'], ['AED', 'د.إ', 'ar-AE'], ['JPY', '¥', 'ja-JP'], ['MXN', 'MX$', 'es-MX'], ['BRL', 'R$', 'pt-BR'], ['PHP', '₱', 'en-PH']]

export default function Settings() {
  const admin = useAdminUser()!
  const db = useDB((s) => s.db)
  const updateSettings = useDB((s) => s.updateSettings)
  const resetDemo = useDB((s) => s.resetDemo)
  const importDatabase = useDB((s) => s.importDatabase)
  const exportDatabase = useDB((s) => s.exportDatabase)
  const settings = db.settings

  const [tab, setTab] = useState<Tab>('store')
  const [draft, setDraft] = useState<Draft>({ ...settings, displayIdleMessages: [...settings.displayIdleMessages] })
  const fileRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const dirtyKeys = (t: Exclude<Tab, 'data'>) => TAB_KEYS[t].filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(settings[k]))
  const save = (t: Exclude<Tab, 'data'>) => {
    const keys = dirtyKeys(t)
    if (!keys.length) { toast.info('Nothing to save'); return }
    const patch: Partial<SettingsType> = {}
    keys.forEach((k) => { (patch as Record<string, unknown>)[k] = draft[k] })
    if (t === 'store' && !draft.storeName.trim()) { toast.error('Store name is required'); return }
    if (t === 'tax' && (draft.taxRate < 0 || draft.taxRate > 100)) { toast.error('Tax rate must be between 0 and 100'); return }
    if (t === 'tax' && !draft.numberPrefix.trim()) { toast.error('Receipt number prefix is required'); return }
    if (t === 'loyalty' && (draft.loyaltyPointsPerCurrency < 0 || draft.loyaltyPointValue < 0)) { toast.error('Loyalty values cannot be negative'); return }
    updateSettings(patch, admin.id)
    toast.success(`${labelOf(t)} settings saved`)
  }
  const discard = (t: Exclude<Tab, 'data'>) => { setDraft((d) => { const n = { ...d }; TAB_KEYS[t].forEach((k) => { (n as Record<string, unknown>)[k] = Array.isArray(settings[k]) ? [...(settings[k] as string[])] : settings[k] }); return n }) }
  const labelOf = (t: Tab) => ({ store: 'Store', tax: 'Sales & tax', receipt: 'Receipt', loyalty: 'Loyalty', display: 'Customer display', data: 'Data' })[t]

  const SaveBar = ({ t }: { t: Exclude<Tab, 'data'> }) => {
    const n = dirtyKeys(t).length
    return (
      <div className="flex items-center justify-end gap-2 pt-4 mt-2 border-t border-slate-100">
        {n > 0 && <span className="text-xs text-amber-600 mr-auto inline-flex items-center gap-1"><AlertTriangle size={12} /> {n} unsaved change{n > 1 ? 's' : ''}</span>}
        <button className="btn-secondary" disabled={!n} onClick={() => discard(t)}><RotateCcw size={14} /> Discard</button>
        <button className="btn-primary" disabled={!n} onClick={() => save(t)}><Save size={14} /> Save {labelOf(t).toLowerCase()}</button>
      </div>
    )
  }

  // ── Data tab helpers ──
  const counts = useMemo(() => ([['Products', db.products.length], ['Customers', db.customers.length], ['Transactions', db.transactions.length], ['Shifts', db.shifts.length], ['Stock movements', db.stockMovements.length], ['Activity events', db.activity.length], ['Repairs', db.repairs.length], ['Purchase orders', db.purchaseOrders.length], ['Promotions', db.promotions.length], ['Alerts', db.alerts.length], ['Staff', db.users.length], ['Registers', db.registers.length]] as Array<[string, number]>), [db])
  const exportJSON = () => { const json = exportDatabase(); downloadFile(`phoneman-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, json, 'application/json'); toast.success(`Backup exported (${(json.length / 1024).toFixed(0)} KB)`) }
  const onImport = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as DBType
      if (!parsed || !Array.isArray(parsed.products) || !parsed.settings) { toast.error('That file is not a valid Phone man backup'); return }
      if (!(await confirm('Import database?', <>This replaces <b>all current data</b> ({db.transactions.length} transactions, {db.products.length} products…) with the contents of <b>{file.name}</b> ({parsed.transactions?.length ?? 0} transactions, {parsed.products.length} products). This cannot be undone — export a backup first.</>, { danger: true, confirmLabel: 'Replace data' }))) return
      const ok = importDatabase(parsed)
      if (ok) { toast.success('Database imported'); setDraft({ ...parsed.settings, displayIdleMessages: [...parsed.settings.displayIdleMessages] }) } else toast.error('Import failed')
    } catch { toast.error('Could not parse JSON file') }
    if (fileRef.current) fileRef.current.value = ''
  }
  const doReset = async () => {
    if (!(await confirm('Reset demo data?', 'All products, customers, transactions, shifts and settings will be replaced with fresh demo data. Sessions stay signed in.', { danger: true, confirmLabel: 'Reset everything' }))) return
    resetDemo()
    const fresh = useDB.getState().db.settings
    setDraft({ ...fresh, displayIdleMessages: [...fresh.displayIdleMessages] })
    toast.success('Demo data reset')
  }

  // ── Receipt preview data ──
  const preview = useMemo(() => {
    const p = db.products.find((x) => x.active && x.categoryId !== 'cat_service') ?? db.products[0]
    const acc = db.products.find((x) => x.id !== p?.id && x.price < 60 && x.categoryId !== 'cat_service')
    const lines = [p, acc].filter(Boolean).map((x) => ({ name: x!.name, emoji: x!.emoji, qty: 1, price: x!.price, taxable: x!.taxable }))
    const rate = draft.taxRate / 100
    const sub = round2(lines.reduce((a, l) => a + l.price * l.qty, 0))
    const taxable = lines.filter((l) => l.taxable).reduce((a, l) => a + l.price * l.qty, 0)
    const tax = draft.taxInclusive ? round2(taxable - taxable / (1 + rate)) : round2(taxable * rate)
    const total = draft.taxInclusive ? sub : round2(sub + tax)
    return { lines, sub, tax, total, points: Math.floor(total * draft.loyaltyPointsPerCurrency) }
  }, [db.products, draft.taxRate, draft.taxInclusive, draft.loyaltyPointsPerCurrency])

  const fmt = (n: number) => { try { return new Intl.NumberFormat(draft.locale, { style: 'currency', currency: draft.currency }).format(n) } catch { return `${draft.currencySymbol}${n.toFixed(2)}` } }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Store configuration, taxes, receipts, loyalty, customer display and data" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'store', label: <span className="inline-flex items-center gap-1.5"><Store size={14} /> Store</span> },
        { value: 'tax', label: <span className="inline-flex items-center gap-1.5"><Percent size={14} /> Sales & Tax</span> },
        { value: 'receipt', label: <span className="inline-flex items-center gap-1.5"><ReceiptIcon size={14} /> Receipt</span> },
        { value: 'loyalty', label: <span className="inline-flex items-center gap-1.5"><Star size={14} /> Loyalty</span> },
        { value: 'display', label: <span className="inline-flex items-center gap-1.5"><Monitor size={14} /> Customer Display</span> },
        { value: 'data', label: <span className="inline-flex items-center gap-1.5"><Database size={14} /> Data</span> },
      ]} />

      {tab === 'store' && (
        <Card title="Store profile" subtitle="Shown on receipts, the customer display and the admin header">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Store name" required><Input value={draft.storeName} onChange={(e) => set('storeName', e.target.value)} /></Field>
            <Field label="Tagline"><Input value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
            <Field label="Address" className="md:col-span-2"><Input value={draft.address} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="Phone"><Input value={draft.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Email"><Input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Website" className="md:col-span-2"><Input value={draft.website} onChange={(e) => set('website', e.target.value)} /></Field>
          </div>
          <SaveBar t="store" />
        </Card>
      )}

      {tab === 'tax' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Currency & numbering">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Currency code">
                <Select value={CURRENCIES.some((c) => c[0] === draft.currency) ? draft.currency : 'custom'} onChange={(e) => { const c = CURRENCIES.find((x) => x[0] === e.target.value); if (c) setDraft((d) => ({ ...d, currency: c[0], currencySymbol: c[1], locale: c[2] })) }}>
                  {CURRENCIES.map((c) => <option key={c[0]} value={c[0]}>{c[0]} · {c[1]}</option>)}
                  <option value="custom">Custom…</option>
                </Select>
              </Field>
              <Field label="ISO code"><Input value={draft.currency} onChange={(e) => set('currency', e.target.value.toUpperCase().slice(0, 3))} className="font-mono" /></Field>
              <Field label="Symbol"><Input value={draft.currencySymbol} onChange={(e) => set('currencySymbol', e.target.value)} /></Field>
              <Field label="Locale" hint="Controls number & date formatting, e.g. en-US, de-DE"><Input value={draft.locale} onChange={(e) => set('locale', e.target.value)} className="font-mono" /></Field>
              <Field label="Receipt number prefix" hint={`Next: ${draft.numberPrefix || 'PM'}-${String(settings.nextTransactionNumber).padStart(6, '0')}`}><Input value={draft.numberPrefix} onChange={(e) => set('numberPrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))} className="font-mono" /></Field>
              <Field label="Default opening float"><Input type="number" min={0} step="1" value={draft.openingFloatDefault} onChange={(e) => set('openingFloatDefault', Number(e.target.value) || 0)} /></Field>
            </div>
            <div className="mt-3 text-xs text-slate-500 rounded-lg bg-slate-50 p-3">Preview: <b className="text-slate-800">{fmt(1234.5)}</b> · {fmt(0.99)}</div>
          </Card>
          <Card title="Tax">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Tax name"><Input value={draft.taxName} onChange={(e) => set('taxName', e.target.value)} placeholder="Sales Tax, VAT, GST" /></Field>
              <Field label="Rate (%)"><Input type="number" min={0} max={100} step="0.01" value={draft.taxRate} onChange={(e) => set('taxRate', Number(e.target.value) || 0)} /></Field>
            </div>
            <div className="mt-4"><Toggle checked={draft.taxInclusive} onChange={(v) => set('taxInclusive', v)} label={<span>Prices include tax <span className="text-xs text-slate-400">— when on, {draft.taxName || 'tax'} is extracted from the listed price instead of added</span></span>} /></div>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              Example: an item listed at <b>{fmt(100)}</b> → {draft.taxInclusive ? <>customer pays <b>{fmt(100)}</b>, of which {fmt(round2(100 - 100 / (1 + draft.taxRate / 100)))} is {draft.taxName}</> : <>customer pays <b>{fmt(round2(100 * (1 + draft.taxRate / 100)))}</b> including {fmt(round2(draft.taxRate))} {draft.taxName}</>}.
            </div>
          </Card>
          <Card title="Cashier controls" subtitle="Guard-rails that require a manager PIN at the register" className="xl:col-span-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Cashier max discount (%)" hint="Above this a manager PIN is requested"><Input type="number" min={0} max={100} value={draft.cashierMaxDiscountPercent} onChange={(e) => set('cashierMaxDiscountPercent', Number(e.target.value) || 0)} /></Field>
              <div className="flex flex-col gap-3 pt-5">
                <Toggle checked={draft.requireManagerForRefund} onChange={(v) => set('requireManagerForRefund', v)} label="Require manager PIN for refunds" />
                <Toggle checked={draft.requireManagerForVoid} onChange={(v) => set('requireManagerForVoid', v)} label="Require manager PIN to void a sale" />
              </div>
              <div className="text-xs text-slate-500 rounded-lg bg-blue-50 text-blue-800 p-3 flex gap-2"><Info size={14} className="shrink-0 mt-0.5" /><span>Cashiers whose permissions already include refund / void still need approval when these toggles are on. Admins are never prompted.</span></div>
            </div>
            <SaveBar t="tax" />
          </Card>
        </div>
      )}

      {tab === 'receipt' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Receipt text">
            <div className="flex flex-col gap-4">
              <Field label="Header" hint="Printed under the store address"><Textarea value={draft.receiptHeader} onChange={(e) => set('receiptHeader', e.target.value)} /></Field>
              <Field label="Footer" hint="Return policy, warranty terms, thank-you note"><Textarea value={draft.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} className="min-h-[110px]" /></Field>
              <Toggle checked={draft.autoPrintReceipt} onChange={(v) => set('autoPrintReceipt', v)} label={<span>Auto-print receipt after each sale <span className="text-xs text-slate-400">— opens the print dialog automatically</span></span>} />
            </div>
            <SaveBar t="receipt" />
          </Card>
          <Card title="Live preview" subtitle="Updates as you type — built from a sample sale">
            <div className="bg-slate-100 rounded-xl p-5 flex justify-center">
              <div className="bg-white text-slate-900 font-mono text-[12px] leading-relaxed w-[320px] p-5 border border-dashed border-slate-300 rounded-lg shadow-sm">
                <div className="text-center">
                  <div className="text-lg font-bold tracking-wide">{(draft.storeName || 'STORE').toUpperCase()}</div>
                  <div className="text-[11px] text-slate-600">{draft.address}</div>
                  <div className="text-[11px] text-slate-600">{draft.phone}</div>
                  <div className="mt-2 text-[11px] whitespace-pre-wrap">{draft.receiptHeader}</div>
                </div>
                <div className="border-t border-dashed border-slate-300 my-3" />
                <div className="flex justify-between"><span>SALE</span><b>{draft.numberPrefix || 'PM'}-{String(settings.nextTransactionNumber).padStart(6, '0')}</b></div>
                <div className="flex justify-between text-slate-600"><span>Date</span><span>{fmtDateTime(new Date().toISOString())}</span></div>
                <div className="flex justify-between text-slate-600"><span>Cashier</span><span>{admin.name}</span></div>
                <div className="border-t border-dashed border-slate-300 my-3" />
                {preview.lines.map((l, i) => (
                  <div key={i} className="mb-1.5">
                    <div className="flex justify-between gap-2"><span className="flex-1">{l.name}</span><span>{fmt(l.price * l.qty)}</span></div>
                    <div className="text-[11px] text-slate-500">{l.qty} × {fmt(l.price)}</div>
                  </div>
                ))}
                <div className="border-t border-dashed border-slate-300 my-3" />
                <div className="flex justify-between"><span>Subtotal</span><span>{fmt(preview.sub)}</span></div>
                <div className="flex justify-between"><span>{draft.taxName} ({draft.taxRate}%){draft.taxInclusive ? ' incl.' : ''}</span><span>{fmt(preview.tax)}</span></div>
                <div className="flex justify-between text-base font-bold mt-1"><span>TOTAL</span><span>{fmt(preview.total)}</span></div>
                <div className="border-t border-dashed border-slate-300 my-3" />
                <div className="flex justify-between"><span>Card •••• 4242</span><span>{fmt(preview.total)}</span></div>
                {preview.points > 0 && <div className="flex justify-between text-slate-600 mt-2"><span>Points earned</span><span>+{preview.points}</span></div>}
                <div className="border-t border-dashed border-slate-300 my-3" />
                <div className="text-center text-[11px] text-slate-600 whitespace-pre-wrap">{draft.receiptFooter}</div>
                <div className="text-center text-[11px] text-slate-400 mt-2">{draft.website}</div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'loyalty' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Loyalty programme" subtitle="Points are earned on every sale linked to a customer and can be redeemed at checkout">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={`Points earned per ${draft.currencySymbol}1 spent`}><Input type="number" min={0} step="0.1" value={draft.loyaltyPointsPerCurrency} onChange={(e) => set('loyaltyPointsPerCurrency', Number(e.target.value) || 0)} /></Field>
              <Field label={`Value of 1 point (${draft.currencySymbol})`}><Input type="number" min={0} step="0.001" value={draft.loyaltyPointValue} onChange={(e) => set('loyaltyPointValue', Number(e.target.value) || 0)} /></Field>
            </div>
            <div className="mt-3 text-xs text-slate-500">Effective cash-back rate: <b className="text-slate-800">{(draft.loyaltyPointsPerCurrency * draft.loyaltyPointValue * 100).toFixed(2)}%</b></div>
            <SaveBar t="loyalty" />
          </Card>
          <Card title="Example" subtitle="How the current values play out">
            {[50, 250, 1000].map((amt) => {
              const pts = Math.floor(amt * draft.loyaltyPointsPerCurrency)
              return (
                <div key={amt} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0 text-sm">
                  <span className="text-slate-600">Customer spends <b className="text-slate-800">{fmt(amt)}</b></span>
                  <span className="text-right"><span className="font-semibold text-violet-700">+{pts.toLocaleString()} pts</span> <span className="text-slate-400">= {fmt(round2(pts * draft.loyaltyPointValue))} off next visit</span></span>
                </div>
              )
            })}
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              Currently <b className="text-slate-800">{db.customers.reduce((a, c) => a + c.loyaltyPoints, 0).toLocaleString()} points</b> are outstanding across {db.customers.filter((c) => c.loyaltyPoints > 0).length} customers, a liability of <b className="text-slate-800">{money(db.customers.reduce((a, c) => a + c.loyaltyPoints, 0) * settings.loyaltyPointValue)}</b> at the saved point value.
            </div>
          </Card>
        </div>
      )}

      {tab === 'display' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Customer-facing display" subtitle={<span>Opens per register at <code className="font-mono">/display/&lt;registerId&gt;</code></span>} action={db.registers[0] && <a href={`/display/${db.registers[0].id}`} target="_blank" rel="noreferrer" className="btn-secondary !py-1 !px-2.5 text-xs"><ExternalLink size={12} /> Preview</a>}>
            <div className="flex flex-col gap-4">
              <div>
                <div className="label">Idle messages <span className="text-slate-400 font-normal">— rotate while no sale is in progress</span></div>
                <div className="flex flex-col gap-2">
                  {draft.displayIdleMessages.map((m, i) => (
                    <div key={i} className="flex gap-2">
                      <Input value={m} onChange={(e) => set('displayIdleMessages', draft.displayIdleMessages.map((x, j) => (j === i ? e.target.value : x)))} />
                      <button className="btn-ghost !px-2 text-slate-400 hover:text-red-600" onClick={() => set('displayIdleMessages', draft.displayIdleMessages.filter((_, j) => j !== i))} title="Remove"><X size={15} /></button>
                    </div>
                  ))}
                  <button className="btn-secondary self-start !py-1.5 text-xs" onClick={() => set('displayIdleMessages', [...draft.displayIdleMessages, ''])}><Plus size={13} /> Add message</button>
                </div>
              </div>
              <Toggle checked={draft.displayShowPromotions} onChange={(v) => set('displayShowPromotions', v)} label={<span>Show active promotions on the idle screen <span className="text-xs text-slate-400">({db.promotions.filter((p) => p.active).length} active)</span></span>} />
              <Field label="Accent color">
                <div className="flex items-center gap-3">
                  <input type="color" value={draft.displayAccent} onChange={(e) => set('displayAccent', e.target.value)} className="w-10 h-10 rounded-lg border border-slate-200 p-0.5 bg-white cursor-pointer" />
                  <Input value={draft.displayAccent} onChange={(e) => set('displayAccent', e.target.value)} className="!w-32 font-mono" />
                  <div className="flex gap-1.5">{['#2563eb', '#7c3aed', '#059669', '#ea580c', '#db2777', '#0f172a'].map((c) => <button key={c} type="button" onClick={() => set('displayAccent', c)} className={cx('w-6 h-6 rounded-full border-2', draft.displayAccent === c ? 'border-slate-900' : 'border-white')} style={{ background: c }} />)}</div>
                </div>
              </Field>
            </div>
            <SaveBar t="display" />
          </Card>
          <Card title="Idle screen preview">
            <div className="rounded-xl overflow-hidden border border-slate-200 aspect-video flex flex-col text-white relative" style={{ background: `linear-gradient(135deg, ${draft.displayAccent}, #0f172a)` }}>
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, white 0, transparent 40%), radial-gradient(circle at 80% 70%, white 0, transparent 40%)' }} />
              <div className="relative flex-1 flex flex-col items-center justify-center text-center p-6">
                <div className="text-2xl font-bold tracking-tight">{draft.storeName}</div>
                <div className="text-sm opacity-80 mt-1">{draft.tagline}</div>
                <div className="mt-6 text-lg font-medium max-w-md">{draft.displayIdleMessages.filter(Boolean)[0] ?? 'Welcome!'}</div>
                <div className="flex gap-1.5 mt-4">{draft.displayIdleMessages.filter(Boolean).map((_, i) => <span key={i} className={cx('w-1.5 h-1.5 rounded-full bg-white', i === 0 ? 'opacity-100' : 'opacity-40')} />)}</div>
              </div>
              {draft.displayShowPromotions && db.promotions.filter((p) => p.active)[0] && (
                <div className="relative bg-white/10 backdrop-blur px-5 py-3 text-sm flex items-center justify-between"><span>🎉 {db.promotions.filter((p) => p.active)[0]!.name}</span>{db.promotions.filter((p) => p.active)[0]!.code && <span className="font-mono bg-white/20 rounded px-2 py-0.5 text-xs">{db.promotions.filter((p) => p.active)[0]!.code}</span>}</div>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-3">The real display reacts live to the cart, payment and completed sale for its register.</div>
          </Card>
        </div>
      )}

      {tab === 'data' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Database" subtitle="Everything lives in this browser's local storage and syncs across open tabs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {counts.map(([k, v]) => <div key={k} className="rounded-lg bg-slate-50 p-3"><div className="text-lg font-bold text-slate-900 leading-none">{v.toLocaleString()}</div><div className="text-[11px] text-slate-400 mt-1">{k}</div></div>)}
            </div>
            <div className="mt-4">
              <KV label="Schema version" value={db.version} />
              <KV label="Demo seeded" value={fmtDateTime(db.seededAt)} />
              <KV label="Storage used" value={`${(exportDatabase().length / 1024).toFixed(0)} KB`} />
              <KV label="Next receipt number" value={`${settings.numberPrefix}-${String(settings.nextTransactionNumber).padStart(6, '0')}`} />
            </div>
          </Card>
          <div className="flex flex-col gap-4">
            <Card title="Backup & restore">
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Download size={17} /></div>
                  <div className="flex-1"><div className="text-sm font-semibold text-slate-800">Export JSON</div><div className="text-xs text-slate-500">Download a complete snapshot of the database.</div></div>
                  <button className="btn-primary !py-1.5 text-xs" onClick={exportJSON}>Export</button>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Upload size={17} /></div>
                  <div className="flex-1"><div className="text-sm font-semibold text-slate-800">Import JSON</div><div className="text-xs text-slate-500">Restore from a previous export. Replaces all current data.</div></div>
                  <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f) }} />
                  <button className="btn-secondary !py-1.5 text-xs" onClick={() => fileRef.current?.click()}>Choose file</button>
                </div>
              </div>
            </Card>
            <Card title="Danger zone" className="border-red-100">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0"><Trash2 size={17} /></div>
                <div className="flex-1"><div className="text-sm font-semibold text-slate-800">Reset demo data</div><div className="text-xs text-slate-500">Wipe everything and re-seed 120 days of realistic demo activity. Useful before a client walkthrough.</div></div>
                <button className="btn-danger !py-1.5 text-xs" onClick={doReset}>Reset</button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
