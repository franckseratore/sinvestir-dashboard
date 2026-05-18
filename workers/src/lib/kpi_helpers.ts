/**
 * Port TS des helpers communs aux KPIs : targets, status, pct_atteinte,
 * format de KpiCard. Équivalent strict de `backend/app/kpis.py` lignes 14-200.
 */
import type postgres from 'postgres'
import type { Period } from './period'

export type KpiFormat = 'currency' | 'percent' | 'number'
export type StatusValue = 'green' | 'orange' | 'red' | 'unknown'

export interface Target {
  sens: 'Haut' | 'Bas'
  target: number
  seuil: number
  prorata: boolean
}

export interface KpiCard {
  value: number | null
  comparison_value: number | null
  delta: number | null
  delta_pct: number | null
  status: StatusValue
  trend_alert: boolean
  target: number | null
  seuil_critique: number | null
  pct_atteinte: number | null
  pct_status: StatusValue
  format: KpiFormat
  sparkline: number[]
  moving_avg_4w: number | null
}

export function safeDiv(num: number | null, den: number | null): number | null {
  if (den === null || den === 0) return null
  if (num === null) return null
  return num / den
}

export async function getTarget(
  sql: postgres.Sql,
  indicateur: string,
): Promise<Target | null> {
  const rows = await sql<
    Array<{ sens: 'Haut' | 'Bas'; target_mensuelle: number; seuil_critique: number; prorata: boolean }>
  >`
    SELECT sens, target_mensuelle, seuil_critique, prorata
    FROM targets WHERE indicateur = ${indicateur}
  `
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    sens: r.sens,
    target: Number(r.target_mensuelle),
    seuil: Number(r.seuil_critique),
    prorata: Boolean(r.prorata),
  }
}

export function scaleTarget(
  t: Target | null,
  period: Period,
): { target: number | null; seuil: number | null } {
  if (!t) return { target: null, seuil: null }
  const startYear = Number(period.start.slice(0, 4))
  const endYear = Number(period.end.slice(0, 4))
  if ((startYear < 2026 && endYear < 2026) || (startYear > 2026 && endYear > 2026)) {
    return { target: null, seuil: null }
  }
  if (!t.prorata) return { target: t.target, seuil: t.seuil }
  const scale = period.days / 30
  return { target: t.target * scale, seuil: t.seuil * scale }
}

export function computePctAtteinte(
  value: number | null,
  target: number | null,
  sens: 'Haut' | 'Bas' | null,
): { pct: number | null; status: StatusValue } {
  if (value === null || target === null || target === 0 || !sens) {
    return { pct: null, status: 'unknown' }
  }
  let pct: number
  if (sens === 'Haut') {
    pct = (value / target) * 100
  } else {
    pct = value === 0 ? 999 : (target / value) * 100
  }
  pct = Math.min(pct, 999)
  let status: StatusValue = 'red'
  if (pct >= 100) status = 'green'
  else if (pct >= 80) status = 'orange'
  return { pct: Math.round(pct * 10) / 10, status }
}

export function statusOf(
  value: number | null,
  target: number | null,
  seuil: number | null,
  sens: 'Haut' | 'Bas' | null,
): StatusValue {
  if (value === null || target === null || seuil === null || !sens) return 'unknown'
  if (sens === 'Haut') {
    if (value >= target) return 'green'
    if (value >= seuil) return 'orange'
    return 'red'
  }
  // Bas
  if (value <= target) return 'green'
  if (value <= seuil) return 'orange'
  return 'red'
}

function round2(v: number | null): number | null {
  if (v === null) return null
  return Math.round(v * 100) / 100
}

export async function buildKpiCard(
  sql: postgres.Sql,
  indicateur: string,
  value: number | null,
  compValue: number | null,
  period: Period,
  fmt: KpiFormat = 'number',
  options: {
    sparkline?: number[]
    trendAlert?: boolean
    movingAvg4w?: number | null
  } = {},
): Promise<KpiCard> {
  const t = await getTarget(sql, indicateur)
  const { target: scaledTarget, seuil: scaledSeuil } = scaleTarget(t, period)
  const sens = t?.sens ?? null

  let delta: number | null = null
  let deltaPct: number | null = null
  if (value !== null && compValue !== null && compValue !== 0) {
    delta = value - compValue
    deltaPct = Math.round((delta / compValue) * 1000) / 10
  } else if (value !== null && compValue !== null) {
    delta = value - compValue
  }

  let st = statusOf(value, scaledTarget, scaledSeuil, sens)
  if (options.trendAlert && st !== 'red') st = 'red'

  const { pct: pctAtteinte, status: pctStatus } = computePctAtteinte(
    value,
    scaledTarget,
    sens,
  )

  return {
    value: round2(value),
    comparison_value: round2(compValue),
    delta: round2(delta),
    delta_pct: deltaPct,
    status: st,
    trend_alert: Boolean(options.trendAlert),
    target: round2(scaledTarget),
    seuil_critique: round2(scaledSeuil),
    pct_atteinte: pctAtteinte,
    pct_status: pctStatus,
    format: fmt,
    sparkline: options.sparkline ?? [],
    moving_avg_4w: round2(options.movingAvg4w ?? null),
  }
}

/**
 * Sparkline générique : groupe par jour sur les 30 derniers jours et applique
 * une SQL aggregation sur les `tableName`.{`dateCol`}.
 * On accepte une callable qui prend (sql, start, end) → number[] pour rester
 * type-safe (postgres.js refuse l'interpolation de table/colonne en string).
 */
export type SparklineFetcher = (
  sql: postgres.Sql,
  start: string,
  end: string,
) => Promise<Array<{ d: string; v: number | string | null }>>

export async function buildSparkline(
  sql: postgres.Sql,
  period: Period,
  fetcher: SparklineFetcher,
): Promise<number[]> {
  const end = new Date(`${period.end}T00:00:00Z`)
  const start = new Date(end.getTime() - 29 * 86_400_000)
  const startStr = start.toISOString().slice(0, 10)
  const rows = await fetcher(sql, startStr, period.end)
  return rows.map((r) => {
    const v = r.v
    if (v === null || v === undefined) return 0
    const n = typeof v === 'number' ? v : Number(v)
    return Math.round(n * 100) / 100
  })
}
