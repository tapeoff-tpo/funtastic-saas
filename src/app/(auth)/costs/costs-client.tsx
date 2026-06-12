'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useQueryStates, parseAsInteger, parseAsString } from 'nuqs'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from 'lucide-react'
import { Pagination, PageSizeSelector } from '@/components/ui/pagination'

export type CostRow = {
  id: string
  internalSku: string
  name: string
  costPrice: string | null
  warehouseLocation: string | null
}

type SortKey = 'internalSku' | 'name' | 'costPrice' | 'warehouseLocation'

const SORT_LABELS: Record<SortKey, string> = {
  internalSku: '품목코드',
  name: '품목명',
  costPrice: '원가',
  warehouseLocation: '한국창고기준 위치',
}

const SORT_KEYS = new Set<string>(Object.keys(SORT_LABELS))

function formatCost(value: string | null): string {
  if (!value) return ''
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toLocaleString('ko-KR') : value
}

function sortIcon(active: boolean, order: string | null) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
  return order === 'desc'
    ? <ArrowDown className="h-3.5 w-3.5" />
    : <ArrowUp className="h-3.5 w-3.5" />
}

export function CostsClient({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: CostRow[]
  total: number
  page: number
  pageSize: number
}) {
  const [isPending, startTransition] = useTransition()
  const [query, setQuery] = useQueryStates({
    search: parseAsString,
    sort: parseAsString,
    order: parseAsString,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(50),
  }, { shallow: false })
  const [searchInput, setSearchInput] = useState(query.search ?? '')

  const activeSort = SORT_KEYS.has(query.sort ?? '') ? query.sort : 'internalSku'
  const activeOrder = query.order === 'desc' ? 'desc' : 'asc'

  const exportHref = useMemo(() => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    params.set('sort', activeSort ?? 'internalSku')
    params.set('order', activeOrder)
    return `/api/costs/export?${params.toString()}`
  }, [activeOrder, activeSort, query.search])

  const submitSearch = () => {
    startTransition(() => {
      void setQuery({ search: searchInput.trim() || null, page: 1 })
    })
  }

  const resetFilters = () => {
    setSearchInput('')
    startTransition(() => {
      void setQuery({ search: null, sort: null, order: null, page: 1 })
    })
  }

  const updateSort = (key: SortKey) => {
    const nextOrder = activeSort === key && activeOrder === 'asc' ? 'desc' : 'asc'
    startTransition(() => {
      void setQuery({ sort: key, order: nextOrder, page: 1 })
    })
  }

  const updatePage = (nextPage: number) => {
    void setQuery({ page: nextPage })
  }

  const updatePageSize = (nextPageSize: number) => {
    void setQuery({ pageSize: nextPageSize, page: 1 })
  }

  const hasSearch = Boolean(query.search?.trim())

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-md border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submitSearch()
          }}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="상품코드 또는 상품명으로 검색"
              className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            검색
          </button>
          {hasSearch ? (
            <button
              type="button"
              onClick={resetFilters}
              className="h-9 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted"
            >
              초기화
            </button>
          ) : null}
        </form>

        <div className="flex items-center gap-2">
          <PageSizeSelector
            pageSize={pageSize}
            total={total}
            onPageSizeChange={updatePageSize}
            onPageChange={updatePage}
            className="whitespace-nowrap"
          />
          <a
            href={exportHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted"
          >
            <Download className="h-4 w-4" />
            엑셀 다운
          </a>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-muted/60">
            <tr className="border-b">
              <SortableHeader
                label={SORT_LABELS.internalSku}
                active={activeSort === 'internalSku'}
                order={activeOrder}
                onClick={() => updateSort('internalSku')}
                className="w-[180px]"
              />
              <SortableHeader
                label={SORT_LABELS.name}
                active={activeSort === 'name'}
                order={activeOrder}
                onClick={() => updateSort('name')}
              />
              <SortableHeader
                label="works 신규 원가"
                active={activeSort === 'costPrice'}
                order={activeOrder}
                onClick={() => updateSort('costPrice')}
                alignRight
                className="w-[160px]"
              />
              <SortableHeader
                label="works 기존 원가"
                active={activeSort === 'costPrice'}
                order={activeOrder}
                onClick={() => updateSort('costPrice')}
                alignRight
                className="w-[160px]"
              />
              <SortableHeader
                label={SORT_LABELS.warehouseLocation}
                active={activeSort === 'warehouseLocation'}
                order={activeOrder}
                onClick={() => updateSort('warehouseLocation')}
                className="w-[190px]"
              />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="h-32 text-center text-muted-foreground">
                  원가를 표시할 상품이 없습니다.
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/40">
                <td className="px-3 py-2 font-mono">
                  <Link href={`/products/${row.id}`} className="text-blue-600 hover:underline">
                    {row.internalSku}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/products/${row.id}`} className="line-clamp-2 text-blue-600 hover:underline">
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCost(row.costPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCost(row.costPrice)}</td>
                <td className="px-3 py-2">{row.warehouseLocation ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={updatePage}
        onPageSizeChange={updatePageSize}
        hidePageSize
      />
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
  order: string | null
  onClick: () => void
  alignRight?: boolean
  className?: string
}) {
  return (
    <th className={`px-3 py-2.5 font-medium text-muted-foreground ${className}`}>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-1 ${alignRight ? 'justify-end text-right' : 'justify-start text-left'} hover:text-foreground`}
      >
        <span>{label}</span>
        {sortIcon(active, order)}
      </button>
    </th>
  )
}
