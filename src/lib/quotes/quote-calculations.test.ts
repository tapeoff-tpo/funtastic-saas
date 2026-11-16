import { describe, expect, it } from 'vitest'
import {
  calculateMonthlySalesTotals,
  calculateQuoteLineTotals,
  calculateQuoteTotals,
  calculateSalesItemMargin,
  calculateSalesMarginTotals,
  deriveSalesStatus,
  formatKoreanWon,
  isSalesStatusIncludedInTotals,
  parseQuoteNumber,
  quoteItemsFromSale,
  salesRecordDate,
  summarizeSalesStatuses,
} from './quote-calculations'

describe('quote calculations', () => {
  it('splits VAT-exclusive and VAT-inclusive lines exactly once after line rounding', () => {
    expect(calculateQuoteLineTotals({ qty: 2, price: 10_000 })).toEqual({
      supply: 20_000,
      vat: 2_000,
      total: 22_000,
    })
    expect(calculateQuoteLineTotals({ qty: 2, price: 10_000, vatIncluded: true })).toEqual({
      supply: 18_182,
      vat: 1_818,
      total: 20_000,
    })
  })

  it('uses zero for a blank printable line and aggregates line totals', () => {
    expect(calculateQuoteLineTotals({ qty: '', price: '' })).toEqual({ supply: 0, vat: 0, total: 0 })
    expect(calculateQuoteTotals([
      { qty: 1, price: 1_000 },
      { qty: 1, price: 1_100, vatIncluded: true },
    ])).toEqual({ supply: 2_000, vat: 200, total: 2_200 })
  })

  it('accepts only stored non-negative numeric values', () => {
    expect(parseQuoteNumber('1200.5')).toBe(1200.5)
    expect(parseQuoteNumber('')).toBeNull()
    expect(parseQuoteNumber('1,200')).toBeNull()
    expect(parseQuoteNumber(-1)).toBeNull()
    expect(parseQuoteNumber(Number.NaN)).toBeNull()
  })

  it('writes the same Korean total wording used by the printable quote', () => {
    expect(formatKoreanWon(0)).toBe('금영원정')
    expect(formatKoreanWon(10)).toBe('금십원정')
    expect(formatKoreanWon(12_345)).toBe('금일만이천삼백사십오원정')
    expect(formatKoreanWon(123_456_789)).toBe('금일억이천삼백사십오만육천칠백팔십구원정')
  })

  it('copies customer-facing sale lines and appends charged delivery without exposing internal costs', () => {
    const items = quoteItemsFromSale({
      items: [
        { productCode: 'SKU-1', name: '  텀블러  ', spec: 'EA', qty: 2, price: 10_000, cost: 5_000, wholesalePrice: 12_000, vatIncluded: true, note: '선물포장' },
        { productCode: 'SKU-2', name: '컵', spec: '화이트', qty: 1, price: 3_000, cost: 1_000 },
        { productCode: 'SKU-3', name: '   ', spec: '블랙', qty: 1, price: 1_000, cost: 1 },
      ],
      includeShipping: true,
      shippingFee: 3_300,
      shippingVatIncluded: true,
    })

    expect(items).toEqual([
      { id: 1, name: '  텀블러  ', spec: '', qty: 2, price: 10_000, vatIncluded: true, note: '선물포장' },
      { id: 2, name: '컵', spec: '화이트', qty: 1, price: 3_000, vatIncluded: false, note: '' },
      { id: 3, name: '배송비', spec: '건', qty: 1, price: 3_300, vatIncluded: true, note: '' },
    ])
    expect(items[0]).not.toHaveProperty('cost')
    expect(items[0]).not.toHaveProperty('wholesalePrice')
    expect(items[0]).not.toHaveProperty('productCode')
  })

  it('does not add a delivery line when it is not charged or is zero', () => {
    expect(quoteItemsFromSale({
      items: [{ name: '상품', qty: 1, price: 1_000 }],
      includeShipping: false,
      shippingFee: 5_000,
    })).toHaveLength(1)
    expect(quoteItemsFromSale({
      items: [{ name: '상품', qty: 1, price: 1_000 }],
      includeShipping: true,
      shippingFee: 0,
    })).toHaveLength(1)
  })
})

describe('sales margin calculations', () => {
  it('calculates item profit, VAT, margin, and discount using the sales edit rules', () => {
    expect(calculateSalesItemMargin({
      qty: 2,
      price: 10_000,
      cost: 5_000,
      wholesalePrice: 12_000,
    })).toMatchObject({
      discountRate: 1 - (10_000 / 12_000),
      unitGross: 11_000,
      unitVat: 1_000,
      unitProfit: 5_000,
      unitProfitRate: 5_000 / 11_000,
      totalGross: 22_000,
      totalVat: 2_000,
      totalCost: 10_000,
      totalProfit: 10_000,
      totalProfitRate: 10_000 / 22_000,
    })
  })

  it('uses the VAT-included price as gross and keeps missing cost unknown', () => {
    expect(calculateSalesItemMargin({ qty: 1, price: 11_000, cost: 5_000, vatIncluded: true })).toMatchObject({
      unitGross: 11_000,
      unitVat: 1_000,
      totalGross: 11_000,
      totalVat: 1_000,
      totalCost: 5_000,
      totalProfit: 5_000,
    })
    expect(calculateSalesItemMargin({ qty: 1, price: 10_000 })).toMatchObject({
      totalGross: 11_000,
      totalCost: null,
      totalProfit: null,
    })
  })

  it('adds charged shipping but subtracts actual shipping cost only from profit', () => {
    expect(calculateSalesMarginTotals({
      items: [{ qty: 2, price: 10_000, cost: 5_000 }],
      includeShipping: true,
      shippingFee: 5_500,
      shippingVatIncluded: true,
      shippingCost: 3_000,
    })).toMatchObject({
      subtotalGross: 22_000,
      subtotalVat: 2_000,
      shippingGross: 5_500,
      shippingVat: 500,
      totalGross: 27_500,
      totalVat: 2_500,
      totalCost: 10_000,
      totalProfit: 12_000,
      totalProfitRate: 12_000 / 27_500,
    })
  })
})

describe('sales workflow summaries', () => {
  it('derives workflow status from shipment and payment completion', () => {
    expect(deriveSalesStatus([], [])).toBe('pending')
    expect(deriveSalesStatus([{ status: 'completed' }], [{ status: 'completed' }])).toBe('completed')
    expect(deriveSalesStatus([{ status: 'completed' }], [{ status: 'before' }])).toBe('inProgress')
  })

  it('counts statuses and includes only active/completed sales in monetary totals', () => {
    expect(summarizeSalesStatuses([
      { status: 'pending' },
      { status: 'inProgress' },
      { status: 'blocked' },
      { status: 'completed' },
      { status: 'other' },
    ])).toEqual({ total: 5, pending: 2, inProgress: 1, blocked: 1, completed: 1 })
    expect(isSalesStatusIncludedInTotals('pending')).toBe(false)
    expect(isSalesStatusIncludedInTotals('blocked')).toBe(false)
    expect(isSalesStatusIncludedInTotals('inProgress')).toBe(true)
    expect(isSalesStatusIncludedInTotals('completed')).toBe(true)
  })

  it('keeps a month profit unknown when any included sale lacks a cost', () => {
    const months = calculateMonthlySalesTotals([
      {
        status: 'pending',
        quoteDate: '2026-01-05',
        items: [{ qty: 1, price: 1_000, cost: 500 }],
        shippingCost: 0,
      },
      {
        status: 'inProgress',
        quoteDate: '2026-01-10',
        items: [{ qty: 1, price: 10_000, cost: 5_000 }],
        shippingCost: 0,
      },
      {
        status: 'completed',
        quoteDate: '2026-02-12',
        items: [{ qty: 1, price: 10_000 }],
        shippingCost: 0,
      },
      {
        status: 'blocked',
        quoteDate: '2026-02-13',
        items: [{ qty: 1, price: 10_000, cost: 1 }],
        shippingCost: 0,
      },
    ], '2026')

    expect(months[0]).toMatchObject({
      month: '01',
      totalGross: 11_000,
      totalCost: 5_000,
      totalProfit: 5_000,
      totalProfitRate: 5_000 / 11_000,
    })
    expect(months[1]).toMatchObject({
      month: '02',
      totalGross: 11_000,
      totalCost: null,
      totalProfit: null,
      totalProfitRate: null,
    })
  })

  it('uses quote date, then sale date, then creation date for filtering', () => {
    expect(salesRecordDate({ quoteDate: '2026-11-13T08:00:00.000Z' })).toBe('2026-11-13')
    expect(salesRecordDate({ saleDate: '2026-10-01' })).toBe('2026-10-01')
    expect(salesRecordDate({ createdAt: new Date('2026-09-02T00:00:00.000Z') })).toBe('2026-09-02')
    expect(salesRecordDate({ quoteDate: 'not a date' })).toBe('')
  })
})
