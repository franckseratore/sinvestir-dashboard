/**
 * KPIs additionnels (au-delà des 7 core de kpis.ts) :
 *   volume_leads_paid/organic, booking_rate_paid/organic, ca_per_lead, ca_per_call,
 *   acv, ventes_count, calls_booked/completed, no_show_rate, budget_paid, ca_paid
 *
 * Cohérent avec backend/app/kpis.py — mêmes formules, mêmes indicateurs.
 */
import type postgres from 'postgres'
import type { Period } from './period'
import { buildKpiCard, buildSparkline, safeDiv, type KpiCard, type SparklineFetcher } from './kpi_helpers'

function nf(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

async function scalar(
  _sql: postgres.Sql,
  rows: Promise<Array<Record<string, number | string | null>>>,
): Promise<number | null> {
  const r = await rows
  if (!r.length) return null
  const first = r[0]
  const firstKey = Object.keys(first)[0]
  return nf(first[firstKey])
}

function isoWeekRanges(today = new Date()): Array<{ start: string; end: string }> {
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const weekday = (t.getUTCDay() + 6) % 7
  const lastSunday = new Date(t.getTime() - (weekday + 1) * 86_400_000)
  const out: Array<{ start: string; end: string }> = []
  for (let i = 3; i >= 0; i--) {
    const sunday = new Date(lastSunday.getTime() - i * 7 * 86_400_000)
    const monday = new Date(sunday.getTime() - 6 * 86_400_000)
    out.push({ start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) })
  }
  return out
}

// ─── KPIs additionnels ───────────────────────────────────────────────────────

export async function volumeLeadsPaid(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const v = await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads_paid WHERE date BETWEEN ${p.start} AND ${p.end}`)
  const cv = comp ? await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads_paid WHERE date BETWEEN ${comp.start} AND ${comp.end}`) : null
  return buildKpiCard(sql, 'volume_leads_paid', v, cv, p, 'number')
}

export async function volumeLeadsOrganic(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const v = await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${p.start} AND ${p.end} AND canal = 'Organique'`)
  const cv = comp ? await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${comp.start} AND ${comp.end} AND canal = 'Organique'`) : null
  return buildKpiCard(sql, 'volume_leads_organic', v, cv, p, 'number')
}

export async function bookingRatePaid(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const calls = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls_paid WHERE date_reservation BETWEEN ${p.start} AND ${p.end}`)
  const leads = await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads_paid WHERE date BETWEEN ${p.start} AND ${p.end}`)
  const v = safeDiv(calls, leads)
  let cv: number | null = null
  if (comp) {
    const cc = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls_paid WHERE date_reservation BETWEEN ${comp.start} AND ${comp.end}`)
    const cl = await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads_paid WHERE date BETWEEN ${comp.start} AND ${comp.end}`)
    cv = safeDiv(cc, cl)
  }
  return buildKpiCard(sql, 'booking_rate_paid', v, cv, p, 'percent')
}

export async function bookingRateOrganic(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const calls = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${p.start} AND ${p.end} AND canal = 'Organique'`)
  const leads = await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${p.start} AND ${p.end} AND canal = 'Organique'`)
  const v = safeDiv(calls, leads)
  let cv: number | null = null
  if (comp) {
    const cc = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${comp.start} AND ${comp.end} AND canal = 'Organique'`)
    const cl = await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${comp.start} AND ${comp.end} AND canal = 'Organique'`)
    cv = safeDiv(cc, cl)
  }
  return buildKpiCard(sql, 'booking_rate_organic', v, cv, p, 'percent')
}

export async function caPerLead(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const ca = await scalar(sql, sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end}`)
  const leads = await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${p.start} AND ${p.end}`)
  const v = safeDiv(ca, leads)
  let cv: number | null = null
  if (comp) {
    const cca = await scalar(sql, sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${comp.start} AND ${comp.end}`)
    const cl = await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${comp.start} AND ${comp.end}`)
    cv = safeDiv(cca, cl)
  }
  const weeks = isoWeekRanges()
  const weekly: number[] = []
  for (const w of weeks) {
    const wca = await scalar(sql, sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${w.start} AND ${w.end}`)
    const wl = await scalar(sql, sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${w.start} AND ${w.end}`)
    const r = safeDiv(wca, wl)
    if (r !== null) weekly.push(r)
  }
  const mov4w = weekly.length === 4 ? Math.round((weekly.reduce((a, b) => a + b) / 4) * 10000) / 10000 : null
  const trendAlert = weekly.length === 4 && weekly[1] < weekly[0] && weekly[2] < weekly[1] && weekly[3] < weekly[2]
  return buildKpiCard(sql, 'ca_per_lead', v, cv, p, 'currency', { trendAlert, movingAvg4w: mov4w })
}

export async function caPerCall(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const ca = await scalar(sql, sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end}`)
  const calls = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${p.start} AND ${p.end} AND is_past = TRUE`)
  const v = safeDiv(ca, calls)
  let cv: number | null = null
  if (comp) {
    const cca = await scalar(sql, sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${comp.start} AND ${comp.end}`)
    const cc = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${comp.start} AND ${comp.end} AND is_past = TRUE`)
    cv = safeDiv(cca, cc)
  }
  return buildKpiCard(sql, 'ca_per_call', v, cv, p, 'currency')
}

export async function acv(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const ca = await scalar(sql, sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end}`)
  const cnt = await scalar(sql, sql`SELECT COUNT(*) AS v FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end}`)
  const v = safeDiv(ca, cnt)
  let cv: number | null = null
  if (comp) {
    const cca = await scalar(sql, sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${comp.start} AND ${comp.end}`)
    const ccnt = await scalar(sql, sql`SELECT COUNT(*) AS v FROM ventes WHERE date BETWEEN ${comp.start} AND ${comp.end}`)
    cv = safeDiv(cca, ccnt)
  }
  return buildKpiCard(sql, 'acv', v, cv, p, 'currency')
}

export async function ventesCount(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const v = await scalar(sql, sql`SELECT COUNT(*) AS v FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end}`)
  const cv = comp ? await scalar(sql, sql`SELECT COUNT(*) AS v FROM ventes WHERE date BETWEEN ${comp.start} AND ${comp.end}`) : null
  return buildKpiCard(sql, 'ventes_count', v, cv, p, 'number')
}

export async function callsBooked(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const v = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${p.start} AND ${p.end}`)
  const cv = comp ? await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${comp.start} AND ${comp.end}`) : null
  return buildKpiCard(sql, 'calls_booked', v, cv, p, 'number')
}

export async function callsCompleted(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const v = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${p.start} AND ${p.end} AND is_past = TRUE`)
  const cv = comp ? await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${comp.start} AND ${comp.end} AND is_past = TRUE`) : null
  return buildKpiCard(sql, 'calls_completed', v, cv, p, 'number')
}

export async function noShowRate(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const eligible = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${p.start} AND ${p.end} AND (is_past = TRUE OR date_call IS NULL)`)
  const ns = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${p.start} AND ${p.end} AND date_call IS NULL`)
  const v = safeDiv(ns, eligible)
  let cv: number | null = null
  if (comp) {
    const ce = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${comp.start} AND ${comp.end} AND (is_past = TRUE OR date_call IS NULL)`)
    const cn = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${comp.start} AND ${comp.end} AND date_call IS NULL`)
    cv = safeDiv(cn, ce)
  }
  const weeks = isoWeekRanges()
  const weekly: number[] = []
  for (const w of weeks) {
    const el = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${w.start} AND ${w.end} AND (is_past = TRUE OR date_call IS NULL)`)
    const nsw = await scalar(sql, sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${w.start} AND ${w.end} AND date_call IS NULL`)
    const r = safeDiv(nsw, el)
    if (r !== null) weekly.push(r)
  }
  const mov4w = weekly.length === 4 ? Math.round((weekly.reduce((a, b) => a + b) / 4) * 10000) / 10000 : null
  // No-show is "Bas" → trend alert on 3 consecutive increases
  const trendAlert = weekly.length === 4 && weekly[1] > weekly[0] && weekly[2] > weekly[1] && weekly[3] > weekly[2]
  return buildKpiCard(sql, 'no_show_rate', v, cv, p, 'percent', { trendAlert, movingAvg4w: mov4w })
}

export async function budgetPaid(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const v = await scalar(sql, sql`SELECT COALESCE(SUM(spend),0) AS v FROM budget WHERE date BETWEEN ${p.start} AND ${p.end}`)
  const cv = comp ? await scalar(sql, sql`SELECT COALESCE(SUM(spend),0) AS v FROM budget WHERE date BETWEEN ${comp.start} AND ${comp.end}`) : null
  const fetcher: SparklineFetcher = (s, start, end) =>
    s`SELECT date AS d, COALESCE(SUM(spend),0) AS v FROM budget WHERE date BETWEEN ${start} AND ${end} GROUP BY date ORDER BY date`
  const sparkline = await buildSparkline(sql, p, fetcher)
  return buildKpiCard(sql, 'budget_paid', v, cv, p, 'currency', { sparkline })
}

export async function caPaid(sql: postgres.Sql, p: Period, comp: Period | null): Promise<KpiCard> {
  const v = await scalar(sql, sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes_paid WHERE date BETWEEN ${p.start} AND ${p.end}`)
  const cv = comp ? await scalar(sql, sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes_paid WHERE date BETWEEN ${comp.start} AND ${comp.end}`) : null
  // Python kpis.ca_paid uses indicateur 'ca_ht' (cf line 538) — on garde la même target
  return buildKpiCard(sql, 'ca_ht', v, cv, p, 'currency')
}
