'use client'

import { useTransition } from 'react'
import type { Table } from '@tanstack/react-table'
import type { ProductRow } from './columns'

interface ProductActionsProps {
  table: Table<ProductRow>
}

/**
 * Toolbar actions for the product list: bulk delete.
 */
export function ProductActions({ table }: ProductActionsProps) {
  const [isPending, startTransition] = useTransition()

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

  if (selectedIds.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleBulkDelete}
        disabled={isPending}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? '삭제 중...' : `선택 삭제 (${selectedIds.length}개)`}
      </button>
    </div>
  )
}
