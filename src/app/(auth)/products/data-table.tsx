'use client'

import { useMemo, useState } from 'react'
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
import { ChevronRight, ChevronDown } from 'lucide-react'
import { columns, type ProductRow } from './columns'
import { ProductActions } from './product-actions'
import { Pagination } from '@/components/ui/pagination'

/** 품번(internalSku 의 '-' 앞) prefix */
function skuPrefix(sku: string | null | undefined): string {
  return (sku ?? '').split('-')[0]
}

interface DataTableProps {
  data: ProductRow[]
  total: number
  pageSize: number
  page: number
}

export function ProductDataTable({ data, total, pageSize, page }: DataTableProps) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  // 펼쳐진 품번 prefix 모음. 기본 모두 접힘 — 헤더 행만 보이고 자식은 토글로.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const router = useRouter()

  const toggleExpand = (prefix: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(prefix)) next.delete(prefix)
      else next.add(prefix)
      return next
    })
  }

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

  // 페이지 안에서 같은 품번(prefix) 그룹 정보를 미리 계산.
  // - groupCount: prefix → 같은 prefix 행 수
  // - firstIdxOf: prefix → 그룹의 첫 행 인덱스 (헤더 역할)
  const groupInfo = useMemo(() => {
    const count = new Map<string, number>()
    const firstIdx = new Map<string, number>()
    data.forEach((r, i) => {
      const p = skuPrefix(r.internalSku)
      count.set(p, (count.get(p) ?? 0) + 1)
      if (!firstIdx.has(p)) firstIdx.set(p, i)
    })
    return { count, firstIdx }
  }, [data])

  return (
    <div className="space-y-4">
      <ProductActions table={table} />

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b">
                {/* 토글 화살표 자리 */}
                <th className="w-8" />
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
                  colSpan={columns.length + 2}
                  className="h-32 text-center text-muted-foreground"
                >
                  등록된 상품이 없습니다. 상품을 등록하거나 마켓플레이스에서 역수집하세요.
                </td>
              </tr>
            ) : (
              (() => {
                // 품번 단위 그룹핑 + 접기/펼치기.
                // 그룹의 첫 행 = 헤더(항상 보임). 자식 행은 expanded.has(prefix) 일 때만 보임.
                // 그룹 멤버가 1개면 화살표 숨기고 일반 행처럼.
                const rows = table.getRowModel().rows
                let runningGroup = 0
                let lastPrefix: string | null = null
                return rows.map((row, idx) => {
                  const prefix = skuPrefix(row.original.internalSku)
                  const isHeader = groupInfo.firstIdx.get(prefix) === idx
                  const memberCount = groupInfo.count.get(prefix) ?? 1
                  const isOpen = expanded.has(prefix)
                  // 헤더가 아니고 닫힌 상태면 숨김
                  if (!isHeader && !isOpen) return null
                  if (isHeader && lastPrefix !== prefix) {
                    if (lastPrefix !== null) runningGroup++
                    lastPrefix = prefix
                  }
                  const groupBg = runningGroup % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                  const isGroupStart = isHeader && idx > 0
                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors hover:bg-muted/50 ${
                        isGroupStart ? 'border-t-2 border-t-gray-300' : 'border-b'
                      } ${row.getIsSelected() ? 'bg-muted' : groupBg}`}
                    >
                      {/* 토글 화살표 셀 */}
                      <td className="px-1 py-2 text-center align-middle">
                        {isHeader && memberCount > 1 ? (
                          <button
                            type="button"
                            onClick={() => toggleExpand(prefix)}
                            aria-label={isOpen ? '접기' : '펼치기'}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-200 hover:text-gray-900 cursor-pointer"
                            title={`${memberCount}개 옵션`}
                          >
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        ) : !isHeader ? (
                          // 자식 행: 들여쓰기 가이드
                          <span className="inline-block h-4 w-4 border-l-2 border-gray-200 ml-2" />
                        ) : null}
                      </td>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-3 py-2">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {isHeader && memberCount > 1 && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                              옵션 {memberCount}
                            </span>
                          )}
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
