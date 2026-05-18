/**
 * Port TS des KPIs core de `backend/app/kpis.py` (cf. ca_ht, volume_leads,
 * booking_rate, closing_rate, closing_rate_net, cpl_paid, roas_paid,
 * budget_paid, no_show_rate, acv, calls_completed).
 *
 * Pour chaque KPI, on garde la même formule et le même `indicateur` que la
 * version Python pour que `getTarget(indicateur)` retombe sur la bonne target.
 *
 * Les queries Postgres reprennent strictement le SQL DuckDB (équivalent ANSI).
 */
import type postgres from 'postgres'
import type { Period } from './period'
import {
  buildKpiCard,
  buildSparkline,
  safeDiv,
  type KpiCard,
  type SparklineFetcher,
} from './kpi_helpers'

// ─── Helpers internes ───────────────────────────────────────────────────────

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
  // last Sunday: today - (weekday + 1) where Monday=0..Sunday=6
  const weekday = (t.getUTCDay() + 6) % 7
  const lastSunday = new Date(t.getTime() - (weekday + 1) * 86_400_000)
  const out: Array<{ start: string; end: string }> = []
  for (let i = 3; i >= 0; i--) {
    const sunday = new Date(lastSunday.getTime() - i * 7 * 86_400_000)
    const monday = new Date(sunday.getTime() - 6 * 86_400_000)
    out.push({
      start: monday.toISOString().slice(0, 10),
      end: sunday.toISOString().slice(0, 10),
    })
  }
  return out
}

// ─── KPIs ───────────────────────────────────────────────────────────────────

export async function caHt(
  sql: postgres.Sql,
  period: Period,
  comp: Period | null,
): Promise<KpiCard> {
  const val = await scalar(
    sql,
    sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${period.start} AND ${period.end}`,
  )
  const cval = comp
    ? await scalar(
        sql,
        sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${comp.start} AND ${comp.end}`,
      )
    : null

  const fetcher: SparklineFetcher = (s, start, end) =>
    s`SELECT date AS d, COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${start} AND ${end} GROUP BY date ORDER BY date`
  const sparkline = await buildSparkline(sql, period, fetcher)

  // Last 4 ISO weeks for moving_avg + trend_alert
  const weeks = isoWeekRanges()
  const weekly: number[] = []
  for (const w of weeks) {
    const v = await scalar(
      sql,
      sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes WHERE date BETWEEN ${w.start} AND ${w.end}`,
    )
    weekly.push(v ?? 0)
  }
  const movingAvg4w = weekly.length === 4 ? Math.round((weekly.reduce((a, b) => a + b) / 4) * 100) / 100 : null
  const trendAlert =
    weekly.length === 4 && weekly[1] < weekly[0] && weekly[2] < weekly[1] && weekly[3] < weekly[2]

  return buildKpiCard(sql, 'ca_ht', val, cval, period, 'currency', {
    sparkline,
    trendAlert,
    movingAvg4w,
  })
}

export async function volumeLeads(
  sql: postgres.Sql,
  period: Period,
  comp: Period | null,
): Promise<KpiCard> {
  const val = await scalar(
    sql,
    sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${period.start} AND ${period.end}`,
  )
  const cval = comp
    ? await scalar(
        sql,
        sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${comp.start} AND ${comp.end}`,
      )
    : null
  const fetcher: SparklineFetcher = (s, start, end) =>
    s`SELECT date AS d, COUNT(*) AS v FROM leads WHERE date BETWEEN ${start} AND ${end} GROUP BY date ORDER BY date`
  const sparkline = await buildSparkline(sql, period, fetcher)
  return buildKpiCard(sql, 'volume_leads', val, cval, period, 'number', { sparkline })
}

export async function bookingRate(
  sql: postgres.Sql,
  period: Period,
  comp: Period | null,
): Promise<KpiCard> {
  const calls = await scalar(
    sql,
    sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${period.start} AND ${period.end}`,
  )
  const leads = await scalar(
    sql,
    sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${period.start} AND ${period.end}`,
  )
  const val = safeDiv(calls, leads)
  let cval: number | null = null
  if (comp) {
    const cc = await scalar(
      sql,
      sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${comp.start} AND ${comp.end}`,
    )
    const cl = await scalar(
      sql,
      sql`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${comp.start} AND ${comp.end}`,
    )
    cval = safeDiv(cc, cl)
  }
  return buildKpiCard(sql, 'booking_rate', val, cval, period, 'percent')
}

export async function closingRate(
  sql: postgres.Sql,
  period: Period,
  comp: Period | null,
): Promise<KpiCard> {
  // Brut : ventes / calls réservés (inclut no-shows)
  const sales = await scalar(
    sql,
    sql`SELECT COUNT(*) AS v FROM ventes WHERE date BETWEEN ${period.start} AND ${period.end}`,
  )
  const booked = await scalar(
    sql,
    sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${period.start} AND ${period.end}`,
  )
  const val = safeDiv(sales, booked)
  let cval: number | null = null
  if (comp) {
    const cs = await scalar(
      sql,
      sql`SELECT COUNT(*) AS v FROM ventes WHERE date BETWEEN ${comp.start} AND ${comp.end}`,
    )
    const cb = await scalar(
      sql,
      sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${comp.start} AND ${comp.end}`,
    )
    cval = safeDiv(cs, cb)
  }
  return buildKpiCard(sql, 'closing_rate', val, cval, period, 'percent')
}

export async function closingRateNet(
  sql: postgres.Sql,
  period: Period,
  comp: Period | null,
): Promise<KpiCard> {
  // Net : ventes / calls passés (hors no-shows)
  const sales = await scalar(
    sql,
    sql`SELECT COUNT(*) AS v FROM ventes WHERE date BETWEEN ${period.start} AND ${period.end}`,
  )
  const completed = await scalar(
    sql,
    sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${period.start} AND ${period.end} AND is_past = TRUE`,
  )
  const val = safeDiv(sales, completed)
  let cval: number | null = null
  if (comp) {
    const cs = await scalar(
      sql,
      sql`SELECT COUNT(*) AS v FROM ventes WHERE date BETWEEN ${comp.start} AND ${comp.end}`,
    )
    const cc = await scalar(
      sql,
      sql`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${comp.start} AND ${comp.end} AND is_past = TRUE`,
    )
    cval = safeDiv(cs, cc)
  }
  return buildKpiCard(sql, 'closing_rate_net', val, cval, period, 'percent')
}

export async function cplPaid(
  sql: postgres.Sql,
  period: Period,
  comp: Period | null,
): Promise<KpiCard> {
  const budget = await scalar(
    sql,
    sql`SELECT COALESCE(SUM(spend),0) AS v FROM budget WHERE date BETWEEN ${period.start} AND ${period.end}`,
  )
  const leads = await scalar(
    sql,
    sql`SELECT COUNT(*) AS v FROM leads_paid WHERE date BETWEEN ${period.start} AND ${period.end}`,
  )
  const val = safeDiv(budget, leads)
  let cval: number | null = null
  if (comp) {
    const cb = await scalar(
      sql,
      sql`SELECT COALESCE(SUM(spend),0) AS v FROM budget WHERE date BETWEEN ${comp.start} AND ${comp.end}`,
    )
    const cl = await scalar(
      sql,
      sql`SELECT COUNT(*) AS v FROM leads_paid WHERE date BETWEEN ${comp.start} AND ${comp.end}`,
    )
    cval = safeDiv(cb, cl)
  }
  return buildKpiCard(sql, 'cpl_paid', val, cval, period, 'currency')
}

export async function roasPaid(
  sql: postgres.Sql,
  period: Period,
  comp: Period | null,
): Promise<KpiCard> {
  const ca = await scalar(
    sql,
    sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes_paid WHERE date BETWEEN ${period.start} AND ${period.end}`,
  )
  const spend = await scalar(
    sql,
    sql`SELECT COALESCE(SUM(spend),0) AS v FROM budget WHERE date BETWEEN ${period.start} AND ${period.end}`,
  )
  const val = safeDiv(ca, spend)
  let cval: number | null = null
  if (comp) {
    const cca = await scalar(
      sql,
      sql`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes_paid WHERE date BETWEEN ${comp.start} AND ${comp.end}`,
    )
    const csp = await scalar(
      sql,
      sql`SELECT COALESCE(SUM(spend),0) AS v FROM budget WHERE date BETWEEN ${comp.start} AND ${comp.end}`,
    )
    cval = safeDiv(cca, csp)
  }
  return buildKpiCard(sql, 'roas_paid', val, cval, period, 'number')
}
