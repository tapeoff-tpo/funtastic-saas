import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CoupangRegistrationWorkbench } from '@/app/(auth)/operations/coupang-registration/workbench'
import { blankDraft, createRegistrationRow } from '@/lib/coupang-registration/model'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const source = { code: '1471', name: '마미백 플러스', price: 15000, status: 'SELLING', thumbnails: ['https://cdn.tapeoff.kr/front.jpg'], detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], options: [{ name: '베이지', addPrice: 0 }], notice: [], costCandidates: [{ sku: '112361-0001', name: '마미백 플러스', optionName: '베이지', costPrice: 10000 }] }

describe('registration pricing workbench', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, json: async () => url.includes('/drafts') ? init?.method === 'POST' ? { id: 'draft-1', revision: 1 } : { drafts: [] } : url.includes('?code=') ? { product: source } : { products: [{ ...source, costCandidates: [] }] } })))
  })
  it('builds one registration row from searched components and saves their quantities', async () => {
    render(<CoupangRegistrationWorkbench />)
    fireEvent.click(screen.getByRole('button', { name: '세트 만들기' }))
    const dialog = screen.getByRole('dialog', { name: '세트 구성품 검색' })
    fireEvent.change(within(dialog).getByLabelText('B2B 상품명 또는 코드'), { target: { value: '마미백' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '검색' }))
    const beige = await within(dialog).findByRole('button', { name: '베이지' })
    fireEvent.click(beige)
    await within(dialog).findByText('구성품 1종 추가')
    fireEvent.click(beige)
    fireEvent.click(within(dialog).getByRole('button', { name: '구성 확인' }))
    fireEvent.change(screen.getByLabelText('등록 상품명'), { target: { value: '마미백 3개입' } })
    const quantity = screen.getByRole('spinbutton', { name: '마미백 플러스 베이지 구성 수량' })
    expect(quantity).toHaveValue(2)
    fireEvent.change(quantity, { target: { value: '3' } })
    expect(screen.getByLabelText('마미백 3개입 원가')).toHaveTextContent('30,000원')
    expect(screen.getByLabelText('마미백 3개입 쿠팡공급가')).toHaveValue(45000)
    expect(screen.getByLabelText('마미백 3개입 쿠팡판매가')).toHaveValue(75000)
    const supply = screen.getByLabelText('마미백 3개입 쿠팡공급가')
    fireEvent.change(supply, { target: { value: '42000' } })
    expect(screen.getByLabelText('마미백 3개입 쿠팡판매가')).toHaveValue(70000)
    fireEvent.click(screen.getByRole('button', { name: '공급가 자동계산' }))
    expect(supply).toHaveValue(45000)
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      expect(call).toBeDefined()
      const { draft } = JSON.parse(String(call![1]!.body))
      expect(draft.rows).toHaveLength(1)
      expect(draft.rows[0].bundleComponents).toMatchObject([{ sourceCode: '1471', optionName: '베이지', quantity: 3, unitCost: 10000, unitWholesale: 15000 }])
    })
  })
  it('fills a saved draft’s missing cost and allows a VAT override', async () => {
    const row = { ...createRegistrationRow(source, '베이지'), costPrice: null }
    const saved = { id: 'draft-1', name: '마미백 견적', revision: 1, updatedAt: '2026-11-06' }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith('/costs')
        ? { costs: [{ id: row.id, internalSku: row.internalSku, costPrice: 8776 }] }
        : url.includes('?id=')
          ? { ...saved, payload: { ...blankDraft(), rows: [row] } }
          : { drafts: [saved] },
    })))

    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /마미백 견적/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    expect(await screen.findByLabelText('마미백 플러스 베이지 원가')).toHaveValue(8776)
    fireEvent.click(screen.getByRole('button', { name: /마미백 플러스 베이지 112361-0001/ }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '매출부가세 직접 입력' }), { target: { value: '2000' } })
    expect(screen.getByText('4,224원')).toBeInTheDocument()
  })
  it('loads selected product costs and keeps wholesale fixed while editing supply and retail', async () => {
    render(<CoupangRegistrationWorkbench />)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const dialog = screen.getByRole('dialog', { name: 'B2B 상품 검색' })
    fireEvent.change(within(dialog).getByLabelText('B2B 상품명 또는 코드'), { target: { value: '마미백' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '검색' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '베이지' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '상품 검색 닫기' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: '상품 검색 닫기' }))
    expect(screen.getByLabelText('마미백 플러스 베이지 원가')).toHaveValue(10000)
    expect(screen.getByLabelText('마미백 플러스 베이지 도매가')).toHaveTextContent('15,000원')
    expect(screen.queryByLabelText('마미백 플러스 베이지 공급가 기준')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('일괄 가격 기준')).not.toBeInTheDocument()
    for (const header of ['매출부가세', '추가 차감', '순수익', '우리 마진', '쿠팡 마진']) expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
    expect(screen.getByLabelText('마미백 플러스 베이지 쿠팡판매가')).toHaveValue(25000)
    fireEvent.change(screen.getByLabelText('마미백 플러스 베이지 쿠팡공급가'), { target: { value: '18000' } })
    await waitFor(() => expect(screen.getByLabelText('마미백 플러스 베이지 쿠팡판매가')).toHaveValue(30000))
    expect(screen.getByText('6,364원')).toBeInTheDocument()
    expect(screen.getByText('40.0%')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('마미백 플러스 베이지 선택'))
    fireEvent.change(screen.getByLabelText('선택 상품 추가 차감'), { target: { value: '10' } })
    expect(screen.getByLabelText('마미백 플러스 베이지 추가 차감률')).toHaveValue('10')
    expect(screen.getByText('4,564원')).toBeInTheDocument()
    const supply = screen.getByLabelText('마미백 플러스 베이지 쿠팡공급가')
    const sale = screen.getByLabelText('마미백 플러스 베이지 쿠팡판매가')
    fireEvent.change(supply, { target: { value: '15000' } })
    expect(sale).toHaveValue(25000)
    fireEvent.change(sale, { target: { value: '28000' } })
    expect(screen.getByText('46.4%')).toBeInTheDocument()
    fireEvent.change(supply, { target: { value: '16000' } })
    expect(sale).toHaveValue(28000)
    fireEvent.click(screen.getByRole('button', { name: '마미백 플러스 베이지 판매가 기준 쿠팡 40% 맞추기' }))
    expect(supply).toHaveValue(16800)
    expect(sale).toHaveValue(28000)
    expect(screen.getByText('40.0%')).toBeInTheDocument()
    fireEvent.change(supply, { target: { value: '18000' } })
    fireEvent.click(screen.getByRole('button', { name: '마미백 플러스 베이지 판매가 자동계산' }))
    expect(sale).toHaveValue(30000)
    fireEvent.change(sale, { target: { value: '29000' } })
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      expect(call).toBeDefined()
      const body = JSON.parse(String(call![1]!.body))
      expect(body.draft.rows[0]).toMatchObject({ costPrice: 10000, priceMode: 'manual', manualSupplyPrice: 18000, saleMode: 'manual', manualSalePrice: 29000, supplyDeductionPercent: 10 })
    })
  })
})
