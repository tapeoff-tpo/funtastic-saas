'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/** Warm only the navigation the user pauses on, not every open business tab. */
export function useIntentPrefetch() {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warmed = useRef(new Map<string, number>())
  function cancel() {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
  function prepare(href: string) {
    cancel()
    if ((warmed.current.get(href) ?? 0) > Date.now()) return
    timer.current = setTimeout(() => {
      timer.current = null
      warmed.current.set(href, Date.now() + 15_000)
      for (const [key, expiry] of warmed.current) if (expiry <= Date.now()) warmed.current.delete(key)
      router.prefetch(href)
    }, 120)
  }
  return { prepare, cancel }
}
