import { create } from 'zustand'
import type { ID, Permission, User } from '@/lib/types'
import { useDB } from './db'
import { nowISO } from '@/lib/utils'

const KEY = 'phoneman.pos.session'

interface SessionState {
  adminUserId?: ID
  cashierUserId?: ID
  registerId?: ID
  loginAdmin: (email: string, password: string) => { ok: boolean; message?: string }
  logoutAdmin: () => void
  loginCashier: (pin: string) => { ok: boolean; message?: string; user?: User }
  logoutCashier: () => void
  selectRegister: (registerId?: ID) => void
  verifyPin: (pin: string, need?: Permission) => User | undefined
}

function loadSession(): Partial<SessionState> {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function save(s: Partial<SessionState>) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ adminUserId: s.adminUserId, cashierUserId: s.cashierUserId, registerId: s.registerId })) } catch { /* ignore */ }
}

export const useSession = create<SessionState>((set, get) => ({
  ...loadSession(),
  loginAdmin: (email, password) => {
    const { db, mutate } = useDB.getState()
    const u = db.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase() && (x.role === 'admin' || x.role === 'manager'))
    if (!u) return { ok: false, message: 'No admin or manager account with that email' }
    if (!u.active) return { ok: false, message: 'This account is deactivated' }
    if ((u.password ?? '') !== password) return { ok: false, message: 'Incorrect password' }
    mutate((d) => {
      const uu = d.users.find((x) => x.id === u.id)!
      uu.lastLoginAt = nowISO()
      d.activity.push({ id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, userId: u.id, userName: u.name, action: 'auth.admin_login', entity: 'user', entityId: u.id, description: `${u.name} signed in to the admin console`, severity: 'info', createdAt: nowISO() })
    })
    set({ adminUserId: u.id })
    save(get())
    return { ok: true }
  },
  logoutAdmin: () => {
    const id = get().adminUserId
    if (id) useDB.getState().log({ userId: id, action: 'auth.admin_logout', entity: 'user', entityId: id, description: 'Signed out of the admin console', severity: 'info' })
    set({ adminUserId: undefined })
    save(get())
  },
  loginCashier: (pin) => {
    const { db, mutate } = useDB.getState()
    const u = db.users.find((x) => x.pin === pin)
    if (!u) return { ok: false, message: 'Invalid PIN' }
    if (!u.active) return { ok: false, message: 'This account is deactivated. Ask a manager.' }
    if (!u.permissions.includes('sell') && u.role === 'cashier') return { ok: false, message: 'This account cannot sell' }
    mutate((d) => {
      const uu = d.users.find((x) => x.id === u.id)!
      uu.lastLoginAt = nowISO()
      d.activity.push({ id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, userId: u.id, userName: u.name, action: 'auth.cashier_login', entity: 'user', entityId: u.id, description: `${u.name} signed in to the cashier portal`, severity: 'info', createdAt: nowISO() })
    })
    set({ cashierUserId: u.id })
    save(get())
    return { ok: true, user: u }
  },
  logoutCashier: () => {
    const id = get().cashierUserId
    if (id) useDB.getState().log({ userId: id, action: 'auth.cashier_logout', entity: 'user', entityId: id, description: 'Signed out of the cashier portal', severity: 'info', registerId: get().registerId })
    set({ cashierUserId: undefined, registerId: undefined })
    save(get())
  },
  selectRegister: (registerId) => {
    set({ registerId })
    save(get())
  },
  verifyPin: (pin, need) => {
    const u = useDB.getState().db.users.find((x) => x.pin === pin && x.active)
    if (!u) return undefined
    if (need && u.role !== 'admin' && !u.permissions.includes(need)) return undefined
    return u
  },
}))

export function useAdminUser(): User | undefined {
  const id = useSession((s) => s.adminUserId)
  return useDB((s) => s.db.users.find((u) => u.id === id))
}
export function useCashierUser(): User | undefined {
  const id = useSession((s) => s.cashierUserId)
  return useDB((s) => s.db.users.find((u) => u.id === id))
}
export function hasPerm(u: User | undefined, p: Permission): boolean {
  if (!u) return false
  if (u.role === 'admin') return true
  return u.permissions.includes(p)
}
