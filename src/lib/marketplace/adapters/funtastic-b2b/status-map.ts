import type { OrderStatus } from '@/lib/orders/types'

const STATUS_MAP: Record<string, OrderStatus> = {
  new: 'new',
  paid: 'new',
  ordered: 'new',
  confirmed: 'confirmed',
  preparing: 'preparing',
  shipped: 'shipped',
  delivering: 'delivering',
  delivered: 'delivered',
  cancelled: 'cancelled',
  canceled: 'cancelled',
}

export function mapFuntasticB2bStatus(status: string): OrderStatus {
  return STATUS_MAP[String(status).toLowerCase()] ?? 'new'
}
