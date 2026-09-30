import React, { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Delete, ShieldCheck } from 'lucide-react'
import type { Permission, Settings, User } from '@/lib/types'
import { useDB, useOpenShift } from '@/store/db'
import { hasPerm, useCashierUser, useSession } from '@/store/session'
import { Modal } from '@/components/ui'
import { cx } from '@/lib/utils'

// ─── Context helper ──────────────────────────────────────────────────────────
export function useCashierContext() {
  const user = useCashierUser()
  const registerId = useSession((s) => s.registerId)
  const register = useDB((s) => s.db.registers.find((r) => r.id === registerId))
  const shift = useOpenShift(registerId)
  return { user, registerId, register, shift }
}

// ─── Sounds ──────────────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null
export function beep(freq = 880, ms = 70, volume = 0.06) {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audioCtx ??= new Ctor()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.value = volume
    o.connect(g)
    g.connect(audioCtx.destination)
    const t = audioCtx.currentTime
    o.start(t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
    o.stop(t + ms / 1000 + 0.02)
  } catch {
    /* audio not available */
  }
}

// ─── Shake (Web Animations API, no global CSS) ───────────────────────────────
export function shake(el: HTMLElement | null) {
  if (!el || typeof el.animate !== 'function') return
  try {
    el.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
      { duration: 360, easing: 'ease-in-out' },
    )
  } catch {
    /* ignore */
  }
}

// ─── Discount policy ─────────────────────────────────────────────────────────
export function isManager(u: User | undefined): boolean {
  return !!u && (u.role === 'admin' || u.role === 'manager')
}
/** Whether applying a discount of `pct` percent needs a manager PIN for this user. */
export function discountNeedsManager(u: User | undefined, pct: number, settings: Settings): boolean {
  if (pct <= 0) return false
  if (!u) return true
  if (isManager(u)) return false
  if (!hasPerm(u, 'discount')) return true
  return pct > settings.cashierMaxDiscountPercent + 1e-9
}

// ─── Keypad ──────────────────────────────────────────────────────────────────
export function Keypad({ onKey, onBackspace, onClear, variant = 'light', leftKey, size = 'md', className }: {
  onKey: (k: string) => void
  onBackspace: () => void
  onClear?: () => void
  variant?: 'light' | 'dark'
  /** Replace the bottom-left "C" key with a custom key (e.g. "." or "00"). */
  leftKey?: string
  size?: 'md' | 'lg'
  className?: string
}) {
  const base = cx(
    'rounded-xl font-semibold select-none transition-colors active:scale-[0.97] flex items-center justify-center',
    size === 'lg' ? 'h-16 text-2xl' : 'h-12 text-lg',
    variant === 'dark' ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-100 text-slate-800 hover:bg-slate-200',
  )
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  return (
    <div className={cx('grid grid-cols-3 gap-2', className)}>
      {keys.map((k) => (
        <button key={k} type="button" className={base} onClick={() => onKey(k)}>{k}</button>
      ))}
      {leftKey ? (
        <button type="button" className={base} onClick={() => onKey(leftKey)}>{leftKey}</button>
      ) : (
        <button type="button" className={cx(base, 'text-sm uppercase tracking-wide', variant === 'dark' ? 'text-slate-300' : 'text-slate-500')} onClick={onClear}>Clear</button>
      )}
      <button type="button" className={base} onClick={() => onKey('0')}>0</button>
      <button type="button" className={base} onClick={onBackspace} aria-label="Backspace"><Delete size={size === 'lg' ? 24 : 20} /></button>
    </div>
  )
}

export function PinDots({ length, max = 4, variant = 'light' }: { length: number; max?: number; variant?: 'light' | 'dark' }) {
  const n = Math.max(max, length)
  return (
    <div className="flex items-center justify-center gap-3">
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className={cx('w-3.5 h-3.5 rounded-full transition-all', i < length ? (variant === 'dark' ? 'bg-white scale-110' : 'bg-brand-600 scale-110') : variant === 'dark' ? 'bg-white/20' : 'bg-slate-200')} />
      ))}
    </div>
  )
}

// ─── Manager PIN approval (promise based, like confirm()) ────────────────────
interface PinReq { open: boolean; need?: Permission; title: string; message?: string; resolve?: (u: User | undefined) => void }
const usePinStore = create<PinReq & { ask: (o: Omit<PinReq, 'open' | 'resolve'>) => Promise<User | undefined>; close: (u: User | undefined) => void }>((set, get) => ({
  open: false,
  title: '',
  ask: (o) => new Promise<User | undefined>((resolve) => {
    get().resolve?.(undefined)
    set({ ...o, open: true, resolve })
  }),
  close: (u) => { get().resolve?.(u); set({ open: false, resolve: undefined }) },
}))

/** Ask for a manager PIN that carries the given permission. Resolves with the approving user, or undefined if cancelled. */
export const requestManagerPin = (need: Permission, title = 'Manager approval required', message?: string) => usePinStore.getState().ask({ need, title, message })

export function ManagerPinHost() {
  const s = usePinStore()
  const verifyPin = useSession((x) => x.verifyPin)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!s.open) return
    setPin(''); setError('')
    try { (document.activeElement as HTMLElement | null)?.blur() } catch { /* ignore */ }
  }, [s.open])

  const submit = (p: string) => {
    const u = verifyPin(p, s.need)
    if (!u) {
      setError(s.need ? `PIN not recognised or lacks "${s.need.replace(/_/g, ' ')}" permission` : 'PIN not recognised')
      shake(boxRef.current)
      setPin('')
      return
    }
    s.close(u)
  }
  useEffect(() => {
    if (!s.open || pin.length !== 4) return
    const t = window.setTimeout(() => submit(pin), 100)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, s.open])
  useEffect(() => {
    if (!s.open) return
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p))
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Enter' && pin.length >= 4) submit(pin)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.open, pin])

  return (
    <Modal open={s.open} onClose={() => s.close(undefined)} size="sm" title={s.title} subtitle={s.message ?? 'Enter a manager PIN to continue'}>
      <div ref={boxRef} className="pb-3">
        <div className="flex items-center justify-center gap-2 text-brand-600 mb-4"><ShieldCheck size={20} /><span className="text-xs font-semibold uppercase tracking-wide">{s.need ? s.need.replace(/_/g, ' ') : 'approval'}</span></div>
        <PinDots length={pin.length} />
        <div className={cx('text-center text-xs mt-3 h-4', error ? 'text-red-600' : 'text-slate-400')}>{error || 'Auto-submits at 4 digits'}</div>
        <Keypad className="mt-3 max-w-[260px] mx-auto" onKey={(k) => setPin((p) => (p.length < 6 ? p + k : p))} onBackspace={() => setPin((p) => p.slice(0, -1))} onClear={() => setPin('')} />
      </div>
    </Modal>
  )
}

/** Money input helper: keeps a string that parses to a non-negative number. */
export function parseAmount(s: string): number {
  const n = parseFloat(s)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
