'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { withChinaShipmentPeriod } from '@/lib/purchasing/china-shipment-period'

export function useChinaWorkNavigation() {
  const router = useRouter()
  const params = useSearchParams()
  return (href: string, options?: { replace?: boolean }) => {
    const destination = withChinaShipmentPeriod(href, params.toString())
    if (options?.replace) router.replace(destination, { scroll: false })
    else router.push(destination, { scroll: false })
  }
}
