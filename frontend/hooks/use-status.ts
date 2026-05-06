'use client'
import { useEffect, useState } from 'react'
import { api, type StatusData } from '@/lib/api'

export function useStatus() {
  const [status, setStatus] = useState<StatusData | null>(null)

  useEffect(() => {
    const poll = () => {
      api.status().then(setStatus).catch(() => {
        setStatus({ last_refresh: null, last_modified_files: [], status: 'error', drive_sync_ok: false })
      })
    }
    poll()
    const id = setInterval(poll, 10_000)
    return () => clearInterval(id)
  }, [])

  return status
}
