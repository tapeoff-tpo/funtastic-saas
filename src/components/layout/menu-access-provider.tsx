'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UNRESTRICTED_MENU_ACCESS, type MenuAccess } from '@/lib/auth/menu-permissions'

const MenuAccessContext = createContext<MenuAccess>(UNRESTRICTED_MENU_ACCESS)
export const useMenuAccess = () => useContext(MenuAccessContext)

export function MenuAccessProvider({ initialAccess, children }: { initialAccess: MenuAccess; children: React.ReactNode }) {
  const sourceKey = JSON.stringify(initialAccess)
  const [snapshot, setSnapshot] = useState({ sourceKey, access: initialAccess })
  const access = snapshot.sourceKey === sourceKey ? snapshot.access : initialAccess
  const router = useRouter()
  useEffect(() => {
    let cancelled = false
    let last = JSON.stringify(initialAccess)
    async function refresh() {
      if (document.hidden) return
      try {
        const response = await fetch('/api/menu-access', { cache: 'no-store' })
        if (!response.ok || cancelled) return
        const next: MenuAccess = await response.json()
        if (JSON.stringify(next) !== last) {
          last = JSON.stringify(next)
          setSnapshot({ sourceKey, access: next })
          router.refresh()
        }
      } catch { /* Server checks still apply while offline. */ }
    }
    const timer = window.setInterval(() => void refresh(), 30_000)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [initialAccess, sourceKey, router])
  return <MenuAccessContext.Provider value={access}>{children}</MenuAccessContext.Provider>
}
