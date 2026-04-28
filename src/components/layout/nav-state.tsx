'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

const TABS_KEY = 'funtastic-tabs'
const FAVS_KEY = 'funtastic-favorites'
const MAX_TABS = 12

export interface OpenTab {
  href: string
  label: string
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
  '/shipping': '배송 관리',
  '/shipping/held': '미발송 관리',
  '/shipping/scan': '바코드 스캔/출고',
  '/shipping/invoice': '송장 업로드 현황',
  '/shipping/combined': '합포장 관리',
  '/shipping/templates': '송장 템플릿',
  '/shipping/print': '송장 출력',
  '/products': '상품 관리',
  '/products/new': '상품 등록',
  '/products/mappings': '상품명 매핑',
  '/products/categories': '카테고리',
  '/products/marketplace-categories': '카테고리 매핑',
  '/inventory': '재고관리',
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
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  // Hydrate from localStorage once on mount
  useEffect(() => {
    try {
      const t = localStorage.getItem(TABS_KEY)
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
  useEffect(() => {
    if (!hydrated) return
    if (!pathname || pathname === '/dashboard') return
    setTabs((prev) => {
      if (prev.some((t) => t.href === pathname)) return prev
      const next: OpenTab = { href: pathname, label: getRouteLabel(pathname) }
      const updated = [...prev, next]
      return updated.length > MAX_TABS ? updated.slice(-MAX_TABS) : updated
    })
  }, [pathname, hydrated])

  const closeTab = useCallback((href: string) => {
    setTabs((prev) => prev.filter((t) => t.href !== href))
  }, [])

  const closeOthers = useCallback((href: string) => {
    setTabs((prev) => prev.filter((t) => t.href === href))
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
