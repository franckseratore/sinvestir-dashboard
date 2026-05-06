'use client'
import { useQueryState } from 'nuqs'
import { cn } from '@/lib/utils'
import { CalendarDays, GitCompare } from 'lucide-react'

const PRESETS = [
  { value: 'last_7_days',  label: '7 derniers jours' },
  { value: 'last_30_days', label: '30 derniers jours' },
  { value: 'last_90_days', label: '90 derniers jours' },
  { value: 'this_week',    label: 'Cette semaine' },
  { value: 'last_week',    label: 'Semaine dernière' },
  { value: 'this_month',   label: 'Ce mois' },
  { value: 'last_month',   label: 'Mois dernier' },
  { value: 'ytd',          label: 'Année en cours' },
  { value: 'custom',       label: 'Plage personnalisée' },
]

export function PeriodSelector() {
  const defaultPeriod = new Date().getDay() === 2 ? 'last_week' : 'last_30_days' // Tuesday = CEO review day
  const [period, setPeriod] = useQueryState('period', { defaultValue: defaultPeriod, shallow: false })
  const [compare, setCompare] = useQueryState('compare', { defaultValue: 'false', shallow: false })
  const [start, setStart] = useQueryState('start', { defaultValue: '', shallow: false })
  const [end, setEnd] = useQueryState('end', { defaultValue: '', shallow: false })

  const isCompare = compare === 'true'
  const currentLabel = PRESETS.find((p) => p.value === period)?.label ?? '30 derniers jours'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Period dropdown */}
      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm">
        <CalendarDays size={14} className="text-zinc-400 flex-shrink-0" />
        <select
          value={period ?? 'last_30_days'}
          onChange={(e) => {
            setPeriod(e.target.value)
            if (e.target.value !== 'custom') { setStart(''); setEnd('') }
          }}
          className="text-sm font-medium text-zinc-700 bg-transparent outline-none cursor-pointer pr-1"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Custom date range */}
      {period === 'custom' && (
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm">
          <input
            type="date"
            value={start ?? ''}
            onChange={(e) => setStart(e.target.value)}
            className="text-sm text-zinc-700 bg-transparent outline-none"
          />
          <span className="text-zinc-300">→</span>
          <input
            type="date"
            value={end ?? ''}
            onChange={(e) => setEnd(e.target.value)}
            className="text-sm text-zinc-700 bg-transparent outline-none"
          />
        </div>
      )}

      {/* Compare toggle */}
      <button
        onClick={() => setCompare(isCompare ? 'false' : 'true')}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-150 shadow-sm',
          isCompare
            ? 'border-brand bg-brand text-white'
            : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
        )}
      >
        <GitCompare size={14} />
        Comparer
      </button>
    </div>
  )
}
