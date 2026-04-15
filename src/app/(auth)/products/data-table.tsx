'use client'

import { useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type VisibilityState,
  type RowSelectionState,
} from '@tanstack/react-table'
import { useQueryState, parseAsInteger } from 'nuqs'
import { columns, type ProductRow } from './columns'
import { ProductActions } from './product-actions'

interface DataTableProps {
  data: ProductRow[]
  total: number
  pageSize: number
  page: number
}

const PAGE_SIZE_OPTIONS = [20, 50, 100]

export function ProductDataTable({ data, total, pageSize, page }: DataTableProps) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const [, setPage] = useQueryState('page', parseAsInteger.withDefault(1).withOptions({ shallow: false }))
  const [, setPageSize] = useQueryState('pageSize', parseAsInteger.withDefault(50).withOptions({ shallow: false }))

  const pageCount = Math.ceil(total / pageSize)

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount,
    state: {
      columnVisibility,
      rowSelection,
      pagination: { pageIndex: page - 1, pageSize },
    },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
  })

  return (
    <div className="space-y-4">
      {/* Action column injected via table meta */}
      <ProductActions table={table} />

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2.5 text-left font-medium text-muted-foreground"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-[120px]">
                  작업
                </th>
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="h-32 text-center text-muted-foreground"
                >
                  등록된 상품이 없습니다. 상품을 등록하거나 마켓플레이스에서 역수집하세요.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, idx) => (
                <tr
                  key={row.id}
                  className={`border-b transition-colors hover:bg-muted/50 ${
                    row.getIsSelected() ? 'bg-muted' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <a
                        href={`/products/${row.original.id}`}
                        className="rounded px-2 py-1 text-xs hover:bg-muted"
                      >
                        편집
                      </a>
                      <DeleteButton productId={row.original.id} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>페이지당</span>
          <select
            value={pageSize}
            onChange={(e) => {
              void setPageSize(Number(e.target.value))
              void setPage(1)
            }}
            className="rounded border px-2 py-1 text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span>건</span>
          <span className="ml-2">
            총 {total.toLocaleString('ko-KR')}건
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-muted"
          >
            이전
          </button>
          <span className="text-sm text-muted-foreground">
            {page} / {pageCount || 1}
          </span>
          <button
            type="button"
            onClick={() => void setPage(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-muted"
          >
            다음
          </button>
        </div>
      </div>
    </div>
  )
}

/** Inline delete button with confirmation */
function DeleteButton({ productId }: { productId: string }) {
  const handleDelete = async () => {
    if (!confirm('이 상품을 삭제하시겠습니까?')) return

    const { deleteProductAction } = await import('@/lib/products/ui-actions')
    const result = await deleteProductAction(productId)

    if (!result.success) {
      alert(`삭제 실패: ${result.error}`)
      return
    }

    // Reload page to refresh data
    window.location.reload()
  }

  return (
    <button
      type="button"
      onClick={() => void handleDelete()}
      className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
    >
      삭제
    </button>
  )
}
