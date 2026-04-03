'use client'

import { useState, useTransition } from 'react'
import { holdOrderAction, releaseOrderAction } from './actions'
import { toast } from 'sonner'

interface HoldDialogProps {
  orderId: string
  isHeld: boolean
  holdReason?: string | null
}

/**
 * Hold/release controls for a single order.
 * If not held: shows button to open hold dialog with reason input.
 * If held: shows release button with current reason displayed.
 */
export function HoldDialog({ orderId, isHeld, holdReason }: HoldDialogProps) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()

  const handleHold = () => {
    if (!reason.trim()) {
      toast.error('보류 사유를 입력해주세요')
      return
    }
    startTransition(async () => {
      const result = await holdOrderAction(orderId, reason)
      if (result.success) {
        toast.success('주문이 보류 처리되었습니다')
        setOpen(false)
        setReason('')
      } else {
        toast.error(result.error ?? '보류 처리에 실패했습니다')
      }
    })
  }

  const handleRelease = () => {
    startTransition(async () => {
      const result = await releaseOrderAction(orderId)
      if (result.success) {
        toast.success('보류가 해제되었습니다')
      } else {
        toast.error(result.error ?? '보류 해제에 실패했습니다')
      }
    })
  }

  if (isHeld) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleRelease}
          disabled={isPending}
          className="rounded border border-orange-300 bg-orange-50 px-2 py-1 text-xs text-orange-700 hover:bg-orange-100 disabled:opacity-50"
          title={holdReason ?? '보류 사유 없음'}
        >
          {isPending ? '처리중...' : '보류 해제'}
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border px-2 py-1 text-xs hover:bg-muted"
      >
        보류
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold">주문 보류</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              보류 사유를 입력해주세요. 보류된 주문은 상태를 변경할 수 없습니다.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="보류 사유를 입력하세요..."
              className="mt-4 w-full rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setReason('')
                }}
                className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleHold}
                disabled={isPending || !reason.trim()}
                className="rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {isPending ? '처리중...' : '보류 처리'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

interface BulkHoldDialogProps {
  orderIds: string[]
  onComplete: () => void
}

/**
 * Bulk hold dialog for multiple selected orders.
 */
export function BulkHoldDialog({ orderIds, onComplete }: BulkHoldDialogProps) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()

  const handleBulkHold = () => {
    if (!reason.trim()) {
      toast.error('보류 사유를 입력해주세요')
      return
    }
    startTransition(async () => {
      let success = 0
      let failed = 0
      for (const orderId of orderIds) {
        const result = await holdOrderAction(orderId, reason)
        if (result.success) success++
        else failed++
      }
      if (failed === 0) {
        toast.success(`${success}건의 주문이 보류 처리되었습니다`)
      } else {
        toast.warning(`${success}건 성공, ${failed}건 실패`)
      }
      setOpen(false)
      setReason('')
      onComplete()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-orange-300 px-3 py-1.5 text-sm text-orange-700 hover:bg-orange-50"
      >
        일괄 보류
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold">일괄 보류 ({orderIds.length}건)</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              선택한 {orderIds.length}건의 주문을 보류합니다.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="보류 사유를 입력하세요..."
              className="mt-4 w-full rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setReason('')
                }}
                className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleBulkHold}
                disabled={isPending || !reason.trim()}
                className="rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {isPending ? '처리중...' : '일괄 보류'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
