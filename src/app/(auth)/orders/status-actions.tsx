'use client'

import { useState, useTransition } from 'react'
import {
  VALID_TRANSITIONS,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from '@/lib/orders/types'
import { changeStatusAction, bulkChangeStatusAction } from './actions'
import { toast } from 'sonner'

interface StatusDropdownProps {
  orderId: string
  currentStatus: OrderStatus
  isHeld: boolean
}

/**
 * Dropdown to change a single order's status.
 * Shows only valid transitions. Disabled when order is held (D-11).
 */
export function StatusDropdown({ orderId, currentStatus, isHeld }: StatusDropdownProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const validNext = VALID_TRANSITIONS[currentStatus] ?? []

  if (validNext.length === 0 && !isHeld) return null

  const handleChange = (newStatus: OrderStatus) => {
    setOpen(false)
    startTransition(async () => {
      const result = await changeStatusAction(orderId, newStatus)
      if (result.success) {
        toast.success(`상태가 ${ORDER_STATUS_LABELS[newStatus]}(으)로 변경되었습니다`)
      } else {
        toast.error(result.error ?? '상태 변경에 실패했습니다')
      }
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isHeld || isPending}
        className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        title={isHeld ? '보류 중인 주문은 상태를 변경할 수 없습니다' : '상태 변경'}
      >
        {isPending ? '처리중...' : '상태 변경'}
      </button>
      {open && validNext.length > 0 && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-md border bg-white py-1 shadow-lg">
          {validNext.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => handleChange(status)}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
            >
              {ORDER_STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface BulkActionBarProps {
  selectedIds: string[]
  onClear: () => void
}

/**
 * Floating action bar shown when rows are selected.
 * Supports bulk status change and bulk hold.
 */
export function BulkActionBar({ selectedIds, onClear }: BulkActionBarProps) {
  const [isPending, startTransition] = useTransition()
  const [showStatusMenu, setShowStatusMenu] = useState(false)

  if (selectedIds.length === 0) return null

  // Common statuses available for bulk change
  const bulkStatuses: OrderStatus[] = ['confirmed', 'preparing', 'shipped', 'cancelled']

  const handleBulkStatus = (newStatus: OrderStatus) => {
    setShowStatusMenu(false)
    startTransition(async () => {
      const result = await bulkChangeStatusAction(selectedIds, newStatus)
      if (result.errors.length === 0) {
        toast.success(`${result.updated}건의 주문 상태가 변경되었습니다`)
      } else {
        toast.warning(
          `${result.updated}건 성공, ${result.errors.length}건 실패`,
        )
      }
      onClear()
    })
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-white px-4 py-3 shadow-xl">
      <span className="text-sm font-medium">{selectedIds.length}개 주문 선택됨</span>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowStatusMenu((v) => !v)}
          disabled={isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? '처리중...' : '일괄 상태 변경'}
        </button>
        {showStatusMenu && (
          <div className="absolute bottom-full left-0 mb-1 min-w-[140px] rounded-md border bg-white py-1 shadow-lg">
            {bulkStatuses.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => handleBulkStatus(status)}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
              >
                {ORDER_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onClear}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        선택 해제
      </button>
    </div>
  )
}
