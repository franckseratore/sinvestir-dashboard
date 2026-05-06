import { cn } from '@/lib/utils'

type Status = 'green' | 'orange' | 'red' | 'unknown'

const CONFIG: Record<Status, { label: string; dot: string; bg: string; text: string }> = {
  green:   { label: 'OK',          dot: 'bg-emerald-500', bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  orange:  { label: 'À surveiller', dot: 'bg-amber-500',   bg: 'bg-amber-50',    text: 'text-amber-700' },
  red:     { label: 'Critique',     dot: 'bg-rose-500',    bg: 'bg-rose-50',     text: 'text-rose-700' },
  unknown: { label: '—',            dot: 'bg-zinc-300',    bg: 'bg-zinc-50',     text: 'text-zinc-500' },
}

interface StatusBadgeProps {
  status: Status
  trendAlert?: boolean
  className?: string
}

export function StatusBadge({ status, trendAlert, className }: StatusBadgeProps) {
  const c = CONFIG[status] ?? CONFIG.unknown
  const label = trendAlert ? '⚠ Tendance' : c.label

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', c.bg, c.text, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', c.dot)} />
      {label}
    </span>
  )
}
