'use client'

import { useState } from 'react'

interface CollectResult {
  success: boolean
  ordersCollected?: number
  claimsCollected?: number
  error?: string
}

interface CollectButtonProps {
  marketplaceId: string
  displayName: string
  disabled?: boolean
}

export function CollectButton({
  marketplaceId,
  displayName,
  disabled,
}: CollectButtonProps) {
  const [collecting, setCollecting] = useState(false)
  const [result, setResult] = useState<CollectResult | null>(null)

  const handleCollect = async () => {
    setCollecting(true)
    setResult(null)
    try {
      const res = await fetch('/api/orders/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketplaceIds: [marketplaceId] }),
      })
      const data = await res.json()

      if (!res.ok) {
        setResult({ success: false, error: data.error || '수집 실패' })
        return
      }

      const r = data.results?.[0]
      if (!r) {
        setResult({ success: false, error: '응답 없음' })
        return
      }
      setResult({
        success: r.success,
        ordersCollected: r.ordersCollected,
        claimsCollected: r.claimsCollected,
        error: r.error,
      })
    } catch {
      setResult({ success: false, error: '네트워크 오류' })
    } finally {
      setCollecting(false)
    }
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={handleCollect}
          disabled={disabled || collecting}
          className="rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {collecting ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
              수집 중
            </span>
          ) : (
            '주문 수집'
          )}
        </button>

        {result && (
          <span
            className={`text-xs ${
              result.success ? 'text-emerald-600' : 'text-red-500'
            }`}
          >
            {result.success ? (
              <>
                ✓ 주문{' '}
                <span className="font-semibold">{result.ordersCollected ?? 0}건</span>
                {(result.claimsCollected ?? 0) > 0 && (
                  <>, 클레임 <span className="font-semibold">{result.claimsCollected}건</span></>
                )}
              </>
            ) : (
              <span title={result.error ?? ''}>
                ✗{' '}
                {result.error && result.error.length > 24
                  ? result.error.slice(0, 24) + '…'
                  : (result.error ?? '오류')}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
