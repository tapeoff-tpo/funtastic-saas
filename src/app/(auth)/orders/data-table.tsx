'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type VisibilityState,
  type RowSelectionState,
} from '@tanstack/react-table'
import { useQueryState, parseAsInteger } from 'nuqs'
import { columns, type OrderRow } from './columns'
import { ShippingActions } from './shipping-actions'
import { OrderDetailDialog } from './order-detail-dialog'
import { Pagination } from '@/components/ui/pagination'
import type { OrderStage } from '@/lib/orders/types'

interface DataTableProps {
  data: OrderRow[]
  total: number
  pageSize: number
  page: number
  stage?: OrderStage
}


export function DataTable({ data, total, pageSize, page, stage }: DataTableProps) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    // 매핑 컬럼은 매핑 필요 스테이지에서만 노출
    { mappingStatus: stage === 'mapping' },
  )
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [showColumnToggle, setShowColumnToggle] = useState(false)
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null)
  const router = useRouter()

  const [, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ shallow: false }),
  )
  const [, setPageSize] = useQueryState(
    'pageSize',
    parseAsInteger.withDefault(50).withOptions({ shallow: false }),
  )

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
    meta: {
      openDetail: (id: string) => setDetailOrderId(id),
    },
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
    <div className="space-y-2">
      {/* Action bar + toolbar merged — ShippingActions + 선택 카운트 + 열 표시 in one row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <ShippingActions
            selectedOrderIds={selectedIds}
            selectedOrders={selectedOrders}
            allOrders={data}
            stage={stage}
          />
        </div>
        {selectedCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {selectedCount}건 선택됨
          </span>
        )}
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

      {/* Detail modal (opened via Claim button or 주문번호 click) */}
      <OrderDetailDialog
        orderId={detailOrderId}
        open={detailOrderId !== null}
        onOpenChange={(open) => { if (!open) setDetailOrderId(null) }}
      />
    </div>
  )
}
