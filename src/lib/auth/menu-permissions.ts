/** Shared menu catalogue. Parent access never grants a separately listed child. */
export const MENU_PERMISSION_GROUPS = [
  { title: '기본', items: [['/dashboard', '대시보드']] },
  { title: '주문·CS·출고', items: [
    ['/orders', '전체 주문'], ['/orders/collect', '주문 수집'], ['/orders/import', '주문 가져오기'],
    ['/orders/claims', '클레임 관리'], ['/cs', '상품검수/CS'], ['/cs/inquiries', '문의'],
    ['/shipping', '출고 작업'], ['/shipping/held', '미발송 관리'], ['/shipping/scan', '바코드 스캔/출고'],
    ['/shipping/invoice', '송장 업로드 현황'], ['/shipping/combined', '합포장 관리'],
    ['/shipping/split', '분할배송'], ['/shipping/templates', '택배 양식 관리'], ['/shipping/print', '배송 라벨 인쇄'],
  ] },
  { title: '상품·품목', items: [
    ['/new-products', '상품관리'], ['/operations/sourcing', '소싱'], ['/costs', '품목'],
    ['/products', '상품 관리(마켓)'], ['/products/mapping', '매핑관리'], ['/products/mapping-codes', '매핑코드 마스터'],
    ['/products/categories', '카테고리'], ['/products/marketplace-categories', '카테고리 매핑'],
  ] },
  { title: '발주·입고', items: [
    ['/purchasing/purchases', '발주검토'], ['/purchasing/orders', '발주'], ['/purchasing/payment-flow', '발주금액'],
    ['/purchasing/raw-data', '발주 로우데이터'], ['/outbound-reflection', '출고반영'],
    ['/purchasing/china-inventory', '중국재고'], ['/purchasing/saas-china-inventory', '중국재고(SaaS)'],
    ['/purchasing/china-shipments', '중국출고'], ['/inventory', '재고관리'],
    ['/inventory/adjustments', '입출고관리'], ['/purchasing/overdue', '구매/입고지연'],
  ] },
  { title: '상품등록·광고', items: [
    ['/analytics/price-table', '판매가 테이블'], ['/operations/marketplace-registration', '상품 등록 관리'],
    ['/operations/detail-pages', '상세페이지 제작'], ['/operations/deal-calendar', '딜 캘린더'],
  ] },
  { title: '분석', items: [
    ['/analytics', '매출분석'], ['/analytics/settlements', '정산 캘린더'],
    ['/analytics/rocket-outbound', '로켓배송/대량 매출'], ['/analytics/short-meeting', '숏미팅'],
    ['/analytics/sabangnet-review', '사방넷 검수'],
  ] },
  { title: '운영·설정', items: [
    ['/operations/ai-accounts', 'AI 계정공유'], ['/purchasing/quotes', '견적서'], ['/operations/flow', '운영 흐름'], ['/admin/dev-log', '개발 작업 일지'],
    ['/settings/company', '회사 설정'], ['/settings/marketplaces', '마켓연동'], ['/settings/market-settings', '마켓설정'],
  ] },
] as const

export const MENU_PATHS: readonly string[] = MENU_PERMISSION_GROUPS.flatMap((group) => group.items.map(([path]) => path))
export type MenuAccess = { superAdmin: boolean; allowedMenus: string[] | null }
export const UNRESTRICTED_MENU_ACCESS: MenuAccess = { superAdmin: true, allowedMenus: null }

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
const menuPathsByLength = [...MENU_PATHS].sort((a, b) => b.length - a.length)

export function normalizeMenuPath(href: string): string {
  // Treat encoded slashes and dot segments like the URL router, never as a way
  // to fall through to an unrestricted parent menu.
  try {
    const decoded = decodeURIComponent(href.split(/[?#]/)[0]).replaceAll('\\', '/')
    if (!decoded.startsWith('/') || decoded.startsWith('//')) return '/__invalid__'
    return new URL(decoded, 'https://menu.local').pathname.replace(/\/+$/, '') || '/'
  } catch { return '/__invalid__' }
}

export function menuForPage(href: string): string | null {
  const path = normalizeMenuPath(href)
  if (path === '/purchasing') return '/purchasing/orders'
  if (matches(path, '/mobile/inspection')) return '/cs'
  return menuPathsByLength.find((menu) => matches(path, menu)) ?? null
}

export function canUseMenu(access: MenuAccess, menu: string): boolean {
  if (matches(menu, '/admin/accounts')) return access.superAdmin
  return access.superAdmin || access.allowedMenus === null || access.allowedMenus.includes(menu)
}

export function canAccessPage(access: MenuAccess, href: string): boolean {
  const path = normalizeMenuPath(href)
  if (matches(path, '/admin/accounts')) return access.superAdmin
  if (['/', '/access-denied', '/settings', '/settings/account', '/settings/menu', '/change-password', '/manifest.webmanifest', '/favicon.ico', '/window.svg', '/vercel.svg', '/next.svg', '/globe.svg', '/file.svg'].includes(path)) return true
  if (matches(path, '/downloads')) {
    const menu = path.includes('1688') ? '/costs' : path.includes('sms-bridge') ? '/operations/ai-accounts' : '/operations/marketplace-registration'
    return canUseMenu(access, menu)
  }
  const menu = menuForPage(path)
  return menu ? canUseMenu(access, menu) : access.superAdmin || access.allowedMenus === null
}

/** Shared APIs list all legitimate consuming menus, never trust Referer. */
const API_MENU_RULES: Array<[string, string[]]> = [
  ['/api/purchasing/purchase-requests/recommendations', ['/purchasing/purchases']],
  ['/api/purchasing/purchase-requests/budget-comparison', ['/purchasing/purchases']],
  ['/api/purchasing/purchase-requests/manual-candidates', ['/purchasing/purchases']],
  ['/api/purchasing/purchase-requests', ['/purchasing/purchases', '/purchasing/orders', '/purchasing/overdue']],
  ['/api/purchasing/purchase-orders', ['/purchasing/purchases', '/purchasing/orders', '/purchasing/overdue']],
  ['/api/purchasing/items', ['/costs']], ['/api/purchasing/purchase-urls', ['/costs']],
  ['/api/purchasing/purchase-url-verification', ['/costs']], ['/api/purchasing/discontinued-products', ['/costs']],
  ['/api/products/mapping-codes', ['/products/mapping-codes', '/products/mapping']],
  ['/api/orders/apply-mappings', ['/orders', '/products/mapping']],
  ['/api/orders/unapply-mappings', ['/orders', '/products/mapping']],
  ['/api/orders/lookup', ['/orders', '/products/mapping']],
  ['/api/analytics/channel-sales', ['/analytics/rocket-outbound']],
  ['/api/analytics/shipping-costs', ['/analytics']], ['/api/analytics/product-costs', ['/analytics']],
  ['/api/analytics/opportunities', ['/analytics/short-meeting']], ['/api/analytics/box-costs', ['/analytics']],
  ['/api/marketplace/credentials', ['/settings/marketplaces']], ['/api/cafe24/callback', ['/settings/marketplaces']],
  ['/api/cs/collect', ['/cs/inquiries']], ['/api/cs/barcode', ['/cs']],
  ['/api/mobile/inspection', ['/cs']], ['/api/claims', ['/orders', '/orders/claims', '/cs']],
  ['/api/orders/claims', ['/orders', '/orders/claims', '/cs']],
  ['/api/sms-bridge', ['/operations/ai-accounts']],
  ['/api/shipping/upload', ['/shipping/invoice', '/orders']],
  ['/api/shipping/export', ['/shipping', '/orders']], ['/api/shipping/import', ['/shipping', '/orders']],
  ['/api/shipping/daesin', ['/shipping', '/orders']], ['/api/shipping/kyungdong', ['/shipping', '/orders']],
  ['/api/shipping/cj', ['/shipping', '/orders']], ['/api/shipping/classify', ['/shipping', '/orders']],
  ['/api/inventory/incoming', ['/inventory']], ['/api/inventory/bulk-upload', ['/inventory']],
  ['/api/inventory/export', ['/inventory']],
]

export function canAccessApi(access: MenuAccess, href: string, method = 'GET'): boolean {
  const path = normalizeMenuPath(href)
  if (path === '/api/menu-access' || path === '/api/settings/menu-order' || path === '/api/check-ip') return true
  if (/^\/api\/purchasing\/purchase-requests\/[^/]+\/bulk-payment-deposit$/.test(path)) {
    return ['/purchasing/orders', '/purchasing/payment-flow'].some((menu) => canUseMenu(access, menu))
  }
  if (path === '/api/shipping/templates' && method === 'GET') {
    return ['/shipping/templates', '/orders', '/shipping', '/shipping/print'].some((menu) => canUseMenu(access, menu))
  }
  if (path === '/api/orders/collect/status' && method === 'GET') {
    return ['/orders', '/orders/collect'].some((menu) => canUseMenu(access, menu))
  }
  if (path === '/api/products/mapping-codes' && method === 'POST' && canUseMenu(access, '/orders')) return true
  if (path === '/api/products/search' && method === 'GET') {
    return canUseMenu(access, '/products') || ['/orders', '/inventory', '/inventory/adjustments', '/cs', '/shipping', '/shipping/scan']
      .some((menu) => canUseMenu(access, menu))
  }
  if (matches(path, '/api/products/marketplace-categories')) {
    return ['/products/marketplace-categories', '/products/categories', ...(method === 'GET' ? ['/products'] : [])]
      .some((menu) => canUseMenu(access, menu))
  }
  const rule = API_MENU_RULES.find(([prefix]) => matches(path, prefix))
  if (rule) return rule[1].some((menu) => canUseMenu(access, menu))
  if (!path.startsWith('/api/')) return false
  return canAccessPage(access, path.slice(4))
}
