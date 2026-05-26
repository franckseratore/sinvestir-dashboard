'use client'
import { Fragment, useMemo, useState } from 'react'
import { useQueryState } from 'nuqs'
import { useApi } from '@/hooks/use-api'
import { api, type SalesData } from '@/lib/api'
import { KpiCard } from '@/components/kpi-card'
import { KpiLegend } from '@/components/kpi-legend'
import { PeriodSelector } from '@/components/period-selector'
import { DriveStatusBanner } from '@/components/drive-status-bar'
import { DataTable } from '@/components/data-table'
import { formatCurrencyFull, formatNumber } from '@/lib/format'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'

type ProduitRow = SalesData['produits'][number]
type CanalRow = SalesData['closing_by_canal'][number]
type CanalDetailRow = SalesData['closing_by_canal_detail'][number]

const closerColumns: ColumnDef<SalesData['closers'][number], unknown>[] = [
  { accessorKey: 'closer', header: 'Closer', cell: (i) => <span className="font-mono text-xs">{String(i.getValue())}</span> },
  { accessorKey: 'calls', header: 'Calls', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  { accessorKey: 'ventes', header: 'Ventes', cell: (i) => <span className="font-mono">{formatNumber(i.getValue() as number)}</span> },
  {
    accessorKey: 'closing_rate',
    header: 'Closing brut %',
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

function CaBreakdownCard({ data }: { data: SalesData['ca_lbd_app'] }) {
  // Réconcilie : LBD + APP = CA total à l'écart près. Si écart > 0, des ventes
  // sont hors-périmètre (autres produits, hors-LBD/APP) → flagué pour audit.
  const ecartAbs = Math.abs(data.ecart)
  const ecartPct = data.total_ca > 0 ? (ecartAbs / data.total_ca) * 100 : 0
  const hasGap = ecartAbs > 0.5 // tolérance arrondis
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-semibold text-zinc-700">CA HT — LBD vs APP</h2>
        <span className="text-[11px] text-zinc-400">Réconciliation produits</span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">CA total HT</div>
          <div className="font-mono text-2xl font-semibold text-brand">{formatCurrencyFull(data.total_ca)}</div>
          <div className="text-xs text-zinc-500 mt-1">{formatNumber(data.total_ventes)} ventes</div>
        </div>
        <div className="rounded-lg border border-zinc-100 p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">LBD</div>
          <div className="font-mono text-2xl font-semibold text-brand">{formatCurrencyFull(data.lbd.ca)}</div>
          <div className="text-xs text-zinc-500 mt-1">{formatNumber(data.lbd.ventes)} ventes</div>
        </div>
        <div className="rounded-lg border border-zinc-100 p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">APP (S&apos;investir Conseil)</div>
          <div className="font-mono text-2xl font-semibold text-brand">{formatCurrencyFull(data.app.ca)}</div>
          <div className="text-xs text-zinc-500 mt-1">{formatNumber(data.app.ventes)} ventes</div>
        </div>
      </div>
      {hasGap && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-medium">⚠ Écart hors-périmètre :</span>
          <span className="font-mono">{formatCurrencyFull(data.ecart)}</span>
          <span className="text-amber-700">({ecartPct.toFixed(1).replace('.', ',')} % du CA)</span>
          <span className="text-amber-700">·</span>
          <span>{formatNumber(data.autres.ventes)} vente{data.autres.ventes > 1 ? 's' : ''} sur produits hors LBD/APP</span>
        </div>
      )}
    </section>
  )
}

function ProduitsTable({ rows }: { rows: ProduitRow[] }) {
  // Agrège LBD en une ligne dépliable (variantes natives en sous-niveau pour audit).
  // APP et autres restent affichés à plat : pas de regroupement demandé.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const display = useMemo(() => {
    const lbdVariants = rows.filter((r) => r.group === 'LBD')
    const others = rows.filter((r) => r.group !== 'LBD')
    const groups: Array<{ key: string; isGroup: boolean; row: ProduitRow; subRows: ProduitRow[] }> = []
    if (lbdVariants.length > 0) {
      const ca = lbdVariants.reduce((acc, r) => acc + r.ca, 0)
      const ventes = lbdVariants.reduce((acc, r) => acc + r.ventes, 0)
      groups.push({
        key: '__LBD__',
        isGroup: true,
        row: {
          produit: 'LBD — Total',
          group: 'LBD',
          ventes,
          ca: Math.round(ca * 100) / 100,
          acv: ventes ? Math.round((ca / ventes) * 100) / 100 : null,
        },
        subRows: [...lbdVariants].sort((a, b) => b.ca - a.ca),
      })
    }
    for (const r of others) groups.push({ key: r.produit ?? '(inconnu)', isGroup: false, row: r, subRows: [] })
    return groups.sort((a, b) => b.row.ca - a.row.ca)
  }, [rows])

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            <th className="px-4 py-3 text-left">Produit</th>
            <th className="px-4 py-3 text-left">Ventes</th>
            <th className="px-4 py-3 text-left">CA HT</th>
            <th className="px-4 py-3 text-left">ACV</th>
          </tr>
        </thead>
        <tbody>
          {display.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-zinc-400">Aucune vente sur cette période</td></tr>
          )}
          {display.map((g, i) => {
            const open = !!expanded[g.key]
            const stripe = i % 2 === 1 ? 'bg-zinc-50/50' : ''
            return (
              <Fragment key={g.key}>
                <tr
                  className={`border-b border-zinc-50 hover:bg-zinc-50 transition-colors ${stripe} ${g.isGroup ? 'cursor-pointer' : ''}`}
                  onClick={() => g.isGroup && setExpanded((s) => ({ ...s, [g.key]: !s[g.key] }))}
                >
                  <td className="px-4 py-3 text-zinc-700">
                    <span className="inline-flex items-center gap-1.5">
                      {g.isGroup && (open ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />)}
                      <span className={g.isGroup ? 'font-semibold' : ''}>{g.row.produit ?? '(inconnu)'}</span>
                      {g.isGroup && <span className="text-[10px] text-zinc-400">({g.subRows.length} variantes)</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-700 font-mono">{formatNumber(g.row.ventes)}</td>
                  <td className="px-4 py-3 text-zinc-700 font-mono font-medium">{formatCurrencyFull(g.row.ca)}</td>
                  <td className="px-4 py-3 text-zinc-700 font-mono">{g.row.acv != null ? formatCurrencyFull(g.row.acv) : '—'}</td>
                </tr>
                {g.isGroup && open && g.subRows.map((sub) => (
                  <tr key={`${g.key}__${sub.produit}`} className="border-b border-zinc-50 bg-zinc-50/30">
                    <td className="px-4 py-2 pl-10 text-zinc-600 text-xs">{sub.produit ?? '(inconnu)'}</td>
                    <td className="px-4 py-2 text-zinc-600 font-mono text-xs">{formatNumber(sub.ventes)}</td>
                    <td className="px-4 py-2 text-zinc-600 font-mono text-xs">{formatCurrencyFull(sub.ca)}</td>
                    <td className="px-4 py-2 text-zinc-600 font-mono text-xs">{sub.acv != null ? formatCurrencyFull(sub.acv) : '—'}</td>
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ClosingRateByCanalTable({ rows, detail }: { rows: CanalRow[]; detail: CanalDetailRow[] }) {
  // Affichage hiérarchique : ligne canal agrégée + sous_canal dépliable.
  // Le brief demande "descendre d'un cran sous le canal principal".
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const byCanal = useMemo(() => {
    const map: Record<string, CanalDetailRow[]> = {}
    for (const r of detail) {
      const k = r.canal ?? 'Inconnu'
      if (!map[k]) map[k] = []
      map[k].push(r)
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => b.ca - a.ca)
    return map
  }, [detail])

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            <th className="px-4 py-3 text-left">Canal</th>
            <th className="px-4 py-3 text-left">Calls passés</th>
            <th className="px-4 py-3 text-left">Ventes</th>
            <th className="px-4 py-3 text-left">Closing brut %</th>
            <th className="px-4 py-3 text-left">CA HT</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-400">Aucune donnée sur cette période</td></tr>
          )}
          {rows.map((r, i) => {
            const k = r.canal ?? 'Inconnu'
            const subRows = byCanal[k] ?? []
            const hasDetail = subRows.length > 0
            const open = !!expanded[k]
            const stripe = i % 2 === 1 ? 'bg-zinc-50/50' : ''
            return (
              <Fragment key={k}>
                <tr
                  className={`border-b border-zinc-50 hover:bg-zinc-50 transition-colors ${stripe} ${hasDetail ? 'cursor-pointer' : ''}`}
                  onClick={() => hasDetail && setExpanded((s) => ({ ...s, [k]: !s[k] }))}
                >
                  <td className="px-4 py-3 text-zinc-700">
                    <span className="inline-flex items-center gap-1.5">
                      {hasDetail && (open ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />)}
                      <span className="font-semibold">{k}</span>
                      {hasDetail && <span className="text-[10px] text-zinc-400">({subRows.length} sous-canaux)</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-700 font-mono">{formatNumber(r.calls)}</td>
                  <td className="px-4 py-3 text-zinc-700 font-mono">{formatNumber(r.ventes)}</td>
                  <td className="px-4 py-3 text-zinc-700">
                    {r.closing_rate == null ? <span className="text-zinc-400">—</span> : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-mono">{r.closing_rate.toFixed(1).replace('.', ',')} %</span>
                        {r.data_inconsistent && <InconsistentBadge />}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 font-mono font-medium">{formatCurrencyFull(r.ca)}</td>
                </tr>
                {hasDetail && open && subRows.map((sub) => (
                  <tr key={`${k}__${sub.sous_canal}`} className="border-b border-zinc-50 bg-zinc-50/30">
                    <td className="px-4 py-2 pl-10 text-zinc-600 text-xs">{sub.sous_canal || '(inconnu)'}</td>
                    <td className="px-4 py-2 text-zinc-600 font-mono text-xs">{formatNumber(sub.calls)}</td>
                    <td className="px-4 py-2 text-zinc-600 font-mono text-xs">{formatNumber(sub.ventes)}</td>
                    <td className="px-4 py-2 text-zinc-600 text-xs">
                      {sub.closing_rate == null ? <span className="text-zinc-400">—</span> : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-mono">{sub.closing_rate.toFixed(1).replace('.', ',')} %</span>
                          {sub.data_inconsistent && <InconsistentBadge />}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-zinc-600 font-mono text-xs">{formatCurrencyFull(sub.ca)}</td>
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function InconsistentBadge() {
  return (
    <span
      title="Données incohérentes : plus de ventes que de calls passés sur ce canal dans la période. Closing plafonné à 100 %."
      className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200"
    >
      ⚠ incohérent
    </span>
  )
}

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

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand">Sales</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{data.period.label}</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            Source : Google Sheets <span className="text-zinc-500 font-medium">(officiel)</span> — refresh quotidien 06h Paris · Tous les montants en HT
          </p>
        </div>
        <PeriodSelector />
      </div>

      <DriveStatusBanner />

      <KpiLegend />

      {/* Bloc CA décomposé LBD vs APP */}
      <CaBreakdownCard data={data.ca_lbd_app} />

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard title="CA HT" data={data.kpis.ca_ht} tooltip="CA total hors taxes généré sur la période — Source : onglet VENTES" />
        <KpiCard title="Ventes" data={data.kpis.ventes_count} tooltip="Nombre de contrats signés sur la période (CA > 0)" />
        <KpiCard title="CA par call" data={data.kpis.ca_per_call} tooltip="CA HT ÷ Calls passés — valeur moyenne générée par chaque appel de vente effectué" />
        <KpiCard title="Closing rate brut" data={data.kpis.closing_rate} tooltip="Ventes ÷ Calls passés (is_past=TRUE) — taux de conversion brut sur les calls effectivement tenus" />
        <KpiCard title="No-show rate" data={data.kpis.no_show_rate} sens="Bas" tooltip="Calls sans créneau confirmé ÷ Calls éligibles (créneaux passés ou sans date_call)" />
        <KpiCard title="Panier moyen (ACV)" data={data.kpis.acv} tooltip="CA HT ÷ Nombre de ventes — valeur moyenne d'un contrat signé" />
        <KpiCard title="Calls réservés" data={data.kpis.calls_booked} tooltip="Nombre de calls dont la date de réservation est dans la période sélectionnée" />
        <KpiCard title="Calls passés" data={data.kpis.calls_completed} tooltip="Calls réservés dont l'heure Calendly est dépassée (is_past = true)" />
        <KpiCard title="Taux d'annulation (iClosed)" data={data.kpis.cancellation_rate} sens="Bas" tooltip="Source iClosed : outcome = 'CANCELLED' ÷ calls avec outcome renseigné" />
        <KpiCard title="Taux de disqualification (iClosed)" data={data.kpis.disqualification_rate} sens="Bas" tooltip="Source iClosed : outcome = 'DISQUALIFIED' ÷ calls avec outcome renseigné" />
      </div>

      {/* Closing rate par closer — table */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-700 mb-4">Performance par closer</h2>
        <DataTable columns={closerColumns} data={data.closers} exportFilename="performance-closers" />
      </section>

      {/* Produits + Canal côte à côte */}
      <div className="grid grid-cols-2 gap-6">
        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">Ventes par produit</h2>
          <ProduitsTable rows={data.produits} />
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">Closing rate brut par canal</h2>
          <ClosingRateByCanalTable rows={data.closing_by_canal} detail={data.closing_by_canal_detail} />
          {(() => {
            const horsCall = data.closing_by_canal.reduce((acc, r) => acc + (r.ventes_hors_call ?? 0), 0)
            const canauxCount = data.closing_by_canal.filter((r) => (r.ventes_hors_call ?? 0) > 0).length
            if (horsCall === 0) return null
            return (
              <p className="mt-3 text-xs text-zinc-500">
                <span className="font-medium text-zinc-600">{formatNumber(horsCall)}</span>{' '}
                vente{horsCall > 1 ? 's' : ''} hors-call sur la période
                {canauxCount > 1 ? ` (réparties sur ${canauxCount} canaux)` : ''}{' '}
                — ventes attribuées à un canal sans call passé correspondant. Closing affiché plafonné à 100 %.
              </p>
            )
          })()}
        </section>
      </div>
    </div>
  )
}
