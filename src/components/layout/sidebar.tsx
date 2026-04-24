'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
  LogOut,
  FileText,
  PackageCheck,
  CircleAlert,
  ChevronsLeft,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface NavSection {
  title?: string
  items: Array<{ href: string; label: string; icon: typeof LayoutDashboard }>
}

const navSections: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
    ],
  },
  {
    title: '주문 처리',
    items: [
      { href: '/orders', label: '전체 주문', icon: ShoppingCart },
      { href: '/orders?stage=prep', label: '출고 준비', icon: CircleAlert },
      { href: '/orders?stage=invoice', label: '송장 발급', icon: FileText },
      { href: '/orders?stage=shipping', label: '출고 대기', icon: PackageCheck },
    ],
  },
  {
    title: '상품',
    items: [
      { href: '/products', label: '상품 관리', icon: Package },
      { href: '/products/mappings', label: '상품명 매핑', icon: ArrowRightLeft },
      { href: '/products/marketplace-categories', label: '카테고리 매핑', icon: FolderTree },
    ],
  },
  {
    title: '물류',
    items: [
      { href: '/shipping/scan', label: '바코드 스캔/출고', icon: Truck },
      { href: '/shipping/held', label: '미발송 관리', icon: PackageX },
      { href: '/shipping/invoice', label: '송장 업로드 현황', icon: Upload },
    ],
  },
  {
    title: '관리',
    items: [
      { href: '/inventory', label: '재고관리', icon: Warehouse },
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
]

interface SidebarProps {
  onCollapse?: () => void
}

export function Sidebar({ onCollapse }: SidebarProps = {}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  const currentStage = searchParams.get('stage')

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
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
        {navSections.map((section, sIdx) => (
          <div key={sIdx} className={sIdx > 0 ? 'mt-2' : ''}>
            {section.title && (
              <p className="mb-0.5 px-2 text-[9px] font-semibold uppercase tracking-wider text-gray-500">
                {section.title}
              </p>
            )}
            <div className="space-y-px">
              {section.items.map((item) => {
                const [itemPath, itemQuery] = item.href.split('?')
                const itemStage = itemQuery?.match(/stage=([^&]+)/)?.[1]

                let isActive: boolean
                if (itemPath === '/orders') {
                  if (pathname !== '/orders') {
                    isActive = false
                  } else if (itemStage) {
                    isActive = currentStage === itemStage
                  } else {
                    isActive = !currentStage
                  }
                } else if (itemPath === '/settings' || itemPath === '/products') {
                  isActive = pathname === itemPath
                } else {
                  isActive = pathname.startsWith(itemPath)
                }

                const Icon = item.icon

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                )
              })}
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
