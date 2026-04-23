'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
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
  const [isPending, startTransition] = useTransition()

  const [filters, setFilters] = useQueryStates({
    status: parseAsString,
    marketplace: parseAsString,
    search: parseAsString,
    dateFrom: parseAsString,
    dateTo: parseAsString,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(50),
  }, { shallow: false })

  // Local state for search input — only pushed to URL on explicit submit
  const [searchInput, setSearchInput] = useState(filters.search ?? '')

  // Keep local input in sync if URL changes externally (e.g. 초기화)
  useEffect(() => {
    setSearchInput(filters.search ?? '')
  }, [filters.search])

  const updateFilter = useCallback(
    (updates: Partial<typeof filters>) => {
      startTransition(() => {
        void setFilters({ ...updates, page: 1 })
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
      marketplace: null,
      search: null,
      dateFrom: null,
      dateTo: null,
      page: 1,
      pageSize: filters.pageSize,
    })
  }, [setFilters, filters.pageSize])

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Marketplace */}
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

      {/* Status */}
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

      {/* Search — manual submit via Enter or button */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-search" className="text-xs font-medium text-muted-foreground">
          검색
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submitSearch()
          }}
          className="flex items-center gap-1"
        >
          <input
            id="filter-search"
            type="text"
            placeholder="주문번호, 상품명, 구매자명"
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
