'use client'
import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/format'
import { StatusBadge } from './status-badge'
import { TrendArrow } from './trend-arrow'
import { Sparkline, sparklineColor } from './sparkline'
import { PctBadge } from './pct-badge'
import { Info } from 'lucide-react'
import type { KpiCard as KpiCardData, Pacing } from '@/lib/api'

function PacingBadge({ pacing }: { pacing: Pacing }) {
  const color =
    pacing.status === 'green' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : pacing.status === 'orange' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : pacing.status === 'red' ? 'bg-rose-50 text-rose-700 border-rose-200'
    : 'bg-zinc-50 text-zinc-500 border-zinc-200'
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[10px] font-medium border rounded-md px-1.5 py-0.5 self-start', color)}
      title={`Atteint ${pacing.actual_pct.toFixed(1).replace('.', ',')}% du target mensuel · Période écoulée ${pacing.expected_pct.toFixed(1).replace('.', ',')}%`}
    >
      Pacing : {pacing.label}
    </span>
  )
}

interface KpiCardProps {
  title: string
  data: KpiCardData
  sens?: 'Haut' | 'Bas'
  className?: string
  tooltip?: string
}

function Skeleton() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-3">
      <div className="h-3 w-24 rounded bg-zinc-100 animate-pulse" />
      <div className="h-8 w-36 rounded bg-zinc-100 animate-pulse" />
      <div className="h-10 rounded bg-zinc-50 animate-pulse" />
    </div>
  )
}

export function KpiCard({ title, data, sens = 'Haut', className, tooltip }: KpiCardProps) {
  const color = sparklineColor(data.status)

  return (
    <div className={cn('rounded-xl border border-zinc-200 bg-white p-5 flex flex-col gap-3 hover:shadow-sm transition-shadow duration-200', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{title}</span>
          {tooltip && (
            <div className="group relative flex-shrink-0">
              <Info size={11} className="cursor-help text-zinc-300 hover:text-zinc-500 transition-colors" />
              <div className="absolute bottom-full left-0 mb-2 w-60 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs text-zinc-600 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 leading-relaxed">
                {tooltip}
              </div>
            </div>
          )}
        </div>
        <StatusBadge status={data.status} trendAlert={data.trend_alert} />
      </div>

      {/* Value */}
      <div className="flex items-end justify-between gap-2">
        <span className={cn('font-mono text-3xl font-semibold text-brand leading-none', data.value === null && 'text-zinc-300')}>
          {formatValue(data.value, data.format)}
        </span>
        {(data.delta !== null || data.delta_pct !== null) && (
          <TrendArrow delta={data.delta} deltaPct={data.delta_pct} sens={sens} />
        )}
      </div>

      {/* Comparison value */}
      {data.comparison_value !== null && data.comparison_value !== undefined && (
        <div className="text-xs text-zinc-400">
          Période préc. : <span className="font-mono font-medium text-zinc-500">{formatValue(data.comparison_value, data.format)}</span>
        </div>
      )}

      {/* Objectif + badge % atteint (Axe 1) */}
      {data.target !== null && data.target !== undefined ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span>Objectif : <span className="font-mono font-medium text-zinc-700">{formatValue(data.target, data.format)}</span></span>
            {data.seuil_critique !== null && data.seuil_critique !== undefined && (
              <span className="text-zinc-400">• Seuil : <span className="font-mono">{formatValue(data.seuil_critique, data.format)}</span></span>
            )}
          </div>
          <PctBadge pct={data.pct_atteinte} pctStatus={data.pct_status} />
          {data.pacing && (
            <PacingBadge pacing={data.pacing} />
          )}
        </div>
      ) : (
        <div className="text-[11px] text-zinc-400 italic">Pas d&apos;objectif</div>
      )}

      {/* Moving average 4 weeks */}
      {data.moving_avg_4w !== null && data.moving_avg_4w !== undefined && (
        <div className="text-xs text-zinc-400">
          Moy. 4 sem. : <span className="font-mono font-medium text-zinc-500">{formatValue(data.moving_avg_4w, data.format)}</span>
        </div>
      )}

      {/* Sparkline */}
      {data.sparkline && data.sparkline.length > 0 && (
        <div className="-mx-1 mt-1">
          <Sparkline data={data.sparkline} color={color} height={36} />
        </div>
      )}
    </div>
  )
}

KpiCard.Skeleton = Skeleton
