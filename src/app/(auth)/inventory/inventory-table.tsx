'use client'

import { useState, useCallback, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table'
import { useQueryState, useQueryStates, parseAsInteger, parseAsString } from 'nuqs'
import { toast } from 'sonner'
import { AdjustStockDialog } from './adjust-stock-dialog'
import { HistoryDialog } from './history-dialog'
import { ExcelUploadDialog } from './excel-upload-dialog'
import { IncomingDialog } from './incoming-dialog'
import { Pagination } from '@/components/ui/pagination'
import { Input } from '@/components/ui/input'
import { SyncedScrollContainer } from '@/components/ui/synced-scroll'
import { useColumnSizing } from '@/lib/hooks/use-column-sizing'
import { updateShippingCost } from './actions'

export interface InventoryRow {
  id: string
  productId: string
  sku: string
  productName: string
  optionName: string | null
  packagingUnit: string | null
  warehouseZone: string | null
  sectorCode: string | null
  totalStock: number
  reservedStock: number
  availableStock: number
  monthlyIncoming: number
  monthlyOutgoing: number
  lastIncomingAt: Date | null
  lastOutgoingAt: Date | null
  shippingCost: string | null
  updatedAt: Date
}

interface InventoryTableProps {
  data: InventoryRow[]
  total: number
  page: number
  pageSize: number
  warehouseZones: string[]
  /** 검색 sentinel — false 면 안내 메시지만 표시하고 fetch 안 함 */
  searched: boolean
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

/**
 * Inline-editable cell for products.shipping_cost (SaaS 배송비 원가).
 * - draft state holds the current input string
 * - onBlur: validate → call updateShippingCost server action via useTransition
 * - On error: revert draft + toast.error
 * - On success: toast.success
 */
function ShippingCostCell({
  productId,
  value,
}: {
  productId: string
  value: string | number | null
}) {
  const initial = value == null ? '' : String(value)
  const [draft, setDraft] = useState(initial)
  const [pending, startTransition] = useTransition()

  // Sync external value changes (e.g. after revalidatePath) into the draft
  useEffect(() => {
    setDraft(initial)
  }, [initial])

  return (
    <div className="flex items-center justify-end gap-1">
      <Input
        type="number"
        min={0}
        step="1"
        inputMode="numeric"
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === initial) return
          const num = draft === '' ? null : Number(draft)
          if (num !== null && (Number.isNaN(num) || num < 0)) {
            setDraft(initial)
            toast.error('숫자만 입력 가능합니다')
            return
          }
          startTransition(async () => {
            const result = await updateShippingCost(productId, num)
            if (result.ok) {
              toast.success('배송비 저장됨')
            } else {
              setDraft(initial)
              toast.error(result.error)
            }
          })
        }}
        className="h-7 w-24 text-right text-xs"
      />
      <span className="text-xs text-muted-foreground">원</span>
    </div>
  )
}

export function InventoryTable({ data, total, page, pageSize, warehouseZones, searched }: InventoryTableProps) {
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
  const [incomingDialogOpen, setIncomingDialogOpen] = useState(false)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const [, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ shallow: false }),
  )
  const [, setPageSize] = useQueryState(
    'pageSize',
    parseAsInteger.withDefault(25).withOptions({ shallow: false }),
  )
  const [filters, setFilters] = useQueryStates({
    search: parseAsString,
    productCode: parseAsString,
    optionCode: parseAsString,
    maxStock: parseAsInteger,
    sort: parseAsString,
    order: parseAsString,
    page: parseAsInteger.withDefault(1),
    warehouseZone: parseAsString,
    // SaaS 배송비(원가) 컬럼 표시 토글 — 검색폼 체크박스로 제어
    showShippingCost: parseAsString,
    // 검색 트리거 sentinel — page.tsx 가 이게 켜졌을 때만 fetch
    searched: parseAsString,
  }, { shallow: false })

  // 컬럼 노출 여부 — '1' 일 때만 SaaS 배송비 컬럼 보임
  const showShippingCost = filters.showShippingCost === '1'

  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const [searchInput, setSearchInput] = useState(filters.search ?? '')
  const [productCodeInput, setProductCodeInput] = useState(filters.productCode ?? '')
  const [optionCodeInput, setOptionCodeInput] = useState(filters.optionCode ?? '')
  const [maxStockInput, setMaxStockInput] = useState(
    filters.maxStock != null ? String(filters.maxStock) : '',
  )
  // 배송비 컬럼 토글 — 체크박스 입력 상태(검색 시 URL 에 반영)
  const [showShippingInput, setShowShippingInput] = useState(showShippingCost)
  useEffect(() => { setSearchInput(filters.search ?? '') }, [filters.search])
  useEffect(() => { setProductCodeInput(filters.productCode ?? '') }, [filters.productCode])
  useEffect(() => { setOptionCodeInput(filters.optionCode ?? '') }, [filters.optionCode])
  useEffect(() => {
    setMaxStockInput(filters.maxStock != null ? String(filters.maxStock) : '')
  }, [filters.maxStock])
  useEffect(() => { setShowShippingInput(showShippingCost) }, [showShippingCost])

  const submitSearch = useCallback(() => {
    const trimmedSearch = searchInput.trim()
    const trimmedProduct = productCodeInput.trim()
    const trimmedOption = optionCodeInput.trim()
    const trimmedMax = maxStockInput.trim()
    const maxStockNum = trimmedMax === '' ? null : Number(trimmedMax)
    if (maxStockNum !== null && (Number.isNaN(maxStockNum) || maxStockNum < 0)) {
      toast.error('재고수량은 0 이상의 숫자만 입력 가능합니다')
      return
    }
    startTransition(() => {
      void setFilters({
        search: trimmedSearch || null,
        productCode: trimmedProduct || null,
        optionCode: trimmedOption || null,
        maxStock: maxStockNum,
        showShippingCost: showShippingInput ? '1' : null,
        page: 1,
        // 검색 sentinel 켜기
        searched: '1',
      })
    })
  }, [searchInput, productCodeInput, optionCodeInput, maxStockInput, showShippingInput, setFilters])

  const handleResetFilters = useCallback(() => {
    setSearchInput('')
    setProductCodeInput('')
    setOptionCodeInput('')
    setMaxStockInput('')
    setShowShippingInput(false)
    void setFilters({
      search: null,
      productCode: null,
      optionCode: null,
      maxStock: null,
      warehouseZone: null,
      showShippingCost: null,
      page: 1,
      searched: null,
    })
  }, [setFilters])

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

  const now = new Date()
  const [dlYear, setDlYear] = useState(now.getFullYear())
  const [dlMonth, setDlMonth] = useState(now.getMonth() + 1)

  const downloadExcel = useCallback((selectedOnly: boolean) => {
    const params = new URLSearchParams({ year: String(dlYear), month: String(dlMonth) })
    if (selectedOnly) {
      const skus = Object.keys(rowSelection)
        .filter((k) => rowSelection[k])
        .map((k) => data[Number(k)]?.sku)
        .filter(Boolean)
      if (skus.length === 0) return
      params.set('skus', skus.join(','))
    }
    const a = document.createElement('a')
    a.href = `/api/inventory/export?${params}`
    a.click()
  }, [rowSelection, data, dlYear, dlMonth])

  const selectedCount = Object.values(rowSelection).filter(Boolean).length

  // Year options: current year and 2 years back
  const yearOptions = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()]

  const columns = [
    columnHelper.display({
      id: 'select',
      size: 32,
      header: ({ table }) => (
        <input
          type="checkbox"
          className="h-3 w-3"
          checked={table.getIsAllPageRowsSelected()}
          ref={(el) => { if (el) el.indeterminate = table.getIsSomePageRowsSelected() }}
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
        <span className="text-muted-foreground text-xs">
          {(page - 1) * pageSize + info.row.index + 1}
        </span>
      ),
    }),
    columnHelper.accessor('sku', {
      size: 110,
      header: () => (
        <button type="button" onClick={() => handleSort('sku')} className="hover:text-foreground">
          상품코드{getSortIndicator('sku')}
        </button>
      ),
      cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
    }),
    // 상품명/옵션명 — 너비 기본값 크게 (사용자 요구: 이 두 열은 최소화 제외)
    columnHelper.accessor('productName', {
      size: 260,
      header: () => (
        <button type="button" onClick={() => handleSort('productName')} className="hover:text-foreground">
          상품명{getSortIndicator('productName')}
        </button>
      ),
    }),
    columnHelper.accessor('optionName', {
      size: 200,
      header: '옵션명',
      cell: (info) => {
        const val = info.getValue()
        return val ? <span className="text-xs text-muted-foreground">{val}</span> : '-'
      },
    }),
    columnHelper.accessor('warehouseZone', {
      size: 70,
      header: () => (
        <button type="button" onClick={() => handleSort('warehouseZone')} className="hover:text-foreground">
          창고{getSortIndicator('warehouseZone')}
        </button>
      ),
      cell: (info) => info.getValue() ?? '-',
    }),
    columnHelper.accessor('totalStock', {
      size: 70,
      header: () => (
        <button type="button" onClick={() => handleSort('totalStock')} className="hover:text-foreground">
          총재고{getSortIndicator('totalStock')}
        </button>
      ),
      cell: (info) => info.getValue().toLocaleString('ko-KR'),
    }),
    columnHelper.accessor('reservedStock', {
      size: 56,
      header: () => (
        <button type="button" onClick={() => handleSort('reservedStock')} className="hover:text-foreground">
          예약{getSortIndicator('reservedStock')}
        </button>
      ),
      cell: (info) => info.getValue().toLocaleString('ko-KR'),
    }),
    columnHelper.accessor('availableStock', {
      size: 56,
      header: () => (
        <button type="button" onClick={() => handleSort('availableStock')} className="hover:text-foreground">
          가용{getSortIndicator('availableStock')}
        </button>
      ),
      cell: (info) => <StockCell value={info.getValue()} />,
    }),
    columnHelper.accessor('monthlyIncoming', {
      size: 72,
      header: '당월입고',
      cell: (info) => {
        const v = info.getValue()
        return v > 0
          ? <span className="text-blue-600">{v.toLocaleString('ko-KR')}</span>
          : <span className="text-muted-foreground">0</span>
      },
    }),
    columnHelper.accessor('monthlyOutgoing', {
      size: 72,
      header: '당월출고',
      cell: (info) => {
        const v = info.getValue()
        return v > 0
          ? <span className="text-orange-600">{v.toLocaleString('ko-KR')}</span>
          : <span className="text-muted-foreground">0</span>
      },
    }),
    // SaaS 배송비(원가) — 검색폼의 "배송비 표시" 체크 후에만 노출
    ...(showShippingCost
      ? [
          columnHelper.accessor('shippingCost', {
            size: 140,
            header: 'SaaS 배송비(원가)',
            cell: (info) => (
              <ShippingCostCell
                productId={info.row.original.productId}
                value={info.getValue()}
              />
            ),
          }),
        ]
      : []),
    columnHelper.accessor('lastIncomingAt', {
      size: 96,
      header: '최종입고일',
      cell: (info) => {
        const d = info.getValue()
        return d ? new Date(d).toLocaleDateString('ko-KR') : '-'
      },
    }),
    columnHelper.accessor('lastOutgoingAt', {
      size: 96,
      header: '최종출고일',
      cell: (info) => {
        const d = info.getValue()
        return d ? new Date(d).toLocaleDateString('ko-KR') : '-'
      },
    }),
    // 포장/피킹위치 — 사용자 요구: 최종출고일 뒤로 이동
    columnHelper.accessor('packagingUnit', {
      size: 64,
      header: '포장',
      cell: (info) => {
        const val = info.getValue()
        return val ? <span className="text-xs text-muted-foreground">{val}</span> : '-'
      },
    }),
    columnHelper.accessor('sectorCode', {
      size: 84,
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
    columnHelper.accessor('updatedAt', {
      size: 96,
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
      size: 100,
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

  // 컬럼 너비 — localStorage 에 저장해서 재방문 시에도 유지
  const [columnSizing, setColumnSizing] = useColumnSizing('inventory-table')

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

  const hasFilters =
    !!filters.search ||
    !!filters.productCode ||
    !!filters.optionCode ||
    filters.maxStock != null ||
    !!filters.warehouseZone

  return (
    <div className="space-y-2">
      {/* Filter panel — 사방넷 스타일 dense form */}
      <form
        onSubmit={(e) => { e.preventDefault(); submitSearch() }}
        className="rounded-md border bg-muted/30 p-2"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">창고</span>
            <select
              value={filters.warehouseZone ?? ''}
              onChange={(e) => {
                void setFilters({
                  warehouseZone: e.target.value || null,
                  page: 1,
                  searched: '1',
                })
              }}
              className="rounded-md border bg-white px-2 py-1 text-xs"
            >
              <option value="">전체</option>
              {warehouseZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">상품명</span>
            <input
              type="text"
              placeholder="상품명 검색"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-[180px] rounded-md border bg-white px-2 py-1 text-xs placeholder:text-muted-foreground"
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">품번코드</span>
            <input
              type="text"
              placeholder="품번 검색"
              value={productCodeInput}
              onChange={(e) => setProductCodeInput(e.target.value)}
              className="w-[140px] rounded-md border bg-white px-2 py-1 text-xs font-mono placeholder:font-sans placeholder:text-muted-foreground"
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">단품코드</span>
            <input
              type="text"
              placeholder="옵션/단품 SKU"
              value={optionCodeInput}
              onChange={(e) => setOptionCodeInput(e.target.value)}
              className="w-[140px] rounded-md border bg-white px-2 py-1 text-xs font-mono placeholder:font-sans placeholder:text-muted-foreground"
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">재고수량</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="N"
              value={maxStockInput}
              onChange={(e) => setMaxStockInput(e.target.value)}
              className="w-[70px] rounded-md border bg-white px-2 py-1 text-xs placeholder:text-muted-foreground"
            />
            <span className="text-muted-foreground">개 이하</span>
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showShippingInput}
              onChange={(e) => setShowShippingInput(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span className="text-muted-foreground">SaaS 배송비(원가) 표시</span>
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

      {/* Top toolbar: pagination + bulk actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-y bg-muted/10 py-1.5">
        <div className="flex-1 min-w-0">
          {searched && (
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
          )}
        </div>
        <div className="flex items-center gap-1">
          <select
            value={dlYear}
            onChange={(e) => setDlYear(Number(e.target.value))}
            className="rounded border px-1.5 py-1 text-xs"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <select
            value={dlMonth}
            onChange={(e) => setDlMonth(Number(e.target.value))}
            className="rounded border px-1.5 py-1 text-xs"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => downloadExcel(true)}
            disabled={selectedCount === 0}
            className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            선택 다운({selectedCount})
          </button>
          <button
            type="button"
            onClick={() => downloadExcel(false)}
            className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted"
          >
            일괄 다운
          </button>
          <button
            type="button"
            onClick={() => setExcelDialogOpen(true)}
            className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted"
          >
            엑셀 업로드
          </button>
          <button
            type="button"
            onClick={() => setIncomingDialogOpen(true)}
            className="rounded-md border border-green-600 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
          >
            입고 처리
          </button>
          <button
            type="button"
            onClick={() => setAdjustDialog({ open: true, mode: 'set' })}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            재고 등록
          </button>
        </div>
      </div>

      {/* Table — searched 가드 */}
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
                    <th
                      key={header.id}
                      style={{ width: header.getSize() }}
                      className="relative whitespace-nowrap px-2 py-1.5 text-left font-medium text-muted-foreground"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onClick={(e) => e.stopPropagation()}
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
                      <td
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                        className="overflow-hidden whitespace-nowrap px-2 py-1"
                      >
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

      {incomingDialogOpen && (
        <IncomingDialog onClose={() => setIncomingDialogOpen(false)} />
      )}

    </div>
  )
}
