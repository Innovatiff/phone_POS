import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BellOff, CheckCheck, ExternalLink, X, Mail, MailOpen, PackageX, Package, Scale, Undo2, Percent, Ban, ClipboardCheck, Wrench, Info, Tag, Save, SlidersHorizontal } from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import { Badge, Card, EmptyState, Field, Input, PageHeader, StatCard, Tabs, confirm, toast } from '@/components/ui'
import { ago, cx, fmtDateTime, money, titleCase } from '@/lib/utils'
import type { Alert, AlertType } from '@/lib/types'

type Tab = 'all' | 'unread' | 'info' | 'warning' | 'critical'

const TYPE_META: Record<AlertType, { icon: React.ReactNode; color: string; label: string }> = {
  low_stock: { icon: <Package size={17} />, color: '#f59e0b', label: 'Low stock' },
  out_of_stock: { icon: <PackageX size={17} />, color: '#ef4444', label: 'Out of stock' },
  shift_variance: { icon: <Scale size={17} />, color: '#f59e0b', label: 'Cash variance' },
  large_refund: { icon: <Undo2 size={17} />, color: '#ef4444', label: 'Large refund' },
  large_discount: { icon: <Percent size={17} />, color: '#f59e0b', label: 'Large discount' },
  void: { icon: <Ban size={17} />, color: '#ef4444', label: 'Void' },
  po_received: { icon: <ClipboardCheck size={17} />, color: '#22c55e', label: 'PO received' },
  repair_ready: { icon: <Wrench size={17} />, color: '#2563eb', label: 'Repair ready' },
  system: { icon: <Info size={17} />, color: '#64748b', label: 'System' },
  price_override: { icon: <Tag size={17} />, color: '#8b5cf6', label: 'Price override' },
}

export default function Alerts() {
  const navigate = useNavigate()
  const admin = useAdminUser()!
  const alerts = useDB((s) => s.db.alerts)
  const settings = useDB((s) => s.db.settings)
  const markAlertRead = useDB((s) => s.markAlertRead)
  const markAllAlertsRead = useDB((s) => s.markAllAlertsRead)
  const dismissAlert = useDB((s) => s.dismissAlert)
  const updateSettings = useDB((s) => s.updateSettings)

  const [tab, setTab] = useState<Tab>('all')
  const [typeFilter, setTypeFilter] = useState<AlertType | 'all'>('all')
  const [rules, setRules] = useState({ largeRefundThreshold: String(settings.largeRefundThreshold), largeDiscountThreshold: String(settings.largeDiscountThreshold), lowStockDefault: String(settings.lowStockDefault) })

  const unread = alerts.filter((a) => !a.read)
  const counts = { all: alerts.length, unread: unread.length, info: alerts.filter((a) => a.severity === 'info').length, warning: alerts.filter((a) => a.severity === 'warning').length, critical: alerts.filter((a) => a.severity === 'critical').length }
  const list = useMemo(() => alerts.filter((a) => (tab === 'all' ? true : tab === 'unread' ? !a.read : a.severity === tab)).filter((a) => typeFilter === 'all' || a.type === typeFilter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [alerts, tab, typeFilter])
  const typeCounts = useMemo(() => { const m: Partial<Record<AlertType, number>> = {}; alerts.forEach((a) => { m[a.type] = (m[a.type] ?? 0) + 1 }); return m }, [alerts])

  const open = (a: Alert) => { markAlertRead(a.id, true); if (a.link) navigate(a.link) }
  const dismissAll = async () => {
    if (!list.length) return
    if (!(await confirm('Dismiss alerts?', `Remove ${list.length} alert(s) from this view permanently?`, { danger: true, confirmLabel: 'Dismiss' }))) return
    list.forEach((a) => dismissAlert(a.id))
    toast.success(`${list.length} alert(s) dismissed`)
  }
  const saveRules = () => {
    const refund = Number(rules.largeRefundThreshold), disc = Number(rules.largeDiscountThreshold), low = Number(rules.lowStockDefault)
    if (!(refund >= 0) || !(disc >= 0 && disc <= 100) || !(low >= 0)) { toast.error('Enter valid thresholds'); return }
    updateSettings({ largeRefundThreshold: refund, largeDiscountThreshold: disc, lowStockDefault: Math.round(low) }, admin.id)
    toast.success('Alert rules saved')
  }
  const rulesDirty = Number(rules.largeRefundThreshold) !== settings.largeRefundThreshold || Number(rules.largeDiscountThreshold) !== settings.largeDiscountThreshold || Number(rules.lowStockDefault) !== settings.lowStockDefault

  return (
    <div>
      <PageHeader title="Alerts" subtitle="Notifications that need a manager's eye — stock, cash, refunds, voids and repairs" actions={<>
        <button className="btn-secondary" disabled={!unread.length} onClick={() => { markAllAlertsRead(); toast.success('All alerts marked as read') }}><CheckCheck size={15} /> Mark all as read</button>
        <button className="btn-ghost text-red-600 hover:bg-red-50" disabled={!list.length} onClick={dismissAll}><BellOff size={15} /> Dismiss shown</button>
      </>} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard label="Unread" value={counts.unread} icon={<Bell size={14} />} hint={`${counts.all} total alerts`} onClick={() => setTab('unread')} />
        <StatCard label="Critical" value={counts.critical} icon={<Ban size={14} />} hint="Voids, out-of-stock" color="#ef4444" onClick={() => setTab('critical')} />
        <StatCard label="Warnings" value={counts.warning} icon={<Scale size={14} />} hint="Variance, refunds, discounts, low stock" color="#f59e0b" onClick={() => setTab('warning')} />
        <StatCard label="Info" value={counts.info} icon={<Info size={14} />} hint="Repairs ready, PO received" color="#2563eb" onClick={() => setTab('info')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" padded={false}>
          <div className="px-5 pt-4">
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All', count: counts.all }, { value: 'unread', label: 'Unread', count: counts.unread }, { value: 'critical', label: 'Critical', count: counts.critical }, { value: 'warning', label: 'Warning', count: counts.warning }, { value: 'info', label: 'Info', count: counts.info }]} />
            <div className="flex flex-wrap gap-1.5 -mt-1 mb-3">
              <button className={cx('badge border', typeFilter === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')} onClick={() => setTypeFilter('all')}>All types</button>
              {(Object.keys(TYPE_META) as AlertType[]).filter((t) => typeCounts[t]).map((t) => (
                <button key={t} className={cx('badge border', typeFilter === t ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')} onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}>{TYPE_META[t].label} <span className="ml-1 opacity-60">{typeCounts[t]}</span></button>
              ))}
            </div>
          </div>
          {list.length ? (
            <ul className="divide-y divide-slate-100">
              {list.map((a) => {
                const meta = TYPE_META[a.type] ?? TYPE_META.system
                return (
                  <li key={a.id} className={cx('flex items-start gap-3 px-5 py-3.5 group', !a.read ? 'bg-brand-50/30' : 'hover:bg-slate-50/70')}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${meta.color}1a`, color: meta.color }}>{meta.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cx('text-sm', !a.read ? 'font-semibold text-slate-900' : 'font-medium text-slate-700')}>{a.title}</span>
                        <Badge tone={a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'amber' : 'blue'} dot>{titleCase(a.severity)}</Badge>
                        <Badge tone="slate">{meta.label}</Badge>
                        {!a.read && <span className="w-2 h-2 rounded-full bg-brand-600" />}
                      </div>
                      <div className="text-sm text-slate-600 mt-0.5">{a.message}</div>
                      <div className="text-[11px] text-slate-400 mt-1" title={fmtDateTime(a.createdAt)}>{ago(a.createdAt)} · {fmtDateTime(a.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {a.link && <button className="btn-secondary !py-1 !px-2.5 text-xs" onClick={() => open(a)}><ExternalLink size={12} /> Open</button>}
                      <button className="btn-ghost !py-1 !px-2 text-xs" title={a.read ? 'Mark as unread' : 'Mark as read'} onClick={() => markAlertRead(a.id, !a.read)}>{a.read ? <Mail size={14} /> : <MailOpen size={14} />}</button>
                      <button className="btn-ghost !py-1 !px-2 text-xs text-slate-400 hover:text-red-600" title="Dismiss" onClick={() => { dismissAlert(a.id); toast.info('Alert dismissed') }}><X size={14} /></button>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : <EmptyState icon={<Bell size={22} />} title={tab === 'unread' ? "You're all caught up" : 'No alerts here'} description={tab === 'unread' ? 'New alerts will appear as the store operates.' : 'Nothing matches this filter.'} />}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Alert rules" subtitle="Thresholds that raise alerts automatically" action={<SlidersHorizontal size={16} className="text-slate-400" />}>
            <div className="flex flex-col gap-4">
              <Field label={`Large refund threshold (${settings.currencySymbol})`} hint="Refunds at or above this raise a warning and are logged with severity 'warning'">
                <Input type="number" min={0} step="1" value={rules.largeRefundThreshold} onChange={(e) => setRules({ ...rules, largeRefundThreshold: e.target.value })} />
              </Field>
              <Field label="Large discount threshold (%)" hint="Sales discounted by this percentage or more raise an alert">
                <Input type="number" min={0} max={100} step="1" value={rules.largeDiscountThreshold} onChange={(e) => setRules({ ...rules, largeDiscountThreshold: e.target.value })} />
              </Field>
              <Field label="Default low-stock threshold (units)" hint="Applied to new products; existing products keep their own threshold">
                <Input type="number" min={0} step="1" value={rules.lowStockDefault} onChange={(e) => setRules({ ...rules, lowStockDefault: e.target.value })} />
              </Field>
              <button className="btn-primary" disabled={!rulesDirty} onClick={saveRules}><Save size={15} /> Save rules</button>
            </div>
          </Card>
          <Card title="Always-on alerts" subtitle="Raised regardless of thresholds">
            <ul className="text-sm text-slate-600 flex flex-col gap-2">
              <li className="flex items-start gap-2"><Ban size={15} className="text-red-500 mt-0.5 shrink-0" /><span><b className="text-slate-800">Void</b> — every voided sale (critical)</span></li>
              <li className="flex items-start gap-2"><Tag size={15} className="text-violet-500 mt-0.5 shrink-0" /><span><b className="text-slate-800">Price override</b> — any unit price changed at checkout</span></li>
              <li className="flex items-start gap-2"><Scale size={15} className="text-amber-500 mt-0.5 shrink-0" /><span><b className="text-slate-800">Cash variance</b> — shift closed with {money(5)}+ difference</span></li>
              <li className="flex items-start gap-2"><PackageX size={15} className="text-red-500 mt-0.5 shrink-0" /><span><b className="text-slate-800">Out of stock</b> — a tracked product hits zero</span></li>
              <li className="flex items-start gap-2"><Wrench size={15} className="text-blue-500 mt-0.5 shrink-0" /><span><b className="text-slate-800">Repair ready</b> — a ticket moves to Ready</span></li>
              <li className="flex items-start gap-2"><ClipboardCheck size={15} className="text-emerald-500 mt-0.5 shrink-0" /><span><b className="text-slate-800">PO received</b> — a purchase order is fully received</span></li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
