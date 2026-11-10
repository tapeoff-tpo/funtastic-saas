import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { resolvePurchasePriceComparison } from '@/lib/purchasing/purchase-price-comparison'
import { PurchasePriceComparisonFields } from './purchase-price-comparison-fields'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
afterEach(() => vi.restoreAllMocks())

it('prefills master prices and compares 3PL prices using shipping totals divided by purchase quantity', async () => {
  const save = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  const prices = resolvePurchasePriceComparison({}, '¥10.25', '40')
  render(<PurchasePriceComparisonFields id="purchase" productName="눈사람전구" sku="SKU-1" prices={prices} quantity={20} canEditBaseline canEditActual />)
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '가격 비교' }))
  expect(screen.getByRole('dialog', { name: '구매가격 비교 (元)' })).toBeInTheDocument()
  expect(screen.getByText('눈사람전구 · SKU-1')).toBeInTheDocument()
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
  fireEvent.click(screen.getByRole('button', { name: '닫기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /가격 비교.*가격 초과/ })).toBeInTheDocument()
})

it('lets purchasing staff edit references before ordering without entering actuals early', () => {
  const prices = resolvePurchasePriceComparison({}, '10', '0')
  render(<PurchasePriceComparisonFields id="purchase" productName="눈사람전구" sku="SKU-1" prices={prices} quantity={0} canEditBaseline canEditActual={false} />)
  fireEvent.click(screen.getByRole('button', { name: '가격 비교' }))
  expect(screen.getByLabelText('기존 배송비 합계')).toHaveValue(0)
  expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
  expect(screen.getByText('– → –')).toBeInTheDocument()
})
