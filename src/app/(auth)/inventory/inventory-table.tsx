'use client'

import { useState, useCallback, useEffect, useTransition } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table'
import { useQueryState, useQueryStates, parseAsInteger, parseAsString } from 'nuqs'
import { AdjustStockDialog } from './adjust-stock-dialog'
import { HistoryDialog } from './history-dialog'
import { ExcelUploadDialog } from './excel-upload-dialog'
import { Pagination } from '@/components/ui/pagination'

export interface InventoryRow {
  id: string
  sku: string
  productName: string
  optionName: string | null
  warehouseZone: string | null
  sectorCode: string | null
  totalStock: number
  reservedStock: number
  availableStock: number
  monthlyIncoming: number
  monthlyOutgoing: number
  lastIncomingAt: Date | null
  lastOutgoingAt: Date | null
  updatedAt: Date
}

interface InventoryTableProps {
  data: InventoryRow[]
  total: number
  page: number
  pageSize: number
  warehouseZones: string[]
}


const columnHelper = createColumnHelper<InventoryRow>()

function StockCell({ value }: { value: number }) {
  const color =
    value <= 0
      ? 'text-red-600 font-semibold'
      : value <= 10
        ? 'text-amber-600 font-medium'
        : ''
  return <span className={color}>{value.toLocaleString('ko-KR')}</span>
}

export function InventoryTable({ data, total, page, pageSize, warehouseZones }: InventoryTableProps) {
  const [adjustDialog, setAdjustDialog] = useState<{
    open: boolean
    mode: 'set' | 'adjust'
    sku?: string
    productName?: string
    currentStock?: number
  }>({ open: false, mode: 'set' })

  const [historyDialog, setHistoryDialog] = useState<{
    open: boolean
    inventoryId: string
    sku: string
  }>({ open: false, inventoryId: '', sku: '' })

  const [excelDialogOpen, setExcelDialogOpen] = useState(false)

  const [, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [, setPageSize] = useQueryState('pageSize', parseAsInteger.withDefault(50))
  const [filters, setFilters] = useQueryStates({
    search: parseAsString,
    sort: parseAsString,
    order: parseAsString,
    page: parseAsInteger.withDefault(1),
    warehouseZone: parseAsString,
  })

  const [isPending, startTransition] = useTransition()
  const [searchInput, setSearchInput] = useState(filters.search ?? '')
  useEffect(() => { setSearchInput(filters.search ?? '') }, [filters.search])

  const submitSearch = useCallback(() => {
    const trimmed = searchInput.trim()
    startTransition(() => {
      void setFilters({ search: trimmed || null, page: 1 })
    })
  }, [searchInput, setFilters])

  const handleSort = useCallback(
    (columnId: string) => {
      const currentSort = filters.sort
      const currentOrder = filters.order
      let newOrder: string | null = 'asc'
      if (currentSort === columnId) {
        if (currentOrder === 'asc') newOrder = 'desc'
        else if (currentOrder === 'desc') newOrder = null
      }
      void setFilters({
        sort: newOrder ? columnId : null,
        order: newOrder,
        page: 1,
      })
    },
    [filters.sort, filters.order, setFilters],
  )

  const getSortIndicator = (columnId: string) => {
    if (filters.sort !== columnId) return ''
    return filters.order === 'asc' ? ' \u2191' : ' \u2193'
  }

  const columns = [
    columnHelper.display({
      id: 'rowNum',
      header: 'No.',
      cell: (info) => (
        <span className="text-muted-foreground text-xs">
          {(page - 1) * pageSize + info.row.index + 1}
        </span>
      ),
    }),
    columnHelper.accessor('sku', {
      header: () => (
        <button type="button" onClick={() => handleSort('sku')} className="hover:text-foreground">
          상품코드{getSortIndicator('sku')}
        </button>
      ),
      cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
    }),
    columnHelper.accessor('productName', {
      header: () => (
        <button type="button" onClick={() => handleSort('productName')} className="hover:text-foreground">
          상품명{getSortIndicator('productName')}
        </button>
      ),
    }),
    columnHelper.accessor('optionName', {
      header: '옵션명',
      cell: (info) => {
        const val = info.getValue()
        return val ? <span className="text-xs text-muted-foreground">{val}</span> : '-'
      },
    }),
    columnHelper.accessor('warehouseZone', {
      header: () => (
        <button type="button" onClick={() => handleSort('warehouseZone')} className="hover:text-foreground">
          창고{getSortIndicator('warehouseZone')}
        </button>
      ),
      cell: (info) => info.getValue() ?? '-',
    }),
    columnHelper.accessor('sectorCode', {
      header: () => (
        <button type="button" onClick={() => handleSort('sectorCode')} className="hover:text-foreground">
          피킹위치{getSortIndicator('sectorCode')}
        </button>
      ),
      cell: (info) => {
        const val = info.getValue()
        return val ? <span className="font-mono text-xs">{val}</span> : '-'
      },
    }),
    columnHelper.accessor('totalStock', {
      header: () => (
        <button type="button" onClick={() => handleSort('totalStock')} className="hover:text-foreground">
          총재고{getSortIndicator('totalStock')}
        </button>
      ),
      cell: (info) => info.getValue().toLocaleString('ko-KR'),
    }),
    columnHelper.accessor('reservedStock', {
      header: () => (
        <button type="button" onClick={() => handleSort('reservedStock')} className="hover:text-foreground">
          예약{getSortIndicator('reservedStock')}
        </button>
      ),
      cell: (info) => info.getValue().toLocaleString('ko-KR'),
    }),
    columnHelper.accessor('availableStock', {
      header: () => (
        <button type="button" onClick={() => handleSort('availableStock')} className="hover:text-foreground">
          가용{getSortIndicator('availableStock')}
        </button>
      ),
      cell: (info) => <StockCell value={info.getValue()} />,
    }),
    columnHelper.accessor('monthlyIncoming', {
      header: '당월입고',
      cell: (info) => {
        const v = info.getValue()
        return v > 0 ? <span className="text-blue-600">{v.toLocaleString('ko-KR')}</span> : '-'
      },
    }),
    columnHelper.accessor('monthlyOutgoing', {
      header: '당월출고',
      cell: (info) => {
        const v = info.getValue()
        return v > 0 ? <span className="text-orange-600">{v.toLocaleString('ko-KR')}</span> : '-'
      },
    }),
    columnHelper.accessor('lastIncomingAt', {
      header: '최종입고일',
      cell: (info) => {
        const d = info.getValue()
        return d ? new Date(d).toLocaleDateString('ko-KR') : '-'
      },
    }),
    columnHelper.accessor('lastOutgoingAt', {
      header: '최종출고일',
      cell: (info) => {
        const d = info.getValue()
        return d ? new Date(d).toLocaleDateString('ko-KR') : '-'
      },
    }),
    columnHelper.accessor('updatedAt', {
      header: () => (
        <button type="button" onClick={() => handleSort('updatedAt')} className="hover:text-foreground">
          최종수정{getSortIndicator('updatedAt')}
        </button>
      ),
      cell: (info) => {
        const d = info.getValue()
        return d ? new Date(d).toLocaleDateString('ko-KR') : '-'
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: '작업',
      cell: (info) => {
        const row = info.row.original
        return (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setAdjustDialog({
                  open: true,
                  mode: 'adjust',
                  sku: row.sku,
                  productName: row.productName,
                  currentStock: row.totalStock,
                })
              }
              className="rounded border px-2 py-1 text-xs hover:bg-muted"
            >
              조정
            </button>
            <button
              type="button"
              onClick={() =>
                setHistoryDialog({
                  open: true,
                  inventoryId: row.id,
                  sku: row.sku,
                })
              }
              className="rounded border px-2 py-1 text-xs hover:bg-muted"
            >
              이력
            </button>
          </div>
        )
      },
    }),
  ]

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
      pagination: { pageIndex: page - 1, pageSize },
    },
  })

  return (
    <div className="space-y-4">
      {/* Toolbar: search + filter + buttons */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => { e.preventDefault(); submitSearch() }}
            className="flex items-center gap-1"
          >
            <input
              type="text"
              placeholder="상품코드 또는 상품명"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-[220px] rounded-md border px-3 py-1.5 text-sm placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? '검색중...' : '검색'}
            </button>
          </form>
          <select
            value={filters.warehouseZone ?? ''}
            onChange={(e) => {
              void setFilters({
                warehouseZone: e.target.value || null,
                page: 1,
              })
            }}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            <option value="">전체 창고</option>
            {warehouseZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExcelDialogOpen(true)}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            엑셀 업로드
          </button>
          <button
            type="button"
            onClick={() => setAdjustDialog({ open: true, mode: 'set' })}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            재고 등록
          </button>
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
                  재고 항목이 없습니다.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, idx) => (
                <tr
                  key={row.id}
                  className={`border-b transition-colors hover:bg-muted/50 ${
                    idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
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
        onPageChange={(p) => void setPage(p)}
        onPageSizeChange={(s) => void setPageSize(s)}
      />

      {/* Dialogs */}
      {adjustDialog.open && (
        <AdjustStockDialog
          mode={adjustDialog.mode}
          sku={adjustDialog.sku}
          productName={adjustDialog.productName}
          currentStock={adjustDialog.currentStock}
          onClose={() => setAdjustDialog({ open: false, mode: 'set' })}
        />
      )}

      {historyDialog.open && (
        <HistoryDialog
          inventoryId={historyDialog.inventoryId}
          sku={historyDialog.sku}
          onClose={() => setHistoryDialog({ open: false, inventoryId: '', sku: '' })}
        />
      )}

      {excelDialogOpen && (
        <ExcelUploadDialog onClose={() => setExcelDialogOpen(false)} />
      )}
    </div>
  )
}
