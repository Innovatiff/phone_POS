import React, { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, BarChart3, Receipt, Bell, Package, Users, PieChart, Settings, Boxes, UserCog, Monitor, Activity,
  Tag, Wrench, Truck, ClipboardList, LogOut, Search, ChevronRight, Smartphone, ExternalLink, Menu, X, type LucideIcon,
} from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser, useSession } from '@/store/session'
import { Avatar, Badge } from '@/components/ui'
import { cx, money, fmtDateTime } from '@/lib/utils'

const NAV: Array<{ to: string; label: string; icon: LucideIcon; group?: string }> = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/sales', label: 'Sales Analytics', icon: BarChart3 },
  { to: '/admin/transactions', label: 'Transactions', icon: Receipt },
  { to: '/admin/alerts', label: 'Alerts', icon: Bell },
  { to: '/admin/catalog', label: 'Catalog', icon: Package },
  { to: '/admin/inventory', label: 'Inventory', icon: Boxes },
  { to: '/admin/purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
  { to: '/admin/suppliers', label: 'Suppliers', icon: Truck },
  { to: '/admin/promotions', label: 'Promotions', icon: Tag },
  { to: '/admin/customers', label: 'Customers', icon: Users },
  { to: '/admin/repairs', label: 'Repairs', icon: Wrench },
  { to: '/admin/staff', label: 'Staff', icon: UserCog },
  { to: '/admin/registers', label: 'Registers & Shifts', icon: Monitor },
  { to: '/admin/activity', label: 'Activity Log', icon: Activity },
  { to: '/admin/reports', label: 'Reports', icon: PieChart },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

export function AdminLayout() {
  const user = useAdminUser()
  const location = useLocation()
  if (!user) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  return <Shell />
}

function Shell() {
  const user = useAdminUser()!
  const logout = useSession((s) => s.logoutAdmin)
  const navigate = useNavigate()
  const location = useLocation()
  const unread = useDB((s) => s.db.alerts.filter((a) => !a.read).length)
  const settings = useDB((s) => s.db.settings)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [cmd, setCmd] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const current = NAV.filter((n) => (n.to === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(n.to))).sort((a, b) => b.to.length - a.to.length)[0]

  return (
    <div className="h-full flex bg-[#f4f6fa]">
      {/* Sidebar */}
      <aside className={cx('bg-navy-900 text-slate-300 flex flex-col shrink-0 transition-all duration-200 z-40', expanded ? 'w-56' : 'w-[72px]', 'hidden md:flex')}
        onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)}>
        <SidebarContent expanded={expanded} unread={unread} />
      </aside>
      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-navy-900 text-slate-300 flex flex-col">
            <SidebarContent expanded unread={unread} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-100 flex items-center gap-3 px-4 md:px-6 shrink-0">
          <button className="md:hidden btn-ghost !px-2" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center shadow-sm"><Smartphone size={18} /></div>
            <div className="min-w-0">
              <div className="text-[17px] font-bold text-slate-900 leading-tight truncate">{settings.storeName} <span className="text-slate-400 font-medium">Admin</span></div>
              <div className="text-[11px] text-slate-400 leading-tight flex items-center gap-1"><span>Admin</span><ChevronRight size={10} /><span className="text-slate-600 font-medium">{current?.label ?? 'Dashboard'}</span></div>
            </div>
          </div>
          <div className="flex-1" />
          <button onClick={() => setCmd(true)} className="hidden sm:flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-400 w-64 hover:bg-white">
            <Search size={15} /><span className="flex-1 text-left">Search anything…</span><span className="kbd">⌘K</span>
          </button>
          <a href="/cashier" target="_blank" rel="noreferrer" className="btn-secondary hidden lg:inline-flex" title="Open cashier portal in new tab"><ExternalLink size={14} /> Cashier portal</a>
          <button onClick={() => navigate('/admin/alerts')} className="relative btn-ghost !px-2">
            <Bell size={19} />
            {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">{unread}</span>}
          </button>
          <div className="flex items-center gap-2 pl-2 border-l border-slate-100">
            <Avatar name={user.name} color={user.color} size={34} />
            <div className="hidden sm:block leading-tight">
              <div className="text-sm font-semibold text-slate-800">{user.name}</div>
              <div className="text-[11px] text-slate-400 capitalize">{user.role}</div>
            </div>
            <button onClick={() => { logout(); navigate('/admin/login') }} className="btn-ghost !px-2" title="Sign out"><LogOut size={17} /></button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-[1500px] mx-auto fade-up" key={location.pathname}>
            <Outlet />
          </div>
        </main>
      </div>
      {cmd && <CommandPalette onClose={() => setCmd(false)} />}
    </div>
  )
}

function SidebarContent({ expanded, unread }: { expanded: boolean; unread: number }) {
  return (
    <>
      <div className="h-16 flex items-center px-4 gap-3 border-b border-white/5">
        <div className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0"><Smartphone size={20} /></div>
        {expanded && <div className="font-bold text-white text-[15px] whitespace-nowrap">Phone man</div>}
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-3 flex flex-col gap-1">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/admin'} title={n.label} className={({ isActive }) => cx('relative flex items-center gap-3 rounded-lg px-3 h-11 transition-colors', isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white')}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-brand-500" />}
                <span className="shrink-0"><n.icon size={20} /></span>
                {expanded && <span className="text-sm font-medium whitespace-nowrap">{n.label}</span>}
                {n.to === '/admin/alerts' && unread > 0 && <span className={cx('absolute bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center', expanded ? 'right-3' : 'top-1.5 right-1.5')}>{unread}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-white/5">
        <NavLink to="/" className="flex items-center gap-3 rounded-lg px-3 h-10 hover:bg-white/5 text-slate-400 hover:text-white" title="Launcher">
          <span className="shrink-0"><Monitor size={18} /></span>
          {expanded && <span className="text-xs font-medium">Launcher</span>}
        </NavLink>
      </div>
    </>
  )
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const db = useDB((s) => s.db)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    const out: Array<{ kind: string; label: string; sub?: string; to: string }> = []
    if (!term) {
      NAV.forEach((n) => out.push({ kind: 'Page', label: n.label, to: n.to }))
      return out.slice(0, 12)
    }
    NAV.filter((n) => n.label.toLowerCase().includes(term)).forEach((n) => out.push({ kind: 'Page', label: n.label, to: n.to }))
    db.products.filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.barcode.includes(term)).slice(0, 5).forEach((p) => out.push({ kind: 'Product', label: p.name, sub: `${p.sku} · ${money(p.price)} · ${p.stock} in stock`, to: `/admin/catalog/${p.id}` }))
    db.customers.filter((c) => c.name.toLowerCase().includes(term) || c.phone.includes(term) || (c.email ?? '').includes(term)).slice(0, 4).forEach((c) => out.push({ kind: 'Customer', label: c.name, sub: c.phone, to: `/admin/customers/${c.id}` }))
    db.transactions.filter((t) => t.number.toLowerCase().includes(term)).slice(-4).forEach((t) => out.push({ kind: 'Transaction', label: t.number, sub: `${money(t.total)} · ${fmtDateTime(t.createdAt)}`, to: `/admin/transactions/${t.id}` }))
    db.users.filter((u) => u.name.toLowerCase().includes(term)).slice(0, 3).forEach((u) => out.push({ kind: 'Staff', label: u.name, sub: u.role, to: `/admin/staff` }))
    db.repairs.filter((r) => r.number.toLowerCase().includes(term) || r.device.toLowerCase().includes(term)).slice(0, 3).forEach((r) => out.push({ kind: 'Repair', label: `${r.number} · ${r.device}`, sub: r.issue, to: `/admin/repairs` }))
    return out.slice(0, 14)
  }, [q, db])
  useEffect(() => setIdx(0), [q])
  const go = (to: string) => { navigate(to); onClose() }
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-pop overflow-hidden fade-up">
        <div className="flex items-center gap-2 px-4 border-b border-slate-100">
          <Search size={18} className="text-slate-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, customers, transactions, pages…" className="flex-1 py-3.5 text-sm outline-none"
            onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) } else if (e.key === 'Enter' && results[idx]) go(results[idx]!.to) }} />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {results.map((r, i) => (
            <button key={r.to + r.label} onMouseEnter={() => setIdx(i)} onClick={() => go(r.to)} className={cx('w-full flex items-center gap-3 px-4 py-2.5 text-left', i === idx ? 'bg-brand-50' : '')}>
              <Badge tone={r.kind === 'Page' ? 'slate' : r.kind === 'Product' ? 'blue' : r.kind === 'Customer' ? 'purple' : r.kind === 'Transaction' ? 'green' : 'amber'} className="w-20 justify-center">{r.kind}</Badge>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{r.label}</div>
                {r.sub && <div className="text-xs text-slate-400 truncate">{r.sub}</div>}
              </div>
            </button>
          ))}
          {!results.length && <div className="px-4 py-8 text-center text-sm text-slate-400">No results for “{q}”</div>}
        </div>
      </div>
    </div>
  )
}
