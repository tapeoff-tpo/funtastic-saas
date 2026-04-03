/**
 * Tests for combined shipping detection algorithm.
 *
 * Tests pure functions: normalizeAddress, getFulfillmentCode, findMergeCandidates
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeAddress,
  getFulfillmentCode,
  findMergeCandidates,
  type OrderWithItems,
} from '@/lib/shipping/combined-shipping'

function makeOrder(overrides: Partial<OrderWithItems> = {}): OrderWithItems {
  return {
    id: crypto.randomUUID(),
    buyerName: '홍길동',
    shippingAddress: {
      zipCode: '06234',
      address1: '서울특별시 강남구 테헤란로 123',
      address2: '4층',
    },
    orderedAt: new Date('2026-04-01T10:00:00Z'),
    items: [
      { id: crypto.randomUUID(), fulfillmentCode: 'normal', quantity: 1 },
    ],
    ...overrides,
  }
}

describe('normalizeAddress', () => {
  it('strips whitespace and normalizes address', () => {
    const result = normalizeAddress({
      zipCode: '  06234  ',
      address1: '  서울특별시  강남구   테헤란로  123  ',
      address2: '  4층  ',
    })
    expect(result).toBe('06234|서울특별시 강남구 테헤란로 123|4층')
  })

  it('handles missing address2', () => {
    const result = normalizeAddress({
      zipCode: '06234',
      address1: '서울특별시 강남구 테헤란로 123',
    })
    expect(result).toBe('06234|서울특별시 강남구 테헤란로 123|')
  })
})

describe('getFulfillmentCode', () => {
  it('returns the code when all items have same fulfillmentCode', () => {
    expect(
      getFulfillmentCode([
        { fulfillmentCode: 'frozen', quantity: 1 },
        { fulfillmentCode: 'frozen', quantity: 2 },
      ]),
    ).toBe('frozen')
  })

  it('returns mixed when items have different fulfillmentCodes', () => {
    expect(
      getFulfillmentCode([
        { fulfillmentCode: 'frozen', quantity: 1 },
        { fulfillmentCode: 'normal', quantity: 1 },
      ]),
    ).toBe('mixed')
  })

  it('defaults to normal when no fulfillmentCode set', () => {
    expect(
      getFulfillmentCode([
        { fulfillmentCode: undefined, quantity: 1 },
        { fulfillmentCode: null as unknown as string, quantity: 1 },
      ]),
    ).toBe('normal')
  })
})

describe('findMergeCandidates', () => {
  it('groups 2 orders with same buyer + address + same day', () => {
    const orders = [
      makeOrder({ id: 'order-1' }),
      makeOrder({ id: 'order-2' }),
    ]
    const groups = findMergeCandidates(orders)
    expect(groups).toHaveLength(1)
    expect(groups[0].orders).toHaveLength(2)
    expect(groups[0].suggestedAction).toBe('merge')
    expect(groups[0].fulfillmentCode).toBe('normal')
  })

  it('returns 0 merge groups when same buyer but different addresses', () => {
    const orders = [
      makeOrder({ id: 'order-1' }),
      makeOrder({
        id: 'order-2',
        shippingAddress: {
          zipCode: '12345',
          address1: '부산광역시 해운대구',
          address2: '1층',
        },
      }),
    ]
    const groups = findMergeCandidates(orders)
    expect(groups).toHaveLength(0)
  })

  it('separates by fulfillment code: 2 normal + 1 frozen -> 1 group of 2 normal', () => {
    const orders = [
      makeOrder({
        id: 'order-1',
        items: [{ id: 'i1', fulfillmentCode: 'normal', quantity: 1 }],
      }),
      makeOrder({
        id: 'order-2',
        items: [{ id: 'i2', fulfillmentCode: 'normal', quantity: 1 }],
      }),
      makeOrder({
        id: 'order-3',
        items: [{ id: 'i3', fulfillmentCode: 'frozen', quantity: 1 }],
      }),
    ]
    const groups = findMergeCandidates(orders)
    expect(groups).toHaveLength(1)
    expect(groups[0].fulfillmentCode).toBe('normal')
    expect(groups[0].orders).toHaveLength(2)
  })

  it('splits groups exceeding maxPackQuantity: 5 orders, max=3 -> 2 groups (3+2)', () => {
    const orders = Array.from({ length: 5 }, (_, i) =>
      makeOrder({ id: `order-${i}` }),
    )
    const groups = findMergeCandidates(orders, 3)
    expect(groups).toHaveLength(2)
    expect(groups[0].orders).toHaveLength(3)
    expect(groups[1].orders).toHaveLength(2)
  })

  it('returns no group for single order with same buyer/address', () => {
    const orders = [makeOrder({ id: 'order-1' })]
    const groups = findMergeCandidates(orders)
    expect(groups).toHaveLength(0)
  })

  it('separates orders from different days even if same buyer/address', () => {
    const orders = [
      makeOrder({
        id: 'order-1',
        orderedAt: new Date('2026-04-01T10:00:00Z'),
      }),
      makeOrder({
        id: 'order-2',
        orderedAt: new Date('2026-04-02T10:00:00Z'),
      }),
    ]
    const groups = findMergeCandidates(orders)
    expect(groups).toHaveLength(0)
  })

  it('assigns correct groupKey containing buyer + address + date', () => {
    const orders = [
      makeOrder({ id: 'order-1' }),
      makeOrder({ id: 'order-2' }),
    ]
    const groups = findMergeCandidates(orders)
    expect(groups[0].groupKey).toContain('홍길동')
    expect(groups[0].groupKey).toContain('06234')
    expect(groups[0].groupKey).toContain('2026-04-01')
  })
})
