'use client'
import { useQueryState } from 'nuqs'
import { useApi } from '@/hooks/use-api'
import { api, type MarketingData } from '@/lib/api'
import { KpiCard } from '@/components/kpi-card'
import { SplitKpiCard } from '@/components/split-kpi-card'
import { KpiLegend } from '@/components/kpi-legend'
import { PeriodSelector } from '@/components/period-selector'
import { DriveStatusBanner } from '@/components/drive-status-bar'
import { DataTable } from '@/components/data-table'
import { formatCurrencyFull, formatNumber, formatPercent } from '@/lib/format'
import { AlertTriangle } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { ColumnDef } from '@tanstack/react-table'
import { cn } from '@/lib/utils'

const CANAL_COLORS: Record<string, string> = {
  Organique: '#10B981', Paid: '#3B82F6', Direct: '#0F2042', Inconnu: '#d4d4d8',
}

function MixBadges({ mix }: { mix: MarketingData['mix_acquisition'] }) {
  const canaux = Object.entries(mix).filter(([k]) => k !== 'total' && typeof mix[k] === 'object') as [string, { count: number; pct: number }][]
  return (
    <div className="flex flex-wrap gap-3">
      {canaux.map(([canal, d]) => (
        <div key={canal} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CANAL_COLORS[canal] ?? '#94a3b8' }} />
          <span className="text-sm font-medium text-zinc-700">{canal}</span>
          <span className="font-mono text-sm font-semibold text-brand">{d.pct.toFixed(1).replace('.', ',')} %</span>
          <span className="text-xs text-zinc-400">({formatNumber(d.count)})</span>
        </div>
      ))}
    </div>
  )
}

function buildLeadsChartData(raw: MarketingData['chart_leads_by_canal']) {
  const byDate: Record<string, Record<string, number>> = {}
  raw.forEach(({ date, canal, value }) => {
    if (!byDate[date]) byDate[date] = {}
    byDate[date][canal] = (byDate[date][canal] ?? 0) + value
  })
  const canaux = [...new Set(raw.map((r) => r.canal))]
  return { data: Object.entries(byDate).map(([date, vals]) => ({ date, ...vals })), canaux }
}

const canalColumns: ColumnDef<MarketingData['canal_performance'][number], unknown>[] = [
  { accessorKey: 'canal', header: 'Canal' },
  { accessorKey: 'sous_canal', header: 'Sous-canal' },
  { accessorKey: 'leads', header: 'Leads', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'cpl', header: 'CPL', cell: (i) => <span className="font-mono">{i.getValue() != null ? formatCurrencyFull(i.getValue() as number) : '—'}</span> },
  { accessorKey: 'calls', header: 'Calls', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'booking_rate', header: 'Booking %', cell: (i) => <span className="font-mono">{i.getValue() != null ? (i.getValue() as number).toFixed(1).replace('.', ',') + ' %' : '—'}</span> },
  { accessorKey: 'ventes', header: 'Ventes', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'ca', header: 'CA HT', cell: (i) => <span className="font-mono font-medium">{formatCurrencyFull(i.getValue() as number)}</span> },
  { accessorKey: 'roas', header: 'ROAS', cell: (i) => <span className="font-mono">{i.getValue() != null ? (i.getValue() as number).toFixed(2) + 'x' : '—'}</span> },
]

const organicColumns: ColumnDef<MarketingData['organic_sources'][number], unknown>[] = [
  { accessorKey: 'source', header: 'Source', cell: (i) => <span className="font-mono text-xs">{String(i.getValue())}</span> },
  { accessorKey: 'sous_canal', header: 'Type' },
  { accessorKey: 'leads', header: 'Leads', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'ca', header: 'CA HT', cell: (i) => <span className="font-mono">{formatCurrencyFull(i.getValue() as number)}</span> },
]

export default function MarketingPage() {
  const [period] = useQueryState('period', { defaultValue: 'last_30_days' })
  const [compare] = useQueryState('compare', { defaultValue: 'false' })
  const [start] = useQueryState('start', { defaultValue: '' })
  const [end] = useQueryState('end', { defaultValue: '' })

  const { data, loading } = useApi<MarketingData>(
    () => api.marketing({ period: period ?? 'last_30_days', compare: compare === 'true', start: start || undefined, end: end || undefined }),
    [period, compare, start, end]
  )

  if (loading || !data) return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div><h1 className="text-2xl font-semibold text-brand">Marketing</h1></div>
        <PeriodSelector />
      </div>
      <div className="grid grid-cols-3 gap-4 animate-pulse">
        {[...Array(7)].map((_, i) => <div key={i} className="h-36 rounded-xl bg-zinc-100" />)}
      </div>
    </div>
  )

  const { data: chartData, canaux } = buildLeadsChartData(data.chart_leads_by_canal)
  const ytb = data.youtube_concentration

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand">Marketing</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{data.period.label}</p>
        </div>
        <PeriodSelector />
      </div>

      <DriveStatusBanner />

      <KpiLegend />

      {/* KPI Cards — 4 cartes (7 → 4) */}
      <div className="grid grid-cols-2 gap-4">
        <SplitKpiCard
          title="Volume leads"
          data={data.kpis.volume_leads}
          splits={[
            { label: 'Paid', value: data.kpis.volume_leads_paid.value, status: data.kpis.volume_leads_paid.status },
            { label: 'Organique', value: data.kpis.volume_leads_organic.value, status: data.kpis.volume_leads_organic.status },
          ]}
          tooltip="Leads entrants tous canaux. Split Paid vs Organique en bas de carte."
        />
        <SplitKpiCard
          title="Booking Rate"
          data={data.kpis.booking_rate}
          splits={[
            { label: 'Paid', value: data.kpis.booking_rate_paid.value, status: data.kpis.booking_rate_paid.status },
            { label: 'Organique', value: data.kpis.booking_rate_organic.value, status: data.kpis.booking_rate_organic.status },
          ]}
          tooltip="Calls réservés ÷ Leads. Split Paid (calls payants ÷ leads payants) vs Organique."
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <KpiCard title="CA / lead" data={data.kpis.ca_per_lead} tooltip="CA HT ÷ Volume leads total — valeur moyenne générée par chaque lead entrant" />
        <div className="rounded-xl border border-zinc-200 bg-white p-5 flex flex-col gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Mix acquisition</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {(Object.entries(data.mix_acquisition).filter(([k]) => k !== 'total' && typeof data.mix_acquisition[k] === 'object') as [string, { count: number; pct: number }][]).map(([canal, d]) => (
              <div key={canal} className="flex items-center gap-1.5 rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-1.5">
                <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: { Organique: '#10B981', Paid: '#3B82F6', Direct: '#0F2042', Inconnu: '#d4d4d8' }[canal] ?? '#94a3b8' }} />
                <span className="text-xs font-medium text-zinc-600">{canal}</span>
                <span className="font-mono text-xs font-bold text-brand">{d.pct.toFixed(1).replace('.', ',')} %</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Leads chart */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-700 mb-4">Volume leads par canal</h2>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
            <XAxis dataKey="date" tickFormatter={(d) => { try { return format(new Date(d), 'dd/MM', { locale: fr }) } catch { return d } }} tick={{ fontSize: 11, fill: '#71717a' }} />
            <YAxis tick={{ fontSize: 11, fill: '#71717a' }} width={40} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            {canaux.map((c) => (
              <Area key={c} type="monotone" dataKey={c} stackId="1" stroke={CANAL_COLORS[c] ?? '#94a3b8'} fill={CANAL_COLORS[c] ?? '#94a3b8'} fillOpacity={0.15} strokeWidth={1.5} dot={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </section>

      {/* YouTube concentration alert */}
      {ytb.alert && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>
            <span className="font-medium">Concentration YouTube élevée : </span>
            {ytb.concentration?.toFixed(1).replace('.', ',')} % des leads organiques viennent de YouTube ({formatNumber(ytb.youtube_leads)} leads). Risque de dépendance.
          </span>
        </div>
      )}

      {/* Canal performance table */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-700 mb-4">Performance par canal</h2>
        <DataTable columns={canalColumns} data={data.canal_performance} exportFilename="performance-canaux" />
      </section>

      {/* Organic sources */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-700 mb-1">Top sources organiques</h2>
        <p className="text-xs text-zinc-400 mb-4">Top 20 sources par volume de leads</p>
        <DataTable columns={organicColumns} data={data.organic_sources} filterPlaceholder="Chercher une source..." exportFilename="sources-organiques" />
      </section>
    </div>
  )
}
