import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CoupangRegistrationWorkbench } from '@/app/(auth)/operations/coupang-registration/workbench'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const source = { code: '1471', name: '마미백 플러스', price: 15000, status: 'SELLING', thumbnails: ['https://cdn.tapeoff.kr/front.jpg'], detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], options: [{ name: '베이지', addPrice: 0 }], notice: [], costCandidates: [{ sku: '112361-0001', name: '마미백 플러스', optionName: '베이지', costPrice: 10000 }] }

describe('registration pricing workbench', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/drafts') ? { drafts: [] } : { products: [source] } })))
  })
  it('adds a real catalogue option and recalculates all four price columns after a markup change', async () => {
    render(<CoupangRegistrationWorkbench />)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const dialog = screen.getByRole('dialog', { name: 'B2B 상품 검색' })
    fireEvent.change(within(dialog).getByLabelText('B2B 상품명 또는 코드'), { target: { value: '마미백' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '검색' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '베이지' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '상품 검색 닫기' }))
    expect(screen.getByLabelText('마미백 플러스 베이지 원가')).toHaveValue(10000)
    expect(screen.getByLabelText('마미백 플러스 베이지 도매가')).toHaveValue(15000)
    expect(screen.getAllByText('25,000원').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('마미백 플러스 베이지 공급가 기준'), { target: { value: 'markup' } })
    await waitFor(() => expect(screen.getAllByText('30,000원').length).toBeGreaterThan(0))
    expect(screen.getByText('8,000원')).toBeInTheDocument()
    expect(screen.getByText('쿠팡 40.00%')).toBeInTheDocument()
  })
})
