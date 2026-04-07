'use client'

import { useCollectPoll, type JobLogResult } from '@/lib/hooks/use-collect-poll'

interface Connection {
  marketplaceId: string
  displayName: string
  status: string
}

interface CollectOrdersPanelProps {
  connections: Connection[]
}

export function CollectOrdersPanel({ connections }: CollectOrdersPanelProps) {
  const { collecting, logs, startCollect, cancelCollect, clearResults } = useCollectPoll()

  const connectedMarkets = connections.filter((c) => c.status !== 'disconnected')

  const handleCollectAll = () => {
    if (connectedMarkets.length === 0) return
    startCollect(connectedMarkets.map((c) => c.marketplaceId))
  }

  if (connectedMarkets.length === 0) return null

  const nameMap = Object.fromEntries(
    connections.map((c) => [c.marketplaceId, c.displayName])
  )

  const enrichedLogs = logs?.map((l) => ({
    ...l,
    displayName: l.marketplaceId ? (nameMap[l.marketplaceId] ?? l.marketplaceId) : '오류',
  }))

  const allDone = enrichedLogs && enrichedLogs.every(
    (l) => l.status === 'completed' || l.status === 'failed' || l.status === 'cancelled'
  )
  const showModal = enrichedLogs && enrichedLogs.length > 0

  const totalOrders = enrichedLogs?.reduce((sum, r) => sum + (r.ordersCollected ?? 0), 0) ?? 0
  const totalClaims = enrichedLogs?.reduce((sum, r) => sum + (r.claimsCollected ?? 0), 0) ?? 0
  const successCount = enrichedLogs?.filter((r) => r.status === 'completed').length ?? 0
  const failCount = enrichedLogs?.filter((r) => r.status === 'failed').length ?? 0
  const cancelledCount = enrichedLogs?.filter((r) => r.status === 'cancelled').length ?? 0

  return (
    <>
      <button
        onClick={handleCollectAll}
        disabled={collecting}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {collecting ? (
          <span className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
            수집 중...
          </span>
        ) : (
          `전체 수집 (${connectedMarkets.length}개)`
        )}
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border bg-background shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-base font-semibold">
                {allDone ? '전체 수집 결과' : '수집 진행 중...'}
              </h2>
              <div className="flex items-center gap-2">
                {!allDone && (
                  <button
                    onClick={cancelCollect}
                    className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    중지
                  </button>
                )}
                {allDone && (
                  <button
                    onClick={clearResults}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="닫기"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Per-marketplace results */}
            <div className="divide-y px-5">
              {enrichedLogs!.map((r, i) => (
                <ResultRow key={i} log={r} />
              ))}
            </div>

            {/* Summary footer */}
            {allDone && (
              <div className="border-t bg-muted/30 px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {successCount > 0 && (
                      <span>
                        총 <span className="font-semibold text-foreground">{totalOrders}건</span> 수집
                        {totalClaims > 0 && (
                          <> (클레임 <span className="font-semibold text-foreground">{totalClaims}건</span>)</>
                        )}
                      </span>
                    )}
                    {failCount > 0 && (
                      <span className={successCount > 0 ? 'ml-2' : ''}>
                        {failCount}개 실패
                      </span>
                    )}
                    {cancelledCount > 0 && (
                      <span className={successCount > 0 || failCount > 0 ? 'ml-2' : ''}>
                        {cancelledCount}개 취소
                      </span>
                    )}
                  </p>
                  <button
                    onClick={clearResults}
                    className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
                  >
                    닫기
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function ResultRow({ log }: { log: JobLogResult & { displayName: string } }) {
  const isCompleted = log.status === 'completed'
  const isFailed = log.status === 'failed'
  const isCancelled = log.status === 'cancelled'
  const isPending = !isCompleted && !isFailed && !isCancelled

  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 text-base">
        {isCompleted && '✅'}
        {isFailed && '❌'}
        {isCancelled && '⏹'}
        {isPending && (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{log.displayName}</p>
        {isCompleted && (
          <p className="text-sm text-muted-foreground">
            신규주문 <span className="font-medium text-foreground">{log.ordersCollected ?? 0}건</span>
            {(log.claimsCollected ?? 0) > 0 && (
              <>, 클레임 <span className="font-medium text-foreground">{log.claimsCollected}건</span></>
            )}{' '}수집
          </p>
        )}
        {isFailed && (
          <p className="break-words text-sm text-red-500">
            {log.errorMessage ?? '알 수 없는 오류'}
          </p>
        )}
        {isCancelled && (
          <p className="text-sm text-muted-foreground">취소됨</p>
        )}
        {isPending && (
          <p className="text-sm text-muted-foreground">대기 중...</p>
        )}
      </div>
    </div>
  )
}
