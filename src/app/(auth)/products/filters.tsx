'use client'

import { useCallback, useRef, useTransition } from 'react'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { PRODUCT_STATUS_LABELS, type ProductStatus } from '@/lib/products/types'

const STATUS_OPTIONS: { value: '' | ProductStatus; label: string }[] = [
  { value: '', label: '전체 상태' },
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
  })

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

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Status filter */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-status" className="text-xs font-medium text-muted-foreground">
          상태
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

      {/* Search */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-search" className="text-xs font-medium text-muted-foreground">
          검색
        </label>
        <input
          id="filter-search"
          type="text"
          placeholder="상품코드, 상품명 검색"
          defaultValue={filters.search ?? ''}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-[240px] rounded-md border px-3 py-1.5 text-sm placeholder:text-muted-foreground"
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
