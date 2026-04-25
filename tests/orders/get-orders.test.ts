import { describe, it, expect } from 'vitest'
import type { OrderListItem } from '@/lib/orders/types'

describe('getOrders — displayName join', () => {
  it('OrderListItem.items[].displayName 필드가 타입에 노출된다 (LEFT JOIN product_name_mappings)', () => {
    const item: OrderListItem['items'][number] = {
      productName: '원본명',
      displayName: '매핑된 SaaS 상품명',
      optionText: null,
      quantity: 1,
      sku: null,
    } as OrderListItem['items'][number]
    expect(item.displayName).toBe('매핑된 SaaS 상품명')
  })
  it.todo('매핑 없는 row → displayName === null (fallback to productName)')
  it.todo('marketplaceId 매칭 실수 방지 — 쿠팡 row가 네이버 매핑을 잡지 않는다')
})
