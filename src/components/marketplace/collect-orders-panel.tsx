'use client'

import { useState } from 'react'

interface Connection {
  marketplaceId: string
  displayName: string
  status: string
}

interface CollectResult {
  marketplaceId: string
  displayName: string
  success: boolean
  ordersCollected?: number
  claimsCollected?: number
  error?: string
}

interface CollectOrdersPanelProps {
  connections: Connection[]
}

export function CollectOrdersPanel({ connections }: CollectOrdersPanelProps) {
  const [collecting, setCollecting] = useState(false)
  const [results, setResults] = useState<CollectResult[] | null>(null)

  const connectedMarkets = connections.filter((c) => c.status !== 'disconnected')

  const handleCollectAll = async () => {
    if (connectedMarkets.length === 0) return
    setCollecting(true)

    const nameMap = Object.fromEntries(
      connections.map((c) => [c.marketplaceId, c.displayName])
    )

    try {
      const res = await fetch('/api/orders/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketplaceIds: connectedMarkets.map((c) => c.marketplaceId),
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setResults([
          {
            marketplaceId: '__error__',
            displayName: '오류',
            success: false,
            error: data.error || '주문 수집에 실패했습니다',
          },
        ])
        return
      }

      const enriched: CollectResult[] = (
        data.results as Array<{
          marketplaceId: string
          success: boolean
          ordersCollected?: number
          claimsCollected?: number
          error?: string
        }>
      ).map((r) => ({
        ...r,
        displayName: nameMap[r.marketplaceId] ?? r.marketplaceId,
      }))

      setResults(enriched)
    } catch {
      setResults([
        {
          marketplaceId: '__error__',
          displayName: '오류',
          success: false,
          error: '주문 수집 중 오류가 발생했습니다',
        },
      ])
    } finally {
      setCollecting(false)
    }
  }

  if (connectedMarkets.length === 0) return null

  const totalOrders =
    results?.reduce((sum, r) => sum + (r.ordersCollected ?? 0), 0) ?? 0
  const totalClaims =
    results?.reduce((sum, r) => sum + (r.claimsCollected ?? 0), 0) ?? 0
  const successCount = results?.filter((r) => r.success).length ?? 0
  const failCount = results?.filter((r) => !r.success).length ?? 0

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

      {/* Results modal */}
      {results && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border bg-background shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-base font-semibold">전체 수집 결과</h2>
              <button
                onClick={() => setResults(null)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="닫기"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            {/* Per-marketplace results */}
            <div className="divide-y px-5">
              {results.map((r, i) => (
                <div key={i} className="flex items-start gap-3 py-3">
                  <span className="mt-0.5 text-base">
                    {r.success ? '✅' : '❌'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.displayName}</p>
                    {r.success ? (
                      <p className="text-sm text-muted-foreground">
                        신규주문{' '}
                        <span className="font-medium text-foreground">
                          {r.ordersCollected ?? 0}건
                        </span>
                        {(r.claimsCollected ?? 0) > 0 && (
                          <>
                            {', '}클레임{' '}
                            <span className="font-medium text-foreground">
                              {r.claimsCollected}건
                            </span>
                          </>
                        )}{' '}
                        수집
                      </p>
                    ) : (
                      <p className="break-words text-sm text-red-500">
                        {r.error ?? '알 수 없는 오류'}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary footer */}
            <div className="border-t bg-muted/30 px-5 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {successCount > 0 && (
                    <span>
                      총{' '}
                      <span className="font-semibold text-foreground">
                        {totalOrders}건
                      </span>{' '}
                      수집
                      {totalClaims > 0 && (
                        <>
                          {' '}(클레임{' '}
                          <span className="font-semibold text-foreground">
                            {totalClaims}건
                          </span>
                          )
                        </>
                      )}
                    </span>
                  )}
                  {failCount > 0 && (
                    <span className={successCount > 0 ? 'ml-2' : ''}>
                      {failCount}개 마켓 실패
                    </span>
                  )}
                  {successCount === 0 && failCount === 0 && (
                    <span>수집된 항목 없음</span>
                  )}
                </p>
                <button
                  onClick={() => setResults(null)}
                  className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
