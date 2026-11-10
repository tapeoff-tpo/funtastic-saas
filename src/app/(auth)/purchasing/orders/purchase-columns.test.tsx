import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { PurchaseColumnPicker, PurchaseColumns, PurchaseEmptyCell } from './purchase-columns'

const columns = [
  { id: 'product', label: '상품' },
  { id: 'payment', label: '결제 상태 / 대량' },
  { id: 'purchase-date', label: '구매날짜', field: true },
]

function table(scope: string) {
  return <PurchaseColumns scope={scope} columns={columns}>
    <PurchaseColumnPicker />
    <table><tbody><tr><PurchaseEmptyCell fallbackCount={2}>조회 결과 없음</PurchaseEmptyCell></tr></tbody></table>
  </PurchaseColumns>
}

beforeEach(() => localStorage.clear())

it('saves each stage independently and adjusts the empty row only for hidden table columns', () => {
  const { rerender } = render(table('staff:inspecting'))
  fireEvent.click(screen.getByText('표시할 열'))
  fireEvent.click(screen.getByLabelText('구매날짜'))
  expect(screen.getByText('조회 결과 없음')).toHaveAttribute('colspan', '2')
  fireEvent.click(screen.getByLabelText('결제 상태 / 대량'))
  expect(screen.getByText('조회 결과 없음')).toHaveAttribute('colspan', '1')
  rerender(table('staff:purchase_completed'))
  expect(screen.getByLabelText('구매날짜')).toBeChecked()
  expect(screen.getByText('조회 결과 없음')).toHaveAttribute('colspan', '2')
  rerender(table('staff:inspecting'))
  expect(screen.getByLabelText('구매날짜')).not.toBeChecked()
  expect(screen.getByLabelText('결제 상태 / 대량')).not.toBeChecked()
})
