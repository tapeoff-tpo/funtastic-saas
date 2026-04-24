'use client'

import { useEffect, useState } from 'react'
import { ChevronsRight } from 'lucide-react'
import { Sidebar } from './sidebar'

interface AppShellProps {
  children: React.ReactNode
}

const STORAGE_KEY = 'funtastic-sidebar-collapsed'

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'true') {
        setCollapsed(true)
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — use default
    }
  }, [])

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
      <main className="flex-1 overflow-auto bg-gray-50 p-6">{children}</main>
    </div>
  )
}
