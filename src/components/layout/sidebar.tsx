'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  ShoppingCart,
  ArrowRightLeft,
  Package,
  FolderTree,
  Truck,
  Upload,
  PackageX,
  Warehouse,
  BarChart3,
  Store,
  Settings,
  FileText,
  Users,
  LogOut,
  ChevronsLeft,
  Download,
  Star,
  Search,
  Headphones,
  MessageSquareText,
  Boxes,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  Bot,
  ChevronDown,
  ChevronRight,
  CalendarDays,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useNavState } from './nav-state'
import {
  applySidebarMenuOrder,
  fetchSidebarMenuOrder,
  readSidebarMenuOrder,
  SIDEBAR_MENU_ORDER_EVENT,
} from './sidebar-menu-order'

export interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
}

export interface NavGroup {
  id: string
  title: string
  items: NavItem[]
}

export interface NavSection {
  id: string
  title?: string
  items: NavItem[]
  groups?: NavGroup[]
  collapsible?: boolean
  defaultCollapsed?: boolean
}

const orderRelatedGroups: NavGroup[] = [
  {
    id: 'orders',
    title: '주문',
    items: [
      { href: '/orders', label: '전체 주문', icon: ShoppingCart },
      { href: '/orders/collect', label: '주문 수집', icon: Download },
      { href: '/shipping/held', label: '미발송 관리', icon: PackageX },
    ],
  },
  {
    id: 'cs',
    title: 'CS',
    items: [
      { href: '/cs', label: '상품검수/CS', icon: Headphones },
      { href: '/cs/inquiries', label: '문의', icon: MessageSquareText },
    ],
  },
  {
    id: 'shipping-work',
    title: '출고작업',
    items: [
      { href: '/shipping/scan', label: '바코드 스캔/출고', icon: Truck },
      { href: '/shipping/invoice', label: '송장 업로드 현황', icon: Upload },
    ],
  },
  {
    id: 'products',
    title: '상품',
    items: [
      { href: '/products', label: '상품 관리', icon: Package },
      { href: '/products/mapping', label: '매핑관리', icon: ArrowRightLeft },
      { href: '/products/mapping-codes', label: '매핑코드 마스터', icon: ArrowRightLeft },
      { href: '/products/marketplace-categories', label: '카테고리 매핑', icon: FolderTree },
      { href: '/inventory/adjustments', label: '입출고관리', icon: ArrowRightLeft },
    ],
  },
  {
    id: 'settings',
    title: '설정',
    items: [
      { href: '/settings/marketplaces', label: '마켓연동', icon: Store },
      { href: '/settings/market-settings', label: '마켓설정', icon: Settings },
    ],
  },
]

export const navSections: NavSection[] = [
  {
    id: 'dashboard',
    items: [
      { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
    ],
  },
  {
    id: 'order-related',
    title: '주문관련',
    collapsible: true,
    defaultCollapsed: true,
    groups: orderRelatedGroups,
    items: orderRelatedGroups.flatMap((group) => group.items),
  },
  {
    id: 'purchasing',
    title: '발주',
    items: [
      { href: '/costs', label: '품목', icon: Package },
      { href: '/inventory', label: '재고관리', icon: Warehouse },
      { href: '/purchasing/china-inventory', label: '중국재고', icon: Boxes },
      { href: '/purchasing/orders', label: '발주', icon: ClipboardList },
      { href: '/purchasing/purchases', label: '발주검토', icon: CreditCard },
      { href: '/purchasing/overdue', label: '구매/입고지연', icon: ClipboardList },
    ],
  },
  {
    id: 'operations',
    title: '운영',
    items: [
      { href: '/operations/deal-calendar', label: '딜 캘린더', icon: CalendarDays },
      { href: '/operations/sourcing', label: '소싱', icon: Search },
      { href: '/operations/ai-accounts', label: 'AI 계정공유', icon: Bot },
      { href: '/purchasing/quotes', label: '견적서', icon: FileSpreadsheet },
    ],
  },
  {
    id: 'analytics',
    title: '분석',
    items: [
      { href: '/analytics', label: '매출분석', icon: BarChart3 },
      { href: '/analytics/price-table', label: '판매가 테이블', icon: FileSpreadsheet },
      { href: '/analytics/sabangnet-review', label: '사방넷 검수', icon: FileSpreadsheet },
      { href: '/analytics/rocket-outbound', label: '로켓배송 출고', icon: FileSpreadsheet },
      { href: '/analytics/short-meeting', label: '숏미팅', icon: ClipboardList },
    ],
  },
  {
    id: 'admin',
    title: '관리자',
    items: [
      { href: '/admin/dev-log', label: '개발로그', icon: FileText },
      { href: '/admin/accounts', label: '계정관리', icon: Users },
      { href: '/settings/menu', label: '메뉴', icon: Settings },
      { href: '/settings', label: '설정', icon: Settings },
    ],
  },
]

const allNavItems: NavItem[] = navSections.flatMap((section) => section.items)

interface SidebarProps {
  onCollapse?: () => void
}

export function Sidebar({ onCollapse }: SidebarProps = {}) {
  const pathname = usePathname()
  const router = useRouter()
  const { favorites, toggleFavorite, isFavorite } = useNavState()
  const [orderedSections, setOrderedSections] = useState<NavSection[]>(navSections)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const syncOrder = () => setOrderedSections(applySidebarMenuOrder(navSections, readSidebarMenuOrder()))
    syncOrder()
    void fetchSidebarMenuOrder()
      .then((order) => {
        if (order) setOrderedSections(applySidebarMenuOrder(navSections, order))
      })
      .catch(() => {
        // Keep the local menu order if account-level settings cannot be loaded.
      })
    window.addEventListener(SIDEBAR_MENU_ORDER_EVENT, syncOrder)
    window.addEventListener('storage', syncOrder)
    return () => {
      window.removeEventListener(SIDEBAR_MENU_ORDER_EVENT, syncOrder)
      window.removeEventListener('storage', syncOrder)
    }
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut({ scope: 'local' })
    router.push('/login')
  }

  const orderedNavItems = orderedSections.flatMap((section) => section.items)
  const favoriteItems = favorites
    .map((href) => orderedNavItems.find((item) => item.href === href) ?? allNavItems.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item))

  function isItemActive(href: string) {
    const itemPath = href.split('?')[0]
    if (itemPath === '/orders' || itemPath === '/cs' || itemPath === '/settings' || itemPath === '/products' || itemPath === '/inventory' || itemPath === '/analytics') {
      return pathname === itemPath
    }
    return pathname.startsWith(itemPath)
  }

  function isSectionActive(section: NavSection) {
    return section.items.some((item) => isItemActive(item.href))
  }

  function renderNavItem(item: NavItem, opts: { showStar: boolean }) {
    const Icon = item.icon
    const active = isItemActive(item.href)
    const fav = isFavorite(item.href)

    return (
      <div
        key={item.href}
        className={`group flex items-center rounded transition-colors ${
          active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
        }`}
      >
        <Link
          href={item.href}
          className="flex flex-1 items-center gap-2 px-2 py-1 text-xs font-medium"
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{item.label}</span>
        </Link>
        {opts.showStar && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              toggleFavorite(item.href)
            }}
            aria-label={fav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
            className={`mr-1 flex h-5 w-5 items-center justify-center rounded transition-opacity hover:bg-gray-700 ${
              fav ? 'text-yellow-400 opacity-100' : 'text-gray-500 opacity-0 group-hover:opacity-100'
            }`}
          >
            <Star className={`h-3 w-3 ${fav ? 'fill-yellow-400' : ''}`} />
          </button>
        )}
      </div>
    )
  }

  function renderSectionItems(section: NavSection) {
    if (!section.groups?.length) {
      return section.items.map((item) => renderNavItem(item, { showStar: true }))
    }

    return section.groups.map((group) => (
      <div key={group.id} className="space-y-px">
        <p className="px-2 pt-1 text-[9px] font-semibold text-gray-500">
          {group.title}
        </p>
        <div className="space-y-px">
          {group.items.map((item) => renderNavItem(item, { showStar: true }))}
        </div>
      </div>
    ))
  }

  return (
    <aside className="flex h-full w-48 flex-col bg-gray-900 text-white">
      <div className="flex h-10 items-center justify-between border-b border-gray-800 px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold">Funtastic</span>
          <span className="text-[9px] text-gray-500">v2.1</span>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="사이드바 접기"
            className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1.5">
        <div className="space-y-px">
          {orderedSections.find((section) => section.id === 'dashboard')?.items.map((item) => renderNavItem(item, { showStar: false }))}
        </div>

        {favoriteItems.length > 0 && (
          <div className="mt-2">
            <p className="mb-0.5 flex items-center gap-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-gray-500">
              <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
              즐겨찾기
            </p>
            <div className="space-y-px">
              {favoriteItems.map((item) => renderNavItem(item, { showStar: true }))}
            </div>
          </div>
        )}

        {orderedSections.filter((section) => section.id !== 'dashboard').map((section) => {
          const sectionIsActive = isSectionActive(section)
          const sectionIsOpen = section.collapsible
            ? openSections[section.id] ?? (sectionIsActive || !section.defaultCollapsed)
            : true
          return (
          <div key={section.id} className="mt-2">
            {section.title && (
              section.collapsible ? (
                <button
                  type="button"
                  onClick={() => setOpenSections((current) => ({
                    ...current,
                    [section.id]: !(current[section.id] ?? (sectionIsActive || !section.defaultCollapsed)),
                  }))}
                  className={`mb-0.5 flex w-full items-center justify-between rounded px-2 py-0.5 text-left text-[9px] font-semibold uppercase tracking-wider transition-colors ${
                    sectionIsActive ? 'text-gray-300' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                  }`}
                >
                  <span>{section.title}</span>
                  {sectionIsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
              ) : (
                <p className="mb-0.5 px-2 text-[9px] font-semibold uppercase tracking-wider text-gray-500">
                  {section.title}
                </p>
              )
            )}
            {sectionIsOpen && (
              <div className="space-y-px">
                {renderSectionItems(section)}
              </div>
            )}
          </div>
          )
        })}
      </nav>

      <div className="border-t border-gray-800 px-2 py-1.5">
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <LogOut className="h-3.5 w-3.5" />
          로그아웃
        </button>
      </div>
    </aside>
  )
}
