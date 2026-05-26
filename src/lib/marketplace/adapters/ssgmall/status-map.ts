import type { OrderStatus } from '@/lib/orders/types'

const SSGMALL_SHIPPING_PROGRESS_MAP: Record<string, OrderStatus> = {
  '120': 'new',
  '130': 'new',
  '140': 'confirmed',
  '160': 'shipped',
  '170': 'delivered',
  '180': 'cancelled',
  '11': 'new',
  '21': 'new',
  '22': 'new',
  '31': 'new',
  '41': 'new',
  '42': 'new',
  '43': 'shipped',
  '51': 'delivered',
  '52': 'cancelled',
}

export function mapSsgmallStatus(progressCode?: string, shippingStatusCode?: string): OrderStatus {
  if (progressCode && SSGMALL_SHIPPING_PROGRESS_MAP[progressCode]) {
    return SSGMALL_SHIPPING_PROGRESS_MAP[progressCode]
  }
  if (shippingStatusCode === '30') return 'new'
  return 'new'
}

export function mapSsgmallClaimType(_code?: string): 'cancel' | 'return' | 'exchange' {
  void _code
  return 'cancel'
}

export function mapSsgmallClaimStatus(_code?: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  void _code
  return 'requested'
}
