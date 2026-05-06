'use client'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { GlobalStatusData } from '@/lib/api'

const DOMAIN_META: Record<string, { label: string; href: string }> = {
  marketing: { label: 'Marketing', href: '/marketing' },
  sales:     { label: 'Sales',     href: '/sales' },
  ads:       { label: 'Ads',       href: '/ads' },
  email:     { label: 'Email',     href: '/email' },
}

interface DomainSummaryProps {
  domains: GlobalStatusData['domains']
}

export function DomainSummary({ domains }: DomainSummaryProps) {
  const ordered = ['marketing', 'sales', 'ads', 'email']

  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-700 mb-3">Statuts par domaine</h2>
      <div className="grid grid-cols-4 gap-4">
        {ordered.map((key) => {
          const stats = domains[key]
          const meta = DOMAIN_META[key]
          if (!meta) return null
          const worst =
            stats?.red ? 'red' :
            stats?.orange ? 'orange' :
            stats?.green ? 'green' : 'unknown'

          return (
            <Link
              key={key}
              href={meta.href}
              className={cn(
                'rounded-xl border bg-white p-5 flex flex-col gap-3 hover:shadow-sm transition-all duration-150 group',
                worst === 'red' ? 'border-rose-200' :
                worst === 'orange' ? 'border-amber-200' :
                worst === 'green' ? 'border-emerald-200' :
                'border-zinc-200',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 group-hover:text-brand transition-colors">
                  {meta.label}
                </span>
                <span className={cn(
                  'w-2.5 h-2.5 rounded-full',
                  worst === 'red' ? 'bg-rose-500' :
                  worst === 'orange' ? 'bg-amber-400' :
                  worst === 'green' ? 'bg-emerald-500' :
                  'bg-zinc-300',
                )} />
              </div>

              <div className="flex items-center gap-3 text-xs">
                {stats?.red > 0 && (
                  <span className="flex items-center gap-1 font-medium text-rose-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    {stats.red} critique{stats.red > 1 ? 's' : ''}
                  </span>
                )}
                {stats?.orange > 0 && (
                  <span className="flex items-center gap-1 font-medium text-amber-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    {stats.orange} alerte{stats.orange > 1 ? 's' : ''}
                  </span>
                )}
                {stats?.green > 0 && (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {stats.green} OK
                  </span>
                )}
                {!stats && <span className="text-zinc-300">—</span>}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
