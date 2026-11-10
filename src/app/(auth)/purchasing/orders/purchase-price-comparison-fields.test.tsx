import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { resolvePurchasePriceComparison } from '@/lib/purchasing/purchase-price-comparison'
import { PurchasePriceComparisonFields } from './purchase-price-comparison-fields'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
afterEach(() => vi.restoreAllMocks())

it('prefills master prices and compares 3PL prices using shipping totals divided by purchase quantity', async () => {
  const save = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  const prices = resolvePurchasePriceComparison({}, '¥10.25', '40')
  render(<PurchasePriceComparisonFields id="purchase" prices={prices} quantity={20} canEditBaseline canEditActual />)
  expect(screen.getByLabelText('기존 구매단가')).toHaveValue(10.25)
  expect(screen.getByLabelText('기존 배송비 합계')).toHaveValue(40)
  fireEvent.change(screen.getByLabelText('신규 구매단가'), { target: { value: '10.50' } })
  fireEvent.change(screen.getByLabelText('신규 배송비 합계'), { target: { value: '60' } })
  expect(screen.getByText('¥2 → ¥3')).toBeInTheDocument()
  expect(screen.getByText('+0.25 元')).toBeInTheDocument()
  expect(screen.getByText('+20 元')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('저장됨'))
  expect(save).toHaveBeenCalledWith('/api/purchasing/purchase-requests/purchase', expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ purchasePriceComparison: { actualUnitPriceCny: 10.5, actualShippingCny: 60 } }),
  }))
})

it('lets purchasing staff edit references before ordering without entering actuals early', () => {
  const prices = resolvePurchasePriceComparison({}, '10', '0')
  render(<PurchasePriceComparisonFields id="purchase" prices={prices} quantity={0} canEditBaseline canEditActual={false} />)
  expect(screen.getByLabelText('기존 배송비 합계')).toHaveValue(0)
  expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
  expect(screen.getByText('– → –')).toBeInTheDocument()
})
