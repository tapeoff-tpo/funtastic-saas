import { describe, expect, it } from 'vitest'
import { normalizeNewProductOptionDetails } from './option-details'

describe('normalizeNewProductOptionDetails', () => {
  it('normalizes editable option values into the stored option format', () => {
    expect(normalizeNewProductOptionDetails([
      {
        id: 'red-large',
        optionName: ' 레드 / 대 ',
        sabangnetOptionCode: ' 110336-0001 ',
        sabangnetRegistered: 'y',
        chinaUnitPriceCny: '4.1',
        unitShippingCny: '10.5',
        productSize: '60*48*43',
        purchaseReferenceNotes: '10개입',
        costKrw: '851.4',
        previousCostKrw: '854',
        exchangeRateKrw: '207.5',
        b2bPrice: '12000',
        b2cPrice: '15900',
      },
    ])).toEqual([{
      id: 'red-large',
      optionName: '레드 / 대',
      sabangnetOptionCode: '110336-0001',
      sabangnetRegistered: 'Y',
      chinaUnitPriceCny: 4.1,
      unitShippingCny: 10.5,
      productSize: '60*48*43',
      bulkSize: null,
      purchaseReferenceNotes: '10개입',
      costKrw: 851,
      previousCostKrw: 854,
      exchangeRateKrw: 207.5,
      b2bPrice: 12000,
      b2cPrice: 15900,
    }])
  })

  it('drops invalid field values and gives duplicate rows stable separate ids', () => {
    expect(normalizeNewProductOptionDetails([
      { id: 'same', chinaUnitPriceCny: '-1', sabangnetRegistered: 'unknown' },
      { id: 'same', b2bPrice: 'not-a-number' },
    ])).toMatchObject([
      { id: 'same', chinaUnitPriceCny: null, sabangnetRegistered: null },
      { id: 'option-2', b2bPrice: null },
    ])
    expect(normalizeNewProductOptionDetails({})).toEqual([])
  })
})
