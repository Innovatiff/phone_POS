import React, { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { X, Search, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown, Check, AlertTriangle, Info, CheckCircle2, XCircle, Inbox } from 'lucide-react'
import { cx, initials, money, pct } from '@/lib/utils'

// ─── Cards ───────────────────────────────────────────────────────────────────
export function Card({ className, children, title, subtitle, action, padded = true }: { className?: string; children?: React.ReactNode; title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; padded?: boolean }) {
  return (
    <div className={cx('card', padded && 'p-5', className)}>
      {(title || action) && (
        <div className={cx('flex items-start justify-between gap-3', padded ? 'mb-4' : 'px-5 pt-5 mb-3')}>
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, children }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-[26px] leading-tight font-bold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ─── Sparkline ───────────────────────────────────────────────────────────────
export function Sparkline({ data, color = '#22c55e', width = 96, height = 36, fill = true }: { data: number[]; color?: string; width?: number; height?: number; fill?: boolean }) {
  const id = useRef(`sp${Math.random().toString(36).slice(2, 7)}`).current
  if (!data.length) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const step = width / Math.max(1, data.length - 1)
  const pts = data.map((v, i) => [i * step, height - 3 - ((v - min) / range) * (height - 6)] as const)
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${path} L${width},${height} L0,${height} Z`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function StatCard({ label, value, delta, trend, color, icon, hint, onClick, invert = false }: { label: string; value: React.ReactNode; delta?: number; trend?: number[]; color?: string; icon?: React.ReactNode; hint?: string; onClick?: () => void; invert?: boolean }) {
  const good = delta === undefined ? true : invert ? delta <= 0 : delta >= 0
  const c = color ?? (good ? '#22c55e' : '#ef4444')
  return (
    <div className={cx('card p-5 flex items-center justify-between gap-3 min-w-0', onClick && 'cursor-pointer hover:shadow-pop transition-shadow')} onClick={onClick}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-slate-500 flex items-center gap-1.5">{icon}{label}</div>
        <div className="flex items-baseline gap-3 mt-1">
          <div className="text-[30px] leading-none font-bold text-slate-900 tracking-tight truncate">{value}</div>
          {delta !== undefined && (
            <span className={cx('text-sm font-semibold inline-flex items-center gap-0.5', good ? 'text-emerald-600' : 'text-red-600')}>
              {delta >= 0 ? <ChevronUp size={14} strokeWidth={3} /> : <ChevronDown size={14} strokeWidth={3} />}
              {Math.abs(delta).toFixed(0)}%
            </span>
          )}
        </div>
        {hint && <div className="text-[11px] text-slate-400 mt-1.5">{hint}</div>}
      </div>
      {trend && trend.length > 1 && <Sparkline data={trend} color={c} />}
    </div>
  )
}

// ─── Badges & avatars ────────────────────────────────────────────────────────
type Tone = 'slate' | 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'orange' | 'cyan' | 'pink'
const tones: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-700',
  purple: 'bg-violet-50 text-violet-700',
  orange: 'bg-orange-50 text-orange-700',
  cyan: 'bg-cyan-50 text-cyan-700',
  pink: 'bg-pink-50 text-pink-700',
}
export function Badge({ tone = 'slate', children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx('badge', tones[tone], className)}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 opacity-80" />}
      {children}
    </span>
  )
}
export const statusTone = (s: string): Tone => {
  switch (s) {
    case 'completed': case 'received': case 'collected': case 'closed': case 'active': case 'ready': case 'paid': return 'green'
    case 'refunded': case 'voided': case 'cancelled': case 'critical': case 'out_of_stock': return 'red'
    case 'partially_refunded': case 'partial': case 'warning': case 'low_stock': case 'waiting_parts': case 'ordered': return 'amber'
    case 'open': case 'in_progress': case 'diagnosing': case 'info': return 'blue'
    case 'draft': case 'inactive': return 'slate'
    default: return 'slate'
  }
}

export function Avatar({ name, color, size = 32, className }: { name: string; color?: string; size?: number; className?: string }) {
  return (
    <div className={cx('rounded-full flex items-center justify-center font-semibold text-white shrink-0', className)} style={{ width: size, height: size, background: color ?? '#64748b', fontSize: size * 0.38 }}>
      {initials(name)}
    </div>
  )
}

export function DeltaPill({ value, invert }: { value: number; invert?: boolean }) {
  const good = invert ? value <= 0 : value >= 0
  return <span className={cx('text-xs font-semibold', good ? 'text-emerald-600' : 'text-red-600')}>{pct(value, 0)}</span>
}

// ─── Inputs ──────────────────────────────────────────────────────────────────
export function Field({ label, children, hint, className, required }: { label?: string; children: React.ReactNode; hint?: string; className?: string; required?: boolean }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="label">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</span>}
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx('input', className)} {...p} />
})
export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('input appearance-none pr-8 bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%2394a3b8%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_0.6rem_center]', className)} {...p}>{children}</select>
}
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('input min-h-[80px]', className)} {...p} />
}
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className={cx('inline-flex items-center gap-2.5 text-sm text-slate-700 disabled:opacity-50', !label && 'gap-0')}>
      <span className={cx('relative inline-flex h-5 w-9 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </span>
      {label}
    </button>
  )
}
export function SearchInput({ value, onChange, placeholder = 'Search…', className, autoFocus, inputRef, onKeyDown }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; inputRef?: React.Ref<HTMLInputElement>; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement> }) {
  return (
    <div className={cx('relative', className)}>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input ref={inputRef} autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} className="input pl-9" />
      {value && (
        <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={14} /></button>
      )}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, size = 'sm' }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: React.ReactNode }>; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={cx('rounded-md font-medium transition-colors', size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm', value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: React.ReactNode; count?: number }> }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)} className={cx('px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors', value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {t.label}
          {t.count !== undefined && <span className={cx('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', value === t.value ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ─── Modal / Drawer / Confirm ────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer, size = 'md', subtitle }: { open: boolean; onClose: () => void; title?: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-[96vw]' }[size]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cx('relative w-full bg-white rounded-2xl shadow-pop fade-up flex flex-col max-h-[92vh]', w)}>
        {(title || subtitle) && (
          <div className="flex items-start justify-between px-6 pt-5 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
          </div>
        )}
        <div className="px-6 py-2 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className={cx('relative h-full w-full bg-white shadow-pop flex flex-col', width)}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

interface ConfirmState { open: boolean; title: string; message?: React.ReactNode; confirmLabel?: string; danger?: boolean; resolve?: (v: boolean) => void }
const useConfirmStore = create<ConfirmState & { ask: (o: Omit<ConfirmState, 'open' | 'resolve'>) => Promise<boolean>; close: (v: boolean) => void }>((set, get) => ({
  open: false, title: '',
  ask: (o) => new Promise<boolean>((resolve) => set({ ...o, open: true, resolve })),
  close: (v) => { get().resolve?.(v); set({ open: false, resolve: undefined }) },
}))
export const confirm = (title: string, message?: React.ReactNode, opts?: { confirmLabel?: string; danger?: boolean }) => useConfirmStore.getState().ask({ title, message, ...opts })
export function ConfirmHost() {
  const s = useConfirmStore()
  return (
    <Modal open={s.open} onClose={() => s.close(false)} title={s.title} size="sm" footer={<><button className="btn-secondary" onClick={() => s.close(false)}>Cancel</button><button className={s.danger ? 'btn-danger' : 'btn-primary'} onClick={() => s.close(true)}>{s.confirmLabel ?? 'Confirm'}</button></>}>
      <div className="text-sm text-slate-600 pb-2">{s.message}</div>
    </Modal>
  )
}

// ─── Toasts ──────────────────────────────────────────────────────────────────
interface ToastItem { id: number; kind: 'success' | 'error' | 'info' | 'warning'; text: string }
const useToastStore = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, 'id'>) => void; remove: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random()
    set((s) => ({ items: [...s.items, { ...t, id }] }))
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), t.kind === 'error' ? 5000 : 3200)
  },
  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}))
export const toast = {
  success: (text: string) => useToastStore.getState().push({ kind: 'success', text }),
  error: (text: string) => useToastStore.getState().push({ kind: 'error', text }),
  info: (text: string) => useToastStore.getState().push({ kind: 'info', text }),
  warning: (text: string) => useToastStore.getState().push({ kind: 'warning', text }),
}
export function ToastHost() {
  const { items, remove } = useToastStore()
  const icon = { success: <CheckCircle2 size={18} className="text-emerald-500" />, error: <XCircle size={18} className="text-red-500" />, info: <Info size={18} className="text-blue-500" />, warning: <AlertTriangle size={18} className="text-amber-500" /> }
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]">
      {items.map((t) => (
        <div key={t.id} className="card p-3 flex items-start gap-2.5 fade-up shadow-pop">
          {icon[t.kind]}
          <div className="text-sm text-slate-700 flex-1">{t.text}</div>
          <button onClick={() => remove(t.id)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">{icon ?? <Inbox size={22} />}</div>
      <div className="font-semibold text-slate-800">{title}</div>
      {description && <div className="text-sm text-slate-500 mt-1 max-w-sm">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ─── Data table ──────────────────────────────────────────────────────────────
export interface Column<T> {
  key: string
  header: React.ReactNode
  render?: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number
  className?: string
  width?: string
  align?: 'left' | 'right' | 'center'
}
export function DataTable<T extends { id: string }>({ rows, columns, pageSize = 15, onRowClick, empty, selectable, selected, onSelect, defaultSort, compact, rowClassName, footer }: {
  rows: T[]; columns: Column<T>[]; pageSize?: number; onRowClick?: (row: T) => void; empty?: React.ReactNode; selectable?: boolean; selected?: Set<string>; onSelect?: (ids: Set<string>) => void; defaultSort?: { key: string; dir: 'asc' | 'desc' }; compact?: boolean; rowClassName?: (row: T) => string; footer?: React.ReactNode
}) {
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | undefined>(defaultSort)
  useEffect(() => { setPage(0) }, [rows.length])
  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const sv = col.sortValue
    return [...rows].sort((a, b) => {
      const va = sv(a), vb = sv(b)
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sort.dir === 'asc' ? r : -r
    })
  }, [rows, sort, columns])
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const cur = Math.min(page, pages - 1)
  const slice = sorted.slice(cur * pageSize, cur * pageSize + pageSize)
  const allSelected = selectable && slice.length > 0 && slice.every((r) => selected?.has(r.id))
  const toggleAll = () => {
    const next = new Set(selected)
    if (allSelected) slice.forEach((r) => next.delete(r.id))
    else slice.forEach((r) => next.add(r.id))
    onSelect?.(next)
  }
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {selectable && <th className="w-8"><input type="checkbox" checked={!!allSelected} onChange={toggleAll} className="accent-brand-600" /></th>}
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }} className={cx(c.sortValue && 'cursor-pointer select-none hover:text-slate-600', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')} onClick={() => c.sortValue && setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}>
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {c.sortValue && (sort?.key === c.key ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} className="opacity-40" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr key={row.id} onClick={() => onRowClick?.(row)} className={cx(onRowClick && 'cursor-pointer', rowClassName?.(row))}>
                {selectable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="accent-brand-600" checked={selected?.has(row.id) ?? false} onChange={() => { const n = new Set(selected); n.has(row.id) ? n.delete(row.id) : n.add(row.id); onSelect?.(n) }} /></td>}
                {columns.map((c) => (
                  <td key={c.key} className={cx(compact && '!py-1.5', c.className, c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>{c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (empty ?? <EmptyState title="Nothing here yet" />)}
      </div>
      {(pages > 1 || footer) && (
        <div className="flex items-center justify-between pt-3 text-xs text-slate-500">
          <div>{footer ?? <>Showing {cur * pageSize + 1}–{Math.min(sorted.length, (cur + 1) * pageSize)} of {sorted.length}</>}</div>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <button className="btn-ghost !px-2 !py-1" disabled={cur === 0} onClick={() => setPage(cur - 1)}><ChevronLeft size={14} /></button>
              <span className="px-2 font-medium">{cur + 1} / {pages}</span>
              <button className="btn-ghost !px-2 !py-1" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><ChevronRight size={14} /></button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Misc ────────────────────────────────────────────────────────────────────
export function KV({ label, value, className }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-4 py-1.5 text-sm', className)}>
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value}</span>
    </div>
  )
}
export function Money({ value, className, signed }: { value: number; className?: string; signed?: boolean }) {
  return <span className={cx('tabular-nums', value < 0 && 'text-red-600', className)}>{signed && value > 0 ? '+' : ''}{money(value)}</span>
}
export function ProgressBar({ value, color = '#f97316', className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={cx('h-2.5 rounded-full bg-slate-100 overflow-hidden', className)}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)` }} />
    </div>
  )
}
export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
      <span className={cx('w-4 h-4 rounded border flex items-center justify-center transition-colors', checked ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-300 bg-white')} onClick={() => onChange(!checked)}>
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      {label && <span onClick={() => onChange(!checked)}>{label}</span>}
    </label>
  )
}
export function Spinner({ className }: { className?: string }) {
  return <div className={cx('w-5 h-5 rounded-full border-2 border-slate-200 border-t-brand-600 animate-spin', className)} />
}
export function IconBox({ children, color = '#2563eb', size = 36, className }: { children: React.ReactNode; color?: string; size?: number; className?: string }) {
  return <div className={cx('rounded-xl flex items-center justify-center shrink-0', className)} style={{ width: size, height: size, background: `${color}1a`, color }}>{children}</div>
}
export function Kbd({ children }: { children: React.ReactNode }) { return <span className="kbd">{children}</span> }
