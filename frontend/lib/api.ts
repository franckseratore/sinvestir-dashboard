const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function get<T>(path: string, params: Record<string, string | boolean | undefined>): Promise<T> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  const url = `${BASE}${path}${qs ? '?' + qs : ''}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.json()
}

export type KpiCard = {
  value: number | null
  comparison_value: number | null
  delta: number | null
  delta_pct: number | null
  status: 'green' | 'orange' | 'red' | 'unknown'
  trend_alert: boolean
  target: number | null
  seuil_critique: number | null
  format: string
  sparkline: number[]
  moving_avg_4w: number | null
}

export type TargetRow = {
  indicateur: string
  description: string
  unite: string
  sens: 'Haut' | 'Bas'
  target_mensuelle: number
  seuil_critique: number
  owner: string
  prorata: boolean
}

export type TargetUpdate = {
  target_mensuelle?: number
  seuil_critique?: number
}

export type PeriodMeta = { start: string; end: string; label: string }

export type OverviewData = {
  period: PeriodMeta
  comparison: PeriodMeta | null
  kpis: { ca_ht: KpiCard; volume_leads: KpiCard; booking_rate: KpiCard; closing_rate: KpiCard; cpl_paid: KpiCard; roas_paid: KpiCard }
  chart_ca: { date: string; value: number; comparison_value?: number }[]
  funnel: { label: string; value: number; pct: number | null }[]
  top_sources: { source: string; canal: string; ventes: number; ca: number }[]
}

export type MarketingData = {
  period: PeriodMeta
  kpis: { volume_leads: KpiCard; volume_leads_paid: KpiCard; volume_leads_organic: KpiCard; booking_rate: KpiCard; booking_rate_paid: KpiCard; booking_rate_organic: KpiCard; ca_per_lead: KpiCard }
  mix_acquisition: Record<string, { count: number; pct: number } | number>
  chart_leads_by_canal: { date: string; canal: string; value: number }[]
  canal_performance: { canal: string; sous_canal: string; leads: number; cpl: number | null; calls: number; booking_rate: number | null; ventes: number; ca: number; roas: number | null }[]
  organic_sources: { source: string; sous_canal: string; leads: number; ca: number }[]
  youtube_concentration: { youtube_leads: number; organic_total: number; concentration: number | null; alert: boolean }
}

export type SalesData = {
  period: PeriodMeta
  kpis: { ca_ht: KpiCard; ventes_count: KpiCard; ca_per_call: KpiCard; closing_rate: KpiCard; closing_rate_net: KpiCard; calls_booked: KpiCard; calls_completed: KpiCard; no_show_rate: KpiCard; acv: KpiCard }
  closers: { closer: string; calls: number; ventes: number; closing_rate: number | null; ca: number; acv: number | null }[]
  chart_closing_rate: { date: string; closer: string; closing_rate: number | null }[]
  produits: { produit: string; ventes: number; ca: number; acv: number | null }[]
  closing_by_canal: { canal: string; calls: number; ventes: number; closing_rate: number | null; ca: number }[]
}

export type AdsData = {
  period: PeriodMeta
  kpis: { budget_paid: KpiCard; ca_paid: KpiCard; roas_paid: KpiCard; cpl_paid: KpiCard; benefice_net: number; marge_pct: number | null; benefice_mtd_label: string; benefice_ca: number; benefice_spend: number; benefice_agence: number }
  chart_budget_ca_roas: { date: string; budget: number; ca: number; roas: number | null }[]
  meta_vs_google: { canal: string; budget: number; ca: number; leads: number; roas: number | null; cpl: number | null }[]
  creatives: { creative_id: string; canal: string; spend: number; leads: number; cpl: number | null; calls: number; ventes: number; ca: number; roas: number | null; marge_pct: number | null; alert: boolean }[]
}

export type StatusData = {
  last_refresh: string | null
  last_modified_files: string[]
  status: 'ok' | 'error' | 'initializing'
  drive_sync_ok: boolean
}

export type EmailData = {
  kpis: {
    open_rate: { value: number | null; status: string }
    ctor: { value: number | null; status: string }
    unsubscribe_rate: { value: number | null; status: string }
    unsubscribes: { value: number | null; status: string }
    total_sends: { value: number | null; status: string }
    nb_campaigns: { value: number | null; status: string }
  }
  chart_open_rate: { date: string; name: string; open_rate: number; ctr: number }[]
  campaigns: {
    name: string; sdate: string; send_amt: number
    uniqueopens: number; uniquelinkclicks: number; unsubscribes: number
    open_rate_pct: number; ctr_pct: number; ctor_pct: number
  }[]
}

export type IClosedKpi = {
  value: number | null
  comparison_value?: number | null
  delta_pct?: number | null
  status: string
}

export type IClosedData = {
  period: PeriodMeta
  comparison: PeriodMeta | null
  kpis: {
    volume_calls: IClosedKpi
    no_show_rate: IClosedKpi
    closing_rate_net: IClosedKpi
    revenue: IClosedKpi
    acv: IClosedKpi
    ventes_count: IClosedKpi
  }
  closers: {
    closer: string; calls: number; shown: number; no_shows: number
    ventes: number; ca: number; closing_rate_pct: number | null; acv: number | null
  }[]
  outcomes_breakdown: { outcome: string; count: number; pct: number }[]
  chart_revenue: { date: string; ca: number; ventes: number }[]
}

export type GlobalStatusKpi = {
  key: string
  label: string
  domain: string
  href: string
  value: number | null
  format: string
  status: 'green' | 'orange' | 'red' | 'unknown'
}

export type GlobalStatusData = {
  period: PeriodMeta
  worst_status: 'green' | 'orange' | 'red'
  phrase: string
  critical_count: number
  warning_count: number
  critical_kpis: GlobalStatusKpi[]
  domains: Record<string, { green: number; orange: number; red: number; unknown: number; total: number }>
}

type ApiParams = { period: string; compare?: boolean; start?: string; end?: string }

export const api = {
  overview: (p: ApiParams) => get<OverviewData>('/api/overview', p as Record<string, string | boolean | undefined>),
  marketing: (p: ApiParams) => get<MarketingData>('/api/marketing', p as Record<string, string | boolean | undefined>),
  sales: (p: ApiParams) => get<SalesData>('/api/sales', p as Record<string, string | boolean | undefined>),
  ads: (p: ApiParams) => get<AdsData>('/api/ads', p as Record<string, string | boolean | undefined>),
  email: () => get<EmailData>('/api/email', {}),
  iclosed: (p: ApiParams) => get<IClosedData>('/api/iclosed', p as Record<string, string | boolean | undefined>),
  status: () => get<StatusData>('/api/status', {}),
  globalStatus: (p: Omit<ApiParams, 'compare'>) => get<GlobalStatusData>('/api/global-status', p as Record<string, string | boolean | undefined>),
  adminTargets: () => get<TargetRow[]>('/api/admin/targets', {}),
  updateTarget: async (indicateur: string, body: TargetUpdate): Promise<void> => {
    await fetch(`${BASE}/api/admin/targets/${indicateur}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  },
}
