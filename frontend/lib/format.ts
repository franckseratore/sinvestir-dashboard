const FR = new Intl.NumberFormat('fr-FR')
const FR_DEC = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatCurrency(v: number | null | undefined): string {
  if (v == null) return '—'
  const abs = Math.abs(v)
  const formatted = abs >= 1_000_000
    ? (v / 1_000_000).toFixed(2).replace('.', ',') + ' M€'
    : FR.format(Math.round(v)) + ' €'
  return formatted
}

export function formatCurrencyFull(v: number | null | undefined): string {
  if (v == null) return '—'
  return FR.format(Math.round(v)) + ' €'
}

export function formatPercent(v: number | null | undefined, isDecimal = true): string {
  if (v == null) return '—'
  const pct = isDecimal ? v * 100 : v
  return pct.toFixed(1).replace('.', ',') + ' %'
}

export function formatNumber(v: number | null | undefined): string {
  if (v == null) return '—'
  return FR.format(Math.round(v))
}

export function formatMultiple(v: number | null | undefined): string {
  if (v == null) return '—'
  return FR_DEC.format(v) + 'x'
}

export function formatValue(v: number | null | undefined, fmt: string): string {
  if (v == null) return '—'
  if (fmt === 'currency') return formatCurrency(v)
  if (fmt === 'percent') return formatPercent(v)
  if (fmt === 'multiple') return formatMultiple(v)
  return formatNumber(v)
}

export function formatDelta(delta: number | null, delta_pct: number | null): string {
  if (delta_pct != null) return (delta_pct > 0 ? '+' : '') + delta_pct.toFixed(1).replace('.', ',') + ' %'
  if (delta != null) return (delta > 0 ? '+' : '') + FR.format(Math.round(Math.abs(delta)))
  return '—'
}
