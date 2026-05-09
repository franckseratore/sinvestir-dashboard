'use client'
import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/format'
import { StatusBadge } from './status-badge'
import { TrendArrow } from './trend-arrow'
import { Sparkline, sparklineColor } from './sparkline'
import { PctBadge } from './pct-badge'
import { Info } from 'lucide-react'
import type { KpiCard as KpiCardData } from '@/lib/api'

interface HeroKpiCardProps {
  title: string
  data: KpiCardData
  sens?: 'Haut' | 'Bas'
  className?: string
  tooltip?: string
}

export function HeroKpiCard({ title, data, sens = 'Haut', className, tooltip }: HeroKpiCardProps) {
  const color = sparklineColor(data.status)

  const borderAccent =
    data.status === 'red' ? 'border-t-rose-500' :
    data.status === 'orange' ? 'border-t-amber-400' :
    data.status === 'green' ? 'border-t-emerald-500' :
    'border-t-zinc-200'

  return (
    <div className={cn(
      'rounded-xl border border-zinc-200 bg-white px-6 py-6 flex flex-col gap-4 hover:shadow-md transition-shadow duration-200 border-t-4',
      borderAccent,
      className,
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</span>
          {tooltip && (
            <div className="group relative flex-shrink-0">
              <Info size={12} className="cursor-help text-zinc-300 hover:text-zinc-500 transition-colors" />
              <div className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-600 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 leading-relaxed">
                {tooltip}
              </div>
            </div>
          )}
        </div>
        <StatusBadge status={data.status} trendAlert={data.trend_alert} />
      </div>

      {/* Value — larger than KpiCard */}
      <div className="flex items-end justify-between gap-2">
        <span className={cn('font-mono text-4xl font-bold text-brand leading-none', data.value === null && 'text-zinc-300')}>
          {formatValue(data.value, data.format)}
        </span>
        {(data.delta !== null || data.delta_pct !== null) && (
          <TrendArrow delta={data.delta} deltaPct={data.delta_pct} sens={sens} />
        )}
      </div>

      {/* Comparison + moving avg */}
      <div className="flex items-center gap-4 text-xs text-zinc-400">
        {data.comparison_value !== null && data.comparison_value !== undefined && (
          <span>Période préc. : <span className="font-mono font-medium text-zinc-500">{formatValue(data.comparison_value, data.format)}</span></span>
        )}
        {data.moving_avg_4w !== null && data.moving_avg_4w !== undefined && (
          <span>Moy. 4 sem. : <span className="font-mono font-medium text-zinc-500">{formatValue(data.moving_avg_4w, data.format)}</span></span>
        )}
      </div>

      {/* Objectif + badge % atteint (Axe 1) */}
      {data.target !== null && data.target !== undefined ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>Objectif : <span className="font-mono font-semibold text-zinc-700">{formatValue(data.target, data.format)}</span></span>
            {data.seuil_critique !== null && data.seuil_critique !== undefined && (
              <span className="text-zinc-400">• Seuil : <span className="font-mono">{formatValue(data.seuil_critique, data.format)}</span></span>
            )}
          </div>
          <PctBadge pct={data.pct_atteinte} pctStatus={data.pct_status} size="md" />
        </div>
      ) : (
        <div className="text-xs text-zinc-400 italic">Pas d&apos;objectif</div>
      )}

      {/* Sparkline */}
      {data.sparkline && data.sparkline.length > 0 && (
        <div className="-mx-2 mt-1">
          <Sparkline data={data.sparkline} color={color} height={44} />
        </div>
      )}
    </div>
  )
}
