'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ArrowUp, ChevronsRight, Menu, X } from 'lucide-react'
import { Sidebar } from './sidebar'
import { TabBar } from './tab-bar'
import { getRouteLabel, NavStateProvider } from './nav-state'
import { PurchasingLanguageSwitcher } from '@/components/purchasing-language-switcher'

interface AppShellProps {
  children: React.ReactNode
}

const STORAGE_KEY = 'funtastic-sidebar-collapsed'

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const mainRef = useRef<HTMLElement>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [mobileMenuPath, setMobileMenuPath] = useState<string | null>(null)
  const mobileMenuOpen = mobileMenuPath === pathname
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

  useEffect(() => {
    if (!mobileMenuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuPath(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileMenuOpen])

  return (
    <NavStateProvider>
      <div className="fixed inset-0 flex overflow-hidden">
        {collapsed ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="사이드바 펼치기"
            className="fixed left-2 top-2 z-50 hidden h-7 w-7 items-center justify-center rounded bg-gray-900 text-white shadow hover:bg-gray-800 md:flex"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        ) : (
          <div className="hidden h-full md:flex">
            <Sidebar onCollapse={toggleCollapsed} />
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="grid h-[calc(3rem+env(safe-area-inset-top))] shrink-0 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center border-b border-gray-200 bg-white px-2 pt-[env(safe-area-inset-top)] md:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuPath(pathname)}
              aria-label="메뉴 열기"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
              className="flex h-10 w-10 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100"
            >
              <Menu className="h-5 w-5" />
            </button>
            <p className="truncate px-2 text-center text-sm font-semibold text-gray-900">
              {getRouteLabel(pathname)}
            </p>
            {/* 메뉴 버튼과 같은 폭의 빈 자리로 제목을 항상 화면 가운데에 맞춘다. */}
            <span aria-hidden="true" className="h-10 w-10" />
          </header>
          <div className="hidden md:block">
            <TabBar />
          </div>
          <main
            ref={mainRef}
            onScroll={(event) => setShowScrollTop(event.currentTarget.scrollTop > 300)}
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-gray-50 p-3 sm:p-4 md:p-6"
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
              className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white shadow-lg transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 md:bottom-6 md:right-6 md:w-auto md:gap-1.5 md:px-4"
            >
              <ArrowUp className="h-4 w-4" />
              <span className="hidden md:inline">맨 위로</span>
            </button>
          ) : null}
        </div>
        {mobileMenuOpen ? (
          <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="주 메뉴">
            <button
              type="button"
              onClick={() => setMobileMenuPath(null)}
              aria-label="메뉴 닫기"
              className="absolute inset-0 bg-black/45"
            />
            <div
              id="mobile-navigation"
              className="relative h-full w-[min(18rem,84vw)] shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <Sidebar mobile onNavigate={() => setMobileMenuPath(null)} />
              <button
                type="button"
                onClick={() => setMobileMenuPath(null)}
                aria-label="메뉴 닫기"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </NavStateProvider>
  )
}
