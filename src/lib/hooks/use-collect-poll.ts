import { useState, useRef, useCallback } from 'react'

export interface JobLogResult {
  id: string
  marketplaceId: string | null
  connectionId: string | null
  status: string
  ordersCollected: number | null
  claimsCollected: number | null
  errorMessage: string | null
  progressMessage: string | null
  completedAt: string | null
}

interface UseCollectPollReturn {
  collecting: boolean
  logs: JobLogResult[] | null
  jobLogIds: string[]
  startCollect: (connectionIds: string[], options?: {
    manualLookbackDays?: number
    manualDateFrom?: string
    manualDateTo?: string
  }) => Promise<void>
  cancelCollect: () => Promise<void>
  clearResults: () => void
}

const POLL_INTERVAL = 1500

/**
 * Hook: POST /api/orders/collect → poll /api/orders/collect/status until all done.
 * Supports cancellation of pending jobs.
 */
export function useCollectPoll(): UseCollectPollReturn {
  const [collecting, setCollecting] = useState(false)
  const [logs, setLogs] = useState<JobLogResult[] | null>(null)
  const [jobLogIds, setJobLogIds] = useState<string[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clearResults = useCallback(() => {
    setLogs(null)
    setJobLogIds([])
    stopPolling()
  }, [stopPolling])

  const pollStatus = useCallback(
    (ids: string[]) => {
      const idsParam = ids.join(',')

      const poll = async () => {
        try {
          const res = await fetch(`/api/orders/collect/status?ids=${idsParam}`)
          if (!res.ok) return
          const data = await res.json()
          setLogs(data.logs)
          if (data.allDone) {
            stopPolling()
            setCollecting(false)
          }
        } catch {
          // network error — keep polling
        }
      }

      // First poll immediately
      poll()
      timerRef.current = setInterval(poll, POLL_INTERVAL)
    },
    [stopPolling]
  )

  const startCollect = useCallback(
    async (connectionIds: string[], options?: {
      manualLookbackDays?: number
      manualDateFrom?: string
      manualDateTo?: string
    }) => {
      setCollecting(true)
      setLogs(null)
      setJobLogIds([])
      stopPolling()

      try {
        const res = await fetch('/api/orders/collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionIds,
            manualLookbackDays: options?.manualLookbackDays,
            manualDateFrom: options?.manualDateFrom,
            manualDateTo: options?.manualDateTo,
          }),
        })
        const data = await res.json()

        if (!res.ok) {
          setLogs([
            {
              id: '__error__',
              marketplaceId: null,
              connectionId: null,
              status: 'failed',
              ordersCollected: null,
              claimsCollected: null,
              errorMessage: data.error || '주문 수집 요청 실패',
              progressMessage: null,
              completedAt: null,
            },
          ])
          setCollecting(false)
          return
        }

        setJobLogIds(data.jobLogIds)
        pollStatus(data.jobLogIds)
      } catch {
        setLogs([
          {
            id: '__error__',
            marketplaceId: null,
            connectionId: null,
            status: 'failed',
            ordersCollected: null,
            claimsCollected: null,
            errorMessage: '네트워크 오류',
            progressMessage: null,
            completedAt: null,
          },
        ])
        setCollecting(false)
      }
    },
    [pollStatus, stopPolling]
  )

  const cancelCollect = useCallback(async () => {
    if (jobLogIds.length === 0) return

    stopPolling()

    try {
      await fetch('/api/orders/collect/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobLogIds }),
      })
    } catch {
      // ignore cancel errors
    }

    // Final poll to get updated statuses
    try {
      const res = await fetch(
        `/api/orders/collect/status?ids=${jobLogIds.join(',')}`
      )
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs)
      }
    } catch {
      // ignore
    }

    setCollecting(false)
  }, [jobLogIds, stopPolling])

  return { collecting, logs, jobLogIds, startCollect, cancelCollect, clearResults }
}
