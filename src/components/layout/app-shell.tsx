'use client'

import { useRef, useState } from 'react'
import { ArrowUp, ChevronsRight } from 'lucide-react'
import { Sidebar } from './sidebar'
import { TabBar } from './tab-bar'
import { NavStateProvider } from './nav-state'
import { PurchasingLanguageSwitcher } from '@/components/purchasing-language-switcher'

interface AppShellProps {
  children: React.ReactNode
}

const STORAGE_KEY = 'funtastic-sidebar-collapsed'

export function AppShell({ children }: AppShellProps) {
  const mainRef = useRef<HTMLElement>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  return (
    <NavStateProvider>
      <div className="fixed inset-0 flex overflow-hidden">
        {collapsed ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="사이드바 펼치기"
            className="fixed left-2 top-2 z-50 flex h-7 w-7 items-center justify-center rounded bg-gray-900 text-white shadow hover:bg-gray-800"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        ) : (
          <Sidebar onCollapse={toggleCollapsed} />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <TabBar />
          <main
            ref={mainRef}
            onScroll={(event) => setShowScrollTop(event.currentTarget.scrollTop > 300)}
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-gray-50 p-6"
          >
            <PurchasingLanguageSwitcher />
            {children}
          </main>
          {showScrollTop ? (
            <button
              type="button"
              onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              aria-label="맨 위로 이동"
              title="맨 위로"
              className="fixed bottom-6 right-6 z-40 inline-flex h-11 items-center gap-1.5 rounded-full bg-gray-900 px-4 text-sm font-semibold text-white shadow-lg transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
            >
              <ArrowUp className="h-4 w-4" />
              맨 위로
            </button>
          ) : null}
        </div>
      </div>
    </NavStateProvider>
  )
}
