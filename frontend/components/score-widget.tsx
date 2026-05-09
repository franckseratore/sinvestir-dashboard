'use client'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/format'
import { CheckCircle2, AlertTriangle, XCircle, ArrowRight } from 'lucide-react'
import type { GlobalStatusData } from '@/lib/api'

interface ScoreWidgetProps {
  gs: GlobalStatusData
}

// La couleur de bordure du widget suit `worst_status` (logique seuil_critique métier),
// cohérent avec la décision Q1 : bordure = seuil_critique, badge = % atteint.
export function ScoreWidget({ gs }: ScoreWidgetProps) {
  const { worst_status, phrase, total, green, orange, red, excluded, score_pct, top_alert } = gs

  const isGreen = worst_status === 'green'
  const isOrange = worst_status === 'orange'
  const isRed = worst_status === 'red'

  const Icon = isGreen ? CheckCircle2 : isOrange ? AlertTriangle : XCircle

  const hasObjectives = total > 0

  return (
    <div className={cn(
      'rounded-xl border bg-white px-5 py-4 sm:px-6 sm:py-5',
      isGreen && 'border-emerald-200',
      isOrange && 'border-amber-200',
      isRed && 'border-rose-200',
    )}>
      <div className="flex items-start gap-3 sm:gap-4">
        <Icon
          size={22}
          className={cn(
            'flex-shrink-0 mt-0.5',
            isGreen && 'text-emerald-500',
            isOrange && 'text-amber-500',
            isRed && 'text-rose-500',
          )}
        />
        <div className="flex-1 min-w-0 space-y-3">
          {/* Title */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Score de la semaine
            </p>
            <p className="text-sm text-zinc-600 mt-0.5">{phrase}</p>
          </div>

          {/* Score line */}
          {hasObjectives ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-2xl sm:text-3xl font-semibold text-brand">
                {green} <span className="text-zinc-400">/ {total}</span>
              </span>
              <span className="text-sm text-zinc-500">atteints</span>
              {score_pct !== null && (
                <span className={cn(
                  'text-sm font-semibold',
                  score_pct >= 80 ? 'text-emerald-700' : score_pct >= 50 ? 'text-amber-700' : 'text-rose-700',
                )}>
                  — {Math.round(score_pct)} %
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500 italic">
              Pas d&apos;objectif défini pour cette période.
            </p>
          )}

          {/* Counts */}
          {hasObjectives && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-medium">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {green} verts
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-amber-700">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {orange} jaunes
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1 text-rose-700">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                {red} rouges
              </span>
              {excluded > 0 && (
                <span className="text-zinc-400">
                  ({excluded} KPI{excluded > 1 ? 's' : ''} hors comparaison)
                </span>
              )}
            </div>
          )}

          {/* Top alert */}
          {top_alert && (
            <Link
              href={top_alert.href}
              className={cn(
                'group flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
                'border-rose-200 bg-rose-50 hover:bg-rose-100',
              )}
            >
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-rose-500" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-rose-800">
                  Plus en alerte : {top_alert.label}
                </p>
                <p className="text-xs text-rose-700 mt-0.5 font-mono">
                  {formatValue(top_alert.value, top_alert.format)}
                  {top_alert.target !== null && (
                    <> vs objectif {formatValue(top_alert.target, top_alert.format)}</>
                  )}
                  {top_alert.pct_atteinte !== null && (
                    <span className="text-rose-600"> ({Math.round(top_alert.pct_atteinte)} % atteint)</span>
                  )}
                </p>
              </div>
              <ArrowRight size={14} className="flex-shrink-0 mt-1 text-rose-400 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
