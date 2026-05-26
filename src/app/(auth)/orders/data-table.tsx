'use client'

import { useState, useMemo, useTransition, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { bulkDeleteOrdersAction } from './actions'
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
import { ManualInvoiceButton, ManualStatusChangeButton } from './status-actions'
import { Pagination, PageSizeSelector } from '@/components/ui/pagination'
import { useColumnSizing } from '@/lib/hooks/use-column-sizing'
import type { OrderStage } from '@/lib/orders/types'

interface DataTableProps {
  data: OrderRow[]
  total: number
  pageSize: number
  page: number
  stage?: OrderStage
  showMappingAction?: boolean
  showMappingColumn?: boolean
  canUnlockOrderSnapshots?: boolean
}


export function DataTable({
  data,
  total,
  pageSize,
  page,
  stage,
  showMappingAction = false,
  showMappingColumn: showMappingColumnProp = false,
  canUnlockOrderSnapshots = false,
}: DataTableProps) {
  const showMappingColumn = stage === 'mapping' || showMappingAction || showMappingColumnProp
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    // 매핑 컬럼은 매핑 필요 스테이지에서만 노출
    { mappingStatus: showMappingColumn },
  )
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [showColumnToggle, setShowColumnToggle] = useState(false)
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null)
  const [deletePending, startDelete] = useTransition()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    setColumnVisibility((prev) => ({ ...prev, mappingStatus: showMappingColumn }))
  }, [showMappingColumn])

  const [, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ shallow: false }),
  )
  const [, setPageSize] = useQueryState(
    'pageSize',
    parseAsInteger.withDefault(25).withOptions({ shallow: false }),
  )

  const pageCount = Math.ceil(total / pageSize)
  const [columnSizing, setColumnSizing] = useColumnSizing('orders-table')
  const dataKey = useMemo(() => data.map((order) => order.id).join('|'), [data])
  const visibleOrdersById = useMemo(() => new Map(data.map((order) => [order.id, order])), [data])

  useEffect(() => {
    setRowSelection({})
  }, [dataKey, searchParams])

  const moveToProcessingTab = (tab: 'cancel' | 'return' | 'exchange') => {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of ['status', 'claimType', 'cancel', 'held', 'tab', 'page', 'mapping', 'scan', 'scanResult']) {
      params.delete(key)
    }
    params.delete('dateField')
    params.delete('dateFrom')
    params.delete('dateTo')
    params.set('datePreset', 'all')
    if (tab === 'cancel') {
      params.set('cancel', 'true')
    } else {
      params.set('claimType', tab)
    }
    setRowSelection({})
    router.push(`${pathname}?${params.toString()}`)
  }

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    columnResizeMode: 'onChange',
    pageCount,
    state: {
      columnVisibility,
      rowSelection,
      columnSizing,
      pagination: { pageIndex: page - 1, pageSize },
    },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: setColumnSizing,
    enableRowSelection: true,
    meta: {
      openDetail: (id: string) => setDetailOrderId(id),
      refresh: () => router.refresh(),
      moveToProcessingTab,
    },
  })

  // Extract selected order IDs for bulk actions
  const selectedIds = useMemo(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .filter((key) => visibleOrdersById.has(key))
  }, [rowSelection, visibleOrdersById])

  const selectedCount = selectedIds.length
  const tableWidth = Math.max(table.getTotalSize(), 1620)

  // Extract selected orders (full data including items) for bulk mapping
  const selectedOrders = useMemo(() => {
    return selectedIds
      .map((id) => visibleOrdersById.get(id))
      .filter(Boolean) as OrderRow[]
  }, [selectedIds, visibleOrdersById])

  return (
    <div className="space-y-2">
      {/* Action bar + toolbar merged — ShippingActions + 선택 카운트 + 열 표시 in one row */}
      <div className="flex flex-wrap items-center gap-2">
        <ShippingActions
          selectedOrderIds={selectedIds}
          selectedOrders={selectedOrders}
          allOrders={data}
          stage={stage}
          showMappingAction={showMappingAction}
        />
        {selectedCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {selectedCount}건 선택됨
          </span>
        )}
        <button
          type="button"
          disabled={selectedCount === 0 || deletePending}
          onClick={() => {
            if (selectedCount === 0) return
            // 1차 확인 — 단순 confirm
            if (
              !confirm(
                `선택한 ${selectedCount}건의 주문을 삭제하시겠습니까?\n\n` +
                  `※ 관련 송장/클레임 정보도 함께 삭제됩니다.\n` +
                  `※ 재고 변동 이력은 보존됩니다.`,
              )
            ) {
              return
            }
            // 2차 확인 — 되돌릴 수 없음을 명시
            if (!confirm(`정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
              return
            }
            startDelete(async () => {
              const result = await bulkDeleteOrdersAction(selectedIds)
              if (result.errors.length > 0) {
                alert(`삭제 실패: ${result.errors.join('\n')}`)
                return
              }
              alert(`${result.deleted}건 삭제 완료`)
              setRowSelection({})
              router.refresh()
            })
          }}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deletePending ? '삭제 중...' : `주문 삭제${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
        </button>
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
        <ManualStatusChangeButton
          selectedIds={selectedIds}
          selectedOrders={selectedOrders}
          canUnlockOrderSnapshots={canUnlockOrderSnapshots}
          onChanged={() => {
            setRowSelection({})
            router.refresh()
          }}
          onMovedToProcessingTab={moveToProcessingTab}
        />
        <ManualInvoiceButton
          selectedOrders={selectedOrders}
          onChanged={() => {
            setRowSelection({})
            router.refresh()
          }}
        />
        <PageSizeSelector
          pageSize={pageSize}
          total={total}
          pageSizeOptions={[25, 50, 100, 200, 500, 1000]}
          onPageSizeChange={(s) => {
            void setPageSize(s)
          }}
          onPageChange={(p) => {
            void setPage(p)
          }}
          className="ml-auto"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="table-fixed text-xs" style={{ width: tableWidth }}>
          <thead className="sticky top-0 z-[1] bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="relative whitespace-normal break-keep px-1.5 py-1 text-left text-[11px] font-medium leading-tight text-muted-foreground"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onClick={(event) => event.stopPropagation()}
                        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none bg-transparent hover:bg-blue-400 ${
                          header.column.getIsResizing() ? 'bg-blue-500' : ''
                        }`}
                        aria-label="컬럼 너비 조절"
                      />
                    )}
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
                    <td
                      key={cell.id}
                      className="min-w-0 px-1.5 py-1 align-middle"
                      style={{ width: cell.column.getSize() }}
                    >
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
        hidePageSize
        onPageChange={(p) => {
          void setPage(p)
        }}
        onPageSizeChange={(s) => {
          void setPageSize(s)
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
