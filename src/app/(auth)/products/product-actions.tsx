'use client'

import { useState, useTransition } from 'react'
import type { Table } from '@tanstack/react-table'
import type { ProductRow } from './columns'

interface ProductActionsProps {
  table: Table<ProductRow>
}

/**
 * Toolbar actions for the product list: bulk delete + reverse collection.
 */
export function ProductActions({ table }: ProductActionsProps) {
  const [showReverseDialog, setShowReverseDialog] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [connectionId, setConnectionId] = useState('')
  const [marketplaceId, setMarketplaceId] = useState('coupang')

  const selectedIds = table
    .getSelectedRowModel()
    .rows.map((r) => r.original.id)

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return
    if (!confirm(`선택한 ${selectedIds.length}개 상품을 삭제하시겠습니까?`)) return
    startTransition(async () => {
      const { bulkDeleteProductsAction } = await import('@/lib/products/ui-actions')
      const res = await bulkDeleteProductsAction(selectedIds)
      if (res.success) {
        alert(`${res.data.deleted}개 삭제 완료`)
        window.location.reload()
      } else {
        alert(`삭제 실패: ${res.error}`)
      }
    })
  }

  const MARKETPLACE_OPTIONS = [
    { value: 'coupang', label: '쿠팡' },
    { value: 'naver', label: '네이버' },
  ]

  const handleReverseCollect = () => {
    if (!connectionId.trim()) {
      alert('연동 ID를 입력해주세요.')
      return
    }

    startTransition(async () => {
      const { reverseCollectAction } = await import('@/lib/products/ui-actions')
      const res = await reverseCollectAction(connectionId, marketplaceId)
      if (res.success) {
        setResult(res.data)
      } else {
        alert(`역수집 실패: ${res.error}`)
      }
    })
  }

  return (
    <>
      {showReverseDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold">마켓플레이스 역수집</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              연결된 마켓플레이스에서 상품을 가져옵니다.
            </p>

            <div className="mt-4 space-y-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="rc-marketplace" className="text-sm font-medium">마켓플레이스</label>
                <select
                  id="rc-marketplace"
                  value={marketplaceId}
                  onChange={(e) => setMarketplaceId(e.target.value)}
                  className="rounded-md border px-3 py-1.5 text-sm"
                >
                  {MARKETPLACE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="rc-connection" className="text-sm font-medium">연동 ID</label>
                <input
                  id="rc-connection"
                  type="text"
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                  placeholder="marketplace_connections ID"
                  className="rounded-md border px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            {result && (
              <div className="mt-4 rounded-md border p-3 text-sm">
                <p>가져온 상품: <strong>{result.imported}</strong>건</p>
                <p>건너뛴 상품: <strong>{result.skipped}</strong>건 (이미 등록됨)</p>
                {result.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-red-600">오류 {result.errors.length}건:</p>
                    <ul className="mt-1 list-inside list-disc text-xs text-red-500">
                      {result.errors.slice(0, 5).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowReverseDialog(false)
                  setResult(null)
                }}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={handleReverseCollect}
                disabled={isPending}
                className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {isPending ? '수집 중...' : '역수집 시작'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={isPending}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {isPending ? '삭제 중...' : `선택 삭제 (${selectedIds.length}개)`}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowReverseDialog(true)}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          역수집
        </button>
      </div>
    </>
  )
}
