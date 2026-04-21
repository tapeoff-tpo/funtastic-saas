'use client'

import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type VisibilityState,
  type RowSelectionState,
} from '@tanstack/react-table'
import { useQueryState, parseAsInteger } from 'nuqs'
import { columns, type OrderRow } from './columns'
import { BulkActionBar } from './status-actions'
import { ShippingActions } from './shipping-actions'

interface DataTableProps {
  data: OrderRow[]
  total: number
  pageSize: number
  page: number
}

const PAGE_SIZE_OPTIONS = [20, 50, 100]

export function DataTable({ data, total, pageSize, page }: DataTableProps) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [showColumnToggle, setShowColumnToggle] = useState(false)

  const [, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [, setPageSize] = useQueryState('pageSize', parseAsInteger.withDefault(50))

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

  const selectedCount = Object.keys(rowSelection).length

  // Extract selected order IDs for bulk actions
  const selectedIds = useMemo(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map((key) => {
        const row = table.getRow(key)
        return row?.original?.id
      })
      .filter(Boolean) as string[]
  }, [rowSelection, table])

  // Extract selected orders (full data including items) for bulk mapping
  const selectedOrders = useMemo(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map((key) => table.getRow(key)?.original)
      .filter(Boolean) as OrderRow[]
  }, [rowSelection, table])

  return (
    <div className="space-y-4">
      {/* Shipping action buttons */}
      <ShippingActions selectedOrderIds={selectedIds} selectedOrders={selectedOrders} />

      {/* Bulk action bar (floating, shown when rows selected) */}
      <BulkActionBar
        selectedIds={selectedIds}
        onClear={() => setRowSelection({})}
      />

      {/* Toolbar: column toggle + selected count */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {selectedCount > 0 && `${selectedCount}건 선택됨`}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowColumnToggle((v) => !v)}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            열 표시
          </button>
          {showColumnToggle && (
            <div className="absolute right-0 top-full z-10 mt-1 min-w-[160px] rounded-md border bg-white p-2 shadow-lg">
              {table.getAllLeafColumns()
                .filter((col) => col.getCanHide())
                .map((col) => (
                  <label key={col.id} className="flex items-center gap-2 px-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={col.getIsVisible()}
                      onChange={col.getToggleVisibilityHandler()}
                      className="h-3.5 w-3.5 rounded border-gray-300"
                    />
                    {typeof col.columnDef.header === 'string'
                      ? col.columnDef.header
                      : col.id}
                  </label>
                ))}
            </div>
          )}
        </div>
      </div>

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
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="h-32 text-center text-muted-foreground"
                >
                  주문이 없습니다.
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
