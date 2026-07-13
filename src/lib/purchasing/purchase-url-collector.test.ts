import { describe, expect, it } from 'vitest'
import {
  canonicalize1688OfferUrl,
  resolvePurchaseUrlAssignments,
  type PurchaseUrlAssignmentProduct,
} from './purchase-url-collector'

const products: PurchaseUrlAssignmentProduct[] = [
  { productId: 'p1', sku: '112003-0001', productName: '앤트론 확장백팩', currentUrl: null },
  { productId: 'p2', sku: '112003-0002', productName: '앤트론 확장백팩', currentUrl: null },
]

describe('canonicalize1688OfferUrl', () => {
  it('removes tracking parameters from a 1688 detail URL', () => {
    expect(canonicalize1688OfferUrl(
      'https://detail.1688.com/offer/953220387690.html?spm=a360q.8274423%2Fnew.goods.productname',
    )).toBe('https://detail.1688.com/offer/953220387690.html')
  })

  it('rejects non-1688 and malformed URLs', () => {
    expect(canonicalize1688OfferUrl('https://example.com/offer/953220387690.html')).toBeNull()
    expect(canonicalize1688OfferUrl(
      'https://example.com/?next=https://detail.1688.com/offer/953220387690.html',
    )).toBeNull()
    expect(canonicalize1688OfferUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('resolvePurchaseUrlAssignments', () => {
  it('assigns one exact offer URL to every missing variant in the order', () => {
    expect(resolvePurchaseUrlAssignments(products, [
      'https://detail.1688.com/offer/953220387690.html?spm=test',
    ])).toEqual({
      status: 'assign',
      assignments: [
        { productId: 'p1', url: 'https://detail.1688.com/offer/953220387690.html' },
        { productId: 'p2', url: 'https://detail.1688.com/offer/953220387690.html' },
      ],
      candidates: ['https://detail.1688.com/offer/953220387690.html'],
    })
  })

  it('does not guess when multiple products and multiple links remain', () => {
    expect(resolvePurchaseUrlAssignments(products, [
      'https://detail.1688.com/offer/111111111111.html',
      'https://detail.1688.com/offer/222222222222.html',
    ]).status).toBe('ambiguous')
  })

  it('uses elimination when only one product and candidate remain', () => {
    const rows = [
      { ...products[0]!, currentUrl: 'https://detail.1688.com/offer/111111111111.html' },
      products[1]!,
    ]
    const result = resolvePurchaseUrlAssignments(rows, [
      'https://detail.1688.com/offer/111111111111.html',
      'https://detail.1688.com/offer/222222222222.html',
    ])
    expect(result).toMatchObject({
      status: 'assign',
      assignments: [{ productId: 'p2', url: 'https://detail.1688.com/offer/222222222222.html' }],
    })
  })

  it('never overwrites products that already have a URL', () => {
    const rows = products.map((product) => ({
      ...product,
      currentUrl: 'https://detail.1688.com/offer/111111111111.html',
    }))
    expect(resolvePurchaseUrlAssignments(rows, [
      'https://detail.1688.com/offer/222222222222.html',
    ]).status).toBe('already_set')
  })
})
