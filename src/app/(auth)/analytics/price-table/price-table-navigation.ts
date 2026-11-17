export type PriceTableView = 'compare' | 'products'

export type PriceTableNavigation = {
  sheetName: string
  search: string
  sortKey: string
  sortOrder: 'asc' | 'desc'
  view: PriceTableView
  malls?: string[]
  showExcluded?: boolean
}

export function priceTableHref({ sheetName, search, sortKey, sortOrder, view, malls, showExcluded, page = 1 }: PriceTableNavigation & { page?: number }) {
  const params = new URLSearchParams({ sheet: sheetName, sort: sortKey, order: sortOrder, view })
  if (malls?.length) params.set('malls', malls.join(','))
  if (showExcluded) params.set('excluded', '1')
  if (search) params.set('q', search)
  if (page > 1) params.set('page', String(page))
  return `/analytics/price-table?${params}`
}

export function priceTablePages(page: number, totalPages: number) {
  const start = Math.floor((page - 1) / 10) * 10 + 1
  return Array.from({ length: Math.min(10, totalPages - start + 1) }, (_, index) => start + index)
}

export function priceRegistrationHref(rowId: string, mallId: string, navigation: PriceTableNavigation) {
  const params = new URLSearchParams({ row: rowId, mall: mallId, view: navigation.view, q: navigation.search })
  if (navigation.malls?.length) params.set('malls', navigation.malls.join(','))
  return `/operations/marketplace-registration?${params}`
}
