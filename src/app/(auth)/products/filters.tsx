'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
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
  const [isPending, startTransition] = useTransition()

  const [filters, setFilters] = useQueryStates({
    status: parseAsString,
    category: parseAsString,
    search: parseAsString,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(25),
    // 검색 트리거 sentinel — 이게 있어야 page.tsx 가 fetch 한다.
    searched: parseAsString,
  }, { shallow: false })

  const [searchInput, setSearchInput] = useState(filters.search ?? '')
  useEffect(() => { setSearchInput(filters.search ?? '') }, [filters.search])

  const updateFilter = useCallback(
    (updates: Partial<typeof filters>) => {
      startTransition(() => {
        // 필터 변경은 곧 검색 — searched sentinel 도 함께 켜준다.
        void setFilters({ ...updates, page: 1, searched: '1' })
      })
    },
    [setFilters],
  )

  const submitSearch = useCallback(() => {
    const trimmed = searchInput.trim()
    updateFilter({ search: trimmed || null })
  }, [searchInput, updateFilter])

  const handleReset = useCallback(() => {
    setSearchInput('')
    void setFilters({
      status: null,
      category: null,
      search: null,
      page: 1,
      pageSize: filters.pageSize,
      searched: null,
    })
  }, [setFilters, filters.pageSize])

  const hasFilters = filters.status || filters.search

  return (
    <div className="space-y-3">
      {/* Search bar — manual submit */}
      <form
        onSubmit={(e) => { e.preventDefault(); submitSearch() }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
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
            placeholder="상품코드 또는 상품명으로 검색"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-lg border bg-white py-2 pl-10 pr-4 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-black/10"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? '검색중...' : '검색'}
        </button>
      </form>

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
