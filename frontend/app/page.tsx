'use client'
import { useQueryState } from 'nuqs'
import { useApi } from '@/hooks/use-api'
import { api, type OverviewData, type GlobalStatusData } from '@/lib/api'
import { KpiCard } from '@/components/kpi-card'
import { HeroKpiCard } from '@/components/hero-kpi-card'
import { GlobalStatusBanner } from '@/components/global-status-banner'
import { DomainSummary } from '@/components/domain-summary'
import { PeriodSelector } from '@/components/period-selector'
import { DriveStatusBanner } from '@/components/drive-status-bar'
import { DataTable } from '@/components/data-table'
import { formatCurrencyFull, formatNumber, formatValue } from '@/lib/format'
import { ExternalLink } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'

// ── Consolidated critical alerts ─────────────────────────────────────────────
function CriticalAlerts({ gs }: { gs: GlobalStatusData }) {
  if (!gs.critical_kpis.length) return null
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
      <p className="text-sm font-semibold text-rose-800 mb-3">KPIs critiques — tous onglets</p>
      <div className="flex flex-wrap gap-2">
        {gs.critical_kpis.map((kpi) => (
          <Link
            key={kpi.key}
            href={kpi.href}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />
            {kpi.label}
            {kpi.value !== null && (
              <span className="font-mono text-rose-500">
                {formatValue(kpi.value, kpi.format)}
              </span>
            )}
            <ExternalLink size={10} className="opacity-50" />
          </Link>
        ))}
      </div>
    </div>
  )
}

// ── Funnel ────────────────────────────────────────────────────────────────────
const FUNNEL_COLORS = ['#3B82F6', '#6366F1', '#8B5CF6', '#0F2042']

function FunnelChart({ data }: { data: OverviewData['funnel'] }) {
  const max = data[0]?.value ?? 1
  return (
    <div className="space-y-3">
      {data.map((step, i) => (
        <div key={step.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-zinc-700">{step.label}</span>
            <div className="flex items-center gap-3">
              <span className="font-mono font-semibold text-brand">{formatNumber(step.value)}</span>
              {step.pct != null && (
                <span className="text-xs text-zinc-400">{step.pct.toFixed(1).replace('.', ',')} % du préc.</span>
              )}
            </div>
          </div>
          <div className="h-2 rounded-full bg-zinc-100">
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{ width: `${(step.value / max) * 100}%`, backgroundColor: FUNNEL_COLORS[i] }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Top sources table ─────────────────────────────────────────────────────────
const sourceColumns: ColumnDef<OverviewData['top_sources'][number], unknown>[] = [
  { accessorKey: 'source', header: 'Source', cell: (i) => <span className="font-mono text-xs">{String(i.getValue())}</span> },
  { accessorKey: 'canal', header: 'Canal' },
  { accessorKey: 'ventes', header: 'Ventes', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'ca', header: 'CA HT', cell: (i) => <span className="font-mono font-medium">{formatCurrencyFull(i.getValue() as number)}</span> },
]

// ── Skeleton ──────────────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-14 rounded-xl bg-zinc-100" />
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-48 rounded-xl bg-zinc-100" />)}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <KpiCard.Skeleton key={i} />)}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const [period] = useQueryState('period', { defaultValue: 'last_30_days' })
  const [compare] = useQueryState('compare', { defaultValue: 'false' })
  const [start] = useQueryState('start', { defaultValue: '' })
  const [end] = useQueryState('end', { defaultValue: '' })

  const params = {
    period: period ?? 'last_30_days',
    compare: compare === 'true',
    start: start || undefined,
    end: end || undefined,
  }

  const { data, loading } = useApi<OverviewData>(
    () => api.overview(params),
    [period, compare, start, end],
  )
  const { data: gs } = useApi<GlobalStatusData>(
    () => api.globalStatus({ period: period ?? 'last_30_days', start: start || undefined, end: end || undefined }),
    [period, start, end],
  )

  if (loading || !data) return <LoadingSkeleton />

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand">Overview</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{data.period.label}</p>
        </div>
        <PeriodSelector />
      </div>

      <DriveStatusBanner />

      {/* Niveau 1 — Statut global */}
      {gs && (
        <GlobalStatusBanner
          worst_status={gs.worst_status}
          phrase={gs.phrase}
          critical_count={gs.critical_count}
          warning_count={gs.warning_count}
        />
      )}

      {/* Alertes consolidées — tous onglets */}
      {gs && <CriticalAlerts gs={gs} />}

      {/* Niveau 2 — 3 Hero KPIs */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-3">Indicateurs clés</p>
        <div className="grid grid-cols-3 gap-5">
          <HeroKpiCard
            title="Booking Rate"
            data={data.kpis.booking_rate}
            tooltip="Calls réservés ÷ Leads — mesure la capacité à convertir un lead en appel de vente"
          />
          <HeroKpiCard
            title="CA HT"
            data={data.kpis.ca_ht}
            tooltip="CA total HT généré sur la période, source : feuille VENTES (calls Calendly). Diffère du CA Sales Live (iClosed) qui couvre l'ensemble des deals enregistrés dans iClosed, tous canaux confondus."
          />
          <HeroKpiCard
            title="ROAS Paid"
            data={data.kpis.roas_paid}
            tooltip="CA Paid ÷ Budget Paid — retour sur investissement publicitaire"
          />
        </div>
      </div>

      {/* Niveau 3 — Autres KPIs */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-3">Autres indicateurs</p>
        <div className="grid grid-cols-3 gap-4">
          <KpiCard title="Volume leads" data={data.kpis.volume_leads} tooltip="Nombre de leads entrants tous canaux confondus — source : onglet LEADS" />
          <KpiCard title="Taux de closing" data={data.kpis.closing_rate} tooltip="Ventes ÷ Calls réservés (taux brut, no-shows inclus au dénominateur)" />
          <KpiCard title="CPL Paid" data={data.kpis.cpl_paid} sens="Bas" tooltip="Budget Paid ÷ Leads Paid — coût par lead sur canaux publicitaires" />
        </div>
      </div>

      {/* CA Chart */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-700 mb-4">Évolution CA HT</h2>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data.chart_ca} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => { try { return format(new Date(d), 'dd/MM', { locale: fr }) } catch { return d } }}
              tick={{ fontSize: 11, fill: '#71717a' }}
            />
            <YAxis
              tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              tick={{ fontSize: 11, fill: '#71717a' }}
              width={45}
            />
            <Tooltip
              formatter={(v: number) => [formatCurrencyFull(v), 'CA HT']}
              labelFormatter={(d) => { try { return format(new Date(d), 'dd MMMM yyyy', { locale: fr }) } catch { return d } }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }}
            />
            {data.chart_ca.some((d) => d.comparison_value != null) && (
              <Area type="monotone" dataKey="comparison_value" stroke="#d4d4d8" fill="#f4f4f5" fillOpacity={0.4} strokeWidth={1} strokeDasharray="4 2" dot={false} name="Période préc." />
            )}
            <Area type="monotone" dataKey="value" stroke="#0F2042" fill="#0F2042" fillOpacity={0.06} strokeWidth={2} dot={false} name="CA HT" />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      {/* Funnel + Top Sources */}
      <div className="grid grid-cols-5 gap-6">
        <section className="col-span-2 rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-700 mb-5">Funnel conversion</h2>
          <FunnelChart data={data.funnel} />
        </section>
        <section className="col-span-3 rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">Top 5 sources par CA</h2>
          <DataTable columns={sourceColumns} data={data.top_sources} exportFilename="top-sources" />
        </section>
      </div>

      {/* Niveau 4 — Statuts par domaine */}
      {gs && <DomainSummary domains={gs.domains} />}
    </div>
  )
}
