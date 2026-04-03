'use client'

import { useState, useEffect, useTransition } from 'react'
import { getHistoryAction } from './actions'
import {
  ADJUSTMENT_REASON_LABELS,
  type AdjustmentReason,
  type InventoryHistoryRecord,
} from '@/lib/inventory/types'

interface HistoryDialogProps {
  inventoryId: string
  sku: string
  onClose: () => void
}

const PAGE_SIZE = 20

export function HistoryDialog({ inventoryId, sku, onClose }: HistoryDialogProps) {
  const [items, setItems] = useState<InventoryHistoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [isPending, startTransition] = useTransition()

  const pageCount = Math.ceil(total / PAGE_SIZE)

  useEffect(() => {
    startTransition(async () => {
      const result = await getHistoryAction(inventoryId, page)
      setItems(result.items as InventoryHistoryRecord[])
      setTotal(result.total)
    })
  }, [inventoryId, page])

  const formatDelta = (delta: number) => {
    const prefix = delta > 0 ? '+' : ''
    return `${prefix}${delta.toLocaleString('ko-KR')}`
  }

  const deltaColor = (delta: number) =>
    delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">재고 이력</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {sku} - 전체 {total}건
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            닫기
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">일시</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">사유</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">변동</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">이전</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">이후</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">메모</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">주문</th>
              </tr>
            </thead>
            <tbody>
              {isPending && items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="h-24 text-center text-muted-foreground">
                    불러오는 중...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="h-24 text-center text-muted-foreground">
                    이력이 없습니다.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b hover:bg-muted/50">
                    <td className="px-3 py-2 text-xs">
                      {new Date(item.createdAt).toLocaleString('ko-KR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2">
                      {ADJUSTMENT_REASON_LABELS[item.adjustmentReason as AdjustmentReason] ??
                        item.adjustmentReason}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-medium ${deltaColor(item.delta)}`}>
                      {formatDelta(item.delta)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {item.previousTotal.toLocaleString('ko-KR')}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {item.newTotal.toLocaleString('ko-KR')}
                    </td>
                    <td className="max-w-[150px] truncate px-3 py-2 text-xs text-muted-foreground">
                      {item.note ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {item.orderId ? (
                        <a
                          href={`/orders?search=${item.orderId}`}
                          className="text-primary hover:underline"
                        >
                          {item.orderId.slice(0, 8)}...
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isPending}
              className="rounded border px-3 py-1 text-xs disabled:opacity-50 hover:bg-muted"
            >
              이전
            </button>
            <span className="text-xs text-muted-foreground">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || isPending}
              className="rounded border px-3 py-1 text-xs disabled:opacity-50 hover:bg-muted"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
