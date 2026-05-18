/**
 * Fonctions retournant des tables / charts / séries (pas des KpiCard) :
 * funnel, top_sources, mix_acquisition, canal_performance, organic_sources,
 * youtube_concentration, ca_by_produit, closing_rate_by_closer, closing_rate_by_canal,
 * roas_by_canal, creatives_table, chart_*
 *
 * Cohérent avec backend/app/kpis.py.
 */
import type postgres from 'postgres'
import type { Period } from './period'
import { safeDiv } from './kpi_helpers'

function nf(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(v: number | null): number | null {
  if (v === null) return null
  return Math.round(v * 100) / 100
}

function dateTrunc(col: 'date' | 'date_reservation', g: Period['granularity']): string {
  if (g === 'weekly') return `date_trunc('week', ${col})::date`
  if (g === 'monthly') return `date_trunc('month', ${col})::date`
  return `${col}::date`
}

// ─── Overview ───────────────────────────────────────────────────────────────

export async function funnel(sql: postgres.Sql, p: Period): Promise<Array<{ label: string; value: number; pct: number | null }>> {
  const leads = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${p.start} AND ${p.end}`)[0]?.v)
  const booked = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${p.start} AND ${p.end}`)[0]?.v)
  const completed = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM calls WHERE date_reservation BETWEEN ${p.start} AND ${p.end} AND is_past = TRUE`)[0]?.v)
  const sales = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end}`)[0]?.v)
  const steps: Array<[string, number]> = [
    ['Leads', leads], ['Calls réservés', booked], ['Calls passés', completed], ['Ventes', sales],
  ]
  return steps.map(([label, value], i) => {
    const prev = i > 0 ? steps[i - 1][1] : null
    const pct = prev && prev > 0 ? Math.round((value / prev) * 1000) / 10 : null
    return { label, value: Math.trunc(value), pct }
  })
}

export async function topSources(sql: postgres.Sql, p: Period, limit = 5): Promise<Array<{ source: string; canal: string; ventes: number; ca: number }>> {
  const rows = await sql<Array<{ source: string; canal: string; ventes: string | number; ca: string | number }>>`
    SELECT source_initiale AS source, canal, COUNT(*) AS ventes, COALESCE(SUM(ca_ht),0) AS ca
    FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end}
    GROUP BY source_initiale, canal ORDER BY ca DESC LIMIT ${limit}
  `
  return rows.map((r) => ({
    source: r.source,
    canal: r.canal,
    ventes: Math.trunc(nf(r.ventes)),
    ca: Math.round(nf(r.ca) * 100) / 100,
  }))
}

export async function chartCaSeries(
  sql: postgres.Sql,
  p: Period,
  comp: Period | null,
): Promise<Array<{ date: string; value: number; comparison_value?: number }>> {
  const grp = dateTrunc('date', p.granularity)
  const rows = await sql<Array<{ d: Date | string; ca: string | number }>>`
    SELECT ${sql.unsafe(grp)} AS d, COALESCE(SUM(ca_ht),0) AS ca
    FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end}
    GROUP BY ${sql.unsafe(grp)} ORDER BY ${sql.unsafe(grp)}
  `
  const result = rows.map((r) => ({
    date: (typeof r.d === 'string' ? r.d : r.d.toISOString()).slice(0, 10),
    value: Math.round(nf(r.ca) * 100) / 100,
  })) as Array<{ date: string; value: number; comparison_value?: number }>

  if (comp) {
    const grpC = dateTrunc('date', comp.granularity)
    const rowsC = await sql<Array<{ d: Date | string; ca: string | number }>>`
      SELECT ${sql.unsafe(grpC)} AS d, COALESCE(SUM(ca_ht),0) AS ca
      FROM ventes WHERE date BETWEEN ${comp.start} AND ${comp.end}
      GROUP BY ${sql.unsafe(grpC)} ORDER BY ${sql.unsafe(grpC)}
    `
    const compList = rowsC.map((r) => Math.round(nf(r.ca) * 100) / 100)
    result.forEach((item, i) => {
      if (i < compList.length) item.comparison_value = compList[i]
    })
  }
  return result
}

// ─── Marketing ──────────────────────────────────────────────────────────────

export async function mixAcquisition(
  sql: postgres.Sql,
  p: Period,
): Promise<Record<string, { count: number; pct: number } | number>> {
  const rows = await sql<Array<{ canal: string; n: string | number }>>`
    SELECT canal, COUNT(*) AS n FROM leads WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY canal
  `
  const total = rows.reduce((acc, r) => acc + nf(r.n), 0)
  const result: Record<string, { count: number; pct: number } | number> = { total }
  for (const r of rows) {
    const count = Math.trunc(nf(r.n))
    const pct = total ? Math.round((count / total) * 1000) / 10 : 0
    result[r.canal] = { count, pct }
  }
  return result
}

export async function chartLeadsByCanal(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ date: string; canal: string; value: number }>> {
  const grp = dateTrunc('date', p.granularity)
  const rows = await sql<Array<{ d: Date | string; canal: string; n: string | number }>>`
    SELECT ${sql.unsafe(grp)} AS d, canal, COUNT(*) AS n FROM leads
    WHERE date BETWEEN ${p.start} AND ${p.end}
    GROUP BY ${sql.unsafe(grp)}, canal ORDER BY ${sql.unsafe(grp)}
  `
  return rows.map((r) => ({
    date: (typeof r.d === 'string' ? r.d : r.d.toISOString()).slice(0, 10),
    canal: r.canal,
    value: Math.trunc(nf(r.n)),
  }))
}

export async function canalPerformance(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ canal: string; sous_canal: string; leads: number; cpl: number | null; calls: number; booking_rate: number | null; ventes: number; ca: number; roas: number | null }>> {
  type Row = { canal: string; sous_canal: string; leads: string | number; calls: string | number; ventes: string | number; ca: string | number; budget: string | number }
  const rows = await sql<Row[]>`
    WITH l AS (SELECT canal, sous_canal, COUNT(*) AS leads FROM leads WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY canal, sous_canal),
         c AS (SELECT canal, sous_canal, COUNT(*) AS calls FROM calls WHERE date_reservation BETWEEN ${p.start} AND ${p.end} GROUP BY canal, sous_canal),
         v AS (SELECT canal, sous_canal, COUNT(*) AS ventes, COALESCE(SUM(ca_ht),0) AS ca FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY canal, sous_canal),
         b AS (SELECT canal, sous_canal, COALESCE(SUM(spend),0) AS budget FROM budget WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY canal, sous_canal),
         keys AS (
           SELECT canal, sous_canal FROM l
           UNION SELECT canal, sous_canal FROM c
           UNION SELECT canal, sous_canal FROM v
           UNION SELECT canal, sous_canal FROM b
         )
    SELECT k.canal, k.sous_canal,
           COALESCE(l.leads,0)  AS leads,
           COALESCE(c.calls,0)  AS calls,
           COALESCE(v.ventes,0) AS ventes,
           COALESCE(v.ca,0)     AS ca,
           COALESCE(b.budget,0) AS budget
    FROM keys k
    LEFT JOIN l USING (canal, sous_canal)
    LEFT JOIN c USING (canal, sous_canal)
    LEFT JOIN v USING (canal, sous_canal)
    LEFT JOIN b USING (canal, sous_canal)
  `
  const out = rows.map((r) => {
    const leads = Math.trunc(nf(r.leads))
    const calls = Math.trunc(nf(r.calls))
    const ventes = Math.trunc(nf(r.ventes))
    const ca = nf(r.ca)
    const budget = nf(r.budget)
    return {
      canal: r.canal ?? 'Inconnu',
      sous_canal: r.sous_canal ?? 'Inconnu',
      leads,
      cpl: leads && budget ? Math.round((budget / leads) * 100) / 100 : null,
      calls,
      booking_rate: leads ? Math.round((calls / leads) * 1000) / 10 : null,
      ventes,
      ca: Math.round(ca * 100) / 100,
      roas: budget ? Math.round((ca / budget) * 100) / 100 : null,
    }
  })
  return out.sort((a, b) => b.ca - a.ca)
}

export async function organicSources(
  sql: postgres.Sql,
  p: Period,
  limit = 20,
): Promise<Array<{ source: string; sous_canal: string; leads: number; ca: number }>> {
  const rows = await sql<Array<{ source: string; sous_canal: string; leads: string | number; ca: string | number }>>`
    WITH l AS (
      SELECT source, sous_canal, COUNT(*) AS leads
      FROM leads WHERE date BETWEEN ${p.start} AND ${p.end} AND canal = 'Organique'
      GROUP BY source, sous_canal ORDER BY leads DESC LIMIT ${limit}
    ),
    v AS (
      SELECT source_initiale AS source, COALESCE(SUM(ca_ht),0) AS ca
      FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end} AND canal = 'Organique'
      GROUP BY source_initiale
    )
    SELECT l.source, l.sous_canal, l.leads, COALESCE(v.ca,0) AS ca
    FROM l LEFT JOIN v ON l.source = v.source
  `
  return rows.map((r) => ({
    source: r.source ?? '',
    sous_canal: r.sous_canal ?? '',
    leads: Math.trunc(nf(r.leads)),
    ca: Math.round(nf(r.ca) * 100) / 100,
  }))
}

export async function youtubeConcentration(
  sql: postgres.Sql,
  p: Period,
): Promise<{ youtube_leads: number; organic_total: number; concentration: number | null; alert: boolean }> {
  const totalOrganic = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${p.start} AND ${p.end} AND canal = 'Organique'`)[0]?.v)
  const ytb = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM leads WHERE date BETWEEN ${p.start} AND ${p.end} AND sous_canal = 'YouTube'`)[0]?.v)
  const pct = safeDiv(ytb, totalOrganic)
  return {
    youtube_leads: Math.trunc(ytb),
    organic_total: Math.trunc(totalOrganic),
    concentration: pct !== null ? Math.round(pct * 1000) / 10 : null,
    alert: pct !== null && pct > 0.7,
  }
}

// ─── Sales ──────────────────────────────────────────────────────────────────

export async function closersTable(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ closer: string; calls: number; ventes: number; closing_rate: number | null; ca: number; acv: number | null }>> {
  const rows = await sql<Array<{ closer: string | null; calls: string | number; ventes: string | number; ca: string | number }>>`
    WITH s AS (
      SELECT closer, COUNT(*) AS ventes, COALESCE(SUM(ca_ht),0) AS ca FROM ventes
      WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY closer
    ),
    c AS (
      SELECT closer, COUNT(*) AS calls FROM calls
      WHERE date_reservation BETWEEN ${p.start} AND ${p.end} AND is_past = TRUE GROUP BY closer
    ),
    keys AS (SELECT closer FROM s UNION SELECT closer FROM c)
    SELECT k.closer, COALESCE(c.calls,0) AS calls, COALESCE(s.ventes,0) AS ventes, COALESCE(s.ca,0) AS ca
    FROM keys k LEFT JOIN s USING (closer) LEFT JOIN c USING (closer)
  `
  const out = rows.map((r) => {
    const sales = Math.trunc(nf(r.ventes))
    const calls = Math.trunc(nf(r.calls))
    const ca = nf(r.ca)
    return {
      closer: r.closer ?? '',
      calls,
      ventes: sales,
      closing_rate: calls ? Math.round((sales / calls) * 1000) / 10 : null,
      ca: Math.round(ca * 100) / 100,
      acv: sales ? Math.round((ca / sales) * 100) / 100 : null,
    }
  })
  return out.sort((a, b) => b.ca - a.ca)
}

export async function closingRateByCanal(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ canal: string; calls: number; ventes: number; closing_rate: number | null; ca: number }>> {
  const rows = await sql<Array<{ canal: string | null; calls: string | number; ventes: string | number; ca: string | number }>>`
    WITH s AS (
      SELECT canal, COUNT(*) AS ventes, COALESCE(SUM(ca_ht),0) AS ca FROM ventes
      WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY canal
    ),
    c AS (
      SELECT canal, COUNT(*) AS calls FROM calls
      WHERE date_reservation BETWEEN ${p.start} AND ${p.end} AND is_past = TRUE GROUP BY canal
    ),
    keys AS (SELECT canal FROM s UNION SELECT canal FROM c)
    SELECT k.canal, COALESCE(c.calls,0) AS calls, COALESCE(s.ventes,0) AS ventes, COALESCE(s.ca,0) AS ca
    FROM keys k LEFT JOIN s USING (canal) LEFT JOIN c USING (canal)
  `
  return rows
    .map((r) => {
      const sales = Math.trunc(nf(r.ventes))
      const calls = Math.trunc(nf(r.calls))
      return {
        canal: r.canal ?? 'Inconnu',
        calls,
        ventes: sales,
        closing_rate: calls ? Math.round((sales / calls) * 1000) / 10 : null,
        ca: Math.round(nf(r.ca) * 100) / 100,
      }
    })
    .sort((a, b) => b.ca - a.ca)
}

export async function caByProduit(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ produit: string; ventes: number; ca: number; acv: number | null }>> {
  const rows = await sql<Array<{ produit_nom: string | null; ventes: string | number; ca: string | number }>>`
    SELECT produit_nom, COUNT(*) AS ventes, COALESCE(SUM(ca_ht),0) AS ca
    FROM ventes WHERE date BETWEEN ${p.start} AND ${p.end}
    GROUP BY produit_nom ORDER BY ca DESC
  `
  return rows.map((r) => {
    const ventes = Math.trunc(nf(r.ventes))
    const ca = nf(r.ca)
    return {
      produit: r.produit_nom ?? 'Inconnu',
      ventes,
      ca: Math.round(ca * 100) / 100,
      acv: ventes ? Math.round((ca / ventes) * 100) / 100 : null,
    }
  })
}

export async function chartClosingRateByCloser(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ date: string; closer: string; closing_rate: number | null }>> {
  const grpV = dateTrunc('date', p.granularity)
  const grpR = dateTrunc('date_reservation', p.granularity)
  const rows = await sql<Array<{ date: Date | string; closer: string | null; ventes: string | number; calls: string | number }>>`
    WITH v AS (
      SELECT ${sql.unsafe(grpV)} AS date, closer, COUNT(*) AS ventes FROM ventes
      WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY ${sql.unsafe(grpV)}, closer
    ),
    c AS (
      SELECT ${sql.unsafe(grpR)} AS date, closer, COUNT(*) AS calls FROM calls
      WHERE date_reservation BETWEEN ${p.start} AND ${p.end} AND is_past = TRUE
      GROUP BY ${sql.unsafe(grpR)}, closer
    ),
    keys AS (
      SELECT date, closer FROM v UNION SELECT date, closer FROM c
    )
    SELECT k.date, k.closer, COALESCE(v.ventes,0) AS ventes, COALESCE(c.calls,0) AS calls
    FROM keys k LEFT JOIN v USING (date, closer) LEFT JOIN c USING (date, closer)
    ORDER BY k.date
  `
  return rows.map((r) => {
    const calls = Math.trunc(nf(r.calls))
    const ventes = Math.trunc(nf(r.ventes))
    return {
      date: (typeof r.date === 'string' ? r.date : r.date.toISOString()).slice(0, 10),
      closer: r.closer ?? '',
      closing_rate: calls ? Math.round((ventes / calls) * 1000) / 10 : null,
    }
  })
}

// ─── Ads ────────────────────────────────────────────────────────────────────

export async function roasByCanal(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ canal: string; budget: number; ca: number; leads: number; roas: number | null; cpl: number | null }>> {
  const out: Array<{ canal: string; budget: number; ca: number; leads: number; roas: number | null; cpl: number | null }> = []
  for (const canal of ['Google', 'Meta']) {
    const b = nf((await sql<Array<{ v: string | number }>>`SELECT COALESCE(SUM(spend),0) AS v FROM budget WHERE date BETWEEN ${p.start} AND ${p.end} AND sous_canal = ${canal}`)[0]?.v)
    const r = nf((await sql<Array<{ v: string | number }>>`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes_paid WHERE date BETWEEN ${p.start} AND ${p.end} AND sous_canal = ${canal}`)[0]?.v)
    const l = nf((await sql<Array<{ v: string | number }>>`SELECT COUNT(*) AS v FROM leads_paid WHERE date BETWEEN ${p.start} AND ${p.end} AND sous_canal = ${canal}`)[0]?.v)
    out.push({
      canal: `Paid/${canal}`,
      budget: round2(b) ?? 0,
      ca: round2(r) ?? 0,
      leads: Math.trunc(l),
      roas: b ? Math.round((r / b) * 100) / 100 : null,
      cpl: l ? Math.round((b / l) * 100) / 100 : null,
    })
  }
  return out
}

export async function chartBudgetCaRoas(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ date: string; budget: number; ca: number; roas: number | null }>> {
  const grp = dateTrunc('date', p.granularity)
  const rows = await sql<Array<{ date: Date | string; spend: string | number; ca: string | number }>>`
    WITH b AS (
      SELECT ${sql.unsafe(grp)} AS date, COALESCE(SUM(spend),0) AS spend FROM budget
      WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY ${sql.unsafe(grp)}
    ),
    v AS (
      SELECT ${sql.unsafe(grp)} AS date, COALESCE(SUM(ca_ht),0) AS ca FROM ventes_paid
      WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY ${sql.unsafe(grp)}
    ),
    keys AS (SELECT date FROM b UNION SELECT date FROM v)
    SELECT k.date, COALESCE(b.spend,0) AS spend, COALESCE(v.ca,0) AS ca
    FROM keys k LEFT JOIN b USING (date) LEFT JOIN v USING (date)
    ORDER BY k.date
  `
  return rows.map((r) => {
    const spend = nf(r.spend)
    const ca = nf(r.ca)
    return {
      date: (typeof r.date === 'string' ? r.date : r.date.toISOString()).slice(0, 10),
      budget: Math.round(spend * 100) / 100,
      ca: Math.round(ca * 100) / 100,
      roas: spend ? Math.round((ca / spend) * 100) / 100 : null,
    }
  })
}

export async function creativesTable(
  sql: postgres.Sql,
  p: Period,
): Promise<Array<{ creative_id: string; canal: string; spend: number; leads: number; cpl: number | null; calls: number; ventes: number; ca: number; roas: number | null; marge_pct: number | null; alert: boolean }>> {
  const rows = await sql<Array<{ creative_id: string | null; sous_canal: string | null; spend: string | number; leads: string | number; calls: string | number; ventes: string | number; ca: string | number }>>`
    WITH b AS (
      SELECT creative_id, sous_canal, COALESCE(SUM(spend),0) AS spend FROM budget
      WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY creative_id, sous_canal
    ),
    l AS (
      SELECT source AS creative_id, COUNT(*) AS leads FROM leads_paid
      WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY source
    ),
    c AS (
      SELECT source AS creative_id, COUNT(*) AS calls FROM calls_paid
      WHERE date_reservation BETWEEN ${p.start} AND ${p.end} GROUP BY source
    ),
    v AS (
      SELECT source_initiale AS creative_id, COUNT(*) AS ventes, COALESCE(SUM(ca_ht),0) AS ca FROM ventes_paid
      WHERE date BETWEEN ${p.start} AND ${p.end} GROUP BY source_initiale
    )
    SELECT b.creative_id, b.sous_canal, b.spend,
           COALESCE(l.leads,0)  AS leads,
           COALESCE(c.calls,0)  AS calls,
           COALESCE(v.ventes,0) AS ventes,
           COALESCE(v.ca,0)     AS ca
    FROM b
    LEFT JOIN l ON b.creative_id = l.creative_id
    LEFT JOIN c ON b.creative_id = c.creative_id
    LEFT JOIN v ON b.creative_id = v.creative_id
  `
  const cplTargetRow = await sql<Array<{ seuil_critique: number | null }>>`SELECT seuil_critique FROM targets WHERE indicateur = 'cpl_paid'`
  const cplTarget = nf(cplTargetRow[0]?.seuil_critique) || 30

  const AGENCE: Record<string, number> = { Google: 0.10, Meta: 0.08 }
  const out = rows.map((r) => {
    const spend = nf(r.spend)
    const leads = Math.trunc(nf(r.leads))
    const calls = Math.trunc(nf(r.calls))
    const ventes = Math.trunc(nf(r.ventes))
    const ca = nf(r.ca)
    const cpl = leads ? spend / leads : null
    const roas = spend ? ca / spend : null
    const canalName = r.sous_canal ?? ''
    const agenceRate = AGENCE[canalName] ?? 0.1
    const agenceCost = spend * agenceRate
    const benefice = ca > 0 ? ca - spend - agenceCost : -spend - agenceCost
    const marge = ca > 0 ? safeDiv(benefice, ca) : null
    return {
      creative_id: r.creative_id ?? '',
      canal: canalName,
      spend: Math.round(spend * 100) / 100,
      leads,
      cpl: cpl !== null ? Math.round(cpl * 100) / 100 : null,
      calls,
      ventes,
      ca: Math.round(ca * 100) / 100,
      roas: roas !== null ? Math.round(roas * 100) / 100 : null,
      marge_pct: marge !== null ? Math.round(marge * 1000) / 10 : null,
      alert: cpl !== null && cpl > cplTarget,
    }
  })
  return out.sort((a, b) => b.spend - a.spend)
}

// ─── Bénéfice net Paid (logique métier non triviale) ────────────────────────

export interface BeneficeNet {
  benefice_net: number
  marge_pct: number | null
  mtd_label: string
  ca: number
  spend: number
  agence: number
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

function formatDmy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

function formatDmyYear(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()}`
}

export async function beneficeNetForPeriod(
  sql: postgres.Sql,
  start: string,
  end: string,
): Promise<BeneficeNet> {
  const startD = new Date(`${start}T00:00:00Z`)
  const endD = new Date(`${end}T00:00:00Z`)
  const daysElapsed = Math.round((endD.getTime() - startD.getTime()) / 86_400_000) + 1
  const dim = daysInMonth(startD.getUTCFullYear(), startD.getUTCMonth() + 1)

  const ca = nf((await sql<Array<{ v: string | number }>>`SELECT COALESCE(SUM(ca_ht),0) AS v FROM ventes_paid WHERE date BETWEEN ${start} AND ${end}`)[0]?.v)
  const googleSpend = nf((await sql<Array<{ v: string | number }>>`SELECT COALESCE(SUM(spend),0) AS v FROM budget WHERE date BETWEEN ${start} AND ${end} AND sous_canal = 'Google'`)[0]?.v)
  const metaSpend = nf((await sql<Array<{ v: string | number }>>`SELECT COALESCE(SUM(spend),0) AS v FROM budget WHERE date BETWEEN ${start} AND ${end} AND sous_canal = 'Meta'`)[0]?.v)

  const agenceGoogle = googleSpend * 0.10
  const agenceMeta = Math.max(metaSpend * 0.08, 1500 * (daysElapsed / dim))
  const totalSpend = googleSpend + metaSpend
  const totalAgence = agenceGoogle + agenceMeta
  const beneficeNet = ca - totalSpend - totalAgence
  const marge = safeDiv(beneficeNet, ca)

  return {
    benefice_net: Math.round(beneficeNet * 100) / 100,
    marge_pct: marge !== null ? Math.round(marge * 1000) / 10 : null,
    mtd_label: `${formatDmy(startD)} → ${formatDmyYear(endD)}`,
    ca: Math.round(ca * 100) / 100,
    spend: Math.round(totalSpend * 100) / 100,
    agence: Math.round(totalAgence * 100) / 100,
  }
}

export async function beneficeNetPaid(sql: postgres.Sql, today = new Date()): Promise<BeneficeNet> {
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))
  return beneficeNetForPeriod(sql, first.toISOString().slice(0, 10), t.toISOString().slice(0, 10))
}
