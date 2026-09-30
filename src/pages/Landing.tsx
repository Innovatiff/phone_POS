import React from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard, ScanBarcode, Monitor, Smartphone, ArrowRight, ShieldCheck, Activity, Package } from 'lucide-react'
import { useDB } from '@/store/db'
import { money } from '@/lib/utils'

export default function Landing() {
  const db = useDB((s) => s.db)
  const openShifts = db.shifts.filter((s) => s.status === 'open')
  const today = new Date().toISOString().slice(0, 10)
  const todaySales = db.transactions.filter((t) => t.createdAt.slice(0, 10) === today && t.type === 'sale' && t.status !== 'voided').reduce((a, t) => a + t.total, 0)
  return (
    <div className="min-h-full bg-navy-900 text-white flex flex-col">
      <header className="flex items-center justify-between px-6 md:px-10 py-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-600/30"><Smartphone size={22} /></div>
          <div>
            <div className="text-lg font-bold leading-tight">{db.settings.storeName} POS</div>
            <div className="text-xs text-slate-400">{db.settings.tagline}</div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-6 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5"><Activity size={14} className="text-emerald-400" /> {openShifts.length} register{openShifts.length === 1 ? '' : 's'} open</span>
          <span className="inline-flex items-center gap-1.5"><Package size={14} className="text-brand-500" /> {db.products.length} products</span>
          <span className="inline-flex items-center gap-1.5">Today: <b className="text-white">{money(todaySales)}</b></span>
        </div>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-center">Choose a workspace</h1>
        <p className="text-slate-400 mt-3 text-center max-w-xl">One store, three screens. Everything you do in one window updates the others live — open them side by side to see it.</p>
        <div className="grid md:grid-cols-3 gap-5 mt-10 w-full max-w-5xl">
          <Tile to="/admin" icon={<LayoutDashboard size={26} />} color="#2563eb" title="Admin Console" desc="Dashboard, analytics, catalog, inventory, staff, shifts, activity log, reports and settings." hint="admin@phoneman.store / admin123" />
          <Tile to="/cashier" icon={<ScanBarcode size={26} />} color="#059669" title="Cashier Portal" desc="Scan and sell, manage the cart, take payments, refunds, hold sales and close shifts." hint="PIN 1111 · 2222 · 3333" />
          <Tile to="/display/reg_1" icon={<Monitor size={26} />} color="#7c3aed" title="Customer Display" desc="The second screen facing the customer: scanned items, running total and payment status." hint="Follows Register 1 · open next to the cashier" />
        </div>
        <div className="mt-10 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck size={14} /> Demo data lives in this browser. Reset it anytime from Admin → Settings → Data.</div>
      </main>
    </div>
  )
}

function Tile({ to, icon, color, title, desc, hint }: { to: string; icon: React.ReactNode; color: string; title: string; desc: string; hint: string }) {
  return (
    <Link to={to} className="group rounded-2xl bg-white/5 border border-white/10 p-6 hover:bg-white/10 hover:border-white/20 transition-colors flex flex-col">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: `${color}33`, color: '#fff' }}>{icon}</div>
      <div className="text-xl font-semibold">{title}</div>
      <div className="text-sm text-slate-400 mt-2 flex-1">{desc}</div>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-[11px] font-mono text-slate-500">{hint}</span>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-white group-hover:gap-2 transition-all">Open <ArrowRight size={16} /></span>
      </div>
    </Link>
  )
}
