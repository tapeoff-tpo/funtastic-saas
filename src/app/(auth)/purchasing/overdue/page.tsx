import type { Metadata } from 'next'
import { PurchasingOrdersView } from '../orders/page'
import type { PurchaseRequestStatus } from '@/lib/purchasing/purchase-request-status'

export const metadata: Metadata = {
  title: '구매/입고지연',
}

const OVERDUE_STATUSES = ['purchased', 'purchase_completed'] satisfies PurchaseRequestStatus[]

export default function PurchasingOverduePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <PurchasingOrdersView
      searchParams={searchParams}
      defaultStatus="purchased"
      allowedStatuses={OVERDUE_STATUSES}
      basePath="/purchasing/overdue"
      title="구매/입고지연"
      description="발주요청 후 7일 이상 구매완료되지 않은 항목과 구매완료 후 7일 이상 중국창고에 도착하지 않은 항목을 따로 확인합니다."
      overdueOnly
      showStatusTabs={false}
    />
  )
}
