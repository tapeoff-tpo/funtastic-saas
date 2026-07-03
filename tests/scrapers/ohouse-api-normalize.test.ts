import { describe, expect, it } from 'vitest'
import { normalizeOhouseApiOrderRecord } from '@/scrapers/ohouse/scraper'

describe('normalizeOhouseApiOrderRecord', () => {
  it('uses orderCount as the item quantity when Ohouse API omits quantity', () => {
    const order = normalizeOhouseApiOrderRecord(
      {
        orderNo: 'OH-COUNT-001',
        orderOptionNo: 'OPT-COUNT-001',
        orderCount: 3,
        productName: 'Test product',
        optionName: 'Test option',
        orderStatus: 'PAID',
        orderDate: '2026-07-03T10:00:00+09:00',
        totalPrice: 30000,
        ordererName: 'Buyer',
        ordererPhone: '010-1111-2222',
        receiverName: 'Recipient',
        receiverPhone: '010-3333-4444',
        receiverZipCode: '12345',
        receiverAddress: 'Seoul',
      },
      { email: 'seller', password: 'secret' },
      0,
    )

    expect(order?.items[0].quantity).toBe(3)
  })
})
