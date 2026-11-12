'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { withChinaShipmentPeriod } from '@/lib/purchasing/china-shipment-period'

export function useChinaWorkNavigation() {
  const router = useRouter()
  const params = useSearchParams()
  return (href: string) => router.replace(withChinaShipmentPeriod(href, params.toString()), { scroll: false })
}
