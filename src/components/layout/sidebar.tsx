'use client'

import Link from 'next/link'
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
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useNavState } from './nav-state'

interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
}

interface NavSection {
  title?: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
    ],
  },
  {
    title: '주문',
    items: [
      { href: '/orders', label: '전체 주문', icon: ShoppingCart },
      { href: '/orders/collect', label: '주문 수집', icon: Download },
      { href: '/shipping/held', label: '미발송 관리', icon: PackageX },
    ],
  },
  {
    title: '출고 작업',
    items: [
      { href: '/shipping/scan', label: '바코드 스캔/출고', icon: Truck },
      { href: '/shipping/invoice', label: '송장 업로드 현황', icon: Upload },
    ],
  },
  {
    title: '상품',
    items: [
      { href: '/products', label: '상품 관리', icon: Package },
      { href: '/products/mapping', label: '매핑관리', icon: ArrowRightLeft },
      { href: '/products/mapping-codes', label: '매핑코드 마스터', icon: ArrowRightLeft },
      { href: '/products/marketplace-categories', label: '카테고리 매핑', icon: FolderTree },
      { href: '/inventory', label: '재고관리', icon: Warehouse },
      { href: '/inventory/adjustments', label: '입출고관리', icon: ArrowRightLeft },
    ],
  },
  {
    title: '분석',
    items: [
      { href: '/analytics', label: '매출분석', icon: BarChart3 },
    ],
  },
  {
    title: '설정',
    items: [
      { href: '/settings/marketplaces', label: '마켓연동', icon: Store },
      { href: '/settings', label: '설정', icon: Settings },
    ],
  },
  {
    title: '관리자',
    items: [
      { href: '/admin/dev-log', label: '개발로그', icon: FileText },
      { href: '/admin/accounts', label: '계정관리', icon: Users },
    ],
  },
]

// Flat lookup so favorites can resolve label/icon from href
const allNavItems: NavItem[] = navSections.flatMap((s) => s.items)

interface SidebarProps {
  onCollapse?: () => void
}

export function Sidebar({ onCollapse }: SidebarProps = {}) {
  const pathname = usePathname()
  const router = useRouter()
  const { favorites, toggleFavorite, isFavorite } = useNavState()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut({ scope: 'local' })
    router.push('/login')
  }

  const favoriteItems = favorites
    .map((href) => allNavItems.find((i) => i.href === href))
    .filter((i): i is NavItem => Boolean(i))

  function isItemActive(href: string) {
    const itemPath = href.split('?')[0]
    if (itemPath === '/orders' || itemPath === '/settings' || itemPath === '/products' || itemPath === '/inventory') {
      return pathname === itemPath
    }
    return pathname.startsWith(itemPath)
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
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
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

  return (
    <aside className="flex h-full w-48 flex-col bg-gray-900 text-white">
      {/* Logo */}
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

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-1.5">
        {/* Dashboard */}
        <div className="space-y-px">
          {navSections[0].items.map((item) => renderNavItem(item, { showStar: false }))}
        </div>

        {/* Favorites — directly below Dashboard */}
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

        {/* Remaining sections */}
        {navSections.slice(1).map((section, sIdx) => (
          <div key={sIdx} className="mt-2">
            {section.title && (
              <p className="mb-0.5 px-2 text-[9px] font-semibold uppercase tracking-wider text-gray-500">
                {section.title}
              </p>
            )}
            <div className="space-y-px">
              {section.items.map((item) => renderNavItem(item, { showStar: true }))}
            </div>
          </div>
        ))}
      </nav>

      {/* Sign Out */}
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
