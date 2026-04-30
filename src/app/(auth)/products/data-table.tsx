'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type VisibilityState,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table'
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs'
import { columns, type ProductRow } from './columns'
import { ProductActions } from './product-actions'
import { Pagination } from '@/components/ui/pagination'

interface DataTableProps {
  data: ProductRow[]
  total: number
  pageSize: number
  page: number
}

export function ProductDataTable({ data, total, pageSize, page }: DataTableProps) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const router = useRouter()

  const [, setPage] = useQueryState('page', parseAsInteger.withDefault(1).withOptions({ shallow: false }))
  const [, setPageSize] = useQueryState('pageSize', parseAsInteger.withDefault(50).withOptions({ shallow: false }))
  const [sort, setSort] = useQueryState('sort', parseAsString.withOptions({ shallow: false }))
  const [order, setOrder] = useQueryState('order', parseAsString.withOptions({ shallow: false }))

  const pageCount = Math.ceil(total / pageSize)

  const sorting: SortingState = sort ? [{ id: sort, desc: order === 'desc' }] : []

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
      sorting,
    },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      if (next.length > 0) {
        void setSort(next[0].id)
        void setOrder(next[0].desc ? 'desc' : 'asc')
      } else {
        void setSort(null)
        void setOrder(null)
      }
    },
    enableRowSelection: true,
  })

  return (
    <div className="space-y-4">
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
                    className={`px-3 py-2.5 text-left font-medium text-muted-foreground ${
                      header.column.getCanSort() ? 'cursor-pointer select-none hover:text-foreground' : ''
                    }`}
                    style={{ width: header.getSize() }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {header.isPlaceholder ? null : (
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <span className="text-xs opacity-60">
                            {header.column.getIsSorted() === 'asc'
                              ? '\u25B2'
                              : header.column.getIsSorted() === 'desc'
                                ? '\u25BC'
                                : '\u21C5'}
                          </span>
                        )}
                      </div>
                    )}
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
              (() => {
                // 품번(internalSku 의 '-' 앞) 단위로 시각적 그룹핑.
                // 같은 품번 = 같은 배경색, 그룹 경계엔 두꺼운 구분선.
                // 인접 prefix 비교로 한 번만 순회해서 그룹 인덱스 계산.
                const rows = table.getRowModel().rows
                const meta = rows.map((row, idx) => {
                  const prefix = (row.original.internalSku ?? '').split('-')[0]
                  return { row, prefix, idx }
                })
                let runningGroup = 0
                const enriched = meta.map((m, i) => {
                  if (i > 0 && meta[i - 1].prefix !== m.prefix) runningGroup++
                  return { ...m, groupIdx: runningGroup, isGroupStart: i > 0 && meta[i - 1].prefix !== m.prefix }
                })
                return enriched.map(({ row, isGroupStart, groupIdx }) => {
                const groupBg = groupIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                return (
                <tr
                  key={row.id}
                  className={`transition-colors hover:bg-muted/50 ${
                    isGroupStart ? 'border-t-2 border-t-gray-300' : 'border-b'
                  } ${
                    row.getIsSelected() ? 'bg-muted' : groupBg
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
                )
              })
              })()
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(p) => {
          void setPage(p).then(() => router.refresh())
        }}
        onPageSizeChange={(s) => {
          void setPageSize(s).then(() => router.refresh())
        }}
      />
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
