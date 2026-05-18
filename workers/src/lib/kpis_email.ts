/**
 * KPIs email (ActiveCampaign) — port de backend/app/kpis_email.py.
 *
 * NOTE: la table `ac_campaigns` est vide tant que le pipeline d'ingestion
 * ActiveCampaign n'est pas en place côté Workers (Cron Trigger à venir).
 * Les fonctions retournent donc `{value: null, status: 'unknown'}` mais
 * ne plantent pas.
 */
import type postgres from 'postgres'
import type { StatusValue } from './kpi_helpers'

interface SimpleKpi {
  value: number | null
  status: StatusValue
}

function cutoffDate(days: number, today = new Date()): string {
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const cutoff = new Date(t.getTime() - days * 86_400_000)
  return cutoff.toISOString().slice(0, 10)
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function openRate(sql: postgres.Sql, days = 30): Promise<SimpleKpi> {
  const c = cutoffDate(days)
  const rows = await sql<Array<{ open_rate: number | null }>>`
    SELECT SUM(uniqueopens)::float / NULLIF(SUM(send_amt), 0) AS open_rate
    FROM ac_campaigns WHERE sdate >= ${c}
  `
  const val = asNumberOrNull(rows[0]?.open_rate)
  let status: StatusValue = 'unknown'
  if (val !== null) {
    if (val >= 0.25) status = 'green'
    else if (val >= 0.15) status = 'orange'
    else status = 'red'
  }
  return { value: val, status }
}

export async function ctor(sql: postgres.Sql, days = 30): Promise<SimpleKpi> {
  const c = cutoffDate(days)
  const rows = await sql<Array<{ ctor: number | null }>>`
    SELECT SUM(uniquelinkclicks)::float / NULLIF(SUM(uniqueopens), 0) AS ctor
    FROM ac_campaigns WHERE sdate >= ${c}
  `
  const val = asNumberOrNull(rows[0]?.ctor)
  let status: StatusValue = 'unknown'
  if (val !== null) {
    if (val >= 0.10) status = 'green'
    else if (val >= 0.05) status = 'orange'
    else status = 'red'
  }
  return { value: val, status }
}

export async function unsubscribes(sql: postgres.Sql, days = 30): Promise<SimpleKpi> {
  const c = cutoffDate(days)
  const rows = await sql<Array<{ v: number | null }>>`
    SELECT COALESCE(SUM(unsubscribes),0) AS v FROM ac_campaigns WHERE sdate >= ${c}
  `
  const val = asNumberOrNull(rows[0]?.v)
  let status: StatusValue = 'unknown'
  if (val !== null) {
    if (val < 100) status = 'green'
    else if (val < 300) status = 'orange'
    else status = 'red'
  }
  return { value: val, status }
}

export async function unsubscribeRate(sql: postgres.Sql, days = 30): Promise<SimpleKpi> {
  const c = cutoffDate(days)
  const rows = await sql<Array<{ rate: number | null }>>`
    SELECT SUM(unsubscribes)::float / NULLIF(SUM(send_amt), 0) AS rate
    FROM ac_campaigns WHERE sdate >= ${c}
  `
  const val = asNumberOrNull(rows[0]?.rate)
  let status: StatusValue = 'unknown'
  if (val !== null) {
    if (val < 0.002) status = 'green'
    else if (val < 0.005) status = 'orange'
    else status = 'red'
  }
  return { value: val, status }
}

export async function totalSends(sql: postgres.Sql, days = 30): Promise<SimpleKpi> {
  const c = cutoffDate(days)
  const rows = await sql<Array<{ v: number | null }>>`
    SELECT COALESCE(SUM(send_amt),0) AS v FROM ac_campaigns WHERE sdate >= ${c}
  `
  return { value: asNumberOrNull(rows[0]?.v), status: 'unknown' }
}

export async function nbCampaigns(sql: postgres.Sql, days = 30): Promise<SimpleKpi> {
  const c = cutoffDate(days)
  const rows = await sql<Array<{ v: number | null }>>`
    SELECT COUNT(*) AS v FROM ac_campaigns WHERE sdate >= ${c}
  `
  return { value: asNumberOrNull(rows[0]?.v), status: 'unknown' }
}

export async function chartOpenRate(
  sql: postgres.Sql,
  days = 90,
): Promise<Array<{ date: string; name: string; open_rate: number; ctr: number }>> {
  const c = cutoffDate(days)
  const rows = await sql<Array<{ sdate: Date | string | null; name: string | null; open_rate: number | null; ctr: number | null }>>`
    SELECT sdate, name, open_rate, ctr FROM ac_campaigns WHERE sdate >= ${c} ORDER BY sdate
  `
  return rows
    .filter((r) => r.sdate !== null)
    .map((r) => ({
      date: (typeof r.sdate === 'string' ? r.sdate : (r.sdate as Date).toISOString()).slice(0, 10),
      name: r.name ?? '',
      open_rate: asNumberOrNull(r.open_rate) ?? 0,
      ctr: asNumberOrNull(r.ctr) ?? 0,
    }))
}

export async function campaignsTable(
  sql: postgres.Sql,
  days = 90,
  limit = 50,
): Promise<Array<{ name: string; sdate: string; send_amt: number; uniqueopens: number; uniquelinkclicks: number; unsubscribes: number; open_rate_pct: number; ctr_pct: number; ctor_pct: number }>> {
  const c = cutoffDate(days)
  const rows = await sql<Array<{ name: string | null; sdate: Date | string | null; send_amt: number | null; uniqueopens: number | null; uniquelinkclicks: number | null; unsubscribes: number | null }>>`
    SELECT name, sdate, send_amt, uniqueopens, uniquelinkclicks, unsubscribes
    FROM ac_campaigns WHERE sdate >= ${c}
    ORDER BY sdate DESC LIMIT ${limit}
  `
  return rows.map((r) => {
    const send = asNumberOrNull(r.send_amt) ?? 0
    const opens = asNumberOrNull(r.uniqueopens) ?? 0
    const clicks = asNumberOrNull(r.uniquelinkclicks) ?? 0
    const unsubs = asNumberOrNull(r.unsubscribes) ?? 0
    return {
      name: r.name ?? '',
      sdate: r.sdate ? (typeof r.sdate === 'string' ? r.sdate : r.sdate.toISOString()).slice(0, 10) : '',
      send_amt: send,
      uniqueopens: opens,
      uniquelinkclicks: clicks,
      unsubscribes: unsubs,
      open_rate_pct: send ? Math.round((opens / send) * 1000) / 10 : 0,
      ctr_pct: send ? Math.round((clicks / send) * 1000) / 10 : 0,
      ctor_pct: opens ? Math.round((clicks / opens) * 1000) / 10 : 0,
    }
  })
}
