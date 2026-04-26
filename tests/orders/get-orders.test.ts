import { describe, it, expect } from 'vitest'
import type { OrderListItem } from '@/lib/orders/types'

describe('OrderListItem shape — phase 8', () => {
  it('items[].displayName 필드가 타입에 노출된다 (LEFT JOIN product_name_mappings)', () => {
    const item: OrderListItem['items'][number] = {
      productName: '원본명',
      displayName: '매핑된 SaaS 상품명',
      optionText: null,
      quantity: 1,
      sku: null,
      shippingCost: null,
    }
    expect(item.displayName).toBe('매핑된 SaaS 상품명')
  })

  it('매핑 없는 row → displayName === null (fallback to productName)', () => {
    const item: OrderListItem['items'][number] = {
      productName: '원본명',
      displayName: null,
      optionText: null,
      quantity: 1,
      sku: null,
      shippingCost: null,
    }
    expect(item.displayName).toBeNull()
  })

  it('OrderListItem exposes shippingType, shippingFee, hasInquiries', () => {
    const o: Pick<OrderListItem, 'shippingType' | 'shippingFee' | 'hasInquiries'> = {
      shippingType: 'prepaid',
      shippingFee: '3000',
      hasInquiries: true,
    }
    expect(o.shippingType).toBe('prepaid')
    expect(o.shippingFee).toBe('3000')
    expect(o.hasInquiries).toBe(true)
  })
})
