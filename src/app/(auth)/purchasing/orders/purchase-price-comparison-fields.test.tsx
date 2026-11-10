import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { resolvePurchasePriceComparison } from '@/lib/purchasing/purchase-price-comparison'
import { PurchasePriceComparisonFields } from './purchase-price-comparison-fields'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
afterEach(() => vi.restoreAllMocks())

it('compares master per-unit shipping with actual shipping total divided by purchase quantity', async () => {
  const save = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  const prices = resolvePurchasePriceComparison({}, '¥10.25', '0.55')
  render(<PurchasePriceComparisonFields id="purchase" productName="눈사람전구" sku="SKU-1" prices={prices} quantity={20} canEditActual />)
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '가격 비교' }))
  expect(screen.getByRole('dialog', { name: '구매가격 비교 (元)' })).toBeInTheDocument()
  expect(screen.getByText('눈사람전구 · SKU-1')).toBeInTheDocument()
  expect(screen.getByText('기존 구매단가').parentElement).toHaveTextContent('10.25')
  expect(screen.getByText('기존 개당 배송비').parentElement).toHaveTextContent('0.55')
  expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
  fireEvent.change(screen.getByLabelText('신규 구매단가'), { target: { value: '10.50' } })
  fireEvent.change(screen.getByLabelText('신규 배송비 합계'), { target: { value: '60' } })
  expect(screen.getByText('¥0.55 → ¥3')).toBeInTheDocument()
  expect(screen.getByText('+0.25 元')).toBeInTheDocument()
  expect(screen.getByText('+2.45 元')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('저장됨'))
  expect(save).toHaveBeenCalledWith('/api/purchasing/purchase-requests/purchase', expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ purchasePriceComparison: { actualUnitPriceCny: 10.5, actualShippingCny: 60 } }),
  }))
  fireEvent.click(screen.getByRole('button', { name: '닫기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /가격 비교.*가격 초과/ })).toBeInTheDocument()
})

it('shows the master reference without a save action before actual prices can be entered', () => {
  const prices = resolvePurchasePriceComparison({}, '10', '0')
  render(<PurchasePriceComparisonFields id="purchase" productName="눈사람전구" sku="SKU-1" prices={prices} quantity={0} canEditActual={false} />)
  fireEvent.click(screen.getByRole('button', { name: '가격 비교' }))
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument()
  expect(screen.getByText('¥0 → –')).toBeInTheDocument()
})

it('uses the current master values even when the purchase has old reference values and saved actuals', () => {
  const stored = { baselineUnitPriceCny: 10, baselineUnitShippingCny: null, baselineShippingCny: 11, actualUnitPriceCny: 13, actualShippingCny: 0 }
  expect(resolvePurchasePriceComparison(stored, '12', '0.55')).toEqual({
    baselineUnitPriceCny: 12,
    baselineUnitShippingCny: 0.55,
    actualUnitPriceCny: 13,
    actualShippingCny: 0,
  })
  expect(resolvePurchasePriceComparison(stored, '', null)).toEqual({
    baselineUnitPriceCny: null,
    baselineUnitShippingCny: null,
    actualUnitPriceCny: 13,
    actualShippingCny: 0,
  })
})
