import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MonthlyFundDashboard } from './monthly-fund-dashboard'

describe('MonthlyFundDashboard', () => {
  it('switches the product ranking when a month is selected', () => {
    render(<MonthlyFundDashboard monthly={[
      { month: '2026-11', depositedCny: 1000, debitedCny: 300, products: [{ sku: 'A', name: '컵', amountCny: 300 }] },
      { month: '2026-10', depositedCny: 200, debitedCny: 80, products: [{ sku: 'B', name: '병', amountCny: 80 }] },
    ]} />)
    expect(screen.getByText('컵')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '2026-10' }))
    expect(screen.getByText('병')).toBeTruthy()
    expect(screen.queryByText('컵')).toBeNull()
    expect(within(screen.getByRole('table')).getByText('200 元')).toBeTruthy()
  })

  it('does not represent missing costs as a complete total', () => {
    render(<MonthlyFundDashboard monthly={[{ month: '2026-11', depositedCny: null, debitedCny: null, products: [] }]} />)
    expect(screen.getAllByText('금액 확인 필요')).toHaveLength(2)
    expect(screen.getByText(/확인된 상품 금액만/)).toBeTruthy()
  })
})
