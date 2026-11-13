import { describe, expect, it } from 'vitest'
import { summarizeFundMonths } from './purchase-fund-monthly'

describe('summarizeFundMonths', () => {
  it('groups deposits and purchase debits by month and ranks products by total cost', () => {
    const rows = [
      { entryType: 'deposit', occurredOn: '2026-10-01', amountCny: '30', missingCostCount: 0, details: null },
      { entryType: 'opening_balance', occurredOn: '2026-11-01', amountCny: '100.25', missingCostCount: 0, details: null },
      { entryType: 'deposit', occurredOn: '2026-11-02', amountCny: '20.50', missingCostCount: 0, details: null },
      { entryType: 'purchase_debit', occurredOn: '2026-11-03', amountCny: '45', missingCostCount: 0, details: { lines: [
        { sku: 'A1', productName: '컵', totalCostYuan: 10 },
        { sku: 'B', productName: '병', totalCostYuan: 35 },
      ] } },
      { entryType: 'purchase_debit', occurredOn: '2026-11-04', amountCny: '30', missingCostCount: 0, details: { lines: [
        { sku: 'A2', productName: '컵', totalCostYuan: 30 },
      ] } },
    ]
    expect(summarizeFundMonths(rows)).toEqual([
      { month: '2026-11', depositedCny: 120.75, debitedCny: 75, products: [
        { sku: '', name: '컵', amountCny: 40 }, { sku: 'B', name: '병', amountCny: 35 },
      ] },
      { month: '2026-10', depositedCny: 30, debitedCny: 0, products: [] },
    ])
  })

  it('marks incomplete amounts unknown while showing known product costs', () => {
    const rows = [
      { entryType: 'deposit', occurredOn: '2026-11-01', amountCny: null, missingCostCount: 0, details: null },
      { entryType: 'purchase_debit', occurredOn: '2026-11-02', amountCny: '10', missingCostCount: 1, details: { lines: [
        { sku: 'A', productName: '상품', totalCostYuan: '10' },
        { sku: 'B', productName: '누락', totalCostYuan: null },
      ] } },
    ]
    expect(summarizeFundMonths(rows)).toEqual([{ month: '2026-11', depositedCny: null, debitedCny: null, products: [{ sku: 'A', name: '상품', amountCny: 10 }] }])
  })

  it('returns at most the ten highest-value products', () => {
    const lines = Array.from({ length: 12 }, (_, index) => ({ sku: `${index}`, productName: `상품${index}`, totalCostYuan: index + 1 }))
    const [month] = summarizeFundMonths([{ entryType: 'purchase_debit', occurredOn: '2026-11-01', amountCny: '78', missingCostCount: 0, details: { lines } }])
    expect(month.products).toHaveLength(10)
    expect(month.products[0].amountCny).toBe(12)
    expect(month.products[9].amountCny).toBe(3)
  })
})
