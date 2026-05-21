'use client'

import { useCallback, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { JobLogResult } from '@/lib/hooks/use-collect-poll'

const POLL_INTERVAL = 1500

export function CsCollectPanel() {
  const [collecting, setCollecting] = useState(false)
  const [logs, setLogs] = useState<JobLogResult[] | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const pollStatus = useCallback((ids: string[]) => {
    const idsParam = ids.join(',')
    const poll = async () => {
      const res = await fetch(`/api/cs/collect/status?ids=${idsParam}`)
      if (!res.ok) return
      const data = await res.json()
      setLogs(data.logs)
      if (data.allDone) {
        stopPolling()
        setCollecting(false)
      }
    }

    poll()
    timerRef.current = setInterval(poll, POLL_INTERVAL)
  }, [stopPolling])

  const startCollect = async () => {
    setCollecting(true)
    setLogs(null)
    stopPolling()

    try {
      const res = await fetch('/api/cs/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackDays: 7 }),
      })
      const data = await res.json()

      if (!res.ok) {
        setLogs([{
          id: '__error__',
          marketplaceId: null,
          connectionId: null,
          status: 'failed',
          ordersCollected: null,
          claimsCollected: null,
          errorMessage: data.error || 'CS 수집 요청 실패',
          progressMessage: null,
          completedAt: null,
        }])
        setCollecting(false)
        return
      }

      pollStatus(data.jobLogIds)
    } catch {
      setLogs([{
        id: '__error__',
        marketplaceId: null,
        connectionId: null,
        status: 'failed',
        ordersCollected: null,
        claimsCollected: null,
        errorMessage: '네트워크 오류',
        progressMessage: null,
        completedAt: null,
      }])
      setCollecting(false)
    }
  }

  const totalCollected = logs?.reduce((sum, log) => sum + (log.claimsCollected ?? 0), 0) ?? 0
  const allDone = Boolean(logs?.length) && logs.every((log) => ['completed', 'failed', 'cancelled'].includes(log.status))

  return (
    <section className="rounded-md border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">CS 수집</h2>
        <button
          type="button"
          onClick={startCollect}
          disabled={collecting}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          <RefreshCw className={`h-4 w-4 ${collecting ? 'animate-spin' : ''}`} />
          {collecting ? '수집 중...' : 'CS 수집'}
        </button>
      </div>

      {logs && (
        <div className="divide-y">
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="font-medium text-gray-700">{allDone ? '수집 결과' : '수집 진행 중...'}</span>
            <span className="text-gray-500">총 {totalCollected.toLocaleString('ko-KR')}건</span>
          </div>
          {logs.map((log) => (
            <div key={log.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[160px_1fr_auto]">
              <span className="font-medium text-gray-800">{log.marketplaceId ?? 'CS'}</span>
              <span className={log.status === 'failed' ? 'text-red-600' : 'text-gray-600'}>
                {log.errorMessage ?? log.progressMessage ?? (log.status === 'completed' ? '완료' : '대기 중')}
              </span>
              <span className="text-right font-semibold tabular-nums text-gray-900">
                {(log.claimsCollected ?? 0).toLocaleString('ko-KR')}건
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
