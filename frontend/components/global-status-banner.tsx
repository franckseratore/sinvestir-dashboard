'use client'
import { cn } from '@/lib/utils'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'

interface GlobalStatusBannerProps {
  worst_status: 'green' | 'orange' | 'red'
  phrase: string
  critical_count: number
  warning_count: number
}

export function GlobalStatusBanner({ worst_status, phrase, critical_count, warning_count }: GlobalStatusBannerProps) {
  const isGreen = worst_status === 'green'
  const isOrange = worst_status === 'orange'
  const isRed = worst_status === 'red'

  const Icon = isGreen ? CheckCircle2 : isOrange ? AlertTriangle : XCircle

  return (
    <div className={cn(
      'rounded-xl border px-5 py-4 flex items-center gap-4',
      isGreen && 'border-emerald-200 bg-emerald-50',
      isOrange && 'border-amber-200 bg-amber-50',
      isRed && 'border-rose-200 bg-rose-50',
    )}>
      <Icon
        size={20}
        className={cn(
          'flex-shrink-0',
          isGreen && 'text-emerald-500',
          isOrange && 'text-amber-500',
          isRed && 'text-rose-500',
        )}
      />
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-semibold',
          isGreen && 'text-emerald-800',
          isOrange && 'text-amber-800',
          isRed && 'text-rose-800',
        )}>
          Statut global de la semaine
        </p>
        <p className={cn(
          'text-sm mt-0.5',
          isGreen && 'text-emerald-700',
          isOrange && 'text-amber-700',
          isRed && 'text-rose-700',
        )}>
          {phrase}
        </p>
      </div>
      {(critical_count > 0 || warning_count > 0) && (
        <div className="flex items-center gap-3 flex-shrink-0 text-xs font-medium">
          {critical_count > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-rose-700">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              {critical_count} critique{critical_count > 1 ? 's' : ''}
            </span>
          )}
          {warning_count > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {warning_count} à surveiller
            </span>
          )}
        </div>
      )}
    </div>
  )
}
