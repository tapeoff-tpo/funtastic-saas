import type { OrderStatus } from '@/lib/orders/types'

const TOSS_ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  PAID: 'new',
  PREPARING_PRODUCT: 'confirmed',
  DELAY_SHIPPING: 'confirmed',
  DELIVERING: 'delivering',
  DELIVERED: 'delivered',
  CONFIRMED_ORDER: 'delivered',
  CANCELED_PAYMENT: 'cancelled',
}

export function mapTossShoppingStatus(code: string): OrderStatus {
  return TOSS_ORDER_STATUS_MAP[code] ?? 'new'
}
