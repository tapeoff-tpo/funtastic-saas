export type PriceTableView = 'compare' | 'products'

export type PriceTableNavigation = {
  sheetName: string
  search: string
  sortKey: string
  sortOrder: 'asc' | 'desc'
  view: PriceTableView
}

export function priceTableHref({ sheetName, search, sortKey, sortOrder, view, page = 1 }: PriceTableNavigation & { page?: number }) {
  const params = new URLSearchParams({ sheet: sheetName, sort: sortKey, order: sortOrder, view })
  if (search) params.set('q', search)
  if (page > 1) params.set('page', String(page))
  return `/analytics/price-table?${params}`
}

export function priceTablePages(page: number, totalPages: number) {
  const start = Math.floor((page - 1) / 10) * 10 + 1
  return Array.from({ length: Math.min(10, totalPages - start + 1) }, (_, index) => start + index)
}
