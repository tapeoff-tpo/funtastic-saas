'use client'

import { useCallback, useRef, useTransition } from 'react'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/orders/types'

const MARKETPLACE_OPTIONS = [
  { value: '', label: '전체 마켓' },
  { value: 'coupang', label: '쿠팡' },
  { value: 'naver', label: '네이버 스마트스토어' },
  { value: 'gmarket', label: 'G마켓' },
  { value: 'auction', label: '옥션' },
  { value: '11st', label: '11번가' },
  { value: 'cafe24', label: 'Cafe24' },
]

const STATUS_OPTIONS: { value: '' | OrderStatus; label: string }[] = [
  { value: '', label: '전체 상태' },
  ...Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({
    value: value as OrderStatus,
    label,
  })),
]

export function OrderFilters() {
  const [, startTransition] = useTransition()
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [filters, setFilters] = useQueryStates({
    status: parseAsString,
    marketplace: parseAsString,
    search: parseAsString,
    dateFrom: parseAsString,
    dateTo: parseAsString,
    mapping: parseAsString,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(50),
  }, { shallow: false })

  /** Update a filter and reset page to 1 */
  const updateFilter = useCallback(
    (updates: Partial<typeof filters>) => {
      startTransition(() => {
        void setFilters({ ...updates, page: 1 })
      })
    },
    [setFilters],
  )

  /** Debounced search input (300ms) */
  const handleSearchChange = useCallback(
    (value: string) => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
      searchTimeout.current = setTimeout(() => {
        updateFilter({ search: value || null })
      }, 300)
    },
    [updateFilter],
  )

  /** Reset all filters */
  const handleReset = useCallback(() => {
    void setFilters({
      status: null,
      marketplace: null,
      search: null,
      dateFrom: null,
      dateTo: null,
      mapping: null,
      page: 1,
      pageSize: filters.pageSize,
    })
  }, [setFilters, filters.pageSize])

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Marketplace filter */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-marketplace" className="text-xs font-medium text-muted-foreground">
          마켓플레이스
        </label>
        <select
          id="filter-marketplace"
          value={filters.marketplace ?? ''}
          onChange={(e) => updateFilter({ marketplace: e.target.value || null })}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          {MARKETPLACE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Mapping filter */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-mapping" className="text-xs font-medium text-muted-foreground">
          매핑
        </label>
        <select
          id="filter-mapping"
          value={filters.mapping ?? ''}
          onChange={(e) => updateFilter({ mapping: e.target.value || null })}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="">전체</option>
          <option value="mapped">매핑됨</option>
          <option value="unmapped">미매핑만</option>
        </select>
      </div>

      {/* Status filter */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-status" className="text-xs font-medium text-muted-foreground">
          주문 상태
        </label>
        <select
          id="filter-status"
          value={filters.status ?? ''}
          onChange={(e) => updateFilter({ status: e.target.value || null })}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-date-from" className="text-xs font-medium text-muted-foreground">
          시작일
        </label>
        <input
          id="filter-date-from"
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(e) => updateFilter({ dateFrom: e.target.value || null })}
          className="rounded-md border px-3 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-date-to" className="text-xs font-medium text-muted-foreground">
          종료일
        </label>
        <input
          id="filter-date-to"
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(e) => updateFilter({ dateTo: e.target.value || null })}
          className="rounded-md border px-3 py-1.5 text-sm"
        />
      </div>

      {/* Search */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-search" className="text-xs font-medium text-muted-foreground">
          검색
        </label>
        <input
          id="filter-search"
          type="text"
          placeholder="주문번호, 상품명, 구매자명 검색"
          defaultValue={filters.search ?? ''}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-[260px] rounded-md border px-3 py-1.5 text-sm placeholder:text-muted-foreground"
        />
      </div>

      {/* Reset */}
      <button
        type="button"
        onClick={handleReset}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        초기화
      </button>
    </div>
  )
}
