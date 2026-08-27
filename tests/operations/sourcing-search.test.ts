import { describe, expect, it } from 'vitest'
import type { ManualSourcingItem, SourcingMeeting } from '@/lib/operations/sourcing'
import { searchSourcingItems, sourcingOptionSummary } from '@/lib/operations/sourcing-search'

function item(overrides: Partial<ManualSourcingItem> = {}): ManualSourcingItem {
  return {
    id: 'item-1',
    meetingId: 'meeting-1',
    ownerOperatorId: 'owner-1',
    ownerName: '김소싱',
    productName: '실리콘 멀티 찜기',
    productOption: '그린',
    options: [{ name: '그린', chinaUnitPriceCny: 12 }, { name: '베이지', chinaUnitPriceCny: 13 }],
    chinaPurchaseUrl: 'https://detail.1688.com/item/123',
    chinaUnitPriceCny: 12,
    unitShippingCny: 1,
    shippingChargeType: 'unit',
    shippingBundleQuantity: null,
    exchangeRateKrw: 200,
    calculatedCostKrw: 2600,
    domesticSaleUrl: 'https://smartstore.naver.com/sample',
    domesticSalePrice: 12900,
    detailPageUrl: null,
    memo1: '주방 신상품',
    memo2: null,
    status: 'passed',
    hasImageFile: false,
    legacyImageUrl: null,
    passedNewProductId: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  }
}

function meeting(items: ManualSourcingItem[]): SourcingMeeting {
  return {
    id: 'meeting-1',
    meetingDate: '2026-08-26',
    title: '8월 마지막 소싱회의',
    status: 'open',
    createdByUserId: null,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    items,
  }
}

describe('sourcing product search', () => {
  it('상품명과 옵션을 공백으로 조합해 검색한다', () => {
    expect(searchSourcingItems([meeting([item()])], '찜기 베이지', null)).toHaveLength(1)
  })

  it('URL, 비고, 한글 상태명도 검색한다', () => {
    const meetings = [meeting([item()])]

    expect(searchSourcingItems(meetings, '1688 123', null)).toHaveLength(1)
    expect(searchSourcingItems(meetings, '주방 신상품', null)).toHaveLength(1)
    expect(searchSourcingItems(meetings, '통과', null)).toHaveLength(1)
  })

  it('선택한 담당자의 상품만 검색한다', () => {
    const meetings = [meeting([
      item(),
      item({ id: 'item-2', ownerOperatorId: 'owner-2', productName: '원목 휴지박스' }),
    ])]

    expect(searchSourcingItems(meetings, '상품', 'owner-1')).toHaveLength(1)
    expect(searchSourcingItems(meetings, '휴지박스', 'owner-1')).toHaveLength(0)
  })

  it('중복 옵션명을 한 번만 요약한다', () => {
    expect(sourcingOptionSummary(item())).toBe('그린 · 베이지')
  })
})
