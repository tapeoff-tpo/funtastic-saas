'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

const TABS_KEY = 'funtastic-tabs'
const FAVS_KEY = 'funtastic-favorites'
const MAX_TABS = 12

export interface OpenTab {
  href: string
  label: string
}

function stripQuery(href: string): string {
  const i = href.indexOf('?')
  return i === -1 ? href : href.slice(0, i)
}

export function tabPathname(tab: { href: string }): string {
  return stripQuery(tab.href)
}

const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': '대시보드',
  '/orders': '주문 관리',
  '/orders/collect': '주문 수집',
  '/orders/import': '주문 가져오기',
  '/orders/claims': '클레임 관리',
  '/costs': '품목',
  '/purchasing/china-inventory': '중국재고',
  '/purchasing/orders': '발주',
  '/purchasing/purchases': '발주검토',
  '/purchasing/overdue': '구매/입고지연',
  '/purchasing/quotes': '견적서',
  '/cs': 'CS 작업',
  '/cs/inquiries': '문의',
  '/shipping': '출고 작업',
  '/shipping/held': '미발송 관리',
  '/shipping/scan': '바코드 스캔',
  '/shipping/invoice': '송장 업로드',
  '/shipping/combined': '합포장 관리',
  '/shipping/templates': '택배 양식 관리',
  '/shipping/print': '배송 라벨 인쇄',
  '/products': '상품 관리',
  '/products/new': '상품 등록',
  '/products/mapping': '매핑관리',
  '/products/mapping-codes': '매핑코드 마스터',
  '/products/categories': '카테고리',
  '/products/marketplace-categories': '마켓 카테고리 매핑',
  '/inventory': '재고관리',
  '/inventory/adjustments': '입출고관리',
  '/analytics': '매출분석',
  '/analytics/price-table': '판매가 테이블',
  '/analytics/sabangnet-review': '사방넷 검수',
  '/analytics/rocket-outbound': '로켓배송 출고',
  '/analytics/short-meeting': '숏미팅',
  '/operations/deal-calendar': '딜 캘린더',
  '/operations/sourcing': '소싱',
  '/operations/marketplace-registration': '상품 등록 관리',
  '/operations/ai-accounts': 'AI 계정공유',
  '/settings': '설정',
  '/settings/account': '계정 설정',
  '/settings/company': '회사 설정',
  '/settings/marketplaces': '마켓연동',
  '/settings/market-settings': '마켓설정',
  '/settings/menu': '메뉴 설정',
}

export function getRouteLabel(pathname: string): string {
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname]
  if (/^\/orders\/[^/]+$/.test(pathname)) return '주문 상세'
  if (/^\/products\/[^/]+$/.test(pathname)) return '상품 상세'
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

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
    } catch {
      // ignore
    }
  }, [tabs, hydrated])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(FAVS_KEY, JSON.stringify(favorites))
    } catch {
      // ignore
    }
  }, [favorites, hydrated])

  useEffect(() => {
    if (!hydrated) return
    if (!pathname || pathname === '/dashboard') return
    const search = searchParams?.toString() ?? ''
    const fullHref = search ? `${pathname}?${search}` : pathname
    setTabs((prev) => {
      const idx = prev.findIndex((tab) => stripQuery(tab.href) === pathname)
      const label = getRouteLabel(pathname)
      if (idx >= 0) {
        if (prev[idx].href === fullHref && prev[idx].label === label) return prev
        const updated = prev.slice()
        updated[idx] = { ...prev[idx], href: fullHref, label }
        return updated
      }
      const next: OpenTab = { href: fullHref, label }
      const updated = [...prev, next]
      return updated.length > MAX_TABS ? updated.slice(-MAX_TABS) : updated
    })
  }, [pathname, searchParams, hydrated])

  const closeTab = useCallback((href: string) => {
    const path = stripQuery(href)
    setTabs((prev) => prev.filter((tab) => stripQuery(tab.href) !== path))
  }, [])

  const closeOthers = useCallback((href: string) => {
    const path = stripQuery(href)
    setTabs((prev) => prev.filter((tab) => stripQuery(tab.href) === path))
  }, [])

  const closeAll = useCallback(() => {
    setTabs([])
  }, [])

  const toggleFavorite = useCallback((href: string) => {
    setFavorites((prev) =>
      prev.includes(href) ? prev.filter((item) => item !== href) : [...prev, href],
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
