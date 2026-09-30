import React from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from '@/lib/utils'

export const CHART_COLORS = ['#2563eb', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b']

const axisStyle = { fontSize: 11, fill: '#94a3b8' }

export function MoneyTooltip({ active, payload, label, moneyKeys }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; dataKey: string }>; label?: string; moneyKeys?: string[] }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-pop px-3 py-2 text-xs">
      <div className="font-semibold text-slate-700 mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="font-semibold text-slate-800 tabular-nums">{!moneyKeys || moneyKeys.includes(String(p.dataKey)) ? money(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

export function TrendAreaChart({ data, series, height = 260, xKey = 'label', moneyKeys }: { data: Array<Record<string, unknown>>; series: Array<{ key: string; name: string; color: string }>; height?: number; xKey?: string; moneyKeys?: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g_${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="#eef2f7" />
        <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={(v) => (moneyKeys && !moneyKeys.includes(series[0]!.key) ? v : `${v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : v}`)} />
        <Tooltip content={<MoneyTooltip moneyKeys={moneyKeys} />} cursor={{ stroke: '#cbd5e1', strokeDasharray: '3 3' }} />
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2.2} fill={`url(#g_${s.key})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function SimpleBarChart({ data, xKey, bars, height = 240, moneyKeys, stacked, layout = 'horizontal' }: { data: Array<Record<string, unknown>>; xKey: string; bars: Array<{ key: string; name: string; color: string }>; height?: number; moneyKeys?: string[]; stacked?: boolean; layout?: 'horizontal' | 'vertical' }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 8, left: layout === 'vertical' ? 30 : -12, bottom: 0 }} barCategoryGap={layout === 'vertical' ? 6 : 10}>
        <CartesianGrid vertical={layout === 'vertical'} horizontal={layout === 'horizontal'} stroke="#eef2f7" />
        {layout === 'horizontal' ? (
          <>
            <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
          </>
        ) : (
          <>
            <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} width={110} />
          </>
        )}
        <Tooltip content={<MoneyTooltip moneyKeys={moneyKeys} />} cursor={{ fill: '#f1f5f9' }} />
        {bars.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />}
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[6, 6, 0, 0]} stackId={stacked ? 'a' : undefined} maxBarSize={38} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function DonutChart({ data, height = 220, valueKey = 'value', nameKey = 'name', money: isMoney = true }: { data: Array<{ name: string; value: number; color?: string }>; height?: number; valueKey?: string; nameKey?: string; money?: boolean }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="62%" outerRadius="88%" paddingAngle={2} strokeWidth={0}>
          {data.map((d, i) => <Cell key={i} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number, n: string) => [isMoney ? money(v) : v, `${n} (${total ? ((v / total) * 100).toFixed(0) : 0}%)`]} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function SimpleLineChart({ data, xKey, lines, height = 220, moneyKeys }: { data: Array<Record<string, unknown>>; xKey: string; lines: Array<{ key: string; name: string; color: string }>; height?: number; moneyKeys?: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#eef2f7" />
        <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
        <Tooltip content={<MoneyTooltip moneyKeys={moneyKeys} />} />
        {lines.map((l) => <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function LegendDots({ items }: { items: Array<{ name: string; color: string }> }) {
  return (
    <div className="flex items-center gap-4 text-xs text-slate-600">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: i.color }} />{i.name}</span>
      ))}
    </div>
  )
}

export function ChartPlaceholder({ children }: { children: React.ReactNode }) {
  return <div className="h-[220px] flex items-center justify-center text-sm text-slate-400">{children}</div>
}
