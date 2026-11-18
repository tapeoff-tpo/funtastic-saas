import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MallPriceCell } from './mall-price-cell'

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('./price-registration-actions', () => ({ saveMallPrice: mocks.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const props = { rowId: 'row', mallId: 'coupang', mallName: '쿠팡', productName: '상품', price: 15000, override: null, canEdit: true }

it('edits a price in the table and submits the previous override for conflict detection', async () => {
  mocks.save.mockResolvedValue({ saved: true })
  render(<MallPriceCell {...props}>12345</MallPriceCell>)
  expect(screen.getByText('15,000원')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '쿠팡 상품 판매가 수정' }))
  expect(screen.getByRole('dialog', { name: '쿠팡 판매가 수정' })).toBeVisible()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '16000' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ rowId: 'row', mallId: 'coupang', price: '16000', previousPrice: null }))
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('marks a manual price and supports restoring the default', async () => {
  mocks.save.mockResolvedValue({ saved: true })
  render(<MallPriceCell {...props} price={16000} override={16000}>12345</MallPriceCell>)
  expect(screen.getByText('16,000원 · 수정')).toHaveClass('text-amber-700')
  fireEvent.click(screen.getByRole('button', { name: '쿠팡 상품 판매가 수정' }))
  fireEvent.click(screen.getByRole('button', { name: '기본가로 복원' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ rowId: 'row', mallId: 'coupang', price: '', previousPrice: 16000 }))
})
