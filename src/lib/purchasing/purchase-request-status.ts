export const PURCHASE_REQUEST_STATUSES = [
  'requested',
  'purchased',
  'purchase_completed',
  'china_arrived',
  'outbound_requested',
  'completed',
] as const

export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number]

export const PURCHASE_REQUEST_STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  requested: '발주검토',
  purchased: '발주요청',
  purchase_completed: '구매완료',
  china_arrived: '중국창고도착',
  outbound_requested: '중국출고요청',
  completed: '중국출고완료',
}

export const PURCHASE_PAYMENT_STATUSES = ['pending', 'paid', 'before_outbound'] as const

export type PurchasePaymentStatus = (typeof PURCHASE_PAYMENT_STATUSES)[number]

export const PURCHASE_PAYMENT_STATUS_LABELS: Record<PurchasePaymentStatus, string> = {
  pending: '결제 대기',
  paid: '결제 완료',
  before_outbound: '출고 전 결제',
}

const STATUS_FLOW: PurchaseRequestStatus[] = [
  'requested',
  'purchased',
  'purchase_completed',
  'china_arrived',
  'outbound_requested',
  'completed',
]

export function getNextPurchaseStatus(status: PurchaseRequestStatus): PurchaseRequestStatus | null {
  const index = STATUS_FLOW.indexOf(status)
  if (index < 0 || index >= STATUS_FLOW.length - 1) return null
  return STATUS_FLOW[index + 1]
}
