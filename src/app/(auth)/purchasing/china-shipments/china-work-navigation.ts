'use client'

import { useRouter } from 'next/navigation'

export function useChinaWorkNavigation() {
  const router = useRouter()
  return (href: string) => router.replace(href, { scroll: false })
}
