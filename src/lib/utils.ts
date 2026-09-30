import { format, formatDistanceToNowStrict, isSameDay, parseISO } from 'date-fns'

// ─── IDs ─────────────────────────────────────────────────────────────────────
let counter = 0
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1_000_000
  const rand = Math.random().toString(36).slice(2, 8)
  const time = Date.now().toString(36)
  return `${prefix}${prefix ? '_' : ''}${time}${rand}${counter.toString(36)}`
}

export function pad(n: number, width = 6): string {
  return String(n).padStart(width, '0')
}

// ─── Money ───────────────────────────────────────────────────────────────────
let currencyFormatter: Intl.NumberFormat | null = null
let currencyKey = ''

export function configureCurrency(locale: string, currency: string) {
  const key = `${locale}|${currency}`
  if (key !== currencyKey) {
    try {
      currencyFormatter = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 })
    } catch {
      currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    }
    currencyKey = key
  }
}

export function money(n: number | undefined | null): string {
  if (!currencyFormatter) configureCurrency('en-US', 'USD')
  return currencyFormatter!.format(round2(n ?? 0))
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function pct(n: number, digits = 1): string {
  return `${(n >= 0 ? '+' : '')}${n.toFixed(digits)}%`
}

export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1) + 'k'
  return n.toLocaleString()
}

// ─── Dates ───────────────────────────────────────────────────────────────────
export const nowISO = () => new Date().toISOString()

export function fmtDate(iso: string | undefined, f = 'MMM d, yyyy'): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), f)
  } catch {
    return iso
  }
}
export function fmtDateTime(iso: string | undefined): string {
  return fmtDate(iso, 'MMM d, yyyy · HH:mm')
}
export function fmtTime(iso: string | undefined): string {
  return fmtDate(iso, 'HH:mm')
}
export function ago(iso: string | undefined): string {
  if (!iso) return '—'
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true })
  } catch {
    return iso
  }
}
export function sameDay(a: string, b: Date | string): boolean {
  return isSameDay(parseISO(a), typeof b === 'string' ? parseISO(b) : b)
}
export function startOfDayISO(d = new Date()): string {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.toISOString()
}
export function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}
export function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

// ─── Misc ────────────────────────────────────────────────────────────────────
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function sum<T>(arr: T[], fn: (t: T) => number): number {
  return arr.reduce((acc, t) => acc + fn(t), 0)
}

export function groupBy<T, K extends string | number>(arr: T[], key: (t: T) => K): Record<K, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item)
    ;(acc[k] ||= []).push(item)
    return acc
  }, {} as Record<K, T[]>)
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

export function titleCase(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function downloadFile(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0]!)
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n')
}

export function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length)
  if (!lines.length) return []
  const parseLine = (line: string) => {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (c === '"') inQ = false
        else cur += c
      } else if (c === '"') inQ = true
      else if (c === ',') {
        out.push(cur)
        cur = ''
      } else cur += c
    }
    out.push(cur)
    return out
  }
  const headers = parseLine(lines[0]!).map((h) => h.trim())
  return lines.slice(1).map((l) => {
    const vals = parseLine(l)
    const o: Record<string, string> = {}
    headers.forEach((h, i) => (o[h] = (vals[i] ?? '').trim()))
    return o
  })
}

// Seeded PRNG (mulberry32) for deterministic demo data
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#ca8a04']

export function generateIMEI(r: () => number): string {
  let s = '35'
  for (let i = 0; i < 13; i++) s += Math.floor(r() * 10)
  return s
}

export function generateBarcode(r: () => number): string {
  let s = '8'
  for (let i = 0; i < 12; i++) s += Math.floor(r() * 10)
  return s
}
