import type { Metadata } from 'next'
import { PurchasingOrdersView } from '../orders/page'
import type { PurchaseRequestStatus } from '@/lib/purchasing/purchase-request-status'

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
      description="자동 추천 발주 항목을 검토하고 담당자와 요청수량을 확정한 뒤 발주요청으로 넘깁니다."
      showRecommendationGenerator
    />
  )
}
