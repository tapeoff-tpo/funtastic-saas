import { describe, expect, it } from 'vitest'
import { normalizeImportedOrderItem } from '@/lib/orders/import-normalize'
import type { ParsedOrderRow } from '@/lib/orders/excel-import'

const baseItem: ParsedOrderRow = {
  orderNumber: 'O-1',
  buyerName: '구매자',
  recipientName: '수령자',
  recipientAddress: '서울시',
  orderedAt: '2026-05-29 10:00:00',
  productName: '상품',
  quantity: 1,
  totalAmount: 1000,
}

describe('normalizeImportedOrderItem', () => {
  it('uses Firstmall product unique id as the Funtastic marketplace product code', () => {
    const item = normalizeImportedOrderItem({
      ...baseItem,
      marketplaceItemId: 'SHIP-ITEM-001',
      sku: 'PRODUCT-UNIQUE-001',
    }, 'funtastic-b2b')

    expect(item.marketplaceItemId).toBe('PRODUCT-UNIQUE-001')
    expect(item.sku).toBe('PRODUCT-UNIQUE-001')
  })

  it('keeps Ownerclan sku split behavior', () => {
    const item = normalizeImportedOrderItem({
      ...baseItem,
      marketplaceItemId: '12345',
      sku: 'OC-PRODUCT INTERNAL-SKU',
    }, 'ownerclan')

    expect(item.marketplaceItemId).toBe('OC-PRODUCT')
    expect(item.sku).toBe('INTERNAL-SKU')
  })
})
