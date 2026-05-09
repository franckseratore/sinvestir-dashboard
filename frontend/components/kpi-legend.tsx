import { cn } from '@/lib/utils'

interface KpiLegendProps {
  className?: string
}

export function KpiLegend({ className }: KpiLegendProps) {
  return (
    <p className={cn('text-xs text-zinc-500 px-1', className)}>
      Bordure = seuil critique métier · Badge = % atteint vs objectif
    </p>
  )
}
