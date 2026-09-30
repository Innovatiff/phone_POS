import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ShieldAlert, Info, Download, ExternalLink, Filter, X, ChevronDown, Monitor } from 'lucide-react'
import { useDB } from '@/store/db'
import { Avatar, Badge, Card, EmptyState, PageHeader, SearchInput, Select, toast } from '@/components/ui'
import { ago, cx, downloadFile, fmtDate, fmtTime, sameDay, titleCase, toCSV } from '@/lib/utils'
import type { ActivityLog as ActivityEntry, ActivitySeverity } from '@/lib/types'

const PAGE = 60

export function entityLink(a: { entity: string; entityId?: string }): string | undefined {
  if (!a.entityId && !['shift', 'settings', 'user'].includes(a.entity)) return undefined
  switch (a.entity) {
    case 'transaction': return `/admin/transactions/${a.entityId}`
    case 'product': return `/admin/catalog/${a.entityId}`
    case 'customer': return `/admin/customers/${a.entityId}`
    case 'shift': case 'register': return '/admin/registers'
    case 'user': return '/admin/staff'
    case 'repair': return '/admin/repairs'
    case 'purchase_order': return '/admin/purchase-orders'
    case 'promotion': return '/admin/promotions'
    case 'supplier': return '/admin/suppliers'
    case 'category': case 'brand': return '/admin/catalog'
    case 'settings': return '/admin/settings'
    default: return undefined
  }
}
const entityTone = (e: string): 'blue' | 'green' | 'purple' | 'amber' | 'cyan' | 'pink' | 'orange' | 'slate' => ({ transaction: 'green', product: 'blue', customer: 'purple', shift: 'amber', user: 'pink', cart: 'cyan', repair: 'orange', purchase_order: 'amber', promotion: 'pink' } as Record<string, 'blue' | 'green' | 'purple' | 'amber' | 'cyan' | 'pink' | 'orange'>)[e] ?? 'slate'

function SeverityIcon({ s }: { s: ActivitySeverity }) {
  if (s === 'critical') return <span className="w-7 h-7 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0"><ShieldAlert size={14} /></span>
  if (s === 'warning') return <span className="w-7 h-7 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><AlertTriangle size={14} /></span>
  return <span className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Info size={14} /></span>
}

export default function ActivityLogPage() {
  const db = useDB((s) => s.db)
  const [q, setQ] = useState('')
  const [user, setUser] = useState('all')
  const [entity, setEntity] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [register, setRegister] = useState('all')
  const [prefix, setPrefix] = useState('all')
  const [days, setDays] = useState('7')
  const [limit, setLimit] = useState(PAGE)

  const entities = useMemo(() => Array.from(new Set(db.activity.map((a) => a.entity))).sort(), [db.activity])
  const prefixes = useMemo(() => Array.from(new Set(db.activity.map((a) => a.action.split('.')[0]!))).sort(), [db.activity])
  const today = new Date()
  const todayAll = useMemo(() => db.activity.filter((a) => sameDay(a.createdAt, today)), [db.activity])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const since = days === 'all' ? 0 : Date.now() - Number(days) * 86400000
    return db.activity.filter((a) => {
      if (new Date(a.createdAt).getTime() < since) return false
      if (user !== 'all' && a.userId !== user) return false
      if (entity !== 'all' && a.entity !== entity) return false
      if (severity !== 'all' && a.severity !== severity) return false
      if (register !== 'all' && (a.registerId ?? '') !== register) return false
      if (prefix !== 'all' && !a.action.startsWith(prefix + '.')) return false
      if (term && !(a.description.toLowerCase().includes(term) || a.action.includes(term) || a.userName.toLowerCase().includes(term) || (a.entityId ?? '').toLowerCase().includes(term))) return false
      return true
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [db.activity, q, user, entity, severity, register, prefix, days])

  const shown = filtered.slice(0, limit)
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: ActivityEntry[] }> = []
    for (const a of shown) {
      const day = a.createdAt.slice(0, 10)
      const g = out[out.length - 1]
      if (g && g.day === day) g.items.push(a)
      else out.push({ day, items: [a] })
    }
    return out
  }, [shown])

  const hasFilters = q || user !== 'all' || entity !== 'all' || severity !== 'all' || register !== 'all' || prefix !== 'all'
  const clear = () => { setQ(''); setUser('all'); setEntity('all'); setSeverity('all'); setRegister('all'); setPrefix('all') }

  const exportCSV = () => {
    downloadFile(`activity-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(filtered.map((a) => ({ time: a.createdAt, user: a.userName, userId: a.userId, action: a.action, entity: a.entity, entityId: a.entityId ?? '', register: db.registers.find((r) => r.id === a.registerId)?.name ?? '', severity: a.severity, description: a.description, meta: a.meta ? JSON.stringify(a.meta) : '' }))), 'text/csv')
    toast.success(`Exported ${filtered.length} events`)
  }

  const dayLabel = (day: string) => {
    const d = new Date(`${day}T12:00:00`)
    const y = new Date(); y.setDate(y.getDate() - 1)
    if (sameDay(d.toISOString(), today)) return 'Today'
    if (sameDay(d.toISOString(), y)) return 'Yesterday'
    return fmtDate(d.toISOString(), 'EEEE, MMM d, yyyy')
  }

  return (
    <div>
      <PageHeader title="Activity Log" subtitle="Every movement in the store, by whom, when and where — nothing is silent" actions={<>
        <span className="inline-flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1.5"><span className="relative flex w-2 h-2"><span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-75 animate-ping" /><span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" /></span> Live · auto-refresh</span>
        <button className="btn-secondary" onClick={exportCSV}><Download size={15} /> Export CSV</button>
      </>} />

      <div className="flex flex-wrap gap-3 mb-5">
        <Chip icon={<Activity size={14} />} label="Events today" value={todayAll.length} tone="blue" onClick={() => { setDays('1'); setSeverity('all') }} />
        <Chip icon={<AlertTriangle size={14} />} label="Warnings today" value={todayAll.filter((a) => a.severity === 'warning').length} tone="amber" onClick={() => { setDays('1'); setSeverity('warning') }} />
        <Chip icon={<ShieldAlert size={14} />} label="Critical today" value={todayAll.filter((a) => a.severity === 'critical').length} tone="red" onClick={() => { setDays('1'); setSeverity('critical') }} />
        <Chip icon={<Filter size={14} />} label="In current view" value={filtered.length} tone="slate" />
        <Chip icon={<Activity size={14} />} label="Total logged" value={db.activity.length} tone="slate" />
      </div>

      <Card padded={false} className="mb-5">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
          <SearchInput value={q} onChange={setQ} placeholder="Search description, action, user, ID…" className="w-full sm:w-72" />
          <Select value={user} onChange={(e) => setUser(e.target.value)} className="!w-40"><option value="all">All users</option>{db.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="!w-40"><option value="all">All entities</option>{entities.map((e) => <option key={e} value={e}>{titleCase(e)}</option>)}</Select>
          <Select value={prefix} onChange={(e) => setPrefix(e.target.value)} className="!w-40"><option value="all">All actions</option>{prefixes.map((p) => <option key={p} value={p}>{titleCase(p)}.*</option>)}</Select>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="!w-36"><option value="all">All severities</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></Select>
          <Select value={register} onChange={(e) => setRegister(e.target.value)} className="!w-40"><option value="all">All registers</option><option value="">No register</option>{db.registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
          <Select value={days} onChange={(e) => { setDays(e.target.value); setLimit(PAGE) }} className="!w-36"><option value="1">Last 24h</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></Select>
          {hasFilters && <button className="btn-ghost text-xs" onClick={clear}><X size={13} /> Clear</button>}
        </div>

        {groups.length ? (
          <div className="divide-y divide-slate-100">
            {groups.map((g) => (
              <div key={g.day}>
                <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur px-5 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center justify-between">
                  <span>{dayLabel(g.day)}</span><span className="font-normal normal-case">{g.items.length} event(s)</span>
                </div>
                <ol className="divide-y divide-slate-50">
                  {g.items.map((a) => {
                    const u = db.users.find((x) => x.id === a.userId)
                    const reg = a.registerId ? db.registers.find((r) => r.id === a.registerId) : undefined
                    const link = entityLink(a)
                    return (
                      <li key={a.id} className={cx('flex items-start gap-3 px-5 py-3 hover:bg-slate-50/70', a.severity === 'critical' && 'bg-red-50/30', a.severity === 'warning' && 'bg-amber-50/20')}>
                        <div className="w-12 shrink-0 text-xs text-slate-400 tabular-nums pt-1.5" title={a.createdAt}>{fmtTime(a.createdAt)}</div>
                        <SeverityIcon s={a.severity} />
                        <Avatar name={a.userName} color={u?.color} size={28} className="mt-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-slate-800"><span className="font-semibold">{a.userName}</span> <span className="text-slate-600">{a.description}</span></div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <Badge tone="slate" className="font-mono !font-medium">{a.action}</Badge>
                            <Badge tone={entityTone(a.entity)}>{titleCase(a.entity)}</Badge>
                            {reg && <Badge tone="cyan"><Monitor size={10} className="mr-1" />{reg.name}</Badge>}
                            {a.meta && Object.keys(a.meta).length > 0 && <span className="text-[11px] text-slate-400 font-mono truncate max-w-[300px]" title={JSON.stringify(a.meta)}>{Object.entries(a.meta).filter(([, v]) => v !== undefined && typeof v !== 'object').map(([k, v]) => `${k}=${String(v)}`).join(' ')}</span>}
                            <span className="text-[11px] text-slate-400 ml-auto">{ago(a.createdAt)}</span>
                          </div>
                        </div>
                        {link ? <Link to={link} className="btn-ghost !px-2 !py-1 text-xs shrink-0" title={`Open ${a.entity}`}><ExternalLink size={13} /></Link> : <span className="w-8" />}
                      </li>
                    )
                  })}
                </ol>
              </div>
            ))}
          </div>
        ) : <EmptyState icon={<Activity size={22} />} title="No events match" description="Try widening the date range or clearing filters." action={hasFilters ? <button className="btn-secondary" onClick={clear}>Clear filters</button> : undefined} />}

        {filtered.length > shown.length && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-center gap-3 text-xs text-slate-500">
            Showing {shown.length} of {filtered.length}
            <button className="btn-secondary !py-1.5" onClick={() => setLimit((l) => l + PAGE)}><ChevronDown size={14} /> Load {Math.min(PAGE, filtered.length - shown.length)} more</button>
            <button className="btn-ghost !py-1.5" onClick={() => setLimit(filtered.length)}>Show all</button>
          </div>
        )}
      </Card>
    </div>
  )
}

function Chip({ icon, label, value, tone, onClick }: { icon: React.ReactNode; label: string; value: number; tone: 'blue' | 'amber' | 'red' | 'slate'; onClick?: () => void }) {
  const cls = { blue: 'bg-blue-50 text-blue-700 border-blue-100', amber: 'bg-amber-50 text-amber-700 border-amber-100', red: 'bg-red-50 text-red-700 border-red-100', slate: 'bg-white text-slate-600 border-slate-200' }[tone]
  return (
    <button type="button" onClick={onClick} className={cx('inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm', cls, onClick && 'hover:shadow-card transition-shadow')}>
      {icon}<span className="font-medium">{label}</span><span className="font-bold text-base tabular-nums">{value.toLocaleString()}</span>
    </button>
  )
}
