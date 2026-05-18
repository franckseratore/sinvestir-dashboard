/**
 * Orchestrator d'ingestion — appelé par Cron Trigger ou endpoint admin.
 *
 * Fetch ActiveCampaign + iClosed et UPSERT dans Supabase.
 */
import type postgres from 'postgres'
import { fetchCampaigns, fetchLists, type AcCampaign, type AcList } from './ingest_ac'
import { fetchEventCalls, fetchDeals, type IcCall, type IcDeal } from './ingest_ic'

export interface IngestResult {
  ok: boolean
  ac_campaigns: number
  ac_lists: number
  ic_calls: number
  ic_deals: number
  errors: string[]
  duration_ms: number
}

export interface IngestEnv {
  AC_API_URL?: string
  AC_API_KEY?: string
  ICLOSED_API_KEY?: string
}

async function upsertAcCampaigns(sql: postgres.Sql, rows: AcCampaign[]): Promise<number> {
  if (rows.length === 0) return 0
  await sql`
    INSERT INTO ac_campaigns ${sql(rows, 'id', 'name', 'sdate', 'send_amt', 'uniqueopens', 'uniquelinkclicks', 'unsubscribes', 'hardbounces', 'type', 'open_rate', 'ctr', 'ctor')}
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      sdate = EXCLUDED.sdate,
      send_amt = EXCLUDED.send_amt,
      uniqueopens = EXCLUDED.uniqueopens,
      uniquelinkclicks = EXCLUDED.uniquelinkclicks,
      unsubscribes = EXCLUDED.unsubscribes,
      hardbounces = EXCLUDED.hardbounces,
      type = EXCLUDED.type,
      open_rate = EXCLUDED.open_rate,
      ctr = EXCLUDED.ctr,
      ctor = EXCLUDED.ctor
  `
  return rows.length
}

async function upsertAcLists(sql: postgres.Sql, rows: AcList[]): Promise<number> {
  if (rows.length === 0) return 0
  await sql`
    INSERT INTO ac_lists ${sql(rows, 'id', 'name')}
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
  `
  return rows.length
}

async function upsertIcCalls(sql: postgres.Sql, rows: IcCall[]): Promise<number> {
  if (rows.length === 0) return 0
  await sql`
    INSERT INTO ic_calls ${sql(rows, 'id', 'date', 'user_id', 'closer', 'closer_email', 'contact_name', 'contact_email', 'outcome', 'no_sale_reason', 'objection', 'has_deal', 'deal_value', 'call_type', 'duration')}
    ON CONFLICT (id) DO UPDATE SET
      date = EXCLUDED.date,
      user_id = EXCLUDED.user_id,
      closer = EXCLUDED.closer,
      closer_email = EXCLUDED.closer_email,
      contact_name = EXCLUDED.contact_name,
      contact_email = EXCLUDED.contact_email,
      outcome = EXCLUDED.outcome,
      no_sale_reason = EXCLUDED.no_sale_reason,
      objection = EXCLUDED.objection,
      has_deal = EXCLUDED.has_deal,
      deal_value = EXCLUDED.deal_value,
      call_type = EXCLUDED.call_type,
      duration = EXCLUDED.duration
  `
  return rows.length
}

async function upsertIcDeals(sql: postgres.Sql, rows: IcDeal[]): Promise<number> {
  if (rows.length === 0) return 0
  await sql`
    INSERT INTO ic_deals ${sql(rows, 'id', 'date', 'user_id', 'closer', 'closer_email', 'value', 'transaction_type', 'product_id', 'event_name')}
    ON CONFLICT (id) DO UPDATE SET
      date = EXCLUDED.date,
      user_id = EXCLUDED.user_id,
      closer = EXCLUDED.closer,
      closer_email = EXCLUDED.closer_email,
      value = EXCLUDED.value,
      transaction_type = EXCLUDED.transaction_type,
      product_id = EXCLUDED.product_id,
      event_name = EXCLUDED.event_name
  `
  return rows.length
}

export async function runIngest(
  sql: postgres.Sql,
  env: IngestEnv,
  days = 90,
): Promise<IngestResult> {
  const t0 = Date.now()
  const errors: string[] = []
  let acCount = 0
  let acListsCount = 0
  let icCallsCount = 0
  let icDealsCount = 0

  if (env.AC_API_URL && env.AC_API_KEY) {
    try {
      const campaigns = await fetchCampaigns(env.AC_API_URL, env.AC_API_KEY, days)
      acCount = await upsertAcCampaigns(sql, campaigns)
      const lists = await fetchLists(env.AC_API_URL, env.AC_API_KEY)
      acListsCount = await upsertAcLists(sql, lists)
    } catch (e) {
      errors.push(`AC: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    errors.push('AC: missing AC_API_URL or AC_API_KEY')
  }

  if (env.ICLOSED_API_KEY) {
    try {
      const calls = await fetchEventCalls(env.ICLOSED_API_KEY, days)
      icCallsCount = await upsertIcCalls(sql, calls)
      const deals = await fetchDeals(env.ICLOSED_API_KEY, days)
      icDealsCount = await upsertIcDeals(sql, deals)
    } catch (e) {
      errors.push(`iClosed: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    errors.push('iClosed: missing ICLOSED_API_KEY')
  }

  return {
    ok: errors.length === 0,
    ac_campaigns: acCount,
    ac_lists: acListsCount,
    ic_calls: icCallsCount,
    ic_deals: icDealsCount,
    errors,
    duration_ms: Date.now() - t0,
  }
}
