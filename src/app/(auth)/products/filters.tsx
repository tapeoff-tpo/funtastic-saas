'use client'

import { useCallback, useRef, useTransition } from 'react'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { PRODUCT_STATUS_LABELS, type ProductStatus } from '@/lib/products/types'

const STATUS_OPTIONS: { value: '' | ProductStatus; label: string }[] = [
  { value: '', label: '전체' },
  ...Object.entries(PRODUCT_STATUS_LABELS)
    .filter(([key]) => key !== 'deleted')
    .map(([value, label]) => ({
      value: value as ProductStatus,
      label,
    })),
]

export function ProductFilters() {
  const [, startTransition] = useTransition()
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [filters, setFilters] = useQueryStates({
    status: parseAsString,
    category: parseAsString,
    search: parseAsString,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(50),
  }, { shallow: false })

  const updateFilter = useCallback(
    (updates: Partial<typeof filters>) => {
      startTransition(() => {
        void setFilters({ ...updates, page: 1 })
      })
    },
    [setFilters],
  )

  const handleSearchChange = useCallback(
    (value: string) => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
      searchTimeout.current = setTimeout(() => {
        updateFilter({ search: value || null })
      }, 300)
    },
    [updateFilter],
  )

  const handleReset = useCallback(() => {
    void setFilters({
      status: null,
      category: null,
      search: null,
      page: 1,
      pageSize: filters.pageSize,
    })
  }, [setFilters, filters.pageSize])

  const hasFilters = filters.status || filters.search

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <circle cx={11} cy={11} r={8} />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          id="filter-search"
          type="text"
          placeholder="상품코드 또는 상품명으로 검색..."
          defaultValue={filters.search ?? ''}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full rounded-lg border bg-white py-2 pl-10 pr-4 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-black/10"
        />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="filter-status"
          value={filters.status ?? ''}
          onChange={(e) => updateFilter({ status: e.target.value || null })}
          className="rounded-lg border bg-white px-3 py-1.5 text-sm shadow-sm"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              상태: {opt.label}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            필터 초기화
          </button>
        )}
      </div>
    </div>
  )
}
