'use client'

/**
 * Client components for held shipments page.
 *
 * HeldOrderActions renders as <td> cells within a table row (server component
 * renders the <tr>, this renders the memo and action cells).
 */

import { useState, useTransition } from 'react'
import { reprocessHeldOrder, updateHeldMemo } from '@/lib/shipping/actions'

interface HeldOrderActionsProps {
  orderId: string
  initialMemo: string
}

export function HeldOrderActions({ orderId, initialMemo }: HeldOrderActionsProps) {
  const [memo, setMemo] = useState(initialMemo)
  const [savedMemo, setSavedMemo] = useState(initialMemo)
  const [isPending, startTransition] = useTransition()
  const [reprocessPending, startReprocessTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleMemoSave() {
    if (memo === savedMemo) return
    setError(null)
    startTransition(async () => {
      const result = await updateHeldMemo(orderId, memo)
      if (result.success) {
        setSavedMemo(memo)
      } else {
        setError(result.error ?? '저장 실패')
      }
    })
  }

  function handleReprocess() {
    if (!confirm('이 주문의 운송장을 삭제하고 준비중 상태로 되돌리시겠습니까?')) return
    setError(null)
    startReprocessTransition(async () => {
      const result = await reprocessHeldOrder(orderId)
      if (!result.success) {
        setError(result.error ?? '재처리 실패')
      }
      // On success, revalidatePath refreshes the page data automatically
    })
  }

  return (
    <>
      {/* 메모 */}
      <td className="px-4 py-3">
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onBlur={handleMemoSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
          disabled={isPending}
          placeholder="메모 입력..."
          className="w-full min-w-[140px] rounded border border-gray-200 px-2 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:opacity-50"
        />
        {error && (
          <p className="mt-1 text-xs text-red-600">{error}</p>
        )}
      </td>

      {/* 액션 */}
      <td className="whitespace-nowrap px-4 py-3">
        <button
          type="button"
          onClick={handleReprocess}
          disabled={reprocessPending}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {reprocessPending ? '처리중...' : '재처리'}
        </button>
      </td>
    </>
  )
}
