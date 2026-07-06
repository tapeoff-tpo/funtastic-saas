'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type RowSelectionState,
  useReactTable,
} from '@tanstack/react-table'
import { parseAsInteger, parseAsString, useQueryState, useQueryStates } from 'nuqs'
import { toast } from 'sonner'
import { AdjustStockDialog } from './adjust-stock-dialog'
import { BulkAdjustmentDialog } from './bulk-adjustment-dialog'
import { ExcelUploadDialog } from './excel-upload-dialog'
import { HistoryDialog } from './history-dialog'
import { Pagination } from '@/components/ui/pagination'
import { SyncedScrollContainer } from '@/components/ui/synced-scroll'
import { useColumnSizing } from '@/lib/hooks/use-column-sizing'

export interface InventoryRow {
  id: string
  sku: string
  productName: string
  optionName: string | null
  warehouseZone: string | null
  availableStock: number
  oneWarehouseStock: number
  coupangWarehouseStock: number
  twoWarehouseStock: number
  primaryTotalStock: number
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
  updatedAt: Date
}

interface InventoryTableProps {
  data: InventoryRow[]
  total: number
  page: number
  pageSize: number
  warehouseZones: string[]
  searched: boolean
  mode?: 'inventory' | 'adjustments'
}

const columnHelper = createColumnHelper<InventoryRow>()

function formatNumber(value: number, maximumFractionDigits = 0) {
  return value.toLocaleString('ko-KR', { maximumFractionDigits })
}

function StockBreakdownCell({ row }: { row: InventoryRow }) {
  const lowStock = row.availableStock <= 0
  return (
    <div className="text-right tabular-nums">
      <div className={lowStock ? 'font-semibold text-red-600' : 'font-semibold'}>
        {formatNumber(row.availableStock)}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {formatNumber(row.oneWarehouseStock)} - {formatNumber(row.coupangWarehouseStock)} - {formatNumber(row.twoWarehouseStock)}
      </div>
    </div>
  )
}

export function InventoryTable({
  data,
  total,
  page,
  pageSize,
  warehouseZones,
  searched,
  mode = 'inventory',
}: InventoryTableProps) {
  const [adjustDialog, setAdjustDialog] = useState<{
    open: boolean
    mode: 'set' | 'adjust'
    inventoryId?: string
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
  const [bulkAdjustmentOpen, setBulkAdjustmentOpen] = useState(false)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const [, setPage] = useQueryState('page', parseAsInteger.withDefault(1).withOptions({ shallow: false }))
  const [, setPageSize] = useQueryState('pageSize', parseAsInteger.withDefault(25).withOptions({ shallow: false }))
  const [filters, setFilters] = useQueryStates({
    search: parseAsString,
    productCode: parseAsString,
    optionCode: parseAsString,
    maxStock: parseAsInteger,
    sort: parseAsString,
    order: parseAsString,
    page: parseAsInteger.withDefault(1),
    warehouseZone: parseAsString,
    searched: parseAsString,
  }, { shallow: false })

  const [isPending, startTransition] = useTransition()
  const [searchInput, setSearchInput] = useState(filters.search ?? '')
  const [productCodeInput, setProductCodeInput] = useState(filters.productCode ?? '')
  const [optionCodeInput, setOptionCodeInput] = useState(filters.optionCode ?? '')
  const [maxStockInput, setMaxStockInput] = useState(filters.maxStock != null ? String(filters.maxStock) : '')

  useEffect(() => { setSearchInput(filters.search ?? '') }, [filters.search])
  useEffect(() => { setProductCodeInput(filters.productCode ?? '') }, [filters.productCode])
  useEffect(() => { setOptionCodeInput(filters.optionCode ?? '') }, [filters.optionCode])
  useEffect(() => {
    setMaxStockInput(filters.maxStock != null ? String(filters.maxStock) : '')
  }, [filters.maxStock])

  const submitSearch = useCallback(() => {
    const maxStock = maxStockInput.trim() === '' ? null : Number(maxStockInput)
    if (maxStock !== null && (!Number.isFinite(maxStock) || maxStock < 0)) {
      toast.error('재고수량은 0 이상의 숫자만 입력 가능합니다')
      return
    }
    startTransition(() => {
      void setFilters({
        search: searchInput.trim() || null,
        productCode: productCodeInput.trim() || null,
        optionCode: optionCodeInput.trim() || null,
        maxStock,
        page: 1,
        searched: '1',
      })
    })
  }, [maxStockInput, optionCodeInput, productCodeInput, searchInput, setFilters])

  const handleResetFilters = useCallback(() => {
    setSearchInput('')
    setProductCodeInput('')
    setOptionCodeInput('')
    setMaxStockInput('')
    void setFilters({
      search: null,
      productCode: null,
      optionCode: null,
      maxStock: null,
      warehouseZone: null,
      page: 1,
      searched: null,
    })
  }, [setFilters])

  const handleSort = useCallback((columnId: string) => {
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
  }, [filters.order, filters.sort, setFilters])

  const getSortIndicator = (columnId: string) => {
    if (filters.sort !== columnId) return ''
    return filters.order === 'asc' ? ' ↑' : ' ↓'
  }

  const now = new Date()
  const [dlYear, setDlYear] = useState(now.getFullYear())
  const [dlMonth, setDlMonth] = useState(now.getMonth() + 1)
  const yearOptions = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()]

  const downloadExcel = useCallback((selectedOnly: boolean) => {
    const params = new URLSearchParams({ year: String(dlYear), month: String(dlMonth) })
    if (selectedOnly) {
      const skus = Object.keys(rowSelection)
        .filter((key) => rowSelection[key])
        .map((key) => data[Number(key)]?.sku)
        .filter(Boolean)
      if (skus.length === 0) return
      params.set('skus', skus.join(','))
    }
    const link = document.createElement('a')
    link.href = `/api/inventory/export?${params}`
    link.click()
  }, [data, dlMonth, dlYear, rowSelection])

  const selectedCount = Object.values(rowSelection).filter(Boolean).length
  const hasFilters = Boolean(
    filters.search
      || filters.productCode
      || filters.optionCode
      || filters.maxStock != null
      || filters.warehouseZone,
  )

  const columns = [
    columnHelper.display({
      id: 'select',
      size: 32,
      header: ({ table }) => (
        <input
          type="checkbox"
          className="h-3 w-3"
          checked={table.getIsAllPageRowsSelected()}
          ref={(element) => { if (element) element.indeterminate = table.getIsSomePageRowsSelected() }}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="h-3 w-3"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    }),
    columnHelper.display({
      id: 'rowNum',
      size: 44,
      header: 'No.',
      cell: (info) => (
        <span className="text-xs text-muted-foreground">
          {(page - 1) * pageSize + info.row.index + 1}
        </span>
      ),
    }),
    columnHelper.accessor('sku', {
      size: 120,
      header: () => (
        <button type="button" onClick={() => handleSort('sku')} className="hover:text-foreground">
          상품코드{getSortIndicator('sku')}
        </button>
      ),
      cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
    }),
    columnHelper.accessor('productName', {
      size: 260,
      header: () => (
        <button type="button" onClick={() => handleSort('productName')} className="hover:text-foreground">
          상품명{getSortIndicator('productName')}
        </button>
      ),
      cell: (info) => <span className="block truncate" title={info.getValue()}>{info.getValue()}</span>,
    }),
    columnHelper.accessor('optionName', {
      size: 180,
      header: '옵션명',
      cell: (info) => info.getValue() || '-',
    }),
    columnHelper.display({
      id: 'availableStock',
      size: 170,
      header: () => (
        <button type="button" onClick={() => handleSort('availableStock')} className="hover:text-foreground">
          현재고(total-1창고-쿠팡-2창고){getSortIndicator('availableStock')}
        </button>
      ),
      cell: (info) => <StockBreakdownCell row={info.row.original} />,
    }),
    columnHelper.accessor('currentMonthOutgoing', {
      size: 110,
      header: '당월 출고수량',
      cell: (info) => <span className="tabular-nums">{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor('threeMonthAverageOutgoing', {
      size: 130,
      header: '3개월평균출고수량',
      cell: (info) => <span className="tabular-nums">{formatNumber(info.getValue(), 1)}</span>,
    }),
    columnHelper.accessor('warehouseZone', {
      size: 130,
      header: () => (
        <button type="button" onClick={() => handleSort('warehouseZone')} className="hover:text-foreground">
          창고{getSortIndicator('warehouseZone')}
        </button>
      ),
      cell: (info) => info.getValue() || '-',
    }),
    columnHelper.accessor('updatedAt', {
      size: 110,
      header: () => (
        <button type="button" onClick={() => handleSort('updatedAt')} className="hover:text-foreground">
          최종수정날짜{getSortIndicator('updatedAt')}
        </button>
      ),
      cell: (info) => new Date(info.getValue()).toLocaleDateString('ko-KR'),
    }),
    columnHelper.display({
      id: 'actions',
      size: 120,
      header: '작업',
      cell: (info) => {
        const row = info.row.original
        return (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAdjustDialog({
                open: true,
                mode: 'adjust',
                inventoryId: row.id,
                sku: row.sku,
                productName: row.productName,
                currentStock: row.primaryTotalStock,
              })}
              className="rounded border px-2 py-1 text-xs hover:bg-muted"
            >
              조정
            </button>
            <button
              type="button"
              onClick={() => setHistoryDialog({ open: true, inventoryId: row.id, sku: row.sku })}
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
  const [columnSizing, setColumnSizing] = useColumnSizing('inventory-table-v2')
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableRowSelection: true,
    columnResizeMode: 'onChange',
    pageCount,
    state: {
      pagination: { pageIndex: page - 1, pageSize },
      rowSelection,
      columnSizing,
    },
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: setColumnSizing,
  })

  return (
    <div className="space-y-2">
      <form onSubmit={(event) => { event.preventDefault(); submitSearch() }} className="rounded-md border bg-muted/30 p-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">창고</span>
            <select
              value={filters.warehouseZone ?? ''}
              onChange={(event) => void setFilters({ warehouseZone: event.target.value || null, page: 1, searched: '1' })}
              className="rounded-md border bg-white px-2 py-1 text-xs"
            >
              <option value="">전체</option>
              {warehouseZones.map((zone) => (
                <option key={zone} value={zone}>{zone}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">상품명</span>
            <input
              type="text"
              placeholder="상품명 검색"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="w-[180px] rounded-md border bg-white px-2 py-1 text-xs placeholder:text-muted-foreground"
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">상품코드</span>
            <input
              type="text"
              placeholder="상품코드 검색"
              value={productCodeInput}
              onChange={(event) => setProductCodeInput(event.target.value)}
              className="w-[140px] rounded-md border bg-white px-2 py-1 text-xs font-mono placeholder:font-sans placeholder:text-muted-foreground"
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">옵션명</span>
            <input
              type="text"
              placeholder="옵션/SKU"
              value={optionCodeInput}
              onChange={(event) => setOptionCodeInput(event.target.value)}
              className="w-[140px] rounded-md border bg-white px-2 py-1 text-xs font-mono placeholder:font-sans placeholder:text-muted-foreground"
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">현재고</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="N"
              value={maxStockInput}
              onChange={(event) => setMaxStockInput(event.target.value)}
              className="w-[70px] rounded-md border bg-white px-2 py-1 text-xs placeholder:text-muted-foreground"
            />
            <span className="text-muted-foreground">개 이하</span>
          </label>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? '검색중...' : '검색'}
            </button>
            {hasFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                초기화
              </button>
            )}
          </div>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-y bg-muted/10 py-1.5">
        <div className="min-w-0 flex-1">
          {searched && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={(nextPage) => void setPage(nextPage)}
              onPageSizeChange={(nextPageSize) => void setPageSize(nextPageSize)}
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          <select value={dlYear} onChange={(event) => setDlYear(Number(event.target.value))} className="rounded border px-1.5 py-1 text-xs">
            {yearOptions.map((year) => <option key={year} value={year}>{year}년</option>)}
          </select>
          <select value={dlMonth} onChange={(event) => setDlMonth(Number(event.target.value))} className="rounded border px-1.5 py-1 text-xs">
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <option key={month} value={month}>{month}월</option>
            ))}
          </select>
          <button type="button" onClick={() => downloadExcel(true)} disabled={selectedCount === 0} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">
            선택 다운({selectedCount})
          </button>
          <button type="button" onClick={() => downloadExcel(false)} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted">
            일괄 다운
          </button>
          {mode === 'inventory' && (
            <button type="button" onClick={() => setExcelDialogOpen(true)} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted">
              엑셀 업로드
            </button>
          )}
          {mode === 'adjustments' ? (
            <>
              <a href="/api/inventory/adjustments/template" className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted">
                엑셀양식 다운로드
              </a>
              <button type="button" onClick={() => setBulkAdjustmentOpen(true)} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                대량등록
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setAdjustDialog({ open: true, mode: 'set' })} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
              재고 등록
            </button>
          )}
        </div>
      </div>

      {!searched ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          검색 조건을 입력하고 <span className="font-medium text-foreground">검색</span> 버튼을 눌러주세요.
        </div>
      ) : (
        <SyncedScrollContainer>
          <table className="text-xs" style={{ width: table.getTotalSize() }}>
            <thead className="sticky top-0 z-[1] bg-muted/50">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b">
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} style={{ width: header.getSize() }} className="relative whitespace-nowrap px-2 py-1.5 text-left font-medium text-muted-foreground">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onClick={(event) => event.stopPropagation()}
                          className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none bg-transparent hover:bg-blue-400 ${header.column.getIsResizing() ? 'bg-blue-500' : ''}`}
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
                  <td colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                    재고 항목이 없습니다.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row, index) => (
                  <tr key={row.id} className={`border-b transition-colors hover:bg-muted/50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} style={{ width: cell.column.getSize() }} className="overflow-hidden whitespace-nowrap px-2 py-1">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </SyncedScrollContainer>
      )}

      {adjustDialog.open && (
        <AdjustStockDialog
          mode={adjustDialog.mode}
          inventoryId={adjustDialog.inventoryId}
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
      {excelDialogOpen && <ExcelUploadDialog onClose={() => setExcelDialogOpen(false)} />}
      {bulkAdjustmentOpen && (
        <BulkAdjustmentDialog
          warehouseZones={warehouseZones}
          onClose={() => setBulkAdjustmentOpen(false)}
        />
      )}
    </div>
  )
}
