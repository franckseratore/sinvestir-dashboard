import { cn } from '@/lib/utils'

interface TrendArrowProps {
  delta: number | null
  deltaPct: number | null
  sens?: 'Haut' | 'Bas'
  className?: string
}

export function TrendArrow({ delta, deltaPct, sens = 'Haut', className }: TrendArrowProps) {
  if (delta === null && deltaPct === null) {
    return <span className={cn('text-xs text-zinc-400', className)}>—</span>
  }

  const positive = (delta ?? deltaPct ?? 0) > 0
  const isGood = sens === 'Haut' ? positive : !positive
  const val = deltaPct != null
    ? (Math.abs(deltaPct).toFixed(1).replace('.', ',') + ' %')
    : ''

  return (
    <span className={cn('flex items-center gap-0.5 text-xs font-semibold font-mono', isGood ? 'text-emerald-600' : 'text-rose-500', className)}>
      <span>{positive ? '▲' : '▼'}</span>
      {val && <span>{val}</span>}
    </span>
  )
}
