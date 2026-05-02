import type { OrderStatus } from '@/lib/orders/types'

export const OWNERCLAN_STATUS_MAP: Record<string, OrderStatus> = {
  placed: 'new',
  paid: 'new',
  preparing: 'preparing',
  shipped: 'shipped',
  cancelled: 'cancelled',
  cancelRequested: 'cancelled',
  delivered: 'delivered',
  exchangeRequested: 'confirmed',
  exchanged: 'confirmed',
  refundRequested: 'confirmed',
  refundAccepted: 'confirmed',
  refundShipped: 'confirmed',
  refunded: 'cancelled',
  refundClosed: 'cancelled',
}

export function mapOwnerclanStatus(code?: string | null): OrderStatus {
  if (!code) return 'new'
  const mapped = OWNERCLAN_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ownerclan status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}
