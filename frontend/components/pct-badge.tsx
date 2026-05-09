import { cn } from '@/lib/utils'

interface PctBadgeProps {
  pct: number | null
  pctStatus: 'green' | 'orange' | 'red' | 'unknown'
  size?: 'sm' | 'md'
  className?: string
}

const STYLES = {
  green: { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', emoji: '🟢' },
  orange: { dot: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', emoji: '🟡' },
  red: { dot: 'bg-rose-500', bg: 'bg-rose-50', text: 'text-rose-700', emoji: '🔴' },
  unknown: { dot: 'bg-zinc-300', bg: 'bg-zinc-50', text: 'text-zinc-500', emoji: '⚪' },
} as const

export function PctBadge({ pct, pctStatus, size = 'sm', className }: PctBadgeProps) {
  if (pct === null || pctStatus === 'unknown') {
    return null
  }
  const s = STYLES[pctStatus]
  const sizeClasses = size === 'md'
    ? 'text-xs px-2.5 py-1'
    : 'text-[11px] px-2 py-0.5'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium w-fit',
        s.bg,
        s.text,
        sizeClasses,
        className,
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', s.dot)} aria-hidden="true" />
      <span className="font-mono">{Math.round(pct)} %</span>
      <span className="opacity-80">atteint</span>
    </span>
  )
}
