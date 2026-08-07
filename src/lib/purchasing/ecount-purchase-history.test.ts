import { describe, expect, it } from 'vitest'
import { matchPurchaseHistoryRow } from './ecount-purchase-history'

const candidates = [
  { productId: 'product-a', internalSku: '100001', productName: '파일 서류 정리함', optionName: null, variantSku: null },
  { productId: 'product-b', internalSku: '100002', productName: '흡착식 다용도 후크', optionName: '그린', variantSku: '100002-0001' },
]

describe('Ecount historical purchase matching', () => {
  it('matches an unambiguous source product to the item master', () => {
    expect(matchPurchaseHistoryRow({
      sourceRequestNumber: '20260806-1', requestDate: '2026-08-06', managerName: null, warehouseName: null,
      sourceProductName: '파일 서류 정리함', quantity: 20, sourceNote: null, sourceStatus: 'completed', rawData: {},
    }, candidates)).toMatchObject({ matchStatus: 'exact', productId: 'product-a', sku: '100001' })
  })

  it('keeps multi-item summary rows out of automatic SKU learning', () => {
    expect(matchPurchaseHistoryRow({
      sourceRequestNumber: '20260806-2', requestDate: '2026-08-06', managerName: null, warehouseName: null,
      sourceProductName: '파일 서류 정리함 외 3건', quantity: 20, sourceNote: null, sourceStatus: 'completed', rawData: {},
    }, candidates)).toMatchObject({ matchStatus: 'summary', productId: null, sku: null })
  })
})
