'use client'
import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/format'
import { StatusBadge } from './status-badge'
import { TrendArrow } from './trend-arrow'
import { Info } from 'lucide-react'
import type { KpiCard as KpiCardData } from '@/lib/api'

interface SplitEntry {
  label: string
  value: number | null
  status: 'green' | 'orange' | 'red' | 'unknown'
}

interface SplitKpiCardProps {
  title: string
  data: KpiCardData
  splits: [SplitEntry, SplitEntry]
  sens?: 'Haut' | 'Bas'
  tooltip?: string
  className?: string
}

const DOT: Record<string, string> = {
  green: 'bg-emerald-500',
  orange: 'bg-amber-400',
  red: 'bg-rose-500',
  unknown: 'bg-zinc-300',
}

export function SplitKpiCard({ title, data, splits, sens = 'Haut', tooltip, className }: SplitKpiCardProps) {
  return (
    <div className={cn('rounded-xl border border-zinc-200 bg-white p-5 flex flex-col gap-3 hover:shadow-sm transition-shadow duration-200', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{title}</span>
          {tooltip && (
            <div className="group relative flex-shrink-0">
              <Info size={11} className="cursor-help text-zinc-300 hover:text-zinc-500 transition-colors" />
              <div className="absolute bottom-full left-0 mb-2 w-64 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs text-zinc-600 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 leading-relaxed">
                {tooltip}
              </div>
            </div>
          )}
        </div>
        <StatusBadge status={data.status} trendAlert={data.trend_alert} />
      </div>

      {/* Global value */}
      <div className="flex items-end justify-between gap-2">
        <span className={cn('font-mono text-3xl font-semibold text-brand leading-none', data.value === null && 'text-zinc-300')}>
          {formatValue(data.value, data.format)}
        </span>
        {(data.delta !== null || data.delta_pct !== null) && (
          <TrendArrow delta={data.delta} deltaPct={data.delta_pct} sens={sens} />
        )}
      </div>

      {/* Target */}
      {data.target !== null && data.target !== undefined && (
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <span>Cible : <span className="font-mono">{formatValue(data.target, data.format)}</span></span>
          {data.seuil_critique !== null && data.seuil_critique !== undefined && (
            <span>• Seuil : <span className="font-mono">{formatValue(data.seuil_critique, data.format)}</span></span>
          )}
        </div>
      )}

      {/* Split row */}
      <div className="flex items-center gap-3 pt-1 border-t border-zinc-50">
        {splits.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 flex-1">
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', DOT[s.status] ?? DOT.unknown)} />
            <span className="text-[10px] text-zinc-400 font-medium">{s.label}</span>
            <span className="font-mono text-xs font-semibold text-zinc-600 ml-auto">
              {formatValue(s.value, data.format)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
