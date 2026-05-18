/**
 * Port TypeScript de `backend/app/period_resolver.py`.
 *
 * Toutes les dates sont manipulées en UTC pour éviter les surprises timezone
 * dans le Workers runtime (la conversion Europe/Paris est faite côté affichage,
 * pas ici). Comportement strictement équivalent au code Python pour les bornes.
 */

export type Granularity = 'daily' | 'weekly' | 'monthly'

export type PeriodPreset =
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'ytd'
  | 'custom'

export interface Period {
  start: string // 'YYYY-MM-DD'
  end: string   // 'YYYY-MM-DD'
  label: string
  granularity: Granularity
  days: number
}

const DAY_MS = 86_400_000

function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS)
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDmy(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${day}/${m}/${y}`
}

// ISO weekday: 0 = Monday, 6 = Sunday (cohérent avec Python .weekday())
function isoWeekday(d: Date): number {
  return (d.getUTCDay() + 6) % 7
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function granularityFor(start: Date, end: Date): Granularity {
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS)
  if (days <= 30) return 'daily'
  if (days <= 180) return 'weekly'
  return 'monthly'
}

function buildPeriod(start: Date, end: Date, label: string): Period {
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1
  return {
    start: formatYmd(start),
    end: formatYmd(end),
    label,
    granularity: granularityFor(start, end),
    days,
  }
}

export function resolve(
  preset: string,
  options: { customStart?: string; customEnd?: string; today?: Date } = {},
): Period {
  const today = options.today ? toUtcMidnight(options.today) : toUtcMidnight(new Date())

  let start: Date
  let end: Date
  let label: string

  switch (preset) {
    case 'last_7_days':
      start = addDays(today, -6)
      end = today
      label = '7 derniers jours'
      break
    case 'last_30_days':
      start = addDays(today, -29)
      end = today
      label = '30 derniers jours'
      break
    case 'last_90_days':
      start = addDays(today, -89)
      end = today
      label = '90 derniers jours'
      break
    case 'this_week':
      start = addDays(today, -isoWeekday(today))
      end = today
      label = 'Cette semaine'
      break
    case 'last_week':
      start = addDays(today, -(isoWeekday(today) + 7))
      end = addDays(start, 6)
      label = 'Semaine dernière'
      break
    case 'this_month':
      start = firstOfMonth(today)
      end = today
      label = 'Ce mois'
      break
    case 'last_month': {
      const firstThis = firstOfMonth(today)
      end = addDays(firstThis, -1)
      start = firstOfMonth(end)
      label = 'Mois dernier'
      break
    }
    case 'ytd':
      start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
      end = today
      label = 'Année en cours'
      break
    case 'custom': {
      if (options.customStart && options.customEnd) {
        start = new Date(`${options.customStart}T00:00:00Z`)
        end = new Date(`${options.customEnd}T00:00:00Z`)
      } else {
        start = addDays(today, -29)
        end = today
      }
      label = `${formatDmy(start)} – ${formatDmy(end)}`
      break
    }
    default:
      start = addDays(today, -29)
      end = today
      label = '30 derniers jours'
  }

  return buildPeriod(start, end, label)
}

export function comparisonPeriod(p: Period): Period {
  const start = new Date(`${p.start}T00:00:00Z`)
  const end = new Date(`${p.end}T00:00:00Z`)
  const duration = Math.round((end.getTime() - start.getTime()) / DAY_MS)
  const compEnd = addDays(start, -1)
  const compStart = addDays(compEnd, -duration)
  return buildPeriod(
    compStart,
    compEnd,
    `${formatDmy(compStart)} – ${formatDmy(compEnd)}`,
  )
}
