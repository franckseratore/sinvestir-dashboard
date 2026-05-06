'use client'
import { useStatus } from '@/hooks/use-status'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'

export function DriveStatusDot() {
  const status = useStatus()

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <RefreshCw size={12} className="animate-spin" />
        <span>Connexion...</span>
      </div>
    )
  }

  const isOk = status.status === 'ok'
  const lastRefresh = status.last_refresh
    ? format(new Date(status.last_refresh), 'HH:mm:ss', { locale: fr })
    : null

  return (
    <div className="space-y-1">
      <div className={cn('flex items-center gap-2 text-xs font-medium', isOk ? 'text-emerald-600' : 'text-rose-500')}>
        {isOk
          ? <CheckCircle2 size={12} />
          : <AlertCircle size={12} />
        }
        <span>{isOk ? 'Données à jour' : 'Erreur de données'}</span>
      </div>
      {lastRefresh && (
        <div className="text-[10px] text-zinc-400 pl-4">Actualisé à {lastRefresh}</div>
      )}
    </div>
  )
}

export function DriveStatusBanner() {
  const status = useStatus()
  if (!status || status.status === 'ok') return null

  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <AlertCircle size={16} className="flex-shrink-0" />
      <span>
        {status.status === 'error'
          ? 'Impossible de lire les fichiers source. Vérifie que les fichiers Excel sont accessibles.'
          : 'Initialisation en cours...'}
      </span>
    </div>
  )
}
