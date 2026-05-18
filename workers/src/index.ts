/**
 * sinvestir-dashboard backend — Cloudflare Workers + Supabase Postgres.
 *
 * Migration en cours depuis le backend Python (FastAPI + DuckDB) — voir
 * `memory/migration_path.md`.
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import postgres from 'postgres'

import { resolve, comparisonPeriod } from './lib/period'
import {
  caHt,
  volumeLeads,
  bookingRate,
  closingRate,
  closingRateNet,
  cplPaid,
  roasPaid,
} from './lib/kpis'
import {
  volumeLeadsPaid,
  volumeLeadsOrganic,
  bookingRatePaid,
  bookingRateOrganic,
  caPerLead,
  caPerCall,
  acv,
  ventesCount,
  callsBooked,
  callsCompleted,
  noShowRate,
  budgetPaid,
  caPaid,
} from './lib/kpis_extra'
import {
  funnel,
  topSources,
  chartCaSeries,
  mixAcquisition,
  chartLeadsByCanal,
  canalPerformance,
  organicSources,
  youtubeConcentration,
  closersTable,
  closingRateByCanal,
  caByProduit,
  chartClosingRateByCloser,
  roasByCanal,
  chartBudgetCaRoas,
  creativesTable,
  beneficeNetPaid,
  reconciliation,
  unattributedSales,
} from './lib/tables'
import {
  openRate,
  ctor,
  unsubscribeRate,
  unsubscribes,
  totalSends,
  nbCampaigns,
  chartOpenRate,
  campaignsTable,
} from './lib/kpis_email'
import {
  volumeCalls,
  noShowRateIc,
  closingRateNetIc,
  revenueIc,
  acvIc,
  ventesCountIc,
  closersTableIc,
  outcomesBreakdown,
  chartRevenueByDay,
} from './lib/kpis_iclosed'
import { globalStatus } from './lib/kpis_global'
import { runIngest, type IngestEnv } from './lib/ingest'

type Bindings = {
  DATABASE_URL: string
  BACKEND_API_KEY: string
  AC_API_URL?: string
  AC_API_KEY?: string
  ICLOSED_API_KEY?: string
}

const app = new Hono<{ Bindings: Bindings; Variables: { sql: postgres.Sql } }>()

app.use('*', logger())
app.use('*', cors({ origin: '*', allowHeaders: ['Content-Type', 'X-API-Key'] }))

// ─── Auth middleware : X-API-Key ────────────────────────────────────────────
app.use('*', async (c, next) => {
  const expected = c.env.BACKEND_API_KEY
  if (!expected) {
    return c.json({ error: 'server_misconfigured', message: 'BACKEND_API_KEY not set' }, 500)
  }
  const provided = c.req.header('X-API-Key') || c.req.header('x-api-key')
  if (provided !== expected) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

// ─── DB binding par requête ─────────────────────────────────────────────────
app.use('*', async (c, next) => {
  const sql = postgres(c.env.DATABASE_URL, { prepare: false, max: 1 })
  c.set('sql', sql)
  try {
    await next()
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 5 }))
  }
})

// ─── Helpers ────────────────────────────────────────────────────────────────

function parsePeriod(c: { req: { query: (k: string) => string | undefined } }) {
  const preset = c.req.query('period') || 'last_30_days'
  const customStart = c.req.query('start') || undefined
  const customEnd = c.req.query('end') || undefined
  const compare = c.req.query('compare') === 'true'
  const p = resolve(preset, { customStart, customEnd })
  const comp = compare ? comparisonPeriod(p) : null
  return { p, comp }
}

function periodMeta(p: { start: string; end: string; label: string }) {
  return { start: p.start, end: p.end, label: p.label }
}

// ─── /api/status ────────────────────────────────────────────────────────────

app.get('/api/status', async (c) => {
  const sql = c.get('sql')
  try {
    const rows = await sql<Array<{ now: Date; venues_count: number }>>`
      SELECT NOW() AS now, (SELECT COUNT(*) FROM ventes) AS venues_count
    `
    return c.json({
      ok: true,
      db_now: rows[0]?.now,
      ventes_count: Number(rows[0]?.venues_count ?? 0),
      last_refresh: null,
      last_modified_files: [],
      status: 'ok',
      drive_sync_ok: true,
      version: 'workers-0.2.0',
    })
  } catch (err: unknown) {
    return c.json(
      { ok: false, status: 'error', error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})

// ─── /api/overview ──────────────────────────────────────────────────────────

app.get('/api/overview', async (c) => {
  const sql = c.get('sql')
  const { p, comp } = parsePeriod(c)
  try {
    const [ca, vl, br, cr, cpl, roas, ch, fn, top, unattr] = await Promise.all([
      caHt(sql, p, comp),
      volumeLeads(sql, p, comp),
      bookingRate(sql, p, comp),
      closingRate(sql, p, comp),
      cplPaid(sql, p, comp),
      roasPaid(sql, p, comp),
      chartCaSeries(sql, p, comp),
      funnel(sql, p),
      topSources(sql, p),
      unattributedSales(sql, p),
    ])
    return c.json({
      period: periodMeta(p),
      comparison: comp ? { start: comp.start, end: comp.end, label: comp.label } : null,
      kpis: { ca_ht: ca, volume_leads: vl, booking_rate: br, closing_rate: cr, cpl_paid: cpl, roas_paid: roas },
      chart_ca: ch,
      funnel: fn,
      top_sources: top,
      unattributed: unattr,
    })
  } catch (err: unknown) {
    return c.json({ error: 'kpi_error', message: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/marketing ─────────────────────────────────────────────────────────

app.get('/api/marketing', async (c) => {
  const sql = c.get('sql')
  const { p, comp } = parsePeriod(c)
  try {
    const [vl, vlp, vlo, br, brp, bro, cpl, mix, cha, perf, org, yt] = await Promise.all([
      volumeLeads(sql, p, comp),
      volumeLeadsPaid(sql, p, comp),
      volumeLeadsOrganic(sql, p, comp),
      bookingRate(sql, p, comp),
      bookingRatePaid(sql, p, comp),
      bookingRateOrganic(sql, p, comp),
      caPerLead(sql, p, comp),
      mixAcquisition(sql, p),
      chartLeadsByCanal(sql, p),
      canalPerformance(sql, p),
      organicSources(sql, p),
      youtubeConcentration(sql, p),
    ])
    return c.json({
      period: periodMeta(p),
      kpis: {
        volume_leads: vl,
        volume_leads_paid: vlp,
        volume_leads_organic: vlo,
        booking_rate: br,
        booking_rate_paid: brp,
        booking_rate_organic: bro,
        ca_per_lead: cpl,
      },
      mix_acquisition: mix,
      chart_leads_by_canal: cha,
      canal_performance: perf,
      organic_sources: org,
      youtube_concentration: yt,
    })
  } catch (err: unknown) {
    return c.json({ error: 'kpi_error', message: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/sales ─────────────────────────────────────────────────────────────

app.get('/api/sales', async (c) => {
  const sql = c.get('sql')
  const { p, comp } = parsePeriod(c)
  try {
    const [ca, vc, cpcall, cr, crn, cb, cc, ns, av, closers, chartCR, prod, byCanal] = await Promise.all([
      caHt(sql, p, comp),
      ventesCount(sql, p, comp),
      caPerCall(sql, p, comp),
      closingRate(sql, p, comp),
      closingRateNet(sql, p, comp),
      callsBooked(sql, p, comp),
      callsCompleted(sql, p, comp),
      noShowRate(sql, p, comp),
      acv(sql, p, comp),
      closersTable(sql, p),
      chartClosingRateByCloser(sql, p),
      caByProduit(sql, p),
      closingRateByCanal(sql, p),
    ])
    return c.json({
      period: periodMeta(p),
      kpis: {
        ca_ht: ca,
        ventes_count: vc,
        ca_per_call: cpcall,
        closing_rate: cr,
        closing_rate_net: crn,
        calls_booked: cb,
        calls_completed: cc,
        no_show_rate: ns,
        acv: av,
      },
      closers,
      chart_closing_rate: chartCR,
      produits: prod,
      closing_by_canal: byCanal,
    })
  } catch (err: unknown) {
    return c.json({ error: 'kpi_error', message: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/ads ───────────────────────────────────────────────────────────────

app.get('/api/ads', async (c) => {
  const sql = c.get('sql')
  const { p, comp } = parsePeriod(c)
  try {
    const [bud, cap, roas, cpl, ben, chart, mvg, creatives] = await Promise.all([
      budgetPaid(sql, p, comp),
      caPaid(sql, p, comp),
      roasPaid(sql, p, comp),
      cplPaid(sql, p, comp),
      beneficeNetPaid(sql),
      chartBudgetCaRoas(sql, p),
      roasByCanal(sql, p),
      creativesTable(sql, p),
    ])
    return c.json({
      period: periodMeta(p),
      kpis: {
        budget_paid: bud,
        ca_paid: cap,
        roas_paid: roas,
        cpl_paid: cpl,
        benefice_net: ben.benefice_net,
        marge_pct: ben.marge_pct,
        benefice_mtd_label: ben.mtd_label,
        benefice_ca: ben.ca,
        benefice_spend: ben.spend,
        benefice_agence: ben.agence,
      },
      chart_budget_ca_roas: chart,
      meta_vs_google: mvg,
      creatives,
    })
  } catch (err: unknown) {
    return c.json({ error: 'kpi_error', message: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/email ─────────────────────────────────────────────────────────────

app.get('/api/email', async (c) => {
  const sql = c.get('sql')
  try {
    const [orVal, ct, unsR, unsAbs, ts, nbc, chart, table] = await Promise.all([
      openRate(sql, 30),
      ctor(sql, 30),
      unsubscribeRate(sql, 30),
      unsubscribes(sql, 30),
      totalSends(sql, 30),
      nbCampaigns(sql, 30),
      chartOpenRate(sql, 90),
      campaignsTable(sql, 90, 50),
    ])
    return c.json({
      kpis: {
        open_rate: orVal,
        ctor: ct,
        unsubscribe_rate: unsR,
        unsubscribes: unsAbs,
        total_sends: ts,
        nb_campaigns: nbc,
      },
      chart_open_rate: chart,
      campaigns: table,
    })
  } catch (err: unknown) {
    return c.json({ error: 'kpi_error', message: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/iclosed ───────────────────────────────────────────────────────────

app.get('/api/iclosed', async (c) => {
  const sql = c.get('sql')
  const { p, comp } = parsePeriod(c)
  try {
    const [vc, ns, crn, rev, av, vntcnt, closers, outcomes, chartRev] = await Promise.all([
      volumeCalls(sql, p, comp),
      noShowRateIc(sql, p, comp),
      closingRateNetIc(sql, p, comp),
      revenueIc(sql, p, comp),
      acvIc(sql, p, comp),
      ventesCountIc(sql, p, comp),
      closersTableIc(sql, p),
      outcomesBreakdown(sql, p),
      chartRevenueByDay(sql, p),
    ])
    return c.json({
      period: periodMeta(p),
      comparison: comp ? { start: comp.start, end: comp.end, label: comp.label } : null,
      kpis: {
        volume_calls: vc,
        no_show_rate: ns,
        closing_rate_net: crn,
        revenue: rev,
        acv: av,
        ventes_count: vntcnt,
      },
      closers,
      outcomes_breakdown: outcomes,
      chart_revenue: chartRev,
    })
  } catch (err: unknown) {
    return c.json({ error: 'kpi_error', message: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/reconciliation ────────────────────────────────────────────────────
// Compare Sales (Google Sheets, officiel) vs Sales Live (iClosed) sur une période.

app.get('/api/reconciliation', async (c) => {
  const sql = c.get('sql')
  const { p } = parsePeriod(c)
  try {
    const r = await reconciliation(sql, p)
    return c.json({ period: periodMeta(p), ...r })
  } catch (err: unknown) {
    return c.json({ error: 'kpi_error', message: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/global-status ─────────────────────────────────────────────────────

app.get('/api/global-status', async (c) => {
  const sql = c.get('sql')
  const { p } = parsePeriod(c)
  try {
    const gs = await globalStatus(sql, p)
    return c.json({ period: periodMeta(p), ...gs })
  } catch (err: unknown) {
    return c.json({ error: 'kpi_error', message: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/admin/targets ─────────────────────────────────────────────────────

app.get('/api/admin/targets', async (c) => {
  const sql = c.get('sql')
  try {
    const rows = await sql`
      SELECT indicateur, description, unite, sens, target_mensuelle, seuil_critique, owner, prorata
      FROM targets ORDER BY indicateur
    `
    return c.json(rows)
  } catch (err: unknown) {
    return c.json({ error: 'kpi_error', message: err instanceof Error ? err.message : String(err) }, 500)
  }
})

app.put('/api/admin/targets/:indicateur', async (c) => {
  const sql = c.get('sql')
  const indicateur = c.req.param('indicateur')
  let body: { target_mensuelle?: number; seuil_critique?: number } = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  try {
    if (body.target_mensuelle !== undefined && body.target_mensuelle !== null) {
      await sql`UPDATE targets SET target_mensuelle = ${body.target_mensuelle} WHERE indicateur = ${indicateur}`
    }
    if (body.seuil_critique !== undefined && body.seuil_critique !== null) {
      await sql`UPDATE targets SET seuil_critique = ${body.seuil_critique} WHERE indicateur = ${indicateur}`
    }
    return c.json({ ok: true })
  } catch (err: unknown) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/admin/refresh ─────────────────────────────────────────────────────
// Dans le nouveau monde, les données Excel sont vivantes dans Supabase Postgres.
// Le bouton "Refresh" déclenche maintenant l'ingestion des APIs externes
// (ActiveCampaign + iClosed) — équivalent du `_rebuild_external()` Python.

app.post('/api/admin/refresh', async (c) => {
  const sql = c.get('sql')
  const env: IngestEnv = {
    AC_API_URL: c.env.AC_API_URL,
    AC_API_KEY: c.env.AC_API_KEY,
    ICLOSED_API_KEY: c.env.ICLOSED_API_KEY,
  }
  try {
    const r = await runIngest(sql, env, 90)
    return c.json({ message: 'Refresh AC + iClosed', ...r })
  } catch (err: unknown) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/admin/ingest ──────────────────────────────────────────────────────
// Endpoint dédié pour déclencher manuellement l'ingestion (même handler que
// le Cron Trigger). Pratique pour tester sans attendre la prochaine heure pleine.

app.post('/api/admin/ingest', async (c) => {
  const sql = c.get('sql')
  const env: IngestEnv = {
    AC_API_URL: c.env.AC_API_URL,
    AC_API_KEY: c.env.AC_API_KEY,
    ICLOSED_API_KEY: c.env.ICLOSED_API_KEY,
  }
  const days = Number(c.req.query('days') || 90)
  try {
    const r = await runIngest(sql, env, days)
    return c.json(r, r.ok ? 200 : 500)
  } catch (err: unknown) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ─── /api/admin/report/* ────────────────────────────────────────────────────
// Slack/Notion automation — sera porté en Cron Trigger Workers (task #17).

app.post('/api/admin/report/weekly', (c) =>
  c.json({ ok: false, error: 'not_implemented', note: 'Cron Trigger Workers à venir' }, 501),
)
app.post('/api/admin/report/monthly', (c) =>
  c.json({ ok: false, error: 'not_implemented', note: 'Cron Trigger Workers à venir' }, 501),
)

// ─── /api/debug/unknown-sources ─────────────────────────────────────────────
// L'ancien code maintenait un set in-memory des sources non classifiées.
// Dans le nouveau monde, on calculerait ça côté ingest. Pour l'instant, []
// pour ne pas casser le frontend si la route est appelée.

app.get('/api/debug/unknown-sources', (c) => c.json({ unknown_sources: [] }))

// ─── 404 ────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404))

// ─── Scheduled handler (Cron Trigger) ───────────────────────────────────────

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1 })
    const ingestEnv: IngestEnv = {
      AC_API_URL: env.AC_API_URL,
      AC_API_KEY: env.AC_API_KEY,
      ICLOSED_API_KEY: env.ICLOSED_API_KEY,
    }
    ctx.waitUntil(
      runIngest(sql, ingestEnv, 90)
        .then((r) => console.log('[cron]', event.cron, JSON.stringify(r)))
        .catch((err) => console.error('[cron]', event.cron, 'error:', err))
        .finally(() => sql.end({ timeout: 5 })),
    )
  },
}
