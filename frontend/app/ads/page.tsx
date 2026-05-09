'use client'
import { useQueryState } from 'nuqs'
import { useApi } from '@/hooks/use-api'
import { api, type AdsData } from '@/lib/api'
import { KpiCard } from '@/components/kpi-card'
import { KpiLegend } from '@/components/kpi-legend'
import { PeriodSelector } from '@/components/period-selector'
import { DriveStatusBanner } from '@/components/drive-status-bar'
import { DataTable } from '@/components/data-table'
import { formatCurrencyFull, formatNumber, formatCurrency } from '@/lib/format'
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { ColumnDef } from '@tanstack/react-table'
import { cn } from '@/lib/utils'

function MetaGoogleCards({ data }: { data: AdsData['meta_vs_google'] }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {data.map((canal) => (
        <div key={canal.canal} className="rounded-xl border border-zinc-200 bg-white p-5 space-y-3">
          <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">{canal.canal}</div>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
            {[
              ['Budget', formatCurrencyFull(canal.budget)],
              ['Leads', formatNumber(canal.leads)],
              ['CPL', canal.cpl != null ? formatCurrencyFull(canal.cpl) : '—'],
              ['ROAS', canal.roas != null ? canal.roas.toFixed(2) + 'x' : '—'],
              ['CA HT', formatCurrencyFull(canal.ca)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-[10px] text-zinc-400 uppercase">{label}</div>
                <div className="font-mono font-semibold text-brand">{value}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const creativeColumns: ColumnDef<AdsData['creatives'][number], unknown>[] = [
  {
    accessorKey: 'creative_id',
    header: 'Créative (ID)',
    cell: (i) => <span className="font-mono text-xs">{String(i.getValue())}</span>
  },
  { accessorKey: 'canal', header: 'Canal' },
  { accessorKey: 'spend', header: 'Spend', cell: (i) => <span className="font-mono">{formatCurrencyFull(i.getValue() as number)}</span> },
  { accessorKey: 'leads', header: 'Leads', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  {
    accessorKey: 'cpl',
    header: 'CPL',
    cell: (i) => {
      const row = i.row.original
      const v = i.getValue() as number | null
      return (
        <span className={cn('font-mono', row.alert && 'text-rose-600 font-semibold')}>
          {v != null ? formatCurrencyFull(v) : '—'}
        </span>
      )
    }
  },
  { accessorKey: 'calls', header: 'Calls', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'ventes', header: 'Ventes', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'ca', header: 'CA HT', cell: (i) => <span className="font-mono font-medium">{formatCurrencyFull(i.getValue() as number)}</span> },
  { accessorKey: 'roas', header: 'ROAS', cell: (i) => <span className="font-mono">{i.getValue() != null ? (i.getValue() as number).toFixed(2) + 'x' : '—'}</span> },
  {
    accessorKey: 'marge_pct',
    header: 'Marge',
    cell: (i) => {
      const v = i.getValue() as number | null
      if (v == null) return <span className="text-zinc-400">—</span>
      const color = v >= 30 ? 'text-emerald-600' : v >= 0 ? 'text-amber-600' : 'text-rose-500'
      return <span className={`font-mono ${color}`}>{v.toFixed(1).replace('.', ',')} %</span>
    }
  },
]

export default function AdsPage() {
  const [period] = useQueryState('period', { defaultValue: 'last_30_days' })
  const [compare] = useQueryState('compare', { defaultValue: 'false' })
  const [start] = useQueryState('start', { defaultValue: '' })
  const [end] = useQueryState('end', { defaultValue: '' })

  const { data, loading } = useApi<AdsData>(
    () => api.ads({ period: period ?? 'last_30_days', compare: compare === 'true', start: start || undefined, end: end || undefined }),
    [period, compare, start, end]
  )

  if (loading || !data) return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-brand">Ads</h1></div><PeriodSelector /></div>
      <div className="grid grid-cols-3 gap-4 animate-pulse">{[...Array(4)].map((_, i) => <div key={i} className="h-36 rounded-xl bg-zinc-100" />)}</div>
    </div>
  )

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand">Ads</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{data.period.label}</p>
        </div>
        <PeriodSelector />
      </div>

      <DriveStatusBanner />

      <KpiLegend />

      {/* Meta vs Google — angle de pilotage quotidien, en premier */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700">Meta vs Google</h2>
        <MetaGoogleCards data={data.meta_vs_google} />
      </section>

      {/* KPI Cards globaux */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard title="Budget Paid" data={data.kpis.budget_paid} sens="Bas" tooltip="Budget publicitaire total dépensé sur la période (Meta + Google + TikTok) — Source : onglet BUDGET" />
        <KpiCard title="CA Paid" data={data.kpis.ca_paid} tooltip="CA HT généré par les canaux payants — Source : onglet VENTES (canal = Paid)" />
        <KpiCard title="ROAS Paid" data={data.kpis.roas_paid} tooltip="CA Paid ÷ Budget Paid — retour sur investissement publicitaire (ex : 3x = 3€ CA pour 1€ de budget)" />
        <KpiCard title="CPL Paid" data={data.kpis.cpl_paid} sens="Bas" tooltip="Budget Paid ÷ Leads Paid — coût par lead sur les canaux publicitaires" />
        <div className="rounded-xl border border-zinc-200 bg-white p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Bénéfice net Paid</span>
            <span className="text-[10px] text-zinc-400 font-mono">{data.kpis.benefice_mtd_label}</span>
          </div>
          <span className={cn('font-mono text-3xl font-semibold leading-none', (data.kpis.benefice_net ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-500')}>
            {formatCurrencyFull(data.kpis.benefice_net as number)}
          </span>
          <div className="space-y-0.5 text-[10px] text-zinc-400">
            <div>CA : <span className="font-mono font-medium text-zinc-500">{formatCurrency(data.kpis.benefice_ca)}</span></div>
            <div>Spend : <span className="font-mono font-medium text-zinc-500">{formatCurrency(data.kpis.benefice_spend)}</span> · Agence : <span className="font-mono font-medium text-zinc-500">{formatCurrency(data.kpis.benefice_agence)}</span></div>
            <div>Marge : <span className="font-mono font-medium">{data.kpis.marge_pct?.toFixed(1).replace('.', ',') ?? '—'} %</span></div>
          </div>
        </div>
      </div>

      {/* Budget vs CA vs ROAS chart */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-700 mb-4">Budget · CA · ROAS</h2>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data.chart_budget_ca_roas} margin={{ top: 5, right: 40, bottom: 0, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
            <XAxis dataKey="date" tickFormatter={(d) => { try { return format(new Date(d), 'dd/MM', { locale: fr }) } catch { return d } }} tick={{ fontSize: 11, fill: '#71717a' }} />
            <YAxis yAxisId="left" tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} tick={{ fontSize: 11, fill: '#71717a' }} width={45} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => v + 'x'} tick={{ fontSize: 11, fill: '#71717a' }} width={35} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }} formatter={(v: number, name: string) => [name === 'roas' ? v?.toFixed(2) + 'x' : formatCurrencyFull(v), name]} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="left" dataKey="budget" fill="#d4d4d8" name="Budget" radius={[2, 2, 0, 0]} />
            <Bar yAxisId="left" dataKey="ca" fill="#0F2042" name="CA Paid" radius={[2, 2, 0, 0]} fillOpacity={0.8} />
            <Line yAxisId="right" type="monotone" dataKey="roas" stroke="#C9A55C" strokeWidth={2} dot={false} name="ROAS" />
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      {/* Creatives table */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-sm font-semibold text-zinc-700">Créatives par ID</h2>
        </div>
        <p className="text-xs text-zinc-400 mb-4">
          Analyse créa par ID brut. Le mapping enrichi (format, hook, audience) sera ajouté en V1.
          <span className="text-rose-500 ml-1">Les lignes en rouge ont un CPL au-dessus du seuil critique.</span>
        </p>
        <DataTable
          columns={creativeColumns}
          data={data.creatives}
          filterPlaceholder="Chercher une créative..."
          exportFilename="creatives-ads"
        />
      </section>
    </div>
  )
}
