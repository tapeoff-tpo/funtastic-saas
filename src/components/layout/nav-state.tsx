'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

const TABS_KEY = 'funtastic-tabs'
const FAVS_KEY = 'funtastic-favorites'
const MAX_TABS = 12

export interface OpenTab {
  /** Full URL including query string (e.g. "/products/mapping?q=글라손&page=3").
   *  Stored full so reopening the tab restores nuqs/useQueryStates filter state. */
  href: string
  label: string
}

/** Strip query string — tabs are identified by pathname only, but href remembers state. */
function stripQuery(href: string): string {
  const i = href.indexOf('?')
  return i === -1 ? href : href.slice(0, i)
}

/** Public helper — used by tab-bar to compare tab.href against current pathname. */
export function tabPathname(tab: { href: string }): string {
  return stripQuery(tab.href)
}

/**
 * Static label map for known routes. For dynamic routes (/orders/[id]),
 * we fall back to a generic label or the segment.
 */
const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': '대시보드',
  '/orders': '전체 주문',
  '/orders/collect': '주문 수집',
  '/orders/import': '주문 엑셀 임포트',
  '/orders/claims': '클레임 관리',
  '/cs': 'CS 대시보드',
  '/cs/cancel': '취소 관리',
  '/cs/return': '반품 관리',
  '/cs/exchange': '교환 관리',
  '/cs/inquiries': '문의 관리',
  '/shipping': '배송 관리',
  '/shipping/held': '미발송 관리',
  '/shipping/scan': '바코드 스캔/출고',
  '/shipping/invoice': '송장 업로드 현황',
  '/shipping/combined': '합포장 관리',
  '/shipping/templates': '송장 템플릿',
  '/shipping/print': '송장 출력',
  '/products': '상품 관리',
  '/products/new': '상품 등록',
  '/products/mapping': '매핑관리',
  '/products/categories': '카테고리',
  '/products/marketplace-categories': '카테고리 매핑',
  '/inventory': '재고관리',
  '/inventory/adjustments': '입출고관리',
  '/analytics': '매출분석',
  '/settings': '설정',
  '/settings/company': '회사 정보',
  '/settings/marketplaces': '마켓연동',
}

export function getRouteLabel(pathname: string): string {
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname]
  // Dynamic detail pages
  if (/^\/orders\/[^/]+$/.test(pathname)) return '주문 상세'
  if (/^\/products\/[^/]+$/.test(pathname)) return '상품 상세'
  // Fallback: last segment
  const seg = pathname.split('/').filter(Boolean).pop()
  return seg ?? pathname
}

interface NavStateValue {
  tabs: OpenTab[]
  favorites: string[]
  closeTab: (href: string) => void
  closeOthers: (href: string) => void
  closeAll: () => void
  toggleFavorite: (href: string) => void
  isFavorite: (href: string) => boolean
}

const NavStateContext = createContext<NavStateValue | null>(null)

export function NavStateProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  // Hydrate from localStorage once on mount
  useEffect(() => {
    try {
      const t = localStorage.getItem(TABS_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (t) setTabs(JSON.parse(t))
      const f = localStorage.getItem(FAVS_KEY)
      if (f) setFavorites(JSON.parse(f))
    } catch {
      // ignore
    }
    setHydrated(true)
  }, [])

  // Persist tabs
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
    } catch {
      // ignore
    }
  }, [tabs, hydrated])

  // Persist favorites
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(FAVS_KEY, JSON.stringify(favorites))
    } catch {
      // ignore
    }
  }, [favorites, hydrated])

  // Track current route as a tab. /login and /dashboard root excluded from auto-add to avoid clutter.
  // Tab is identified by pathname; href stores the *full* URL (with query string) so that
  // reopening the tab restores filter/page/sort state held in URL search params.
  useEffect(() => {
    if (!hydrated) return
    if (!pathname || pathname === '/dashboard') return
    const search = searchParams?.toString() ?? ''
    const fullHref = search ? `${pathname}?${search}` : pathname
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabs((prev) => {
      const idx = prev.findIndex((t) => stripQuery(t.href) === pathname)
      if (idx >= 0) {
        // Existing tab — refresh its href to the latest URL so the next reopen restores state.
        if (prev[idx].href === fullHref) return prev
        const updated = prev.slice()
        updated[idx] = { ...prev[idx], href: fullHref }
        return updated
      }
      const next: OpenTab = { href: fullHref, label: getRouteLabel(pathname) }
      const updated = [...prev, next]
      return updated.length > MAX_TABS ? updated.slice(-MAX_TABS) : updated
    })
  }, [pathname, searchParams, hydrated])

  // Close handlers match by pathname — caller may pass full href or bare path.
  const closeTab = useCallback((href: string) => {
    const path = stripQuery(href)
    setTabs((prev) => prev.filter((t) => stripQuery(t.href) !== path))
  }, [])

  const closeOthers = useCallback((href: string) => {
    const path = stripQuery(href)
    setTabs((prev) => prev.filter((t) => stripQuery(t.href) === path))
  }, [])

  const closeAll = useCallback(() => {
    setTabs([])
  }, [])

  const toggleFavorite = useCallback((href: string) => {
    setFavorites((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href],
    )
  }, [])

  const isFavorite = useCallback(
    (href: string) => favorites.includes(href),
    [favorites],
  )

  return (
    <NavStateContext.Provider
      value={{ tabs, favorites, closeTab, closeOthers, closeAll, toggleFavorite, isFavorite }}
    >
      {children}
    </NavStateContext.Provider>
  )
}

export function useNavState() {
  const ctx = useContext(NavStateContext)
  if (!ctx) throw new Error('useNavState must be used inside NavStateProvider')
  return ctx
}
