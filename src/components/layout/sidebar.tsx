'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  ShoppingCart,
  ArrowRightLeft,
  Truck,
  Upload,
  PackageX,
  Warehouse,
  BarChart3,
  Store,
  Settings,
  LogOut,
  FileSpreadsheet,
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
      { href: '/orders', label: '주문수집/관리', icon: ShoppingCart },
      { href: '/products', label: '상품매핑/관리', icon: ArrowRightLeft },
    ],
  },
  {
    title: '배송',
    items: [
      { href: '/shipping', label: '송장 생성/출력', icon: Truck },
      { href: '/shipping/invoice', label: '송장 업로드', icon: Upload },
      { href: '/shipping/held', label: '미발송 관리', icon: PackageX },
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
      { href: '/settings/excel-templates', label: '엑셀 양식', icon: FileSpreadsheet },
      { href: '/settings', label: '설정', icon: Settings },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="flex h-full w-64 flex-col bg-gray-900 text-white">
      {/* Logo */}
      <div className="flex h-16 items-center px-6">
        <span className="text-xl font-bold">Funtastic</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {navSections.map((section, sIdx) => (
          <div key={sIdx} className={sIdx > 0 ? 'mt-4' : ''}>
            {section.title && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  item.href === '/settings'
                    ? pathname === '/settings'
                    : pathname.startsWith(item.href)
                const Icon = item.icon

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Sign Out */}
      <div className="border-t border-gray-800 px-3 py-3">
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </button>
      </div>
    </aside>
  )
}
