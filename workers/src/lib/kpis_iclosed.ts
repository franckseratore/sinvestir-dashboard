/**
 * KPIs iClosed — port de backend/app/kpis_iclosed.py.
 *
 * NOTE: tables `ic_calls` et `ic_deals` vides tant que le pipeline d'ingestion
 * iClosed n'est pas en place côté Workers (Cron Trigger à venir).
 */
import type postgres from 'postgres'
import type { Period } from './period'
import { buildKpiCard, getTarget, scaleTarget, statusOf, type KpiCard, type StatusValue } from './kpi_helpers'

export interface IClosedKpi {
  value: number | null
  comparison_value?: number | null
  delta_pct?: number | null
  status: StatusValue
}

function nf(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function deltaPct(val: number | null, comp: number | null): number | null {
  if (val === null || comp === null || comp === 0) return null
  return Math.round(((val - comp) / comp) * 1000) / 10
}

export async function volumeCalls(sql: postgres.Sql, p: Period, comp: Period | null): Promise<IClosedKpi> {
  const val = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM ic_calls WHERE date BETWEEN ${p.start} AND ${p.end}`)[0]?.v)
  let compVal: number | null = null
  if (comp) {
    compVal = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM ic_calls WHERE date BETWEEN ${comp.start} AND ${comp.end}`)[0]?.v)
  }
  return { value: val, comparison_value: compVal, delta_pct: deltaPct(val, compVal), status: 'unknown' }
}

export async function noShowRateIc(sql: postgres.Sql, p: Period, comp: Period | null): Promise<IClosedKpi> {
  const rows = await sql<Array<{ rate: number | null }>>`
    SELECT COUNT(*) FILTER (WHERE outcome = 'NO_SHOW')::float
         / NULLIF(COUNT(*) FILTER (WHERE outcome IS NOT NULL), 0) AS rate
    FROM ic_calls WHERE date BETWEEN ${p.start} AND ${p.end}
  `
  const val = nf(rows[0]?.rate)
  let compVal: number | null = null
  if (comp) {
    const rows2 = await sql<Array<{ rate: number | null }>>`
      SELECT COUNT(*) FILTER (WHERE outcome = 'NO_SHOW')::float
           / NULLIF(COUNT(*) FILTER (WHERE outcome IS NOT NULL), 0) AS rate
      FROM ic_calls WHERE date BETWEEN ${comp.start} AND ${comp.end}
    `
    compVal = nf(rows2[0]?.rate)
  }
  const t = await getTarget(sql, 'no_show_rate')
  const { target: st, seuil: ss } = scaleTarget(t, p)
  const status = statusOf(val, st, ss, t?.sens ?? null)
  return { value: val, comparison_value: compVal, delta_pct: deltaPct(val, compVal), status }
}

export async function closingRateNetIc(sql: postgres.Sql, p: Period, comp: Period | null): Promise<IClosedKpi> {
  const shown = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM ic_calls WHERE date BETWEEN ${p.start} AND ${p.end} AND outcome IS NOT NULL AND outcome != 'NO_SHOW'`)[0]?.v) ?? 0
  const won = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM ic_deals WHERE date BETWEEN ${p.start} AND ${p.end} AND transaction_type = 'WON'`)[0]?.v) ?? 0
  const val = shown ? won / shown : null
  let compVal: number | null = null
  if (comp) {
    const shown2 = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM ic_calls WHERE date BETWEEN ${comp.start} AND ${comp.end} AND outcome IS NOT NULL AND outcome != 'NO_SHOW'`)[0]?.v) ?? 0
    const won2 = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM ic_deals WHERE date BETWEEN ${comp.start} AND ${comp.end} AND transaction_type = 'WON'`)[0]?.v) ?? 0
    compVal = shown2 ? won2 / shown2 : null
  }
  const t = await getTarget(sql, 'closing_rate_net')
  const { target: st, seuil: ss } = scaleTarget(t, p)
  const status = statusOf(val, st, ss, t?.sens ?? null)
  return { value: val, comparison_value: compVal, delta_pct: deltaPct(val, compVal), status }
}

export async function revenueIc(sql: postgres.Sql, p: Period, comp: Period | null): Promise<IClosedKpi> {
  const val = nf((await sql<Array<{ v: string | number }>>`SELECT COALESCE(SUM(value),0) AS v FROM ic_deals WHERE date BETWEEN ${p.start} AND ${p.end} AND transaction_type = 'WON'`)[0]?.v)
  let compVal: number | null = null
  if (comp) {
    compVal = nf((await sql<Array<{ v: string | number }>>`SELECT COALESCE(SUM(value),0) AS v FROM ic_deals WHERE date BETWEEN ${comp.start} AND ${comp.end} AND transaction_type = 'WON'`)[0]?.v)
  }
  const status: StatusValue = val && val > 0 ? 'green' : 'red'
  return { value: val, comparison_value: compVal, delta_pct: deltaPct(val, compVal), status }
}

export async function acvIc(sql: postgres.Sql, p: Period, comp: Period | null): Promise<IClosedKpi> {
  const val = nf((await sql<Array<{ v: number | null }>>`SELECT AVG(value) AS v FROM ic_deals WHERE date BETWEEN ${p.start} AND ${p.end} AND transaction_type = 'WON'`)[0]?.v)
  let compVal: number | null = null
  if (comp) {
    compVal = nf((await sql<Array<{ v: number | null }>>`SELECT AVG(value) AS v FROM ic_deals WHERE date BETWEEN ${comp.start} AND ${comp.end} AND transaction_type = 'WON'`)[0]?.v)
  }
  const t = await getTarget(sql, 'acv')
  const { target: st, seuil: ss } = scaleTarget(t, p)
  const status = statusOf(val, st, ss, t?.sens ?? null)
  return { value: val, comparison_value: compVal, delta_pct: deltaPct(val, compVal), status }
}

async function outcomeRate(
  sql: postgres.Sql,
  outcome: string,
  start: string,
  end: string,
): Promise<number | null> {
  const rows = await sql<Array<{ rate: number | null }>>`
    SELECT COUNT(*) FILTER (WHERE outcome = ${outcome})::float
         / NULLIF(COUNT(*) FILTER (WHERE outcome IS NOT NULL), 0) AS rate
    FROM ic_calls WHERE date BETWEEN ${start} AND ${end}
  `
  return nf(rows[0]?.rate)
}

/**
 * Taux générique iClosed (annulation / disqualification) renvoyé en KpiCard
 * complet pour s'intégrer aux autres cards de l'onglet Sales.
 */
async function outcomeRateCard(
  sql: postgres.Sql,
  indicateur: string,
  outcome: string,
  p: Period,
  comp: Period | null,
): Promise<KpiCard> {
  const val = await outcomeRate(sql, outcome, p.start, p.end)
  const cval = comp ? await outcomeRate(sql, outcome, comp.start, comp.end) : null
  return buildKpiCard(sql, indicateur, val, cval, p, 'percent')
}

export async function cancellationRateIc(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  return outcomeRateCard(sql, 'cancellation_rate', 'CANCELLED', p, comp)
}

export async function disqualificationRateIc(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  return outcomeRateCard(sql, 'disqualification_rate', 'DISQUALIFIED', p, comp)
}

export async function ventesCountIc(sql: postgres.Sql, p: Period, comp: Period | null): Promise<IClosedKpi> {
  const val = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM ic_deals WHERE date BETWEEN ${p.start} AND ${p.end} AND transaction_type = 'WON'`)[0]?.v)
  let compVal: number | null = null
  if (comp) {
    compVal = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM ic_deals WHERE date BETWEEN ${comp.start} AND ${comp.end} AND transaction_type = 'WON'`)[0]?.v)
  }
  return { value: val, comparison_value: compVal, delta_pct: deltaPct(val, compVal), status: 'unknown' }
}

export async function closersTableIc(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ closer: string; calls: number; shown: number; no_shows: number; ventes: number; ca: number; closing_rate_pct: number | null; acv: number | null }>> {
  const rows = await sql<Array<{ closer: string | null; calls: number; shown: number; no_shows: number; ventes: number; ca: number | null; closing_rate_pct: number | null; acv: number | null }>>`
    WITH calls_agg AS (
      SELECT closer,
             COUNT(*) AS calls_total,
             COUNT(*) FILTER (WHERE outcome IS NOT NULL) AS calls_logged,
             COUNT(*) FILTER (WHERE outcome = 'NO_SHOW') AS no_shows,
             COUNT(*) FILTER (WHERE outcome IS NOT NULL AND outcome != 'NO_SHOW') AS shown
      FROM ic_calls WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY closer
    ),
    deals_agg AS (
      SELECT closer,
             COUNT(*) FILTER (WHERE transaction_type = 'WON') AS ventes,
             SUM(value) FILTER (WHERE transaction_type = 'WON') AS ca
      FROM ic_deals WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY closer
    )
    SELECT c.closer, c.calls_total AS calls, c.shown, c.no_shows,
           COALESCE(d.ventes, 0) AS ventes,
           COALESCE(d.ca, 0) AS ca,
           CASE WHEN c.shown > 0 THEN ROUND(COALESCE(d.ventes, 0)::numeric / c.shown * 100, 1) END AS closing_rate_pct,
           CASE WHEN d.ventes > 0 THEN ROUND(d.ca / d.ventes, 0) END AS acv
    FROM calls_agg c LEFT JOIN deals_agg d ON c.closer = d.closer
    ORDER BY ca DESC NULLS LAST
  `
  return rows.map((r) => ({
    closer: r.closer ?? '',
    calls: Number(r.calls) || 0,
    shown: Number(r.shown) || 0,
    no_shows: Number(r.no_shows) || 0,
    ventes: Number(r.ventes) || 0,
    ca: Number(r.ca) || 0,
    closing_rate_pct: r.closing_rate_pct !== null ? Number(r.closing_rate_pct) : null,
    acv: r.acv !== null ? Number(r.acv) : null,
  }))
}

export async function outcomesBreakdown(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ outcome: string; count: number; pct: number }>> {
  const rows = await sql<Array<{ outcome: string | null; count: string | number }>>`
    SELECT COALESCE(outcome, 'Non renseigné') AS outcome, COUNT(*) AS count
    FROM ic_calls WHERE date BETWEEN ${p.start} AND ${p.end}
    GROUP BY outcome ORDER BY count DESC
  `
  const total = rows.reduce((acc, r) => acc + (Number(r.count) || 0), 0)
  return rows.map((r) => ({
    outcome: r.outcome ?? 'Non renseigné',
    count: Number(r.count) || 0,
    pct: total ? Math.round(((Number(r.count) || 0) / total) * 1000) / 10 : 0,
  }))
}

export async function chartRevenueByDay(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ date: string; ca: number; ventes: number }>> {
  const rows = await sql<Array<{ date: Date | string; ca: number | null; ventes: number | null }>>`
    SELECT date, SUM(value) AS ca, COUNT(*) AS ventes
    FROM ic_deals WHERE date BETWEEN ${p.start} AND ${p.end} AND transaction_type = 'WON'
    GROUP BY date ORDER BY date ASC
  `
  return rows.map((r) => ({
    date: (typeof r.date === 'string' ? r.date : r.date.toISOString()).slice(0, 10),
    ca: Number(r.ca) || 0,
    ventes: Number(r.ventes) || 0,
  }))
}
