/**
 * Port TS de `backend/app/activecampaign_client.py`.
 *
 * Fetch les campaigns + lists ActiveCampaign via l'API HTTP de l'org.
 */

interface AcRawCampaign {
  id: string
  name?: string
  sdate?: string | null
  send_amt?: string | number | null
  uniqueopens?: string | number | null
  uniquelinkclicks?: string | number | null
  unsubscribes?: string | number | null
  hardbounces?: string | number | null
  type?: string
}

export interface AcCampaign {
  id: string
  name: string
  sdate: string | null
  send_amt: number
  uniqueopens: number
  uniquelinkclicks: number
  unsubscribes: number
  hardbounces: number
  type: string
  open_rate: number
  ctr: number
  ctor: number
}

export interface AcList {
  id: string
  name: string
}

function nf(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function cutoffDate(days: number, today = new Date()): string {
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  return new Date(t.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

async function get(url: string, apiKey: string): Promise<unknown> {
  const r = await fetch(url, { headers: { 'Api-Token': apiKey } })
  if (!r.ok) throw new Error(`AC API ${r.status} on ${url}`)
  return r.json()
}

export async function fetchCampaigns(
  apiUrl: string,
  apiKey: string,
  days = 90,
): Promise<AcCampaign[]> {
  const cutoff = cutoffDate(days)
  const out: AcCampaign[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const url = `${apiUrl}/api/3/campaigns?limit=${limit}&offset=${offset}&orders%5Bsdate%5D=DESC`
    const data = (await get(url, apiKey)) as { campaigns?: AcRawCampaign[]; meta?: { total?: string | number } }
    const campaigns = data.campaigns ?? []
    if (campaigns.length === 0) break

    let pastCutoff = false
    for (const c of campaigns) {
      const sdate = (c.sdate ?? '').slice(0, 10)
      if (sdate && sdate < cutoff) {
        pastCutoff = true
        break
      }
      const sent = Math.trunc(nf(c.send_amt))
      if (sent === 0) continue
      const opens = Math.trunc(nf(c.uniqueopens))
      const clicks = Math.trunc(nf(c.uniquelinkclicks))
      out.push({
        id: c.id,
        name: c.name ?? '',
        sdate: sdate || null,
        send_amt: sent,
        uniqueopens: opens,
        uniquelinkclicks: clicks,
        unsubscribes: Math.trunc(nf(c.unsubscribes)),
        hardbounces: Math.trunc(nf(c.hardbounces)),
        type: c.type ?? 'single',
        open_rate: sent ? opens / sent : 0,
        ctr: sent ? clicks / sent : 0,
        ctor: opens ? clicks / opens : 0,
      })
    }

    if (pastCutoff) break

    offset += limit
    const total = nf(data.meta?.total)
    if (offset >= total) break
  }

  return out
}

export async function fetchLists(apiUrl: string, apiKey: string): Promise<AcList[]> {
  const data = (await get(`${apiUrl}/api/3/lists?limit=100`, apiKey)) as { lists?: Array<{ id: string; name?: string }> }
  return (data.lists ?? []).map((l) => ({ id: l.id, name: l.name ?? '' }))
}
