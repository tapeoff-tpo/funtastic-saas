'use client'

import { useCollectPoll } from '@/lib/hooks/use-collect-poll'

interface CollectButtonProps {
  marketplaceId: string
  displayName: string
  disabled?: boolean
}

export function CollectButton({
  marketplaceId,
  disabled,
}: CollectButtonProps) {
  const { collecting, logs, startCollect } = useCollectPoll()

  const handleCollect = () => {
    startCollect([marketplaceId])
  }

  const log = logs?.[0]
  const isDone = log && (log.status === 'completed' || log.status === 'failed')
  const isRunning = collecting || (log && !isDone)

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={handleCollect}
          disabled={disabled || !!isRunning}
          className="rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
              수집 중
            </span>
          ) : (
            '주문 수집'
          )}
        </button>

        {isDone && (
          <span
            className={`text-xs ${
              log.status === 'completed' ? 'text-emerald-600' : 'text-red-500'
            }`}
          >
            {log.status === 'completed' ? (
              <>
                ✓ 주문{' '}
                <span className="font-semibold">{log.ordersCollected ?? 0}건</span>
                {(log.claimsCollected ?? 0) > 0 && (
                  <>, 클레임 <span className="font-semibold">{log.claimsCollected}건</span></>
                )}
              </>
            ) : (
              <span className="max-w-[320px] break-words text-right" title={log.errorMessage ?? ''}>
                ✗ {log.errorMessage ?? log.progressMessage ?? '오류'}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
