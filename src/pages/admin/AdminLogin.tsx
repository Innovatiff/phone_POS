import React, { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Smartphone, Lock, Mail, ArrowRight } from 'lucide-react'
import { useAdminUser, useSession } from '@/store/session'
import { useDB } from '@/store/db'

export default function AdminLogin() {
  const user = useAdminUser()
  const login = useSession((s) => s.loginAdmin)
  const users = useDB((s) => s.db.users.filter((u) => u.role !== 'cashier'))
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('admin@phoneman.store')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState<string | null>(null)
  if (user) return <Navigate to="/admin" replace />
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = login(email, password)
    if (!r.ok) { setError(r.message ?? 'Login failed'); return }
    navigate((location.state as { from?: string } | null)?.from ?? '/admin', { replace: true })
  }
  return (
    <div className="min-h-full flex">
      <div className="hidden lg:flex w-[46%] bg-navy-900 text-white flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-brand-600 flex items-center justify-center"><Smartphone size={22} /></div>
          <div className="font-bold text-lg">Phone man</div>
        </div>
        <div>
          <h2 className="text-4xl font-bold leading-tight">See every movement.<br />Control every sale.</h2>
          <p className="text-slate-400 mt-4 max-w-md">Live sales, cash drawers, stock, staff activity and customer history — all from one console.</p>
        </div>
        <div className="text-xs text-slate-500">Admin console · v1.0</div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 bg-[#f4f6fa]">
        <form onSubmit={submit} className="card p-8 w-full max-w-md fade-up">
          <h1 className="text-2xl font-bold text-slate-900">Sign in to Admin</h1>
          <p className="text-sm text-slate-500 mt-1">Use an admin or manager account.</p>
          <label className="block mt-6">
            <span className="label">Email</span>
            <div className="relative"><Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoFocus /></div>
          </label>
          <label className="block mt-4">
            <span className="label">Password</span>
            <div className="relative"><Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" value={password} onChange={(e) => setPassword(e.target.value)} type="password" /></div>
          </label>
          {error && <div className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <button className="btn-primary w-full mt-6 !py-2.5">Sign in <ArrowRight size={16} /></button>
          <div className="mt-6 border-t border-slate-100 pt-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-2">Demo accounts</div>
            <div className="flex flex-col gap-1.5">
              {users.map((u) => (
                <button type="button" key={u.id} onClick={() => { setEmail(u.email); setPassword(u.password ?? '') }} className="flex items-center justify-between text-xs rounded-lg px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600">
                  <span><b className="text-slate-800">{u.name}</b> · {u.role}</span><span className="font-mono">{u.email} / {u.password}</span>
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
