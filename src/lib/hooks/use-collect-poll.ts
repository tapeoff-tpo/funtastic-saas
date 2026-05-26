import { useState, useRef, useCallback } from 'react'

export interface JobLogResult {
  id: string
  marketplaceId: string | null
  connectionId: string | null
  jobType?: string | null
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
const MAX_POLL_DURATION = 8 * 60 * 1000
const POLL_TIMEOUT_MESSAGE = 'RPA 작업이 제한시간 안에 끝나지 않았습니다. 다시 시도해주세요.'

function formatActiveCollectionError(error: string, activeJob: unknown): string {
  if (!activeJob || typeof activeJob !== 'object') return error
  const job = activeJob as {
    jobType?: string | null
    marketplaceId?: string | null
    status?: string | null
    progressMessage?: string | null
  }
  const parts = [
    job.marketplaceId ? `마켓=${job.marketplaceId}` : null,
    job.jobType ? `작업=${job.jobType}` : null,
    job.status ? `상태=${job.status}` : null,
    job.progressMessage ? `마지막 단계=${job.progressMessage}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? `${error} (${parts.join(', ')})` : error
}

/**
 * Hook: POST /api/orders/collect → poll /api/orders/collect/status until all done.
 * Supports cancellation of pending jobs.
 */
export function useCollectPoll(): UseCollectPollReturn {
  const [collecting, setCollecting] = useState(false)
  const [logs, setLogs] = useState<JobLogResult[] | null>(null)
  const [jobLogIds, setJobLogIds] = useState<string[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartedAtRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    pollStartedAtRef.current = null
  }, [])

  const clearResults = useCallback(() => {
    setCollecting(false)
    setLogs(null)
    setJobLogIds([])
    stopPolling()
  }, [stopPolling])

  const pollStatus = useCallback(
    (ids: string[]) => {
      const idsParam = ids.join(',')
      pollStartedAtRef.current = Date.now()

      const failTimedOutPoll = () => {
        stopPolling()
        setCollecting(false)
        setLogs((currentLogs) => {
          if (currentLogs?.length) {
            return currentLogs.map((log) =>
              log.status === 'queued' || log.status === 'running'
                ? {
                    ...log,
                    status: 'failed',
                    errorMessage: log.errorMessage || POLL_TIMEOUT_MESSAGE,
                    completedAt: new Date().toISOString(),
                  }
                : log,
            )
          }

          return ids.map((id) => ({
            id,
            marketplaceId: null,
            connectionId: null,
            status: 'failed',
            ordersCollected: null,
            claimsCollected: null,
            errorMessage: POLL_TIMEOUT_MESSAGE,
            progressMessage: null,
            completedAt: new Date().toISOString(),
          }))
        })
      }

      const poll = async () => {
        if (pollStartedAtRef.current && Date.now() - pollStartedAtRef.current > MAX_POLL_DURATION) {
          failTimedOutPoll()
          return
        }

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
          const activeJob = data.activeJob && typeof data.activeJob === 'object'
            ? data.activeJob as {
                id?: string | null
                marketplaceId?: string | null
                connectionId?: string | null
                jobType?: string | null
                status?: string | null
                progressMessage?: string | null
              }
            : null
          const activeJobId = typeof activeJob?.id === 'string' ? activeJob.id : null
          const activeJobStatus = activeJob?.status === 'queued' || activeJob?.status === 'running'
            ? activeJob.status
            : null

          if (activeJobId && activeJobStatus) {
            const activeMessage = formatActiveCollectionError(data.error || '주문 수집 요청 실패', activeJob)
            setJobLogIds([activeJobId])
            setLogs([
              {
                id: activeJobId,
                marketplaceId: activeJob.marketplaceId ?? null,
                connectionId: activeJob.connectionId ?? null,
                jobType: activeJob.jobType ?? null,
                status: activeJobStatus,
                ordersCollected: null,
                claimsCollected: null,
                errorMessage: activeMessage,
                progressMessage: activeJob.progressMessage ?? activeMessage,
                completedAt: null,
              },
            ])
            pollStatus([activeJobId])
            return
          }

          setLogs([
            {
              id: '__error__',
              marketplaceId: data.activeJob?.marketplaceId ?? null,
              connectionId: data.activeJob?.connectionId ?? null,
              jobType: data.activeJob?.jobType ?? null,
              status: 'failed',
              ordersCollected: null,
              claimsCollected: null,
              errorMessage: formatActiveCollectionError(data.error || '주문 수집 요청 실패', data.activeJob),
              progressMessage: data.activeJob?.progressMessage ?? null,
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
