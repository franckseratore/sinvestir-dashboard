'use client'
import { useQueryState } from 'nuqs'
import { useApi } from '@/hooks/use-api'
import { api, type SalesData } from '@/lib/api'
import { KpiCard } from '@/components/kpi-card'
import { KpiLegend } from '@/components/kpi-legend'
import { PeriodSelector } from '@/components/period-selector'
import { DriveStatusBanner } from '@/components/drive-status-bar'
import { DataTable } from '@/components/data-table'
import { formatCurrencyFull, formatNumber } from '@/lib/format'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { ColumnDef } from '@tanstack/react-table'

const CLOSER_COLORS = ['#0F2042', '#3B82F6', '#10B981', '#F59E0B', '#F43F5E', '#8B5CF6', '#EC4899']

function buildCloserChart(raw: SalesData['chart_closing_rate']) {
  const byDate: Record<string, Record<string, number | null>> = {}
  const closers = [...new Set(raw.map((r) => r.closer))]
  raw.forEach(({ date, closer, closing_rate }) => {
    if (!byDate[date]) byDate[date] = {}
    byDate[date][closer] = closing_rate
  })
  return { data: Object.entries(byDate).map(([date, vals]) => ({ date, ...vals })), closers: closers.slice(0, 6) }
}

const closerColumns: ColumnDef<SalesData['closers'][number], unknown>[] = [
  { accessorKey: 'closer', header: 'Closer', cell: (i) => <span className="font-mono text-xs">{String(i.getValue())}</span> },
  { accessorKey: 'calls', header: 'Calls', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'ventes', header: 'Ventes', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  {
    accessorKey: 'closing_rate',
    header: 'Closing %',
    cell: (i) => {
      const v = i.getValue() as number | null
      if (v == null) return <span className="text-zinc-400">—</span>
      const color = v >= 30 ? 'text-emerald-600' : v >= 15 ? 'text-amber-600' : 'text-rose-500'
      return <span className={`font-mono font-semibold ${color}`}>{v.toFixed(1).replace('.', ',')} %</span>
    }
  },
  { accessorKey: 'ca', header: 'CA HT', cell: (i) => <span className="font-mono font-medium">{formatCurrencyFull(i.getValue() as number)}</span> },
  { accessorKey: 'acv', header: 'ACV', cell: (i) => <span className="font-mono">{i.getValue() != null ? formatCurrencyFull(i.getValue() as number) : '—'}</span> },
]

const produitColumns: ColumnDef<SalesData['produits'][number], unknown>[] = [
  { accessorKey: 'produit', header: 'Produit' },
  { accessorKey: 'ventes', header: 'Ventes', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'ca', header: 'CA HT', cell: (i) => <span className="font-mono font-medium">{formatCurrencyFull(i.getValue() as number)}</span> },
  { accessorKey: 'acv', header: 'ACV', cell: (i) => <span className="font-mono">{i.getValue() != null ? formatCurrencyFull(i.getValue() as number) : '—'}</span> },
]

const canalColumns: ColumnDef<SalesData['closing_by_canal'][number], unknown>[] = [
  { accessorKey: 'canal', header: 'Canal' },
  { accessorKey: 'calls', header: 'Calls', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'ventes', header: 'Ventes', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  {
    accessorKey: 'closing_rate',
    header: 'Closing %',
    cell: (i) => {
      const v = i.getValue() as number | null
      return v != null ? <span className="font-mono">{v.toFixed(1).replace('.', ',')} %</span> : <span className="text-zinc-400">—</span>
    }
  },
  { accessorKey: 'ca', header: 'CA HT', cell: (i) => <span className="font-mono font-medium">{formatCurrencyFull(i.getValue() as number)}</span> },
]

export default function SalesPage() {
  const [period] = useQueryState('period', { defaultValue: 'last_30_days' })
  const [compare] = useQueryState('compare', { defaultValue: 'false' })
  const [start] = useQueryState('start', { defaultValue: '' })
  const [end] = useQueryState('end', { defaultValue: '' })

  const { data, loading, error } = useApi<SalesData>(
    () => api.sales({ period: period ?? 'last_30_days', compare: compare === 'true', start: start || undefined, end: end || undefined }),
    [period, compare, start, end]
  )

  if (loading) return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-brand">Sales</h1></div><PeriodSelector /></div>
      <div className="grid grid-cols-3 gap-4 animate-pulse">{[...Array(9)].map((_, i) => <div key={i} className="h-36 rounded-xl bg-zinc-100" />)}</div>
    </div>
  )

  if (error || !data) return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-brand">Sales</h1></div><PeriodSelector /></div>
      <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">
        Impossible de charger les données. Le backend est-il démarré ?{error ? ` (${error})` : ''}
      </div>
    </div>
  )

  const { data: chartData, closers } = buildCloserChart(data.chart_closing_rate)

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand">Sales</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{data.period.label}</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            Source : Google Sheets <span className="text-zinc-500 font-medium">(officiel)</span> — refresh quotidien 06h Paris
          </p>
        </div>
        <PeriodSelector />
      </div>

      <DriveStatusBanner />

      <KpiLegend />

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard title="CA HT" data={data.kpis.ca_ht} tooltip="CA total hors taxes généré sur la période — Source : onglet VENTES" />
        <KpiCard title="Ventes" data={data.kpis.ventes_count} tooltip="Nombre de contrats signés sur la période (CA > 0)" />
        <KpiCard title="CA par call" data={data.kpis.ca_per_call} tooltip="CA HT ÷ Calls passés — valeur moyenne générée par chaque appel de vente effectué" />
        <KpiCard title="Closing brut (/ réservés)" data={data.kpis.closing_rate} tooltip="Ventes ÷ Calls réservés — taux brut incluant les no-shows au dénominateur" />
        <KpiCard title="Closing net (/ passés)" data={data.kpis.closing_rate_net} tooltip="Ventes ÷ Calls passés — taux net excluant les no-shows, mesure la vraie efficacité closing" />
        <KpiCard title="No-show rate" data={data.kpis.no_show_rate} sens="Bas" tooltip="Calls sans créneau confirmé ÷ Calls éligibles (créneaux passés ou sans date_call)" />
        <KpiCard title="Calls réservés" data={data.kpis.calls_booked} tooltip="Nombre de calls dont la date de réservation est dans la période sélectionnée" />
        <KpiCard title="Calls passés" data={data.kpis.calls_completed} tooltip="Calls réservés dont l'heure Calendly est dépassée (is_past = true)" />
        <KpiCard title="Panier moyen (ACV)" data={data.kpis.acv} tooltip="CA HT ÷ Nombre de ventes — valeur moyenne d'un contrat signé" />
      </div>

      {/* Closing rate par closer — table */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-700 mb-4">Performance par closer</h2>
        <DataTable columns={closerColumns} data={data.closers} exportFilename="performance-closers" />
      </section>

      {/* Closing rate dans le temps */}
      {closers.length > 0 && (
        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">Closing rate dans le temps</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis dataKey="date" tickFormatter={(d) => { try { return format(new Date(d), 'dd/MM', { locale: fr }) } catch { return d } }} tick={{ fontSize: 11, fill: '#71717a' }} />
              <YAxis tickFormatter={(v) => v + '%'} tick={{ fontSize: 11, fill: '#71717a' }} width={40} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }} formatter={(v: number) => [v?.toFixed(1) + '%', '']} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              {closers.map((closer, i) => (
                <Line key={closer} type="monotone" dataKey={closer} stroke={CLOSER_COLORS[i % CLOSER_COLORS.length]} strokeWidth={1.5} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Produits + Canal côte à côte */}
      <div className="grid grid-cols-2 gap-6">
        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">Ventes par produit</h2>
          <DataTable columns={produitColumns} data={data.produits} exportFilename="ventes-par-produit" />
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">Closing rate par canal</h2>
          <DataTable columns={canalColumns} data={data.closing_by_canal} exportFilename="closing-par-canal" />
        </section>
      </div>
    </div>
  )
}
