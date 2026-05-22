'use client'

import { useState } from 'react'
import { ChevronsRight } from 'lucide-react'
import { Sidebar } from './sidebar'
import { TabBar } from './tab-bar'
import { NavStateProvider } from './nav-state'

interface AppShellProps {
  children: React.ReactNode
}

const STORAGE_KEY = 'funtastic-sidebar-collapsed'

export function AppShell({ children }: AppShellProps) {
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
      <div className="flex h-screen">
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
        <div className="flex flex-1 flex-col overflow-hidden">
          <TabBar />
          <main className="flex-1 overflow-auto bg-gray-50 p-6">{children}</main>
        </div>
      </div>
    </NavStateProvider>
  )
}
