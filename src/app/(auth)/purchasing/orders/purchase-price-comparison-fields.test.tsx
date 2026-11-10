import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { resolvePurchasePriceComparison } from '@/lib/purchasing/purchase-price-comparison'
import { PurchasePriceComparisonFields } from './purchase-price-comparison-fields'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
afterEach(() => vi.restoreAllMocks())

it('compares master per-unit shipping with actual shipping total divided by purchase quantity', async () => {
  const save = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  const prices = resolvePurchasePriceComparison({}, '¥10.25', '0.55')
  render(<PurchasePriceComparisonFields id="purchase" productName="눈사람전구" sku="SKU-1" prices={prices} quantity={20} canEditBaseline canEditActual />)
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '가격 비교' }))
  expect(screen.getByRole('dialog', { name: '구매가격 비교 (元)' })).toBeInTheDocument()
  expect(screen.getByText('눈사람전구 · SKU-1')).toBeInTheDocument()
  expect(screen.getByLabelText('기존 구매단가')).toHaveValue(10.25)
  expect(screen.getByLabelText('기존 개당 배송비')).toHaveValue(0.55)
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

it('lets purchasing staff edit references before ordering without entering actuals early', () => {
  const prices = resolvePurchasePriceComparison({}, '10', '0')
  render(<PurchasePriceComparisonFields id="purchase" productName="눈사람전구" sku="SKU-1" prices={prices} quantity={0} canEditBaseline canEditActual={false} />)
  fireEvent.click(screen.getByRole('button', { name: '가격 비교' }))
  expect(screen.getByLabelText('기존 개당 배송비')).toHaveValue(0)
  expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
  expect(screen.getByText('¥0 → –')).toBeInTheDocument()
})

it('keeps a copied master shipping reference as a per-unit value and flags ambiguous legacy amounts', () => {
  expect(resolvePurchasePriceComparison({ baselineShippingCny: 0.55 }, '12', '0.55').baselineUnitShippingCny).toBe(0.55)
  const prices = resolvePurchasePriceComparison({ baselineShippingCny: 11, actualShippingCny: 12 }, '12', '0.55')
  render(<PurchasePriceComparisonFields id="purchase" productName="눈사람전구" sku="SKU-1" prices={prices} legacyShipping={11} quantity={20} canEditBaseline canEditActual />)
  fireEvent.click(screen.getByRole('button', { name: '가격 비교' }))
  expect(screen.getByLabelText('기존 개당 배송비')).toHaveValue(null)
  expect(screen.getByText('이전에 저장한 배송비 단위를 확인해주세요.')).toBeInTheDocument()
  expect(screen.getByText('¥11')).toBeInTheDocument()
  expect(screen.queryByText('개당 배송비 차이')).not.toBeInTheDocument()
})
