'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { BarChart3, TrendingUp, Users, Megaphone, LayoutDashboard, Mail, PhoneCall, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DriveStatusDot } from './drive-status-bar'
import { Suspense } from 'react'

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/marketing', label: 'Marketing', icon: TrendingUp },
  { href: '/sales', label: 'Sales', icon: Users },
  { href: '/ads', label: 'Ads', icon: Megaphone },
  { href: '/email', label: 'Email', icon: Mail },
  { href: '/iclosed', label: 'Sales Live', icon: PhoneCall },
  { href: '/admin/targets', label: 'Targets', icon: Settings2 },
]

function NavLinks() {
  const pathname = usePathname()
  const params = useSearchParams()

  return (
    <nav className="flex-1 px-3 py-4 space-y-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href
        const qs = params.toString()
        const to = qs ? `${href}?${qs}` : href
        return (
          <Link
            key={href}
            href={to}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
              isActive
                ? 'bg-brand text-white'
                : 'text-zinc-500 hover:text-brand hover:bg-zinc-100'
            )}
          >
            <Icon size={16} className={isActive ? 'text-white' : 'text-zinc-400'} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-zinc-200 flex flex-col h-full">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-zinc-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center">
            <BarChart3 size={14} className="text-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold text-brand leading-none">S'investir</div>
            <div className="text-[10px] text-zinc-400 mt-0.5 uppercase tracking-wide">Dashboard</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <Suspense fallback={<div className="flex-1 p-3" />}>
        <NavLinks />
      </Suspense>

      {/* Bottom: Drive status */}
      <div className="px-4 py-4 border-t border-zinc-100">
        <DriveStatusDot />
      </div>
    </aside>
  )
}
