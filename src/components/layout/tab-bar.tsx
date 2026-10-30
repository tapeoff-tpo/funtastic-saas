'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, X } from 'lucide-react'
import { getRouteLabel, tabPathname, useNavState } from './nav-state'
import { useMenuAccess } from './menu-access-provider'
import { canAccessPage, MENU_PATHS } from '@/lib/auth/menu-permissions'

export function TabBar() {
  const pathname = usePathname()
  const { tabs, closeTab } = useNavState()
  const access = useMenuAccess()
  const home = MENU_PATHS.find((path) => canAccessPage(access, path)) ?? '/access-denied'

  const isHome = pathname === home

  return (
    <div className="flex h-9 items-stretch gap-px overflow-x-auto border-b border-gray-200 bg-gray-100 px-1">
      {/* Home / Dashboard tab — always present, not closable */}
      <Link
        href={home}
        className={`flex items-center gap-1.5 px-3 text-xs font-medium transition-colors ${
          isHome
            ? 'border-t-2 border-blue-500 bg-white text-gray-900'
            : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
        }`}
        title={getRouteLabel(home)}
      >
        <Home className="h-3.5 w-3.5" />
      </Link>

      {tabs.filter((tab) => canAccessPage(access, tab.href)).map((tab) => {
        // tab.href may include query string (e.g. "/orders?from=...") so compare by pathname.
        const tabPath = tabPathname(tab)
        const active = pathname === tabPath
        return (
          <div
            key={tabPath}
            className={`group flex items-center transition-colors ${
              active
                ? 'border-t-2 border-blue-500 bg-white text-gray-900'
                : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
            }`}
          >
            <Link
              href={tab.href}
              className="flex items-center px-3 py-1 text-xs font-medium"
              title={tab.label}
            >
              <span className="max-w-[140px] truncate">{tab.label}</span>
            </Link>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                closeTab(tab.href)
              }}
              aria-label={`${tab.label} 탭 닫기`}
              className="mr-1 flex h-4 w-4 items-center justify-center rounded text-gray-400 opacity-60 hover:bg-gray-300 hover:text-gray-700 hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
