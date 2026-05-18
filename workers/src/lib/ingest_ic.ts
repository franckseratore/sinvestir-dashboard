/**
 * Port TS de `backend/app/iclosed_client.py`.
 *
 * Fetch les eventCalls + deals iClosed via l'API publique.
 */

const BASE_URL = 'https://public.api.iclosed.io'

interface IcUser {
  id?: string
  firstName?: string
  lastName?: string
  email?: string
}

interface IcCallRaw {
  id: string
  dateTimeUTC?: string | null
  dateTime?: string | null
  task?: Array<{ outcome?: string | null; noSaleReason?: string | null; objection?: string | null }>
  deals?: Array<{ value?: string | number | null }>
  user?: IcUser
  inviteeName?: string | null
  inviteeEmail?: string | null
  callType?: string
  duration?: number
}

export interface IcCall {
  id: string
  date: string
  user_id: string | null
  closer: string
  closer_email: string
  contact_name: string
  contact_email: string
  outcome: string | null
  no_sale_reason: string | null
  objection: string | null
  has_deal: boolean
  deal_value: number
  call_type: string
  duration: number
}

interface IcDealRaw {
  id: string
  time?: string | null
  user?: IcUser
  value?: string | number | null
  transactionType?: string
  productId?: string | null
  event?: { name?: string } | null
}

export interface IcDeal {
  id: string
  date: string | null
  user_id: string | null
  closer: string
  closer_email: string
  value: number
  transaction_type: string
  product_id: string | null
  event_name: string
}

function cutoffDate(days: number, today = new Date()): string {
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  return new Date(t.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

async function get(path: string, apiKey: string, params: Record<string, string | number>): Promise<unknown> {
  const url = `${BASE_URL}${path}?${new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  ).toString()}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!r.ok) throw new Error(`iClosed API ${r.status} on ${url}`)
  return r.json()
}

function parseCall(c: IcCallRaw): IcCall | null {
  const dt = c.dateTimeUTC ?? c.dateTime ?? ''
  const callDate = dt.slice(0, 10)
  if (!callDate) return null
  const task = c.task && c.task.length > 0 ? c.task[0] : {}
  const deals = c.deals ?? []
  const user = c.user ?? {}
  const dealValue = deals.reduce((acc, d) => acc + (Number(d.value) || 0), 0)
  return {
    id: c.id,
    date: callDate,
    user_id: user.id ?? null,
    closer: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
    closer_email: user.email ?? '',
    contact_name: c.inviteeName ?? '',
    contact_email: c.inviteeEmail ?? '',
    outcome: task.outcome ?? null,
    no_sale_reason: task.noSaleReason ?? null,
    objection: task.objection ?? null,
    has_deal: deals.length > 0,
    deal_value: dealValue,
    call_type: c.callType ?? '',
    duration: c.duration ?? 0,
  }
}

export async function fetchEventCalls(apiKey: string, days = 90): Promise<IcCall[]> {
  const cutoff = cutoffDate(days)
  const seen = new Set<string>()
  const rows: IcCall[] = []

  function addCall(c: IcCallRaw): boolean {
    if (seen.has(c.id)) return false
    const parsed = parseCall(c)
    if (parsed === null) return false
    if (parsed.date < cutoff) return true
    seen.add(c.id)
    rows.push(parsed)
    return false
  }

  // Step 1 — most recent
  const recent = (await get('/v1/eventCalls', apiKey, { eventType: 'PAST', limit: 100 })) as {
    data?: { eventCalls?: IcCallRaw[] }
  }
  for (const c of recent.data?.eventCalls ?? []) addCall(c)

  // Step 2 — page-based pagination
  let page = 1
  while (true) {
    const data = (await get('/v1/eventCalls', apiKey, { eventType: 'PAST', limit: 100, page })) as {
      data?: { eventCalls?: IcCallRaw[] }
    }
    const calls = data.data?.eventCalls ?? []
    if (calls.length === 0) break
    let pastCutoff = false
    for (const c of calls) {
      if (addCall(c)) {
        pastCutoff = true
        break
      }
    }
    if (pastCutoff) break
    page += 1
  }

  return rows
}

export async function fetchDeals(apiKey: string, days = 90): Promise<IcDeal[]> {
  const cutoff = cutoffDate(days)
  const seen = new Set<string>()
  const rows: IcDeal[] = []

  function addDeal(d: IcDealRaw): void {
    if (seen.has(d.id)) return
    seen.add(d.id)
    const dealDate = (d.time ?? '').slice(0, 10) || null
    const user = d.user ?? {}
    rows.push({
      id: d.id,
      date: dealDate,
      user_id: user.id ?? null,
      closer: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
      closer_email: user.email ?? '',
      value: Number(d.value) || 0,
      transaction_type: d.transactionType ?? '',
      product_id: d.productId ?? null,
      event_name: d.event?.name ?? '',
    })
  }

  for (const txType of ['WON', 'RECURRING', 'DEPOSIT']) {
    const def = (await get('/v1/deals', apiKey, { transactionType: txType, limit: 100 })) as {
      data?: { deals?: IcDealRaw[] }
    }
    for (const d of def.data?.deals ?? []) addDeal(d)

    let page = 1
    while (true) {
      const data = (await get('/v1/deals', apiKey, { transactionType: txType, limit: 100, page })) as {
        data?: { deals?: IcDealRaw[]; count?: number }
      }
      const deals = data.data?.deals ?? []
      if (deals.length === 0) break
      for (const d of deals) addDeal(d)
      const total = data.data?.count ?? 0
      if (deals.length < 100 || (total && page * 100 >= total)) break
      page += 1
    }
  }

  // Filter by cutoff in-memory (matches Python behavior)
  return rows.filter((r) => r.date !== null && r.date >= cutoff)
}
