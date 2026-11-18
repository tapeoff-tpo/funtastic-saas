import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ManualRegistrationPanel, type ManualRegistrationMall } from './manual-registration-panel'

const mocks = vi.hoisted(() => ({ save: vi.fn(), saveDisplay: vi.fn(), savePrice: vi.fn(), refresh: vi.fn() }))
vi.mock('../../analytics/price-table/price-registration-actions', () => ({ saveManualRegistrationNumber: mocks.save, saveMallDisplayedPrice: mocks.saveDisplay, saveMallPrice: mocks.savePrice }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const malls: ManualRegistrationMall[] = [
  { id: 'coupang', label: '쿠팡', numbers: [{ key: '쿠팡 상품번호', value: '12345', date: null, manual: false }], price: 15000, priceEdited: false, margin: 3000, fee: 10 },
  { id: 'domeme', label: '도매꾹', numbers: [], price: 12000, priceEdited: false, margin: null, fee: null },
]

it('groups marketplaces and edits a number by double-click without navigating', async () => {
  mocks.save.mockResolvedValue({ saved: true })
  render(<ManualRegistrationPanel rowId="row-1" malls={malls} />)
  expect(screen.getByRole('button', { name: '등록된 몰 1' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('article', { name: '도매꾹 등록정보' })).not.toBeInTheDocument()
  expect(screen.queryByText('번호 수정')).not.toBeInTheDocument()
  fireEvent.doubleClick(screen.getByRole('button', { name: '쿠팡 상품번호 12345' }))
  fireEvent.change(screen.getByRole('textbox', { name: '쿠팡 상품등록번호' }), { target: { value: '98765' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
    rowId: 'row-1', mallId: 'coupang', identifierKey: '쿠팡 상품번호', previousValue: '12345', number: '98765',
  }))
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
})

it('opens an empty number input from the unregistered group', async () => {
  mocks.save.mockResolvedValue({ saved: true })
  render(<ManualRegistrationPanel rowId="row-1" malls={malls} />)
  fireEvent.click(screen.getByRole('button', { name: '미등록 몰 1' }))
  fireEvent.click(screen.getByRole('button', { name: '도매꾹 등록번호 입력' }))
  fireEvent.change(screen.getByRole('textbox', { name: '도매꾹 상품등록번호' }), { target: { value: '24680' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
    rowId: 'row-1', mallId: 'domeme', identifierKey: null, previousValue: null, number: '24680',
  }))
})

it('keeps editing and displays a conflict instead of closing the input', async () => {
  mocks.save.mockResolvedValue({ error: '다른 사용자가 번호를 수정했습니다.' })
  render(<ManualRegistrationPanel rowId="row-1" malls={malls} />)
  fireEvent.keyDown(screen.getByRole('button', { name: '쿠팡 상품번호 12345' }), { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('다른 사용자')
  expect(screen.getByRole('textbox', { name: '쿠팡 상품등록번호' })).toBeVisible()
})


it('shows different option registration prices and stores a separately observed display price', async () => {
  mocks.saveDisplay.mockResolvedValue({ saved: true })
  render(<ManualRegistrationPanel rowId="row-1" malls={[{ ...malls[0], groupSnapshot: 'a'.repeat(64), options: [
    { rowId: 'red', sku: '112001-0001', label: '빨강', registrationPrice: 12000, displayedPrice: null, displayedDate: null, priceEdited: false },
    { rowId: 'blue', sku: '112001-0002', label: '파랑', registrationPrice: 15000, displayedPrice: null, displayedDate: null, priceEdited: false },
  ] }]} />)
  expect(screen.getByText('12,000~15,000원')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '옵션별 등록가·몰 표시가 2개 보기' }))
  fireEvent.click(screen.getByRole('button', { name: '빨강 몰 표시가 입력' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: '빨강 확인한 몰 표시가' }), { target: { value: '12900' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(mocks.saveDisplay).toHaveBeenCalledWith({ rowId: 'red', mallId: 'coupang', price: '12900', previousPrice: null }))
})
