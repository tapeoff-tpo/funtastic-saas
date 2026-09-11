'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const SESSION_KEY = 'funtastic-purchase-order-retention-cleanup-v1'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

/** Runs only after the page really mounts, never during a prefetched GET render. */
export function PurchaseOrderRetentionCleanup() {
  const router = useRouter()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const lastCheckedAt = Number(window.sessionStorage.getItem(SESSION_KEY) ?? 0)
    if (Date.now() - lastCheckedAt < CHECK_INTERVAL_MS) return
    window.sessionStorage.setItem(SESSION_KEY, String(Date.now()))

    let cancelled = false
    void fetch('/api/purchasing/purchase-orders/retention-cleanup', {
      method: 'POST',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('retention cleanup failed')
        return response.json() as Promise<{ deletedCount?: number }>
      })
      .then((result) => {
        if (!cancelled && (result.deletedCount ?? 0) > 0) router.refresh()
      })
      .catch(() => window.sessionStorage.removeItem(SESSION_KEY))

    return () => {
      cancelled = true
    }
  }, [router])

  return null
}
