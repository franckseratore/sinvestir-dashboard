/**
 * global_status — port de `backend/app/kpis.py:global_status()`.
 *
 * Agrège 13 KPIs (12 core + bénéfice net) pour la vue Score / top_alert
 * du dashboard Overview.
 */
import type postgres from 'postgres'
import type { Period } from './period'
import {
  computePctAtteinte,
  getTarget,
  scaleTarget,
  statusOf,
  type StatusValue,
  type KpiCard,
} from './kpi_helpers'
import {
  volumeLeads,
  bookingRate,
  closingRate,
  cplPaid,
  roasPaid,
  caHt,
} from './kpis'
import {
  bookingRatePaid,
  caPerLead,
  caPerCall,
  noShowRate,
  acv,
} from './kpis_extra'
import { beneficeNetForPeriod } from './tables'

type Domain = 'marketing' | 'sales' | 'ads'

interface KpiEntry {
  key: string
  label: string
  domain: Domain
  href: string
  value: number | null
  target: number | null
  format: KpiCard['format']
  status: StatusValue
  pct_atteinte: number | null
  pct_status: StatusValue
}

type KpiFetcher = (sql: postgres.Sql, p: Period, comp: Period | null) => Promise<KpiCard>

const COMPUTATIONS: Array<{ fn: KpiFetcher; key: string; label: string; domain: Domain; href: string }> = [
  { fn: volumeLeads,        key: 'volume_leads',        label: 'Volume Leads',     domain: 'marketing', href: '/marketing' },
  { fn: bookingRate,        key: 'booking_rate',        label: 'Booking Rate',     domain: 'marketing', href: '/marketing' },
  { fn: bookingRatePaid,    key: 'booking_rate_paid',   label: 'Booking Rate Paid', domain: 'marketing', href: '/marketing' },
  { fn: caPerLead,          key: 'ca_per_lead',         label: 'CA / Lead',         domain: 'marketing', href: '/marketing' },
  { fn: caHt,               key: 'ca_ht',               label: 'CA HT',             domain: 'sales',     href: '/sales' },
  { fn: closingRate,        key: 'closing_rate',        label: 'Closing brut',      domain: 'sales',     href: '/sales' },
  { fn: noShowRate,         key: 'no_show_rate',        label: 'No-show Rate',      domain: 'sales',     href: '/sales' },
  { fn: acv,                key: 'acv',                 label: 'Panier moyen',      domain: 'sales',     href: '/sales' },
  { fn: caPerCall,          key: 'ca_per_call',         label: 'CA / Call',         domain: 'sales',     href: '/sales' },
  { fn: roasPaid,           key: 'roas_paid',           label: 'ROAS Paid',         domain: 'ads',       href: '/ads' },
  { fn: cplPaid,            key: 'cpl_paid',            label: 'CPL Paid',          domain: 'ads',       href: '/ads' },
]

export interface GlobalStatus {
  worst_status: 'green' | 'orange' | 'red'
  phrase: string
  critical_count: number
  warning_count: number
  critical_kpis: KpiEntry[]
  domains: Record<string, { green: number; orange: number; red: number; unknown: number; total: number }>
  total: number
  green: number
  orange: number
  red: number
  excluded: number
  score_pct: number | null
  top_alert: {
    key: string
    label: string
    domain: Domain
    href: string
    value: number | null
    target: number | null
    format: KpiCard['format']
    pct_atteinte: number | null
    tier: 1 | 2
  } | null
}

export async function globalStatus(sql: postgres.Sql, p: Period): Promise<GlobalStatus> {
  const all: KpiEntry[] = []

  for (const c of COMPUTATIONS) {
    try {
      const r = await c.fn(sql, p, null)
      all.push({
        key: c.key,
        label: c.label,
        domain: c.domain,
        href: c.href,
        value: r.value,
        target: r.target,
        format: r.format,
        status: r.status,
        pct_atteinte: r.pct_atteinte,
        pct_status: r.pct_status,
      })
    } catch {
      // swallow per-KPI errors comme le code Python
    }
  }

  // Bénéfice Net Paid sur la période active
  try {
    const b = await beneficeNetForPeriod(sql, p.start, p.end)
    const t = await getTarget(sql, 'benefice_net_paid')
    const { target: bt, seuil: bs } = scaleTarget(t, p)
    const bStatus = statusOf(b.benefice_net, bt, bs, t?.sens ?? null)
    const { pct: bPct, status: bPctStatus } = computePctAtteinte(b.benefice_net, bt, t?.sens ?? null)
    all.push({
      key: 'benefice_net_paid',
      label: 'Bénéfice Net Paid',
      domain: 'ads',
      href: '/ads',
      value: b.benefice_net,
      target: bt,
      format: 'currency',
      status: bStatus,
      pct_atteinte: bPct,
      pct_status: bPctStatus,
    })
  } catch {
    // ignore
  }

  const domains: GlobalStatus['domains'] = {}
  for (const k of all) {
    if (!domains[k.domain]) {
      domains[k.domain] = { green: 0, orange: 0, red: 0, unknown: 0, total: 0 }
    }
    const st = k.status === 'green' || k.status === 'orange' || k.status === 'red' ? k.status : 'unknown'
    domains[k.domain][st] += 1
    domains[k.domain].total += 1
  }

  const critical = all.filter((k) => k.status === 'red')
  const warnings = all.filter((k) => k.status === 'orange')

  let worst: 'green' | 'orange' | 'red'
  let phrase: string
  if (critical.length > 0) {
    worst = 'red'
    phrase = `${critical.length} KPI${critical.length > 1 ? 's' : ''} au-dessus du seuil critique métier.`
  } else if (warnings.length > 0) {
    worst = 'orange'
    phrase = `${warnings.length} KPI${warnings.length > 1 ? 's' : ''} à surveiller.`
  } else {
    worst = 'green'
    phrase = 'Tous les KPIs sont dans les clous.'
  }

  const withTarget = all.filter((k) =>
    k.pct_status === 'green' || k.pct_status === 'orange' || k.pct_status === 'red',
  )
  const excluded = all.length - withTarget.length
  const greenPct = withTarget.filter((k) => k.pct_status === 'green').length
  const orangePct = withTarget.filter((k) => k.pct_status === 'orange').length
  const redPct = withTarget.filter((k) => k.pct_status === 'red').length
  const total = withTarget.length
  const scorePct = total > 0 ? Math.round((greenPct / total) * 1000) / 10 : null

  let topAlert: GlobalStatus['top_alert'] = null
  const tier1 = critical.filter((k) => k.pct_atteinte !== null)
  if (tier1.length > 0) {
    const worstK = tier1.reduce((a, b) => ((a.pct_atteinte ?? Infinity) < (b.pct_atteinte ?? Infinity) ? a : b))
    topAlert = {
      key: worstK.key,
      label: worstK.label,
      domain: worstK.domain,
      href: worstK.href,
      value: worstK.value,
      target: worstK.target,
      format: worstK.format,
      pct_atteinte: worstK.pct_atteinte,
      tier: 1,
    }
  } else {
    const tier2 = withTarget.filter((k) => k.pct_status === 'red' && k.pct_atteinte !== null)
    if (tier2.length > 0) {
      const worstK = tier2.reduce((a, b) => ((a.pct_atteinte ?? Infinity) < (b.pct_atteinte ?? Infinity) ? a : b))
      topAlert = {
        key: worstK.key,
        label: worstK.label,
        domain: worstK.domain,
        href: worstK.href,
        value: worstK.value,
        target: worstK.target,
        format: worstK.format,
        pct_atteinte: worstK.pct_atteinte,
        tier: 2,
      }
    }
  }

  return {
    worst_status: worst,
    phrase,
    critical_count: critical.length,
    warning_count: warnings.length,
    critical_kpis: critical,
    domains,
    total,
    green: greenPct,
    orange: orangePct,
    red: redPct,
    excluded,
    score_pct: scorePct,
    top_alert: topAlert,
  }
}
