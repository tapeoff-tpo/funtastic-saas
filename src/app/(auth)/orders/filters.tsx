'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { Check, ChevronDown, Search } from 'lucide-react'
import { ORDER_STATUS_LABELS, type OrderSearchField, type OrderStatus } from '@/lib/orders/types'

const MARKETPLACE_OPTIONS = [
  { value: 'coupang', label: '쿠팡' },
  { value: 'naver', label: '네이버 스마트스토어' },
  { value: 'gmarket', label: 'G마켓' },
  { value: 'auction', label: '옥션' },
  { value: 'elevenst', label: '11번가' },
  { value: 'cafe24', label: 'Cafe24' },
]

const STATUS_OPTIONS: { value: '' | OrderStatus; label: string }[] = [
  { value: '', label: '전체 상태' },
  ...Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({
    value: value as OrderStatus,
    label,
  })),
]

const MAPPING_OPTIONS = [
  { value: 'all', label: '매핑 전체' },
  { value: 'mapped', label: '매핑됨' },
  { value: 'unmapped', label: '매핑안됨' },
]

const SEARCH_FIELD_OPTIONS: Array<{ value: OrderSearchField; label: string }> = [
  { value: 'all', label: '전체검색' },
  { value: 'buyerName', label: '주문자명' },
  { value: 'recipientName', label: '수취인명' },
  { value: 'marketplaceOrderId', label: '쇼핑몰주문번호' },
  { value: 'internalNo', label: '내부주문번호' },
  { value: 'sku', label: '품번코드' },
  { value: 'marketplaceProductCode', label: '쇼핑몰상품코드' },
  { value: 'collectedProductName', label: '수집상품명' },
  { value: 'confirmedProductName', label: '확정상품명' },
  { value: 'recipientPhone', label: '수취인전화번호1' },
  { value: 'recipientPhone2', label: '수취인전화번호2' },
  { value: 'buyerPhone', label: '주문자전화번호1' },
  { value: 'buyerPhone2', label: '주문자전화번호2' },
  { value: 'trackingNumber', label: '송장번호' },
  { value: 'logisticsMessage', label: '물류메세지' },
]

const HANGUL_INITIALS = [
  'ㄱ',
  'ㄲ',
  'ㄴ',
  'ㄷ',
  'ㄸ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅃ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅉ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
] as const

function toSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function toHangulInitials(value: string): string {
  return Array.from(value).map((char) => {
    const code = char.charCodeAt(0) - 0xac00
    if (code < 0 || code > 11171) return char
    return HANGUL_INITIALS[Math.floor(code / 588)]
  }).join('')
}

function MarketplaceSearchSelect({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((option) => option.value === value) ?? options[0]
  const filteredOptions = useMemo(() => {
    const keyword = toSearchText(query)
    if (!keyword) return options
    return options.filter((option) => (
      toSearchText(option.label).includes(keyword)
      || toSearchText(option.value).includes(keyword)
      || toSearchText(toHangulInitials(option.label)).includes(keyword)
    ))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const selectOption = useCallback((nextValue: string) => {
    onChange(nextValue)
    setQuery('')
    setOpen(false)
  }, [onChange])

  return (
    <div ref={rootRef} className="relative w-[178px]">
      <button
        id="filter-marketplace"
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 text-left text-sm hover:bg-muted/40"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selected?.label ?? '전체 마켓'}</span>
        <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-[260px] rounded-md border bg-background shadow-lg">
          <div className="flex items-center gap-2 border-b px-2 py-2">
            <Search className="size-4 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false)
              }}
              placeholder="마켓 검색"
              className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1" role="listbox" aria-labelledby="filter-marketplace">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.value || 'all'}
                  type="button"
                  onClick={() => selectOption(option.value)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  role="option"
                  aria-selected={option.value === value}
                >
                  <span className="truncate">{option.label}</span>
                  {option.value === value && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-sm text-muted-foreground">검색 결과 없음</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function OrderFilters({
  marketplaceOptions = [],
}: {
  marketplaceOptions?: Array<{ value: string; label: string }>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const mergedMarketplaceOptions = useMemo(() => {
    const options = new Map<string, string>()
    for (const option of MARKETPLACE_OPTIONS) options.set(option.value, option.label)
    for (const option of marketplaceOptions) options.set(option.value, option.label)
    return [
      { value: '', label: '전체 마켓' },
      ...Array.from(options, ([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ko-KR')),
    ]
  }, [marketplaceOptions])

  const [filters, setFilters] = useQueryStates({
    status: parseAsString,
    mapping: parseAsString,
    marketplace: parseAsString,
    search: parseAsString,
    searchField: parseAsString,
    dateField: parseAsString,
    dateFrom: parseAsString,
    dateTo: parseAsString,
    datePreset: parseAsString,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(25),
  }, { shallow: false })

  // Local state for search input — only pushed to URL on explicit submit
  const [searchInput, setSearchInput] = useState(filters.search ?? '')
  const isNewTab = filters.status === 'new'
  const formatDateInput = useCallback((date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }, [])

  const updateFilter = useCallback(
    (updates: Partial<typeof filters>) => {
      startTransition(() => {
        void setFilters({ ...updates, page: 1 }).then(() => router.refresh())
      })
    },
    [router, setFilters],
  )

  const submitSearch = useCallback(() => {
    const trimmed = searchInput.trim()
    updateFilter({ search: trimmed || null })
  }, [searchInput, updateFilter])

  const handleReset = useCallback(() => {
    setSearchInput('')
    startTransition(() => {
      void setFilters({
        status: null,
        mapping: null,
        marketplace: null,
        search: null,
        searchField: null,
        dateField: null,
        dateFrom: null,
        dateTo: null,
        datePreset: null,
        page: 1,
        pageSize: filters.pageSize,
      }).then(() => router.refresh())
    })
  }, [filters.pageSize, router, setFilters])

  const setToday = useCallback(() => {
    const today = formatDateInput(new Date())
    updateFilter({ dateFrom: today, dateTo: today, datePreset: null })
  }, [formatDateInput, updateFilter])

  const setRecent7Days = useCallback(() => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 6)
    updateFilter({
      dateFrom: formatDateInput(start),
      dateTo: formatDateInput(end),
      datePreset: null,
    })
  }, [formatDateInput, updateFilter])

  const setAllDates = useCallback(() => {
    updateFilter({ dateFrom: null, dateTo: null, datePreset: 'all' })
  }, [updateFilter])

  const setRecent30Days = useCallback(() => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 29)
    updateFilter({
      dateFrom: formatDateInput(start),
      dateTo: formatDateInput(end),
      datePreset: null,
    })
  }, [formatDateInput, updateFilter])

  const setCurrentMonth = useCallback(() => {
    const end = new Date()
    const start = new Date(end.getFullYear(), end.getMonth(), 1)
    updateFilter({
      dateFrom: formatDateInput(start),
      dateTo: formatDateInput(end),
      datePreset: null,
    })
  }, [formatDateInput, updateFilter])

  const setRecent2Months = useCallback(() => {
    const end = new Date()
    const start = new Date()
    start.setMonth(start.getMonth() - 2)
    updateFilter({
      dateFrom: formatDateInput(start),
      dateTo: formatDateInput(end),
      datePreset: null,
    })
  }, [formatDateInput, updateFilter])

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Marketplace */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-marketplace" className="text-xs font-medium text-muted-foreground">
          마켓플레이스
        </label>
        <MarketplaceSearchSelect
          options={mergedMarketplaceOptions}
          value={filters.marketplace ?? ''}
          onChange={(nextValue) => updateFilter({ marketplace: nextValue || null })}
        />
      </div>

      {/* Status */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-status" className="text-xs font-medium text-muted-foreground">
          주문 상태
        </label>
        <select
          id="filter-status"
          value={filters.status ?? ''}
          onChange={(e) => {
            const nextStatus = e.target.value || null
            updateFilter({
              status: nextStatus,
              mapping: nextStatus === 'new' ? filters.mapping : null,
            })
          }}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {isNewTab && (
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-mapping" className="text-xs font-medium text-muted-foreground">
            매핑 상태
          </label>
          <select
            id="filter-mapping"
            value={filters.mapping ?? 'unmapped'}
            onChange={(e) => updateFilter({ mapping: e.target.value })}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            {MAPPING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Date range */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-date-field" className="text-xs font-medium text-muted-foreground">
          기준일
        </label>
        <select
          id="filter-date-field"
          value={filters.dateField ?? 'orderedAt'}
          onChange={(e) => updateFilter({ dateField: e.target.value === 'orderedAt' ? null : e.target.value })}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="orderedAt">주문일자</option>
          <option value="collectedAt">수집일자</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-date-from" className="text-xs font-medium text-muted-foreground">
          시작일
        </label>
        <input
          id="filter-date-from"
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(e) => updateFilter({ dateFrom: e.target.value || null, datePreset: null })}
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
          onChange={(e) => updateFilter({ dateTo: e.target.value || null, datePreset: null })}
          className="rounded-md border px-3 py-1.5 text-sm"
        />
      </div>

      {/* Search — manual submit via Enter or button */}
      <div className="flex items-end gap-1">
        <button
          type="button"
          onClick={setAllDates}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          전체
        </button>
        <button
          type="button"
          onClick={setToday}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          오늘
        </button>
        <button
          type="button"
          onClick={setRecent7Days}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          최근 7일
        </button>
        <button
          type="button"
          onClick={setRecent30Days}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          30일
        </button>
        <button
          type="button"
          onClick={setCurrentMonth}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          당월
        </button>
        <button
          type="button"
          onClick={setRecent2Months}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          2개월
        </button>
      </div>

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
          <select
            id="filter-search-field"
            value={filters.searchField ?? 'all'}
            onChange={(e) => updateFilter({ searchField: e.target.value === 'all' ? null : e.target.value })}
            className="rounded-md border px-3 py-1.5 text-sm"
            aria-label="검색종류"
          >
            {SEARCH_FIELD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            id="filter-search"
            type="text"
            placeholder="검색어 입력"
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
