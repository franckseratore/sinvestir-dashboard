'use client'
import { useEffect, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { api, EmailData } from '@/lib/api'
import { DataTable } from '@/components/data-table'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { ChevronDown, ChevronUp } from 'lucide-react'

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
function fmt_date(s: string) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmt_date_short(s: string) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function statusColor(s: string) {
  if (s === 'green') return 'text-emerald-600'
  if (s === 'orange') return 'text-amber-600'
  if (s === 'red') return 'text-red-500'
  return 'text-zinc-600'
}
function statusDot(s: string) {
  if (s === 'green') return 'bg-emerald-500'
  if (s === 'orange') return 'bg-amber-400'
  if (s === 'red') return 'bg-red-500'
  return 'bg-zinc-300'
}

function KpiCard({ label, value, status, subtitle }: { label: string; value: string; status: string; subtitle?: string }) {
  return (
    <div className="bg-white rounded-xl border border-zinc-100 p-5 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${statusDot(status)}`} />
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${statusColor(status)}`}>{value}</div>
      {subtitle && <div className="text-xs text-zinc-400">{subtitle}</div>}
    </div>
  )
}

// ── Open rate trend (Recharts AreaChart sur 90 jours) ─────────────────────────
function ORTrendChart({ data }: { data: EmailData['chart_open_rate'] }) {
  if (!data || data.length === 0) return <div className="text-zinc-400 text-sm">Aucune donnée</div>

  const TARGET = 39  // cible 39 % (valeur directe en %)
  const SEUIL = 31   // seuil critique 31 %

  const chartData = data.map((d) => ({
    date: d.date,
    or: +(d.open_rate * 100).toFixed(1),
    name: d.name,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
        <XAxis
          dataKey="date"
          tickFormatter={fmt_date_short}
          tick={{ fontSize: 10, fill: '#71717a' }}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v) => v + ' %'}
          tick={{ fontSize: 10, fill: '#71717a' }}
          width={42}
          domain={[0, 'auto']}
        />
        <Tooltip
          formatter={(v: number, _: string, props: { payload?: { name: string } }) => [
            `${v} %`,
            props?.payload?.name ?? "Taux d'ouverture",
          ]}
          labelFormatter={fmt_date_short}
          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e4e4e7' }}
        />
        <ReferenceLine y={TARGET} stroke="#10B981" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: `Cible ${TARGET} %`, position: 'insideTopRight', fontSize: 10, fill: '#10B981' }} />
        <ReferenceLine y={SEUIL} stroke="#EF4444" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: `Seuil ${SEUIL} %`, position: 'insideTopRight', fontSize: 10, fill: '#EF4444' }} />
        <Area
          type="monotone"
          dataKey="or"
          name="Taux d'ouverture"
          stroke="#3B82F6"
          fill="#3B82F6"
          fillOpacity={0.08}
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Top / Bottom 3 campagnes ──────────────────────────────────────────────────
function CampaignRow({ c, rank }: { c: EmailData['campaigns'][number]; rank: 'top' | 'bottom' }) {
  const color = rank === 'top' ? 'text-emerald-600' : 'text-rose-500'
  const bg = rank === 'top' ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'
  return (
    <div className={`rounded-lg border px-4 py-3 flex items-center gap-4 ${bg}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-zinc-800 truncate">{c.name}</div>
        <div className="text-xs text-zinc-400 mt-0.5">{fmt_date(c.sdate)} · {fmt_n(c.send_amt)} envoyés</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className={`font-mono text-lg font-bold ${color}`}>{fmt_pct_direct(c.open_rate_pct)}</div>
        <div className="text-[10px] text-zinc-400">CTOR {fmt_pct_direct(c.ctor_pct)}</div>
      </div>
    </div>
  )
}

function TopBottomCampaigns({ campaigns }: { campaigns: EmailData['campaigns'] }) {
  if (!campaigns || campaigns.length === 0) return null
  const sorted = [...campaigns].sort((a, b) => b.open_rate_pct - a.open_rate_pct)
  const top3 = sorted.slice(0, 3)
  const bottom3 = sorted.slice(-3).reverse()

  return (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Top 3 campagnes</h3>
        <div className="space-y-2">
          {top3.map((c) => <CampaignRow key={c.name + c.sdate} c={c} rank="top" />)}
        </div>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Bottom 3 campagnes</h3>
        <div className="space-y-2">
          {bottom3.map((c) => <CampaignRow key={c.name + c.sdate} c={c} rank="bottom" />)}
        </div>
      </div>
    </div>
  )
}

// ── Tableau complet (masqué par défaut) ───────────────────────────────────────
type CampaignRow2 = EmailData['campaigns'][number]
const COLUMNS: ColumnDef<CampaignRow2, unknown>[] = [
  { accessorKey: 'sdate', header: 'Date', cell: (i) => fmt_date(String(i.getValue() ?? '')) },
  { accessorKey: 'name', header: 'Campagne' },
  { accessorKey: 'send_amt', header: 'Envoyés', cell: (i) => <span className="font-mono">{fmt_n(i.getValue() as number)}</span> },
  { accessorKey: 'uniqueopens', header: 'Ouvertures', cell: (i) => <span className="font-mono">{fmt_n(i.getValue() as number)}</span> },
  {
    accessorKey: 'open_rate_pct',
    header: "Taux d'ouverture",
    cell: (i) => {
      const v = i.getValue() as number
      const color = v >= 39 ? 'text-emerald-600' : v >= 31 ? 'text-amber-600' : 'text-red-500'
      return <span className={`font-mono font-semibold ${color}`}>{fmt_pct_direct(v)}</span>
    },
  },
  { accessorKey: 'ctr_pct', header: 'CTR', cell: (i) => <span className="font-mono">{fmt_pct_direct(i.getValue() as number)}</span> },
  { accessorKey: 'ctor_pct', header: 'CTOR', cell: (i) => <span className="font-mono">{fmt_pct_direct(i.getValue() as number)}</span> },
  { accessorKey: 'unsubscribes', header: 'Désinscrits', cell: (i) => <span className="font-mono">{fmt_n(i.getValue() as number)}</span> },
]

// ── Page ──────────────────────────────────────────────────────────────────────
export default function EmailPage() {
  const [data, setData] = useState<EmailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    api.email()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">Chargement…</div>
  if (error) return <div className="flex-1 flex items-center justify-center text-red-500 text-sm">{error}</div>
  if (!data) return null

  const { kpis } = data

  return (
    <div className="flex-1 overflow-auto bg-zinc-50 p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Email Marketing</h1>
        <p className="text-sm text-zinc-400 mt-0.5">ActiveCampaign — 30 derniers jours</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard label="Taux d'ouverture" value={fmt_pct(kpis.open_rate.value)} status={kpis.open_rate.status} subtitle="Moyenne pondérée" />
        <KpiCard label="CTOR" value={fmt_pct(kpis.ctor.value)} status={kpis.ctor.status} subtitle="Click-to-Open" />
        <KpiCard label="Taux désabo" value={fmt_pct(kpis.unsubscribe_rate.value)} status={kpis.unsubscribe_rate.status} subtitle="/ emails envoyés" />
        <KpiCard label="Désinscrits" value={fmt_n(kpis.unsubscribes.value)} status={kpis.unsubscribes.status} />
        <KpiCard label="Emails envoyés" value={fmt_n(kpis.total_sends.value)} status="unknown" />
        <KpiCard label="Campagnes" value={fmt_n(kpis.nb_campaigns.value)} status="unknown" subtitle="envoyées" />
      </div>

      {/* Tendance OR 90 jours */}
      <div className="bg-white rounded-xl border border-zinc-100 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-700 mb-1">Tendance taux d'ouverture — 90 jours</h2>
        <p className="text-xs text-zinc-400 mb-4">Par campagne. Lignes de référence : cible 39 % · seuil critique 31 %</p>
        <ORTrendChart data={data.chart_open_rate} />
      </div>

      {/* Top 3 / Bottom 3 */}
      <div className="bg-white rounded-xl border border-zinc-100 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-700 mb-4">Meilleures & moins bonnes campagnes</h2>
        <TopBottomCampaigns campaigns={data.campaigns} />
      </div>

      {/* Voir tout — toggle */}
      <div>
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-brand transition-colors"
        >
          {showAll ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {showAll ? 'Masquer le tableau complet' : `Voir toutes les campagnes (${data.campaigns.length})`}
        </button>

        {showAll && (
          <div className="mt-4 bg-white rounded-xl border border-zinc-100 p-5 shadow-sm">
            <DataTable
              data={data.campaigns}
              columns={COLUMNS}
              exportFilename="ac_campaigns"
            />
          </div>
        )}
      </div>
    </div>
  )
}
