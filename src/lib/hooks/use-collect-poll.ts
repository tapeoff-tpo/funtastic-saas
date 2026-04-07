import { useState, useRef, useCallback } from 'react'

export interface JobLogResult {
  id: string
  marketplaceId: string | null
  status: string
  ordersCollected: number | null
  claimsCollected: number | null
  errorMessage: string | null
  completedAt: string | null
}

interface UseCollectPollReturn {
  collecting: boolean
  logs: JobLogResult[] | null
  startCollect: (marketplaceIds: string[]) => Promise<void>
  clearResults: () => void
}

const POLL_INTERVAL = 1500

/**
 * Hook: POST /api/orders/collect → poll /api/orders/collect/status until all done.
 */
export function useCollectPoll(): UseCollectPollReturn {
  const [collecting, setCollecting] = useState(false)
  const [logs, setLogs] = useState<JobLogResult[] | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clearResults = useCallback(() => {
    setLogs(null)
    stopPolling()
  }, [stopPolling])

  const pollStatus = useCallback(
    (jobLogIds: string[]) => {
      const idsParam = jobLogIds.join(',')

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
    async (marketplaceIds: string[]) => {
      setCollecting(true)
      setLogs(null)
      stopPolling()

      try {
        const res = await fetch('/api/orders/collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketplaceIds }),
        })
        const data = await res.json()

        if (!res.ok) {
          setLogs([
            {
              id: '__error__',
              marketplaceId: null,
              status: 'failed',
              ordersCollected: null,
              claimsCollected: null,
              errorMessage: data.error || '주문 수집 요청 실패',
              completedAt: null,
            },
          ])
          setCollecting(false)
          return
        }

        // Start polling for results
        pollStatus(data.jobLogIds)
      } catch {
        setLogs([
          {
            id: '__error__',
            marketplaceId: null,
            status: 'failed',
            ordersCollected: null,
            claimsCollected: null,
            errorMessage: '네트워크 오류',
            completedAt: null,
          },
        ])
        setCollecting(false)
      }
    },
    [pollStatus, stopPolling]
  )

  return { collecting, logs, startCollect, clearResults }
}
