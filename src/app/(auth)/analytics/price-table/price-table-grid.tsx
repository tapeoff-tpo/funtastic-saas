'use client'

import { useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Columns3,
  RotateCcw,
} from 'lucide-react'
import {
  findMarketplaceProductIds,
  getPriceTableDisplayColumns,
  type PriceTableDisplayColumn,
} from './price-table-columns'

export type PriceTableGridRow = {
  id: string
  rowNumber: number
  productCode: string | null
  productName: string | null
  optionName: string | null
  registeredProductName: string | null
  rawData: Record<string, string>
}

type CoreColumn = {
  id: string
  label: string
  sortKey: string
  required?: boolean
  defaultVisible?: boolean
}

const CORE_COLUMNS: CoreColumn[] = [
  { id: 'productCode', label: '상품코드', sortKey: 'productCode', required: true, defaultVisible: true },
  { id: 'productName', label: '상품명', sortKey: 'productName', required: true, defaultVisible: true },
  { id: 'optionName', label: '옵션', sortKey: 'optionName', defaultVisible: true },
  { id: 'registeredProductName', label: '등록상품명', sortKey: 'registeredProductName', defaultVisible: true },
  { id: 'rowNumber', label: '원본 행', sortKey: 'rowNumber' },
]

const REQUIRED_COLUMN_IDS = CORE_COLUMNS.filter((column) => column.required).map((column) => column.id)

export function PriceTableGrid({
  rows,
  sheetName,
  sortKey,
  sortOrder,
}: {
  rows: PriceTableGridRow[]
  sheetName: string
  sortKey: string
  sortOrder: 'asc' | 'desc'
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const priceColumns = useMemo(() => getPriceTableDisplayColumns(sheetName), [sheetName])
  const recommendedIds = useMemo(
    () => getRecommendedIds(sheetName, priceColumns),
    [priceColumns, sheetName],
  )
  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(() => new Set(recommendedIds))

  const visibleCoreColumns = CORE_COLUMNS.filter((column) => visibleColumnIds.has(column.id))
  const visiblePriceColumns = priceColumns.filter((column) => visibleColumnIds.has(column.id))
  const columnCount = visibleCoreColumns.length + visiblePriceColumns.length
  const hasAdditionalPriceColumns = priceColumns.some((column) => !column.defaultVisible)

  function updateSort(nextSortKey: string) {
    const params = new URLSearchParams(searchParams.toString())
    const nextOrder = sortKey === nextSortKey && sortOrder === 'asc' ? 'desc' : 'asc'
    params.set('sort', nextSortKey)
    params.set('order', nextOrder)
    params.delete('page')
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  function toggleColumn(id: string) {
    if (REQUIRED_COLUMN_IDS.includes(id)) return
    setVisibleColumnIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function showCoreOnly() {
    setVisibleColumnIds(new Set(getCorePresetIds(sheetName)))
  }

  function showAllPrices() {
    setVisibleColumnIds(new Set([
      ...getCorePresetIds(sheetName),
      ...priceColumns.map((column) => column.id),
    ]))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-card p-1">
          <PresetButton active={sameSet(visibleColumnIds, new Set(recommendedIds))} onClick={() => setVisibleColumnIds(new Set(recommendedIds))}>
            추천 구성
          </PresetButton>
          <PresetButton active={sameSet(visibleColumnIds, new Set(getCorePresetIds(sheetName)))} onClick={showCoreOnly}>
            기본정보만
          </PresetButton>
          {hasAdditionalPriceColumns ? (
            <PresetButton active={visiblePriceColumns.length === priceColumns.length} onClick={showAllPrices}>
              가격 전체
            </PresetButton>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">{columnCount}개 열 표시</span>
          <details className="relative">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border bg-background px-2.5 text-sm font-medium hover:bg-muted [&::-webkit-details-marker]:hidden">
              <Columns3 className="size-4" />
              <span className="sm:hidden">열 선택</span>
              <span className="hidden sm:inline">표시 열</span>
            </summary>
            <div className="absolute right-0 z-40 mt-1 w-[290px] rounded-md border bg-popover p-3 text-popover-foreground shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">표시할 열</span>
                <button
                  type="button"
                  onClick={() => setVisibleColumnIds(new Set(recommendedIds))}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" />
                  초기화
                </button>
              </div>
              <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                <ColumnGroup title="기본 정보">
                  {CORE_COLUMNS.map((column) => (
                    <ColumnToggle
                      key={column.id}
                      checked={visibleColumnIds.has(column.id)}
                      disabled={column.required}
                      label={column.label}
                      onChange={() => toggleColumn(column.id)}
                    />
                  ))}
                </ColumnGroup>
                <ColumnGroup title={sheetName === '메인' ? '가격·마진' : '플랫폼 가격'}>
                  {priceColumns.map((column) => (
                    <ColumnToggle
                      key={column.id}
                      checked={visibleColumnIds.has(column.id)}
                      label={column.label}
                      onChange={() => toggleColumn(column.id)}
                    />
                  ))}
                </ColumnGroup>
              </div>
            </div>
          </details>
        </div>
      </div>

      <div className={`relative max-h-[calc(100vh-250px)] min-h-[320px] overflow-auto rounded-md border bg-card ${isPending ? 'opacity-60' : ''}`}>
        <table
          className="w-full border-separate border-spacing-0 text-sm"
          style={{ minWidth: `${430 + Math.max(0, visibleCoreColumns.length - 2) * 160 + visiblePriceColumns.length * 150}px` }}
        >
          <thead>
            <tr>
              {visibleCoreColumns.map((column) => (
                <SortableHeader
                  key={column.id}
                  label={column.label}
                  active={sortKey === column.sortKey}
                  order={sortOrder}
                  onClick={() => updateSort(column.sortKey)}
                  className={coreHeaderClass(column.id)}
                />
              ))}
              {visiblePriceColumns.map((column) => (
                <SortableHeader
                  key={column.id}
                  label={column.label}
                  active={sortKey === rawSortKey(column)}
                  order={sortOrder}
                  onClick={() => updateSort(rawSortKey(column))}
                  alignRight
                  className="min-w-[150px]"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(1, columnCount)} className="h-40 border-t px-4 text-center text-muted-foreground">
                  조건에 맞는 상품이 없습니다.
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="group">
                {visibleCoreColumns.map((column) => (
                  <CoreCell key={column.id} column={column} row={row} />
                ))}
                {visiblePriceColumns.map((column) => (
                  <PriceCell key={column.id} column={column} row={row} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortableHeader({
  label,
  active,
  order,
  onClick,
  alignRight = false,
  className = '',
}: {
  label: string
  active: boolean
  order: 'asc' | 'desc'
  onClick: () => void
  alignRight?: boolean
  className?: string
}) {
  return (
    <th
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`sticky top-0 z-20 border-b bg-muted px-3 py-2.5 font-medium text-muted-foreground ${className}`}
    >
      <button
        type="button"
        onClick={onClick}
        title={`${label} 정렬`}
        className={`flex w-full items-center gap-1 hover:text-foreground ${alignRight ? 'justify-end text-right' : 'justify-start text-left'}`}
      >
        <span className="line-clamp-2">{label}</span>
        {active
          ? order === 'desc' ? <ArrowDown className="size-3.5 shrink-0" /> : <ArrowUp className="size-3.5 shrink-0" />
          : <ArrowUpDown className="size-3.5 shrink-0 opacity-40" />}
      </button>
    </th>
  )
}

function CoreCell({ column, row }: { column: CoreColumn; row: PriceTableGridRow }) {
  const value = column.id === 'rowNumber' ? String(row.rowNumber) : row[column.id as keyof PriceTableGridRow]
  return (
    <td className={`border-b px-3 py-2 align-top group-hover:bg-muted/40 ${coreCellClass(column.id)}`}>
      <span className={column.id === 'productCode' ? 'font-mono font-medium' : column.id === 'optionName' ? 'text-muted-foreground' : ''}>
        {typeof value === 'string' && value ? value : '-'}
      </span>
    </td>
  )
}

function PriceCell({ column, row }: { column: PriceTableDisplayColumn; row: PriceTableGridRow }) {
  const value = row.rawData[column.valueKey]
  const productIds = findMarketplaceProductIds(row.rawData, column)
  const details = (column.details ?? [])
    .map((detail) => ({ ...detail, value: row.rawData[detail.key] }))
    .filter((detail) => detail.value !== undefined && detail.value !== '')

  return (
    <td className="min-w-[150px] border-b px-3 py-2 text-right align-top tabular-nums group-hover:bg-muted/40">
      <div className="font-semibold">{formatValue(value, column.format)}</div>
      {details.length > 0 ? (
        <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
          {details.map((detail) => (
            <div key={detail.key} className="flex justify-end gap-1">
              <span>{detail.label}</span>
              <span>{formatValue(detail.value, detail.format, '')}</span>
            </div>
          ))}
        </div>
      ) : null}
      {column.showProductId && productIds.length > 0 ? (
        <div className="mt-1 space-y-0.5 border-t border-dashed pt-1 text-[11px] text-muted-foreground">
          {productIds.map((productId) => (
            <div key={productId.key} className="flex justify-end gap-1" title={productId.key}>
              <span>상품번호</span>
              <span className="max-w-[105px] truncate font-mono text-foreground">{productId.value}</span>
            </div>
          ))}
        </div>
      ) : column.showProductId ? (
        <div className="mt-1 border-t border-dashed pt-1 text-[11px] text-muted-foreground/70">상품번호 미등록</div>
      ) : null}
    </td>
  )
}

function PresetButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded px-2.5 text-xs font-medium transition-colors ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
    >
      {children}
    </button>
  )
}

function ColumnGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  )
}

function ColumnToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted ${disabled ? 'cursor-default opacity-60' : ''}`}>
      <span className={`flex size-4 items-center justify-center rounded border ${checked ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'}`}>
        {checked ? <Check className="size-3" /> : null}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

function rawSortKey(column: PriceTableDisplayColumn) {
  return `raw:${column.valueKey}`
}

function getCorePresetIds(sheetName: string) {
  return CORE_COLUMNS
    .filter((column) => column.required || (column.defaultVisible && !(sheetName === '메인' && column.id === 'registeredProductName')))
    .map((column) => column.id)
}

function getRecommendedIds(sheetName: string, priceColumns: PriceTableDisplayColumn[]) {
  return [
    ...getCorePresetIds(sheetName),
    ...priceColumns.filter((column) => column.defaultVisible).map((column) => column.id),
  ]
}

function sameSet(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function coreHeaderClass(id: string) {
  if (id === 'productCode') return 'left-0 z-30 w-[130px] min-w-[130px] max-w-[130px]'
  if (id === 'productName') return 'left-[130px] z-30 w-[220px] min-w-[220px] max-w-[220px] border-r'
  if (id === 'optionName') return 'min-w-[150px] max-w-[190px]'
  if (id === 'registeredProductName') return 'min-w-[260px] max-w-[340px]'
  return 'min-w-[90px]'
}

function coreCellClass(id: string) {
  if (id === 'productCode') return 'sticky left-0 z-10 w-[130px] min-w-[130px] max-w-[130px] bg-card'
  if (id === 'productName') return 'sticky left-[130px] z-10 w-[220px] min-w-[220px] max-w-[220px] border-r bg-card'
  if (id === 'optionName') return 'min-w-[150px] max-w-[190px]'
  if (id === 'registeredProductName') return 'min-w-[260px] max-w-[340px]'
  return 'min-w-[90px] text-muted-foreground'
}

function formatValue(value: string | undefined, format: 'money' | 'text' = 'text', empty = '-') {
  if (value === undefined || value === '') return empty
  if (format !== 'money') return value
  const normalized = value.replace(/,/g, '').trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return value
  const number = Number(normalized)
  return Number.isFinite(number) ? number.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : value
}
