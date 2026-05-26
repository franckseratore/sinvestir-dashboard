'use client'
import { useMemo } from 'react'
import { useQueryState } from 'nuqs'
import { useApi } from '@/hooks/use-api'
import { api, type FunnelBySourceData, type FunnelBySourceRow } from '@/lib/api'
import { PeriodSelector } from '@/components/period-selector'
import { DataTable } from '@/components/data-table'
import { formatCurrencyFull, formatNumber } from '@/lib/format'
import type { ColumnDef } from '@tanstack/react-table'

function pctCell(value: number | null) {
  if (value === null) return <span className="text-zinc-400">—</span>
  return <span className="font-mono">{value.toFixed(1).replace('.', ',')} %</span>
}

function InconsistentBadge() {
  return (
    <span
      title="Données incohérentes : un des taux bruts (booking ou closing) dépasse 100 %, signe d'une attribution cross-période (calls réservés hors fenêtre ou ventes sans call tracké). Taux plafonnés à 100 %."
      className="ml-1.5 inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200"
    >
      ⚠ incohérent
    </span>
  )
}

const columns: ColumnDef<FunnelBySourceRow, unknown>[] = [
  {
    accessorKey: 'source',
    header: 'Source',
    cell: (i) => <span className="font-mono text-xs">{String(i.getValue())}</span>,
  },
  { accessorKey: 'canal', header: 'Canal', cell: (i) => <span className="text-xs text-zinc-600">{String(i.getValue())}</span> },
  { accessorKey: 'sous_canal', header: 'Sous-canal', cell: (i) => <span className="text-xs text-zinc-500">{String(i.getValue())}</span> },
  {
    accessorKey: 'leads',
    header: 'Leads',
    cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span>,
  },
  {
    accessorKey: 'booking_rate',
    header: 'Booking %',
    cell: (i) => {
      const v = i.getValue() as number | null
      const row = i.row.original
      const inconsistent = row.data_inconsistent && v !== null && v >= 100
      return (
        <span className="inline-flex items-center">
          {pctCell(v)}
          {inconsistent && <InconsistentBadge />}
        </span>
      )
    },
  },
  {
    accessorKey: 'show_rate',
    header: 'Show %',
    cell: (i) => pctCell(i.getValue() as number | null),
  },
  {
    accessorKey: 'closing_rate',
    header: 'Closing %',
    cell: (i) => {
      const v = i.getValue() as number | null
      if (v === null) return <span className="text-zinc-400">—</span>
      const row = i.row.original
      const inconsistent = row.data_inconsistent && v >= 100
      const color = v >= 30 ? 'text-emerald-600' : v >= 15 ? 'text-amber-600' : 'text-rose-500'
      return (
        <span className="inline-flex items-center">
          <span className={`font-mono font-semibold ${color}`}>{v.toFixed(1).replace('.', ',')} %</span>
          {inconsistent && <InconsistentBadge />}
        </span>
      )
    },
  },
  {
    accessorKey: 'ventes',
    header: 'Ventes',
    cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span>,
  },
  {
    accessorKey: 'ca',
    header: 'CA HT',
    cell: (i) => <span className="font-mono font-medium">{formatCurrencyFull(i.getValue() as number)}</span>,
  },
  {
    accessorKey: 'ca_per_lead',
    header: 'CA / lead',
    cell: (i) => {
      const v = i.getValue() as number | null
      return v !== null ? <span className="font-mono">{formatCurrencyFull(v)}</span> : <span className="text-zinc-400">—</span>
    },
  },
  {
    accessorKey: 'acv',
    header: 'ACV',
    cell: (i) => {
      const v = i.getValue() as number | null
      return v !== null ? <span className="font-mono">{formatCurrencyFull(v)}</span> : <span className="text-zinc-400">—</span>
    },
  },
]

// Petite synthèse champions / underperformers : pour chaque métrique,
// affiche la meilleure et la pire source (parmi celles avec >= 50 leads).
function TopBottom({ rows }: { rows: FunnelBySourceRow[] }) {
  const eligible = useMemo(() => rows.filter((r) => r.leads >= 50), [rows])

  function rank(metric: keyof FunnelBySourceRow, dir: 'best' | 'worst'): FunnelBySourceRow | null {
    const filtered = eligible.filter((r) => r[metric] !== null && r[metric] !== undefined)
    if (filtered.length === 0) return null
    const sign = dir === 'best' ? -1 : 1
    return [...filtered].sort((a, b) => sign * ((a[metric] as number) - (b[metric] as number)))[0]
  }

  const cards: Array<{ label: string; metric: keyof FunnelBySourceRow; fmt: 'pct' | 'eur'; sens: 'Haut' | 'Bas' }> = [
    { label: 'Booking rate', metric: 'booking_rate', fmt: 'pct', sens: 'Haut' },
    { label: 'Closing rate', metric: 'closing_rate', fmt: 'pct', sens: 'Haut' },
    { label: 'CA / lead', metric: 'ca_per_lead', fmt: 'eur', sens: 'Haut' },
    { label: 'ACV', metric: 'acv', fmt: 'eur', sens: 'Haut' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, metric, fmt }) => {
        const best = rank(metric, 'best')
        const worst = rank(metric, 'worst')
        const formatV = (v: number | null) =>
          v === null ? '—' : fmt === 'pct' ? `${v.toFixed(1).replace('.', ',')} %` : formatCurrencyFull(v)
        return (
          <div key={metric} className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-3">{label}</p>
            <div className="space-y-2 text-xs">
              {best && (
                <div>
                  <p className="text-emerald-600 font-medium">🥇 {best.source}</p>
                  <p className="text-zinc-500 font-mono">{formatV(best[metric] as number | null)} · {best.leads} leads</p>
                </div>
              )}
              {worst && best && worst.source !== best.source && (
                <div className="pt-2 border-t border-zinc-100">
                  <p className="text-rose-500 font-medium">🚨 {worst.source}</p>
                  <p className="text-zinc-500 font-mono">{formatV(worst[metric] as number | null)} · {worst.leads} leads</p>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function FunnelPage() {
  const [period] = useQueryState('period', { defaultValue: 'last_30_days' })
  const [start] = useQueryState('start', { defaultValue: '' })
  const [end] = useQueryState('end', { defaultValue: '' })

  const { data, loading, error } = useApi<FunnelBySourceData>(
    () =>
      api.funnelBySource({
        period: period ?? 'last_30_days',
        start: start || undefined,
        end: end || undefined,
      }),
    [period, start, end],
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-brand">Funnel par source</h1>
          </div>
          <PeriodSelector />
        </div>
        <div className="h-96 rounded-xl bg-zinc-100 animate-pulse" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-brand">Funnel par source</h1>
          </div>
          <PeriodSelector />
        </div>
        <div className="text-zinc-400 text-sm">
          Impossible de charger les données{error ? ` (${error})` : ''}.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand">Funnel par source</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{data.period.label}</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            Ventilation des KPIs sales par source d'acquisition — Source : Google Sheets (officiel)
          </p>
        </div>
        <PeriodSelector />
      </div>

      {/* Attribution warning */}
      {data.unattributed.leads_count > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⚠️ <span className="font-semibold">{data.unattributed.leads_count} leads</span> sans source attribuée
          {' '}({data.unattributed.leads_pct ?? '—'} % du total · {data.unattributed.total_leads} leads cumulés)
          {' '}— à corriger côté pipeline d'ingestion.
        </div>
      )}

      {/* Champions / underperformers */}
      <TopBottom rows={data.rows} />

      {/* Table principale */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-700 mb-4">
          Détail par source — {data.rows.length} sources sur la période
        </h2>
        <DataTable columns={columns} data={data.rows} exportFilename="funnel-par-source" />
      </section>
    </div>
  )
}
