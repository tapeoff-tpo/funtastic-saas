import type { Metadata } from 'next'
import type { PurchaseRequestStatus } from '@/lib/purchasing/purchase-request-status'
import { PurchasingOrdersView } from '../orders/page'

export const metadata: Metadata = {
  title: '발주검토',
}

const REVIEW_STATUSES = ['requested'] satisfies PurchaseRequestStatus[]

export default function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <PurchasingOrdersView
      searchParams={searchParams}
      defaultStatus="requested"
      allowedStatuses={REVIEW_STATUSES}
      basePath="/purchasing/purchases"
      title="발주검토"
      showRecommendationGenerator
    />
  )
}
