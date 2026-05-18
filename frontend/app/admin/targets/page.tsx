'use client'
import { useEffect, useState } from 'react'
import { api, TargetRow } from '@/lib/api'
import { formatValue } from '@/lib/format'

function fmt(v: number, unite: string) {
  if (unite === '%') return (v * 100).toFixed(1) + ' %'
  if (unite === '€') return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
  return v.toLocaleString('fr-FR')
}

function EditableCell({
  value,
  onSave,
  unite,
}: {
  value: number
  onSave: (v: number) => void
  unite: string
}) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState(String(unite === '%' ? +(value * 100).toFixed(4) : value))

  function commit() {
    const parsed = parseFloat(raw.replace(',', '.'))
    if (!isNaN(parsed)) {
      const final = unite === '%' ? parsed / 100 : parsed
      onSave(final)
    }
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setRaw(String(unite === '%' ? +(value * 100).toFixed(4) : value)); setEditing(true) }}
        className="font-mono text-right hover:underline hover:text-brand cursor-pointer tabular-nums"
      >
        {fmt(value, unite)}
      </button>
    )
  }
  return (
    <input
      autoFocus
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      className="w-28 rounded border border-brand px-1.5 py-0.5 font-mono text-sm text-right outline-none focus:ring-1 focus:ring-brand"
    />
  )
}

export default function TargetsPage() {
  const [rows, setRows] = useState<TargetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<Record<string, true>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')

  async function handleRefresh() {
    setRefreshing(true)
    setRefreshMsg('')
    try {
      const res = await fetch('/api/proxy/api/admin/refresh', { method: 'POST' })
      const data = await res.json()
      setRefreshMsg(data.ok ? 'Données rechargées ✓' : `Erreur : ${data.error}`)
    } catch {
      setRefreshMsg('Erreur de connexion')
    } finally {
      setRefreshing(false)
      setTimeout(() => setRefreshMsg(''), 3000)
    }
  }

  useEffect(() => {
    api.adminTargets().then((data) => { setRows(data); setLoading(false) })
  }, [])

  async function handleSave(indicateur: string, field: 'target_mensuelle' | 'seuil_critique', value: number) {
    setSaving(indicateur)
    setRows((prev) => prev.map((r) => r.indicateur === indicateur ? { ...r, [field]: value } : r))
    await api.updateTarget(indicateur, { [field]: value })
    setSaving(null)
    setSaved((prev) => ({ ...prev, [indicateur]: true }))
    setTimeout(() => setSaved((prev) => { const next = { ...prev }; delete next[indicateur]; return next }), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">Chargement…</div>
    )
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand">Targets & Seuils</h1>
          <p className="text-sm text-zinc-500 mt-1">Cliquer sur une valeur pour la modifier. Entrée ou clic hors champ pour sauvegarder.</p>
        </div>
        <div className="flex items-center gap-3">
          {refreshMsg && <span className="text-xs text-emerald-600">{refreshMsg}</span>}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            {refreshing ? 'Rechargement…' : '↻ Forcer la mise à jour'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">KPI</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Description</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">Sens</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Cible mensuelle</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Seuil critique</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">Pro-rata</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Owner</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
            {rows.map((row) => (
              <tr key={row.indicateur} className="hover:bg-zinc-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-zinc-600">{row.indicateur}</td>
                <td className="px-4 py-3 text-zinc-700">{row.description}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.sens === 'Haut' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {row.sens === 'Haut' ? '↑' : '↓'} {row.sens}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <EditableCell
                    value={row.target_mensuelle}
                    unite={row.unite}
                    onSave={(v) => handleSave(row.indicateur, 'target_mensuelle', v)}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <EditableCell
                    value={row.seuil_critique}
                    unite={row.unite}
                    onSave={(v) => handleSave(row.indicateur, 'seuil_critique', v)}
                  />
                </td>
                <td className="px-4 py-3 text-center text-zinc-400 text-xs">{row.prorata ? 'Oui' : 'Non'}</td>
                <td className="px-4 py-3 text-zinc-500 text-xs">{row.owner || '—'}</td>
                <td className="px-4 py-3 text-center text-xs">
                  {saving === row.indicateur && <span className="text-zinc-400">…</span>}
                  {saved[row.indicateur] && <span className="text-emerald-600 font-medium">✓</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
