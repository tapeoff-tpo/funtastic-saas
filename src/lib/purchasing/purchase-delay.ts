export const PURCHASE_DELAY_TRACKING_START_DATE = '2026-07-01'

export const PURCHASE_DELAY_REASONS = [
  'discontinued',
  'supplier_changed',
  'temporary_out_of_stock',
  'production_or_shipping_delay',
  'quality_or_spec_issue',
  'under_review',
  'other',
  'resolved',
] as const

export type PurchaseDelayReason = (typeof PURCHASE_DELAY_REASONS)[number]

export const PURCHASE_DELAY_REASON_LABELS: Record<PurchaseDelayReason, string> = {
  discontinued: '단종',
  supplier_changed: '구매처 변경',
  temporary_out_of_stock: '일시 품절',
  production_or_shipping_delay: '생산/배송 지연',
  quality_or_spec_issue: '품질/사양 확인',
  under_review: '확인 중',
  other: '기타',
  resolved: '지연 해소 (정상)',
}

export const PURCHASING_ITEM_STATUSES = [
  'active',
  'discontinued',
  'supplier_changed',
  'temporarily_unavailable',
  'delayed',
  'under_review',
] as const

export type PurchasingItemStatus = (typeof PURCHASING_ITEM_STATUSES)[number]

export const PURCHASING_ITEM_STATUS_LABELS: Record<PurchasingItemStatus, string> = {
  active: '정상',
  discontinued: '단종',
  supplier_changed: '구매처 변경',
  temporarily_unavailable: '일시 품절',
  delayed: '생산/배송 지연',
  under_review: '확인 중',
}

export function purchaseDelayReasonToItemStatus(reason: PurchaseDelayReason): PurchasingItemStatus {
  if (reason === 'discontinued') return 'discontinued'
  if (reason === 'supplier_changed') return 'supplier_changed'
  if (reason === 'temporary_out_of_stock') return 'temporarily_unavailable'
  if (reason === 'production_or_shipping_delay') return 'delayed'
  if (reason === 'quality_or_spec_issue' || reason === 'under_review') return 'under_review'
  if (reason === 'resolved') return 'active'
  return 'under_review'
}

export function isDiscontinuedPurchasingStatus(status: string | null | undefined) {
  return status === 'discontinued'
}

export function isPurchaseDelayTrackingDate(requestDate: string | null | undefined) {
  return Boolean(requestDate && requestDate >= PURCHASE_DELAY_TRACKING_START_DATE)
}
