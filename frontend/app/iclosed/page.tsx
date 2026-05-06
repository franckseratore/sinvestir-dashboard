'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { api, IClosedData } from '@/lib/api'
import { PeriodSelector } from '@/components/period-selector'
import { DataTable } from '@/components/data-table'

function fmt_pct(v: number | null) {
  if (v === null || v === undefined) return '—'
  return `${(v * 100).toFixed(1).replace('.', ',')} %`
}
function fmt_pct_direct(v: number | null) {
  if (v === null || v === undefined) return '—'
  return `${Number(v).toFixed(1).replace('.', ',')} %`
}
function fmt_n(v: number | null) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('fr-FR')
}
function fmt_eur(v: number | null) {
  if (v === null || v === undefined) return '—'
  return `${Math.round(Number(v)).toLocaleString('fr-FR')} €`
}
function fmt_date(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function statusDot(s: string) {
  if (s === 'green') return 'bg-emerald-500'
  if (s === 'orange') return 'bg-amber-400'
  if (s === 'red') return 'bg-red-500'
  return 'bg-zinc-300'
}
function statusText(s: string) {
  if (s === 'green') return 'text-emerald-600'
  if (s === 'orange') return 'text-amber-600'
  if (s === 'red') return 'text-red-500'
  return 'text-zinc-700'
}

function DeltaBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return null
  const up = pct >= 0
  return (
    <span className={`text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? '+' : ''}{pct.toFixed(1).replace('.', ',')}%
    </span>
  )
}

function KpiCard({ label, value, status, delta_pct, subtitle, tooltip }: {
  label: string; value: string; status: string; delta_pct?: number | null; subtitle?: string; tooltip?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-zinc-100 p-5 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${statusDot(status)}`} />
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">{label}</span>
        {tooltip && (
          <div className="group relative ml-auto flex-shrink-0">
            <span className="cursor-help text-zinc-300 hover:text-zinc-500 text-[10px]">ⓘ</span>
            <div className="absolute bottom-full right-0 mb-2 w-64 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs text-zinc-600 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 leading-relaxed">
              {tooltip}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-end gap-2">
        <div className={`text-2xl font-bold ${statusText(status)}`}>{value}</div>
        {delta_pct !== undefined && <DeltaBadge pct={delta_pct} />}
      </div>
      {subtitle && <div className="text-xs text-zinc-400">{subtitle}</div>}
    </div>
  )
}

function OutcomesChart({ data }: { data: IClosedData['outcomes_breakdown'] }) {
  if (!data || data.length === 0) return <div className="text-zinc-400 text-sm">Aucune donnée</div>
  const colors: Record<string, string> = {
    'SALE': 'bg-emerald-500',
    'NO_SALE': 'bg-red-400',
    'NO_SHOW': 'bg-amber-400',
    'Non renseigné': 'bg-zinc-300',
  }
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-28 text-xs text-zinc-500 shrink-0">{d.outcome}</div>
          <div className="flex-1 h-5 bg-zinc-50 rounded-sm overflow-hidden relative">
            <div
              className={`h-full rounded-sm ${colors[d.outcome] || 'bg-zinc-400'}`}
              style={{ width: `${d.pct}%` }}
            />
          </div>
          <div className="text-xs text-zinc-500 w-20 text-right shrink-0">
            {fmt_n(d.count)} ({fmt_pct_direct(d.pct)})
          </div>
        </div>
      ))}
    </div>
  )
}

function RevenueChart({ data }: { data: IClosedData['chart_revenue'] }) {
  if (!data || data.length === 0) return <div className="text-zinc-400 text-sm">Aucune donnée</div>
  const maxCA = Math.max(...data.map(d => d.ca), 1)
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="text-[10px] text-zinc-400 w-12 shrink-0">{fmt_date(d.date)}</div>
          <div className="flex-1 relative h-5 bg-zinc-50 rounded-sm overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full bg-emerald-400 rounded-sm"
              style={{ width: `${(d.ca / maxCA) * 100}%` }}
            />
            <span className="absolute left-2 top-0 h-full flex items-center text-[10px] text-zinc-700 font-medium z-10">
              {fmt_eur(d.ca)}
            </span>
          </div>
          <div className="text-[10px] text-zinc-400 w-12 shrink-0 text-right">{d.ventes} vente{d.ventes > 1 ? 's' : ''}</div>
        </div>
      ))}
    </div>
  )
}

type CloserRow = IClosedData['closers'][number]
const CLOSER_COLUMNS: ColumnDef<CloserRow, unknown>[] = [
  { accessorKey: 'closer', header: 'Closer' },
  { accessorKey: 'calls', header: 'Appels', cell: (i) => <span className="font-mono">{fmt_n(i.getValue() as number)}</span> },
  { accessorKey: 'shown', header: 'Présentés', cell: (i) => <span className="font-mono">{fmt_n(i.getValue() as number)}</span> },
  { accessorKey: 'no_shows', header: 'No-shows', cell: (i) => <span className="font-mono">{fmt_n(i.getValue() as number)}</span> },
  { accessorKey: 'ventes', header: 'Ventes', cell: (i) => <span className="font-mono">{fmt_n(i.getValue() as number)}</span> },
  {
    accessorKey: 'closing_rate_pct',
    header: 'Closing rate',
    cell: (i) => {
      const v = i.getValue() as number | null
      if (v === null) return <span className="text-zinc-400">—</span>
      const color = v >= 50 ? 'text-emerald-600' : v >= 30 ? 'text-amber-600' : 'text-red-500'
      return <span className={`font-mono font-semibold ${color}`}>{fmt_pct_direct(v)}</span>
    },
  },
  { accessorKey: 'ca', header: 'CA closé', cell: (i) => <span className="font-mono font-medium">{fmt_eur(i.getValue() as number)}</span> },
  { accessorKey: 'acv', header: 'ACV', cell: (i) => <span className="font-mono">{fmt_eur(i.getValue() as number | null)}</span> },
]

function IClosedContent() {
  const params = useSearchParams()
  const period = params.get('period') || 'last_30_days'
  const start = params.get('start') || undefined
  const end = params.get('end') || undefined
  const compare = params.get('compare') === 'true'

  const [data, setData] = useState<IClosedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.iclosed({ period, start, end, compare })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [period, start, end, compare])

  if (loading) return <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">Chargement…</div>
  if (error) return <div className="flex-1 flex items-center justify-center text-red-500 text-sm">{error}</div>
  if (!data) return null

  const { kpis } = data

  return (
    <div className="flex-1 overflow-auto bg-zinc-50 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Sales Live</h1>
          <p className="text-sm text-zinc-400 mt-0.5">iClosed — données temps réel</p>
        </div>
        <PeriodSelector />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard
          label="Appels"
          value={fmt_n(kpis.volume_calls.value)}
          status={kpis.volume_calls.status}
          delta_pct={kpis.volume_calls.delta_pct}
        />
        <KpiCard
          label="Ventes"
          value={fmt_n(kpis.ventes_count.value)}
          status={kpis.ventes_count.status}
          delta_pct={kpis.ventes_count.delta_pct}
        />
        <KpiCard
          label="No-show"
          value={fmt_pct(kpis.no_show_rate.value)}
          status={kpis.no_show_rate.status}
          delta_pct={kpis.no_show_rate.delta_pct}
        />
        <KpiCard
          label="Closing net"
          value={fmt_pct(kpis.closing_rate_net.value)}
          status={kpis.closing_rate_net.status}
          delta_pct={kpis.closing_rate_net.delta_pct}
        />
        <KpiCard
          label="CA closé"
          value={fmt_eur(kpis.revenue.value)}
          tooltip="CA total des deals WON enregistrés dans iClosed sur la période. Diffère du CA HT (onglet Sales) qui est basé sur la feuille VENTES (calls Calendly uniquement). Les deux périmètres ne doivent pas être confondus."
          status={kpis.revenue.status}
          delta_pct={kpis.revenue.delta_pct}
        />
        <KpiCard
          label="ACV"
          value={fmt_eur(kpis.acv.value)}
          status={kpis.acv.status}
          delta_pct={kpis.acv.delta_pct}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-zinc-100 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">Outcomes des appels</h2>
          <OutcomesChart data={data.outcomes_breakdown} />
        </div>
        <div className="bg-white rounded-xl border border-zinc-100 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">CA closé par jour</h2>
          <RevenueChart data={data.chart_revenue} />
        </div>
      </div>

      {/* Closers table */}
      <div className="bg-white rounded-xl border border-zinc-100 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-700 mb-4">Performance par closer</h2>
        <DataTable
          data={data.closers}
          columns={CLOSER_COLUMNS}
          exportFilename="iclosed_closers"
        />
      </div>
    </div>
  )
}

export default function IClosedPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">Chargement…</div>}>
      <IClosedContent />
    </Suspense>
  )
}
