export const PRODUCT_OPERATIONS_PATH = '/operations/product-operations'

export const PRODUCT_OPERATIONS_TABS = [
  { id: 'inventory', label: '재고', menus: ['/inventory'] },
  { id: 'pricing', label: '품목·원가', menus: ['/costs'] },
  { id: 'prices', label: '판매가 테이블', menus: ['/analytics/price-table'] },
  { id: 'detail', label: '상세페이지', menus: ['/operations/detail-pages'] },
  { id: 'registration', label: '상품등록', menus: ['/operations/marketplace-registration'] },
] as const

export function productOperationsHref(tab: string, sku?: string) {
  const params = new URLSearchParams({ tab })
  if (sku) params.set('sku', sku)
  return `${PRODUCT_OPERATIONS_PATH}?${params}`
}
