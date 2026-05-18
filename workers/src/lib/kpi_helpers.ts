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

export interface Pacing {
  delta_pp: number    // delta en points de pourcentage (atteint − attendu_au_jour-du-mois)
  status: StatusValue
  label: string       // "en retard de X pts" / "à l'heure" / "en avance de X pts"
  expected_pct: number
  actual_pct: number
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
  pacing: Pacing | null
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

/**
 * Calcule le pacing d'un KPI cumulatif :
 *   pacing = % atteint sur target mensuel − % du mois écoulé
 *
 * Ne s'applique qu'aux KPIs cumulatifs (Target.prorata = true) ET aux périodes
 * qui couvrent le mois courant en cours (this_month / ytd inclus).
 *
 * - delta > 0   → "en avance"     (green)
 * - delta ∈ [-10, 0]  → "à l'heure"  (orange si < 0, sinon green)
 * - delta < -10 → "en retard"     (red)
 *
 * Pour sens=Bas (CPL, no_show), pacing n'est pas pertinent et on retourne null
 * — ce sont des ratios qui ne s'accumulent pas avec le temps.
 */
export function computePacing(
  value: number | null,
  target: Target | null,
  period: Period,
  today: Date = new Date(),
): Pacing | null {
  if (!target || !target.prorata) return null
  if (value === null) return null
  if (target.sens === 'Bas') return null // CPL/no-show : pas de pacing
  if (target.target <= 0) return null

  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const tIso = t.toISOString().slice(0, 10)

  // Le pacing n'a de sens que si la période contient `today` (= cycle en cours)
  if (period.start > tIso || period.end < tIso) return null

  // Détermine la durée totale et écoulée du "cycle" en cours.
  // - Pour this_month : cycle = mois courant complet, écoulé = today.day
  // - Pour ytd        : cycle = année courante, écoulé = jour de l'année
  // - Autres périodes "rolling" (last_30_days etc.) : on assume que la période
  //   définie EST le cycle (start=début, end=today), totalDays = period.days
  //   adapté à la durée canonique 30j → cycle de 30j en cours.
  let totalDays: number
  let elapsedDays: number
  const startD = new Date(`${period.start}T00:00:00Z`)
  const periodStartIsFirstOfMonth = startD.getUTCDate() === 1

  if (periodStartIsFirstOfMonth && startD.getUTCMonth() === t.getUTCMonth() && startD.getUTCFullYear() === t.getUTCFullYear()) {
    // this_month
    totalDays = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
    elapsedDays = t.getUTCDate()
  } else if (startD.getUTCMonth() === 0 && startD.getUTCDate() === 1 && startD.getUTCFullYear() === t.getUTCFullYear()) {
    // ytd
    const startOfYear = new Date(Date.UTC(t.getUTCFullYear(), 0, 0))
    elapsedDays = Math.round((t.getTime() - startOfYear.getTime()) / 86_400_000)
    const endOfYear = new Date(Date.UTC(t.getUTCFullYear() + 1, 0, 0))
    totalDays = Math.round((endOfYear.getTime() - startOfYear.getTime()) / 86_400_000)
  } else {
    // last_30_days, last_7_days, this_week, custom : assume cycle de period.days
    totalDays = period.days
    elapsedDays = period.days
  }

  const expectedPct = Math.round((elapsedDays / totalDays) * 1000) / 10
  const actualPct = Math.round((value / target.target) * 1000) / 10
  const deltaPp = Math.round((actualPct - expectedPct) * 10) / 10

  let status: StatusValue
  let label: string
  if (deltaPp > 0) {
    status = 'green'
    label = `en avance de ${deltaPp.toFixed(1).replace('.', ',')} pts`
  } else if (deltaPp >= -10) {
    status = deltaPp >= -2 ? 'green' : 'orange'
    label = deltaPp >= -2 ? 'à l\'heure' : `en retard de ${Math.abs(deltaPp).toFixed(1).replace('.', ',')} pts`
  } else {
    status = 'red'
    label = `en retard de ${Math.abs(deltaPp).toFixed(1).replace('.', ',')} pts`
  }
  return { delta_pp: deltaPp, status, label, expected_pct: expectedPct, actual_pct: actualPct }
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

  const pacing = computePacing(value, t, period)

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
    pacing,
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
