export type MarketplaceCollectionStatus =
  | 'new'
  | 'ready'
  | 'shipping'
  | 'delivered'
  | 'cancelled'
  | 'claim'
  | 'unknown'

export const MARKETPLACE_COLLECTION_STATUS_LABELS: Record<MarketplaceCollectionStatus, string> = {
  new: '신규',
  ready: '배송준비',
  shipping: '배송중',
  delivered: '배송완료',
  cancelled: '취소',
  claim: '클레임',
  unknown: '미분류',
}

export function normalizeMarketplaceCollectionStatus(
  status: string | null | undefined,
): MarketplaceCollectionStatus | null {
  const text = status?.replace(/\s+/g, '').trim()
  if (!text) return null

  if (/취소|cancel/i.test(text)) return 'cancelled'
  if (/반품|교환|환불|클레임|claim/i.test(text)) return 'claim'
  if (/배송완료|구매확정|완료/.test(text)) return 'delivered'
  if (/배송중|발송완료|출고완료|송장/.test(text)) return 'shipping'
  if (/배송준비|배송준비중|발송대상|출고준비|상품준비|주문확인|발주확인/.test(text)) return 'ready'
  if (/신규|신규주문|결제완료|주문접수|주문통보|발주요청|발주전/.test(text)) return 'new'

  return 'unknown'
}
