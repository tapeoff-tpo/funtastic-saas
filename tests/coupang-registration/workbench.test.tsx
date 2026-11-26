import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CoupangRegistrationWorkbench } from '@/app/(auth)/operations/coupang-registration/workbench'
import { AS_CONTACT_DEFAULT, AS_CONTACT_FIELD, blankDraft, confirmPricing, confirmRegistration, createRegistrationRow, registrationFieldKey, rowIssues, SEARCH_TAGS_FIELD, WARRANTY_DEFAULT, WARRANTY_FIELD, type RegistrationDraft, type RegistrationRow, type TemplateSheet } from '@/lib/coupang-registration/model'
import { getSupplierCategoryTemplate, pingSupplierExtension, searchSupplierCategories, startSupplierRegistration, subscribeSupplierRegistration } from '@/lib/coupang-registration/supplier-bridge'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/coupang-registration/supplier-bridge', () => ({ checkSupplierRegistration: vi.fn(async () => ({ started: true })), pingSupplierExtension: vi.fn(async () => ({ connected: true })), searchSupplierCategories: vi.fn(async () => []), getSupplierCategoryTemplate: vi.fn(), startSupplierRegistration: vi.fn(async () => ({ started: true })), subscribeSupplierRegistration: vi.fn(() => () => undefined) }))
const source = { code: '1471', name: '마미백 플러스', price: 15000, status: 'SELLING', thumbnails: ['https://cdn.tapeoff.kr/front.jpg'], detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], options: [{ name: '베이지', addPrice: 0 }], notice: [], costCandidates: [{ sku: '112361-0001', name: '마미백 플러스', optionName: '베이지', costPrice: 10000 }] }
const second = {
  code: '1472', name: '루멘 철제 사이드 테이블', price: 20000, status: 'SELLING', thumbnails: [], detailImages: [],
  options: [{ name: '블랙', addPrice: 1000 }], notice: [], costCandidates: [{ sku: '112362-0001', name: '루멘 철제 사이드 테이블', optionName: '블랙', costPrice: 12000 }],
}

describe('registration pricing workbench', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/operations/coupang-registration')
    vi.mocked(pingSupplierExtension).mockResolvedValue({ connected: true })
    vi.mocked(startSupplierRegistration).mockResolvedValue({ started: true })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, json: async () => url.includes('/drafts') ? init?.method === 'POST' ? { id: 'draft-1', revision: 1 } : { drafts: [] } : init?.method === 'POST' && url.endsWith('/catalog') ? { products: [source] } : url.includes('?code=') ? { product: source } : { products: [{ ...source, costCandidates: [] }] } })))
  })
  it('edits a saved set through component search and saves its quantities', async () => {
    const bundle = { ...createRegistrationRow(), name: '저장된 세트', bundleComponents: [] }
    const saved = mockSavedDraft({ ...blankDraft(), rows: [bundle] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    fireEvent.click(await screen.findByRole('button', { name: /저장된 세트 세트 · 구성품 0종/ }))
    fireEvent.click(screen.getByRole('button', { name: '구성품 검색' }))
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
    const dialog = await openCatalogSearch('마미백')
    fireEvent.click(await within(dialog).findByLabelText('마미백 플러스 베이지 선택'))
    fireEvent.click(within(dialog).getByRole('button', { name: '선택 상품 1개 추가' }))
    await screen.findByLabelText('마미백 플러스 베이지 원가')
    await waitFor(() => expect(screen.getByLabelText('마미백 플러스 베이지 쿠팡공급가')).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: '상품 검색 닫기' }))
    expect(screen.queryByRole('region', { name: '상품등록정보 입력' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('쿠팡 카테고리 양식')).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: /마미백 플러스 베이지 112361-0001/ }))
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

  it('adds multiple selected products and options together without duplicating registered options', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => {
        if (String(url).endsWith('/drafts')) return { drafts: [] }
        if (init?.method === 'POST' && String(url).endsWith('/catalog')) return { products: [source, second] }
        return { products: [{ ...source, costCandidates: [] }, { ...second, costCandidates: [] }] }
      },
    })))

    render(<CoupangRegistrationWorkbench />)
    const dialog = await openCatalogSearch('테이블')
    fireEvent.click(await within(dialog).findByLabelText('마미백 플러스 베이지 선택'))
    fireEvent.click(within(dialog).getByLabelText('루멘 철제 사이드 테이블 블랙 선택'))
    fireEvent.click(within(dialog).getByRole('button', { name: '선택 상품 2개 추가' }))

    expect(await screen.findByLabelText('마미백 플러스 베이지 원가')).toHaveValue(10000)
    expect(screen.getByLabelText('루멘 철제 사이드 테이블 블랙 원가')).toHaveValue(12000)
    expect(within(dialog).getByText('선택한 상품·옵션 0개')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '상품 검색 닫기' }))
    const reopened = await openCatalogSearch('테이블')
    expect(await within(reopened).findByLabelText('마미백 플러스 베이지 선택')).toBeDisabled()
    expect(within(reopened).getByLabelText('루멘 철제 사이드 테이블 블랙 선택')).toBeDisabled()
  })

  it('adds pricing rows with one lookup and defers product information and PDF conversion until stage two', async () => {
    mockSavedDraft(blankDraft())
    const fallback = vi.mocked(fetch)
    const fullProduct = {
      ...source,
      productMaster: {
        itemId: 'quality-master', match: 'sku' as const, noticeSize: '25*12*41cm', noticeWeight: '400g',
        noticeMaterial: '철제', noticeManufacturer: '확인된 제조공장', noticeCountry: '중국',
        qualityPdf: { id: 'quality-pdf', fileName: '품질표시.pdf', contentType: 'application/pdf' },
      },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/catalog') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        return { ok: true, json: async () => ({ products: [body.phase === 'pricing' ? source : fullProduct] }) }
      }
      if (url.endsWith('/quality-label')) return { ok: true, json: async () => ({ labels: [{ name: '품질표시.jpg', data: 'converted-jpg' }] }) }
      return fallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    const dialog = await openCatalogSearch('마미백')
    fireEvent.click(await within(dialog).findByLabelText('마미백 플러스 베이지 선택'))
    fireEvent.click(within(dialog).getByRole('button', { name: '선택 상품 1개 추가' }))
    await screen.findByLabelText('마미백 플러스 베이지 원가')
    await waitFor(() => expect(screen.getByLabelText('마미백 플러스 베이지 쿠팡공급가')).toBeEnabled())
    const lookups = () => vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/catalog') && init?.method === 'POST')
    expect(lookups()).toHaveLength(1)
    expect(JSON.parse(String(lookups()[0][1]!.body))).toMatchObject({ codes: [source.code], phase: 'pricing' })
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/quality-label'))).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: '상품 검색 닫기' }))
    fireEvent.change(screen.getByLabelText('마미백 플러스 베이지 쿠팡공급가'), { target: { value: '18000' } })
    fireEvent.change(screen.getByLabelText('마미백 플러스 베이지 쿠팡판매가'), { target: { value: '31000' } })
    fireEvent.click(screen.getByRole('button', { name: '마미백 플러스 베이지 가격설정 완료' }))

    const information = await screen.findByRole('row', { name: '마미백 플러스 베이지 상품등록정보' })
    await waitFor(() => expect(within(information).getByLabelText('품질표시 파일명 또는 공개 URL')).toHaveValue('품질표시.jpg'))
    expect(lookups()).toHaveLength(2)
    expect(JSON.parse(String(lookups()[1][1]!.body)).phase).not.toBe('pricing')
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/quality-label'))).toHaveLength(1)
    expect(within(information).getByLabelText('주요 소재')).toHaveValue('철제')
    expect(within(information).getByText('18,000원')).toBeInTheDocument()
    expect(within(information).getByText('31,000원')).toBeInTheDocument()
  })

  it('keeps earlier products and their edited prices visible after reopening search and adding another product', async () => {
    mockSavedDraft(blankDraft())
    render(<CoupangRegistrationWorkbench />)

    const firstSearch = await openCatalogSearch('마미백')
    fireEvent.click(await within(firstSearch).findByLabelText('마미백 플러스 베이지 선택'))
    fireEvent.click(within(firstSearch).getByRole('button', { name: '선택 상품 1개 추가' }))
    await screen.findByLabelText('마미백 플러스 베이지 원가')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(within(firstSearch).getByRole('button', { name: '상품 검색 닫기' }))
    fireEvent.change(screen.getByLabelText('마미백 플러스 베이지 쿠팡공급가'), { target: { value: '18000' } })
    fireEvent.change(screen.getByLabelText('마미백 플러스 베이지 쿠팡판매가'), { target: { value: '31000' } })

    const secondSearch = await openCatalogSearch('루멘')
    fireEvent.click(await within(secondSearch).findByLabelText('루멘 철제 사이드 테이블 블랙 선택'))
    fireEvent.click(within(secondSearch).getByRole('button', { name: '선택 상품 1개 추가' }))
    await screen.findByLabelText('루멘 철제 사이드 테이블 블랙 원가')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(within(secondSearch).getByRole('button', { name: '상품 검색 닫기' }))

    expect(screen.getByLabelText('마미백 플러스 베이지 쿠팡공급가')).toHaveValue(18000)
    expect(screen.getByLabelText('마미백 플러스 베이지 쿠팡판매가')).toHaveValue(31000)
    expect(screen.getByLabelText('루멘 철제 사이드 테이블 블랙 원가')).toHaveValue(12000)
    expect(screen.getByLabelText('상품 검색어')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => expect(savedBodies()).toHaveLength(1))
    expect(savedBodies()[0].draft.rows).toEqual([
      expect.objectContaining({ sourceCode: source.code, manualSupplyPrice: 18000, manualSalePrice: 31000 }),
      expect.objectContaining({ sourceCode: second.code, optionName: '블랙' }),
    ])
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    const reopened = await openCatalogSearch('마미백')
    expect(await within(reopened).findByLabelText('마미백 플러스 베이지 선택')).toBeDisabled()
  })

  it('keeps the existing list visible while typing, waiting for search, closing and reopening its popup', async () => {
    mockSavedDraft({ ...blankDraft(), rows: [createRegistrationRow(source, '베이지'), createRegistrationRow(second, '블랙')] })
    const fallback = vi.mocked(fetch)
    let finishSearch!: (response: { ok: boolean; json: () => Promise<unknown> }) => void
    const pendingSearch = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => { finishSearch = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.includes('/catalog?q=') ? pendingSearch : fallback(url, init)))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: 'draft-1' } })
    await screen.findByLabelText('마미백 플러스 베이지 원가')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('상품 검색어'), { target: { value: '새로운 상품 검색어' } })
    expect(screen.getByLabelText('마미백 플러스 베이지 원가')).toHaveValue(10000)
    expect(screen.getByLabelText('루멘 철제 사이드 테이블 블랙 원가')).toHaveValue(12000)
    expect(screen.queryByText('검색 조건에 맞는 상품이 없습니다.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '상품 검색' }))
    const dialog = await screen.findByRole('dialog', { name: 'B2B 상품 검색' })
    expect(within(dialog).getByLabelText('B2B 상품명 또는 코드')).toHaveValue('새로운 상품 검색어')
    expect(screen.getByLabelText('마미백 플러스 베이지 원가')).toHaveValue(10000)
    expect(screen.getByLabelText('루멘 철제 사이드 테이블 블랙 원가')).toHaveValue(12000)
    expect(screen.getByRole('tab', { name: /1단계 판매가설정/ })).toHaveTextContent('2개')
    finishSearch({ ok: true, json: async () => ({ products: [source, second] }) })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('button', { name: '상품 검색 닫기' }))
    expect(screen.getByLabelText('마미백 플러스 베이지 원가')).toHaveValue(10000)
    expect(screen.getByLabelText('루멘 철제 사이드 테이블 블랙 원가')).toHaveValue(12000)
    const reopened = await openCatalogSearch('다시 다른 상품 검색어')
    expect(within(reopened).getByLabelText('B2B 상품명 또는 코드')).toHaveValue('다시 다른 상품 검색어')
    expect(screen.getByLabelText('마미백 플러스 베이지 원가')).toHaveValue(10000)
    expect(screen.getByLabelText('루멘 철제 사이드 테이블 블랙 원가')).toHaveValue(12000)
    expect(screen.queryByText('검색 조건에 맞는 상품이 없습니다.')).not.toBeInTheDocument()
  })

  it('replaces selected added products with one set and snapshots their component prices', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => {
        if (String(url).endsWith('/drafts')) return init?.method === 'POST' ? { id: 'draft-1', revision: 1 } : { drafts: [] }
        if (init?.method === 'POST' && String(url).endsWith('/catalog')) return { products: [source, second] }
        return { products: [{ ...source, costCandidates: [] }, { ...second, costCandidates: [] }] }
      },
    })))

    render(<CoupangRegistrationWorkbench />)
    const dialog = await openCatalogSearch('테이블')
    fireEvent.click(await within(dialog).findByLabelText('마미백 플러스 베이지 선택'))
    fireEvent.click(within(dialog).getByLabelText('루멘 철제 사이드 테이블 블랙 선택'))
    fireEvent.click(within(dialog).getByRole('button', { name: '선택 상품 2개 추가' }))
    await screen.findByLabelText('마미백 플러스 베이지 원가')
    fireEvent.click(within(dialog).getByRole('button', { name: '상품 검색 닫기' }))

    fireEvent.click(screen.getByLabelText('마미백 플러스 베이지 선택'))
    fireEvent.click(screen.getByLabelText('루멘 철제 사이드 테이블 블랙 선택'))
    fireEvent.click(screen.getByRole('button', { name: '선택 2개를 세트로 변환' }))

    expect(await screen.findByRole('spinbutton', { name: '마미백 플러스 베이지 구성 수량' })).toHaveValue(1)
    expect(screen.getByRole('spinbutton', { name: '루멘 철제 사이드 테이블 블랙 구성 수량' })).toHaveValue(1)
    expect(screen.queryByLabelText('마미백 플러스 베이지 원가')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('루멘 철제 사이드 테이블 블랙 원가')).not.toBeInTheDocument()
    expect(screen.getByText('선택 0개')).toBeInTheDocument()
    expect(screen.getByLabelText('등록 상품명')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      expect(call).toBeDefined()
      const { draft } = JSON.parse(String(call![1]!.body))
      expect(draft.rows).toHaveLength(1)
      expect(draft.rows[0]).toMatchObject({
        name: '',
        sourceCode: '',
        bundleComponents: [
          { sourceCode: '1471', optionName: '베이지', quantity: 1, unitCost: 10000, unitWholesale: 15000 },
          { sourceCode: '1472', optionName: '블랙', quantity: 1, unitCost: 12000, unitWholesale: 21000 },
        ],
      })
    })
  })

  it('keeps new search additions in pricing and persists price confirmation before registration inputs', async () => {
    const row = createRegistrationRow(source, '베이지')
    const draft = { ...blankDraft(), rows: [row] }
    const saved = mockSavedDraft(draft)
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByLabelText('마미백 플러스 베이지 쿠팡공급가')
    expect(screen.queryByLabelText('브랜드')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '엑셀로 출력' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '마미백 플러스 베이지 가격설정 완료' }))
    const editor = await screen.findByRole('row', { name: '마미백 플러스 베이지 상품등록정보' })
    expect(screen.getByRole('tab', { name: /2단계 상품등록정보/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByLabelText('마미백 플러스 베이지 쿠팡공급가')).not.toBeInTheDocument()
    expect(within(editor).getByLabelText('브랜드')).toHaveValue('생활살림')
    expect(within(editor).getByLabelText('제조국')).toHaveValue('중국')
    fireEvent.change(within(editor).getByLabelText('브랜드'), { target: { value: '생활살림' } })
    expect(screen.queryByLabelText('고시명')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => {
      const saves = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      const body = JSON.parse(String(saves.at(-1)![1]!.body))
      expect(body.draft.rows[0]).toMatchObject({ stage: 'information', priceConfirmedAt: expect.any(String), fields: { 브랜드: '생활살림' } })
    })
  })

  it('does not allow price confirmation for a row with missing supply price', async () => {
    const row = { ...createRegistrationRow(source, '베이지'), priceMode: 'manual' as const, manualSupplyPrice: null }
    const saved = mockSavedDraft({ ...blankDraft(), rows: [row] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    expect(await screen.findByRole('button', { name: '마미백 플러스 베이지 가격설정 완료' })).toBeDisabled()
  })

  it('shows each information product as an editable horizontal grid row with manual Excel download and no Hub automation', async () => {
    const first = confirmPricing(createRegistrationRow(source, '베이지'))
    const other = confirmPricing(createRegistrationRow(second, '블랙'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [first, other] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const firstCard = await screen.findByRole('row', { name: `${first.name} 상품등록정보` })
    const secondCard = screen.getByRole('row', { name: `${other.name} 상품등록정보` })
    const table = screen.getByRole('table', { name: '상품등록정보 입력표' })
    expect(firstCard.closest('table')).toBe(table)
    expect(secondCard.closest('table')).toBe(table)
    expect(within(table).getAllByRole('columnheader').every(header => header.classList.contains('sticky') && header.classList.contains('top-0'))).toBe(true)
    expect(within(firstCard).getByLabelText('등록 상품명').closest('td')).toHaveClass('sticky', 'left-10')
    expect(within(firstCard).getByLabelText('등록 상품명')).toHaveValue(first.name)
    expect(within(secondCard).getByLabelText('등록 상품명')).toHaveValue(other.name)
    expect(within(firstCard).getByLabelText('브랜드')).toBeEnabled()
    expect(within(secondCard).getByLabelText('브랜드')).toBeEnabled()
    const firstBrand = within(firstCard).getByLabelText('브랜드')
    const secondBrand = within(secondCard).getByLabelText('브랜드')
    firstBrand.focus()
    fireEvent.keyDown(firstBrand, { key: 'Enter', code: 'Enter', isComposing: true })
    expect(firstBrand).toHaveFocus()
    fireEvent.keyDown(firstBrand, { key: 'Enter', code: 'Enter' })
    expect(secondBrand).toHaveFocus()
    expect(screen.queryByRole('button', { name: '등록정보 입력' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '상품등록' })).not.toBeInTheDocument()
    const tools = screen.getByRole('region', { name: '상품등록정보 도구' })
    expect(within(tools).getByText('전체 2개')).toBeInTheDocument()
    expect(within(tools).getByLabelText('등록완료일')).toBeInTheDocument()
    expect(within(tools).getByRole('button', { name: '선택 0개 등록완료' })).toBeInTheDocument()
    expect(within(tools).getByRole('button', { name: '등록정보 저장' })).toBeInTheDocument()
    expect(within(tools).getByRole('button', { name: '엑셀 다운로드' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '일괄 카테고리' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '카테고리 적용' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('작업 이름')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('카테고리 엑셀 파일', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '품질표시 이미지 추가' })).not.toBeInTheDocument()
    expect(within(firstCard).getByLabelText(`${first.name} 카테고리 엑셀 파일`)).toBeEnabled()
    expect(screen.queryByRole('tablist', { name: '카테고리 시트' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /등록 확장|서플라이어허브/ })).not.toBeInTheDocument()
    for (const command of [pingSupplierExtension, searchSupplierCategories, getSupplierCategoryTemplate, startSupplierRegistration, subscribeSupplierRegistration]) expect(command).not.toHaveBeenCalled()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /\/(export|submit|submissions|category-template)(?:\?|$)/.test(String(url)))).toBe(false)
  })

  it('backfills Product Management keywords into required fields and saves manual changes with packaging units', async () => {
    const cachedMaster = {
      itemId: 'existing-master', match: 'sku' as const, noticeSize: '25*12*41cm', noticeWeight: '400g',
      noticeMaterial: '캔버스', noticeManufacturer: '제조공장', noticeCountry: '중국',
    }
    const row = confirmPricing(createRegistrationRow({ ...source, productMaster: cachedMaster }, '베이지'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [row] })
    const keywords = '수납가방,캔버스\n마미백'
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/catalog') && init?.method === 'POST'
      ? { ok: true, json: async () => ({ products: [{ ...source, productMaster: { ...cachedMaster, productKeywords: keywords } }] }) }
      : fallback(url, init)))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const information = await screen.findByRole('row', { name: `${row.name} 상품등록정보` })
    await waitFor(() => expect(within(information).getByLabelText('검색태그')).toHaveValue(keywords))
    await waitFor(() => expect(screen.getByRole('button', { name: '등록정보 저장' })).toBeEnabled())
    expect(within(information).getByLabelText('품질보증기준')).toHaveValue('제품 이상 시 공정거래위원회 고시 소비자 분쟁해결기준에 의거 보상합니다')
    expect(within(information).getByLabelText('A/S 책임자와 전화번호')).toHaveValue('1577-7011')
    expect(screen.getByRole('columnheader', { name: '한 개 단품 포장 무게 (g)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '한 개 단품 포장 사이즈 (mm)' })).toBeInTheDocument()
    expect(within(information).getByLabelText('한 개 단품 포장 무게')).toHaveValue('400')
    expect(within(information).getByLabelText('한 개 단품 포장 사이즈')).toHaveValue('270*140*430')
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/catalog') && init?.method === 'POST')).toHaveLength(1)

    fireEvent.change(within(information).getByLabelText('검색태그'), { target: { value: '직접 태그\n수납' } })
    fireEvent.change(within(information).getByLabelText('품질보증기준'), { target: { value: '직접 확인한 보증기준' } })
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0]).toMatchObject({
      fields: { 검색태그: '직접 태그\n수납', 품질보증기준: '직접 확인한 보증기준', 'A/S 책임자와 전화번호': '1577-7011' },
      productMaster: { productKeywords: keywords },
    }))
  })

  it('refreshes a fully cached selected option by its own SKU and fills search tags, duplicate colors and size without losing manual values', async () => {
    const cachedMaster = {
      itemId: 'cached-master', match: 'sku' as const, noticeSize: '20*10*30cm', noticeWeight: '400g',
      noticeMaterial: '캔버스', noticeManufacturer: '제조공장', noticeCountry: '중국', productKeywords: '예전 검색태그',
    }
    const freshMaster = { ...cachedMaster, itemId: 'beige-master', noticeSize: '28*13*40cm', productKeywords: '기저귀가방,마미백\n캔버스' }
    const sheet: TemplateSheet = { name: 'QF_101_기저귀가방', columns: [
      { column: 1, label: '상품명', requirement: '필수', guide: '' },
      { column: 2, label: '검색태그', requirement: '선택', guide: '' },
      { column: 3, label: '색상', requirement: '필수', guide: '' },
      { column: 4, label: '사이즈', requirement: '필수', guide: '' },
      { column: 5, label: '색상', requirement: '선택', guide: '' },
    ] }
    const template = manualTemplate('beige-original', '기저귀가방_최신.xlsx', sheet.name, sheet.columns)
    const initial = confirmPricing({
      ...createRegistrationRow({ ...source, productMaster: cachedMaster }, '베이지'),
      templateId: template.id, sheetName: sheet.name,
      priceMode: 'manual', manualSupplyPrice: 17700, saleMode: 'manual', manualSalePrice: 29500,
    })
    const row = {
      ...initial,
      fields: { ...initial.fields, 검색태그: cachedMaster.productKeywords, 사이즈: cachedMaster.noticeSize },
      defaultedFields: { ...initial.defaultedFields, 검색태그: cachedMaster.productKeywords, 사이즈: cachedMaster.noticeSize },
    }
    const saved = mockSavedDraft({ ...blankDraft(), rows: [row], templates: [template] })
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/catalog') && init?.method === 'POST'
      ? { ok: true, json: async () => ({ products: [source], productMasters: { [row.id]: freshMaster } }) }
      : fallback(url, init)))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    let information = await screen.findByRole('row', { name: row.name + ' 상품등록정보' })
    await waitFor(() => expect(within(information).getByLabelText('검색태그')).toHaveValue(freshMaster.productKeywords))
    expect(within(information).getByLabelText('사이즈')).toHaveValue(freshMaster.noticeSize)
    for (const color of within(information).getAllByLabelText('색상')) expect(color).toHaveValue('베이지')
    expect(within(information).getByText('17,700원')).toBeInTheDocument()
    expect(within(information).getByText('29,500원')).toBeInTheDocument()
    const refreshes = () => vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/catalog') && init?.method === 'POST')
    expect(refreshes()).toHaveLength(1)
    expect(JSON.parse(String(refreshes()[0][1]!.body))).toMatchObject({ names: [], codes: ['1471'], rows: [{ id: row.id, sourceCode: '1471', internalSku: '112361-0001', optionName: '베이지' }] })
    await waitFor(() => expect(screen.getByRole('button', { name: '등록정보 저장' })).toBeEnabled())

    const picker = await openCategoryPicker(information)
    expect(within(picker).getByRole('button', { name: `${sheet.name} · ${template.name} 선택` })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(picker).getByRole('button', { name: '양식 선택 닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '카테고리 엑셀 양식 선택' })).not.toBeInTheDocument())
    fireEvent.change(within(information).getByLabelText('검색태그'), { target: { value: '내가 확인한 태그' } })
    fireEvent.change(within(information).getByLabelText('사이즈'), { target: { value: '직접 확인한 치수' } })
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0]).toMatchObject({
      internalSku: '112361-0001', manualSupplyPrice: 17700, manualSalePrice: 29500,
      fields: { 검색태그: '내가 확인한 태그', 사이즈: '직접 확인한 치수' }, productMaster: freshMaster,
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: '등록정보 저장' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await waitFor(() => expect(refreshes()).toHaveLength(2))
    await waitFor(() => expect(screen.getByRole('button', { name: '등록정보 저장' })).toBeEnabled())
    information = screen.getByRole('row', { name: row.name + ' 상품등록정보' })
    expect(within(information).getByLabelText('검색태그')).toHaveValue('내가 확인한 태그')
    expect(within(information).getByLabelText('사이즈')).toHaveValue('직접 확인한 치수')
  })

  it('saves editable common information before an official file and renders only actual headers after upload', async () => {
    const row = confirmPricing({ ...createRegistrationRow(source, '베이지'), priceMode: 'manual', manualSupplyPrice: 17700, saleMode: 'manual', manualSalePrice: 29500, label: '내 라벨.jpg' })
    const initial = { ...blankDraft(), name: '내 수동 등록 정보', rows: [row], labels: [{ name: '내 라벨.jpg', data: 'kept' }] }
    const saved = mockSavedDraft(initial)
    const template = manualTemplate('template-manual', '브랜드양식.xlsx', 'QF_9_실제양식', [
      { column: 1, label: '상품명', requirement: '필수', guide: '' },
      { column: 2, label: '브랜드', requirement: '필수', guide: '' },
      { column: 3, label: '인증정보', requirement: '필수', guide: '' },
    ])
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/template') ? { ok: true, json: async () => ({ template, rows: [createRegistrationRow(second, '엑셀 예시상품')] }) } : fallback(url, init)))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    let card = await screen.findByRole('row', { name: `${row.name} 상품등록정보` })
    await waitFor(() => expect(screen.getByRole('button', { name: '등록정보 저장' })).toBeEnabled())
    fireEvent.change(within(card).getByLabelText('브랜드'), { target: { value: '직접 입력한 브랜드' } })
    fireEvent.change(within(card).getByLabelText('제조국'), { target: { value: '미국' } })
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0].fields).toMatchObject({ 브랜드: '직접 입력한 브랜드', 제조국: '미국' }))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.change(within(card).getByLabelText(`${row.name} 카테고리 엑셀 파일`), { target: { files: [new File(['official'], template.name)] } })
    await chooseUploadedSheet(row.name, template)
    expect(await screen.findByLabelText('인증정보')).toHaveValue('해당사항없음')
    card = screen.getByRole('row', { name: `${row.name} 상품등록정보` })
    expect(within(card).queryByLabelText('제조국')).not.toBeInTheDocument()
    expect(within(card).getByLabelText('브랜드')).toHaveValue('직접 입력한 브랜드')
    expect(within(card).queryByText('인증정보 누락')).not.toBeInTheDocument()
    fireEvent.change(within(card).getByLabelText('인증정보'), { target: { value: '사용자 확인 정보' } })
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => {
      const body = savedBodies().at(-1)
      expect(body?.draft.name).toBe(initial.name)
      expect(body?.draft.labels).toEqual(initial.labels)
      expect(body?.draft.rows).toHaveLength(1)
      expect(body?.draft.rows[0]).toMatchObject({ id: row.id, templateId: template.id, sheetName: template.sheets[0].name, manualSupplyPrice: 17700, manualSalePrice: 29500, label: row.label, fields: { 브랜드: '직접 입력한 브랜드', 제조국: '미국', 인증정보: '사용자 확인 정보' } })
    })
  })

  it('keeps selection, filters, edits, and saving shared between the large view and the inline grid', async () => {
    const first = confirmPricing({ ...createRegistrationRow(source, '베이지'), priceMode: 'manual', manualSupplyPrice: 17700, saleMode: 'manual', manualSalePrice: 29500 })
    const other = confirmPricing(createRegistrationRow(second, '블랙'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [first, other] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const firstRow = await screen.findByRole('row', { name: `${first.name} 상품등록정보` })
    fireEvent.click(within(firstRow).getByLabelText(`${first.name} 선택`))
    fireEvent.change(screen.getByLabelText('상품 검색어'), { target: { value: '마미백' } })
    fireEvent.click(screen.getByLabelText('확인 필요만 보기'))
    fireEvent.click(screen.getByRole('button', { name: '크게 보기' }))
    const dialog = await screen.findByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })
    expect(screen.getAllByRole('table', { name: '상품등록정보 입력표', hidden: true })).toHaveLength(1)
    expect(within(dialog).getByLabelText('상품 검색어')).toHaveValue('마미백')
    expect(within(dialog).getByLabelText('확인 필요만 보기')).toBeChecked()
    const expandedRow = within(dialog).getByRole('row', { name: `${first.name} 상품등록정보` })
    expect(within(expandedRow).getByLabelText(`${first.name} 선택`)).toBeChecked()
    expect(within(dialog).getByRole('row', { name: `${other.name} 상품등록정보` })).toBeInTheDocument()
    fireEvent.change(within(expandedRow).getByLabelText('브랜드'), { target: { value: '확대 화면 수정 브랜드' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => {
      expect(savedBodies().at(-1)?.draft.rows[0]).toMatchObject({ id: first.id, manualSupplyPrice: 17700, manualSalePrice: 29500, fields: { 브랜드: '확대 화면 수정 브랜드' } })
      expect(savedBodies().at(-1)?.draft.rows).toHaveLength(2)
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })).not.toBeInTheDocument())
    const restored = screen.getByRole('row', { name: `${first.name} 상품등록정보` })
    expect(within(restored).getByLabelText('브랜드')).toHaveValue('확대 화면 수정 브랜드')
    expect(within(restored).getByLabelText(`${first.name} 선택`)).toBeChecked()
    expect(screen.getByLabelText('상품 검색어')).toHaveValue('마미백')
    expect(screen.getByLabelText('확인 필요만 보기')).toBeChecked()
  })

  it('moves through large-view cells with Enter and closes with Escape while restoring trigger focus', async () => {
    const first = confirmPricing(createRegistrationRow(source, '베이지'))
    const other = confirmPricing(createRegistrationRow(second, '블랙'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [first, other] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByRole('row', { name: `${first.name} 상품등록정보` })
    const trigger = screen.getByRole('button', { name: '크게 보기' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })
    const firstBrand = within(within(dialog).getByRole('row', { name: `${first.name} 상품등록정보` })).getByLabelText('브랜드')
    const secondBrand = within(within(dialog).getByRole('row', { name: `${other.name} 상품등록정보` })).getByLabelText('브랜드')
    firstBrand.focus()
    fireEvent.keyDown(firstBrand, { key: 'Enter', code: 'Enter' })
    expect(secondBrand).toHaveFocus()
    fireEvent.change(secondBrand, { target: { value: '저장 전 수정값' } })
    fireEvent.keyDown(secondBrand, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(within(screen.getByRole('row', { name: `${other.name} 상품등록정보` })).getByLabelText('브랜드')).toHaveValue('저장 전 수정값')
    expect(savedBodies()).toHaveLength(0)
  })

  it('keeps the whole workbench enlarged while confirming edited prices and moving into registration information', async () => {
    const row = createRegistrationRow(source, '베이지')
    const saved = mockSavedDraft({ ...blankDraft(), rows: [row] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByLabelText(`${row.name} 쿠팡공급가`)
    fireEvent.click(screen.getByRole('button', { name: '크게 보기' }))
    const dialog = await screen.findByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })
    expect(within(dialog).getByRole('tab', { name: /1단계 판매가설정/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByLabelText(`${row.name} 쿠팡공급가`)).toHaveLength(1)
    fireEvent.change(within(dialog).getByLabelText(`${row.name} 쿠팡공급가`), { target: { value: '18000' } })
    expect(within(dialog).getByLabelText(`${row.name} 쿠팡판매가`)).toHaveValue(30000)
    fireEvent.click(within(dialog).getByRole('button', { name: `${row.name} 가격설정 완료` }))
    const informationRow = await within(dialog).findByRole('row', { name: `${row.name} 상품등록정보` })
    expect(within(dialog).getByRole('tab', { name: /2단계 상품등록정보/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })).toBe(dialog)
    expect(within(informationRow).getByLabelText('브랜드')).toHaveValue('생활살림')
    expect(within(informationRow).getByText('18,000원')).toBeInTheDocument()
    expect(within(informationRow).getByText('30,000원')).toBeInTheDocument()
    expect(savedBodies().at(-1)?.draft.rows[0]).toMatchObject({ id: row.id, stage: 'information', manualSupplyPrice: 18000, manualSalePrice: 30000 })
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })).not.toBeInTheDocument())
    expect(screen.getByRole('tab', { name: /2단계 상품등록정보/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('row', { name: `${row.name} 상품등록정보` })).toHaveTextContent('18,000원')
  })

  it('saves a manual completion date and uses third-stage checkboxes only for selection before an explicit return', async () => {
    const first = confirmPricing({ ...createRegistrationRow(source, '베이지'), fields: { 브랜드: '직접 확인 브랜드' } })
    const other = confirmPricing(createRegistrationRow(second, '블랙'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [first, other] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByRole('row', { name: `${first.name} 상품등록정보` })
    fireEvent.change(screen.getByLabelText('등록완료일', { exact: true }), { target: { value: '2026-11-24' } })
    fireEvent.click(screen.getByRole('checkbox', { name: `${first.name} 등록완료` }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0]).toMatchObject({ id: first.id, stage: 'registered', registrationCompletedAt: '2026-11-24', fields: { 브랜드: '직접 확인 브랜드' } }))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('row', { name: `${first.name} 상품등록정보` })).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: `${other.name} 상품등록정보` })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '크게 보기' }))
    const dialog = await screen.findByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })
    fireEvent.click(within(dialog).getByRole('tab', { name: /3단계 등록완료/ }))
    const completed = within(dialog).getByRole('row', { name: `${first.name} 등록완료 정보` })
    const selectCompleted = within(completed).getByRole('checkbox', { name: `${first.name} 선택` })
    expect(selectCompleted).not.toBeChecked()
    expect(within(completed).getByLabelText(`${first.name} 등록완료일`)).toHaveValue('2026-11-24')
    expect(within(dialog).queryByRole('link', { name: /허브/ })).not.toBeInTheDocument()
    fireEvent.change(within(completed).getByLabelText(`${first.name} 등록완료일`), { target: { value: '2026-11-23' } })
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0].registrationCompletedAt).toBe('2026-11-23'))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    const savesBeforeSelection = savedBodies().length
    fireEvent.click(selectCompleted)
    expect(selectCompleted).toBeChecked()
    fireEvent.click(selectCompleted)
    expect(selectCompleted).not.toBeChecked()
    expect(savedBodies()).toHaveLength(savesBeforeSelection)
    expect(within(dialog).getByRole('row', { name: `${first.name} 등록완료 정보` })).toBeInTheDocument()
    fireEvent.click(within(completed).getByRole('button', { name: `${first.name} 2단계로 되돌리기` }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0]).toMatchObject({ id: first.id, stage: 'information', fields: { 브랜드: '직접 확인 브랜드' } }))
    expect(savedBodies().at(-1)?.draft.rows[0].registrationCompletedAt).toBeUndefined()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    const restored = within(dialog).getByRole('row', { name: `${first.name} 상품등록정보` })
    expect(within(restored).getByLabelText('브랜드')).toHaveValue('직접 확인 브랜드')
    expect(within(restored).getByRole('checkbox', { name: `${first.name} 등록완료` })).not.toBeChecked()
    expect(screen.getByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })).toBe(dialog)
  })

  it('completes selected products together with their chosen completion date', async () => {
    const first = confirmPricing(createRegistrationRow(source, '베이지'))
    const other = confirmPricing(createRegistrationRow(second, '블랙'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [first, other] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByRole('row', { name: `${first.name} 상품등록정보` })
    fireEvent.click(screen.getByRole('checkbox', { name: `${first.name} 선택` }))
    fireEvent.click(screen.getByRole('checkbox', { name: `${other.name} 선택` }))
    fireEvent.change(screen.getByLabelText('등록완료일', { exact: true }), { target: { value: '2026-11-22' } })
    fireEvent.click(screen.getByRole('button', { name: '선택 2개 등록완료' }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows.map(row => ({ id: row.id, stage: row.stage, date: row.registrationCompletedAt }))).toEqual([
      { id: first.id, stage: 'registered', date: '2026-11-22' }, { id: other.id, stage: 'registered', date: '2026-11-22' },
    ]))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /3단계 등록완료/ }))
    const completedTable = screen.getByRole('table', { name: '등록완료 목록' })
    expect(within(completedTable).getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByRole('checkbox', { name: '등록완료 상품 전체 선택' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: `${first.name} 선택` })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: `${other.name} 선택` })).not.toBeChecked()
  })

  it('shows every dated product in its stage without date query controls', async () => {
    const earlier = { ...createRegistrationRow(source, '베이지'), name: '먼저 추가한 상품', addedAt: '2026-11-15T00:00:00.000Z' }
    const later = { ...createRegistrationRow(source, '베이지'), name: '나중 추가한 상품', addedAt: '2026-11-20T00:00:00.000Z' }
    const earlyInfo = confirmPricing({ ...createRegistrationRow(source, '베이지'), name: '먼저 가격확정한 상품' }, 1, '2026-11-10T00:00:00.000Z')
    const laterInfo = confirmPricing({ ...createRegistrationRow(source, '베이지'), name: '나중 가격확정한 상품' }, 1, '2026-11-21T00:00:00.000Z')
    const completed = confirmRegistration(confirmPricing({ ...createRegistrationRow(source, '베이지'), name: '수동 완료한 상품' }), '2026-11-22')
    const saved = mockSavedDraft({ ...blankDraft(), rows: [earlier, later, earlyInfo, laterInfo, completed] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByLabelText(`${later.name} 쿠팡공급가`)
    expect(screen.queryByLabelText('시작일')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('종료일')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '전체 날짜' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(`${earlier.name} 쿠팡공급가`)).toBeInTheDocument()
    expect(screen.getByLabelText(`${later.name} 쿠팡공급가`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /2단계 상품등록정보/ }))
    expect(await screen.findByRole('row', { name: `${laterInfo.name} 상품등록정보` })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: `${earlyInfo.name} 상품등록정보` })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /3단계 등록완료/ }))
    expect(screen.getByRole('row', { name: `${completed.name} 등록완료 정보` })).toBeInTheDocument()
    expect(screen.getByLabelText(`${completed.name} 등록완료일`)).toHaveValue('2026-11-22')
    fireEvent.click(screen.getByRole('tab', { name: /1단계 판매가설정/ }))
    expect(screen.getByLabelText(`${earlier.name} 쿠팡공급가`)).toBeInTheDocument()
    expect(screen.getByLabelText(`${later.name} 쿠팡공급가`)).toBeInTheDocument()
  })

  it('automatically connects missing source information once per session while preserving manual fields and prices', async () => {
    const row = confirmPricing({
      ...createRegistrationRow(source, '베이지'), primaryImage: '', thumbnails: [], detailImages: [],
      priceMode: 'manual', manualSupplyPrice: 17700, saleMode: 'manual', manualSalePrice: 29500,
      fields: { 브랜드: '직접 입력 브랜드', 크기: '직접 확인한 제품 크기', '한 개 단품 포장 무게': '777' },
    })
    const product = {
      ...source,
      thumbnails: ['https://cdn.tapeoff.kr/connected-front.jpg'], detailImages: ['https://cdn.tapeoff.kr/connected-detail.jpg'],
      productMaster: { itemId: 'matched-master', match: 'sku' as const, noticeSize: '25*12*41cm', noticeWeight: '400g', noticeMaterial: '철제', noticeManufacturer: '확인된 제조공장', noticeCountry: '중국' },
    }
    const saved = mockSavedDraft({ ...blankDraft(), rows: [row] })
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/catalog') && init?.method === 'POST'
      ? { ok: true, json: async () => ({ products: [product] }) }
      : fallback(url, init)))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const information = await screen.findByRole('row', { name: `${row.name} 상품등록정보` })
    await waitFor(() => expect(within(information).getByLabelText('주요 소재')).toHaveValue('철제'))
    expect(within(information).getByLabelText('한 개 단품 포장 사이즈')).toHaveValue('270*140*430')
    expect(within(information).getByLabelText('대표이미지 URL')).toHaveValue(product.thumbnails[0])
    expect(within(information).getByLabelText('상세이미지 URL')).toHaveValue(product.detailImages[0])
    expect(within(information).getByLabelText('브랜드')).toHaveValue('직접 입력 브랜드')
    expect(within(information).getByLabelText('크기')).toHaveValue('직접 확인한 제품 크기')
    expect(within(information).getByLabelText('한 개 단품 포장 무게')).toHaveValue('777')
    expect(within(information).getByText('17,700원')).toBeInTheDocument()
    expect(within(information).getByText('29,500원')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /정보 연결/ })).not.toBeInTheDocument()
    fireEvent.change(within(information).getByLabelText('주요 소재'), { target: { value: '직접 수정한 소재' } })
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0]).toMatchObject({
      id: row.id, manualSupplyPrice: 17700, manualSalePrice: 29500, productMaster: product.productMaster,
      primaryImage: product.thumbnails[0], detailImages: product.detailImages,
      fields: { 브랜드: '직접 입력 브랜드', 크기: '직접 확인한 제품 크기', '주요 소재': '직접 수정한 소재', '한 개 단품 포장 무게': '777', '한 개 단품 포장 사이즈': '270*140*430' },
    }))
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/catalog') && init?.method === 'POST')).toHaveLength(1)
  })

  it('binds each uploaded original category file only to its product and ignores every example row', async () => {
    const first = confirmPricing({ ...createRegistrationRow(source, '베이지'), priceMode: 'manual', manualSupplyPrice: 17700, saleMode: 'manual', manualSalePrice: 29500, label: '첫 라벨.jpg' })
    const other = confirmPricing({ ...createRegistrationRow(second, '블랙'), priceMode: 'manual', manualSupplyPrice: 21999, saleMode: 'manual', manualSalePrice: 37999, label: '둘째 라벨.jpg' })
    const initial = { ...blankDraft(), name: '서로 다른 양식', rows: [first, other], labels: [{ name: '첫 라벨.jpg', data: 'first-label' }, { name: '둘째 라벨.jpg', data: 'other-label' }] }
    const saved = mockSavedDraft(initial)
    const firstTemplate = manualTemplate('first-template', '가방원본.xlsx', 'QF_101_가방', [{ column: 1, label: '상품명', requirement: '필수', guide: '' }, { column: 2, label: '가방종류', requirement: '필수', guide: '' }])
    const otherTemplate = manualTemplate('other-template', '가구원본.xlsx', 'QF_202_가구', [{ column: 1, label: '상품명', requirement: '필수', guide: '' }, { column: 2, label: '가구재질', requirement: '필수', guide: '' }])
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/template')) {
        const upload = (init!.body as FormData).get('file') as File
        return { ok: true, json: async () => ({ template: upload.name === firstTemplate.name ? firstTemplate : otherTemplate, rows: [createRegistrationRow(source, '가져오면 안 되는 예시')] }) }
      }
      return fallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    let firstCard = await screen.findByRole('row', { name: `${first.name} 상품등록정보` })
    let otherCard = screen.getByRole('row', { name: `${other.name} 상품등록정보` })
    fireEvent.change(within(firstCard).getByLabelText(`${first.name} 카테고리 엑셀 파일`), { target: { files: [new File(['first'], firstTemplate.name)] } })
    await chooseUploadedSheet(first.name, firstTemplate)
    expect(await screen.findByLabelText('가방종류')).toHaveValue('')
    firstCard = screen.getByRole('row', { name: `${first.name} 상품등록정보` })
    otherCard = screen.getByRole('row', { name: `${other.name} 상품등록정보` })
    expect(within(otherCard).queryByLabelText('가방종류')).not.toBeInTheDocument()
    fireEvent.change(within(otherCard).getByLabelText(`${other.name} 카테고리 엑셀 파일`), { target: { files: [new File(['other'], otherTemplate.name)] } })
    await chooseUploadedSheet(other.name, otherTemplate)
    expect(await screen.findByLabelText('가구재질')).toHaveValue('')
    firstCard = screen.getByRole('row', { name: `${first.name} 상품등록정보` })
    otherCard = screen.getByRole('row', { name: `${other.name} 상품등록정보` })
    expect(within(firstCard).queryByLabelText('가구재질')).not.toBeInTheDocument()
    const bagTable = firstCard.closest('table')!
    const furnitureTable = otherCard.closest('table')!
    expect(bagTable).not.toBe(furnitureTable)
    expect(within(bagTable).getByRole('columnheader', { name: /^가방종류/ })).toBeInTheDocument()
    expect(within(bagTable).queryByRole('columnheader', { name: /^가구재질/ })).not.toBeInTheDocument()
    expect(within(furnitureTable).getByRole('columnheader', { name: /^가구재질/ })).toBeInTheDocument()
    expect(within(furnitureTable).queryByRole('columnheader', { name: /^가방종류/ })).not.toBeInTheDocument()
    fireEvent.change(within(firstCard).getByLabelText('가방종류'), { target: { value: '숄더백' } })
    fireEvent.change(within(otherCard).getByLabelText('가구재질'), { target: { value: '철제' } })
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => {
      const body = savedBodies().at(-1)
      expect(body?.draft.rows).toHaveLength(2)
      expect(body?.draft.name).toBe(initial.name)
      expect(body?.draft.labels).toEqual(initial.labels)
      expect(body?.draft.templates.map((item: { id: string }) => item.id)).toEqual([firstTemplate.id, otherTemplate.id])
      expect(body?.draft.rows[0]).toMatchObject({ id: first.id, templateId: firstTemplate.id, sheetName: firstTemplate.sheets[0].name, manualSupplyPrice: 17700, manualSalePrice: 29500, label: first.label, fields: { 가방종류: '숄더백' } })
      expect(body?.draft.rows[1]).toMatchObject({ id: other.id, templateId: otherTemplate.id, sheetName: otherTemplate.sheets[0].name, manualSupplyPrice: 21999, manualSalePrice: 37999, label: other.label, fields: { 가구재질: '철제' } })
      expect(body?.draft.rows[0].fields).not.toHaveProperty('가구재질')
      expect(body?.draft.rows[1].fields).not.toHaveProperty('가방종류')
    })
  })

  it('treats a product category upload as metadata only and requires an explicit sheet assignment', async () => {
    const row = confirmPricing(createRegistrationRow(source, '베이지'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [row] })
    const template = manualTemplate('product-template', '상품연결원본.xlsx', 'QF_3_가방', [{ column: 1, label: '상품명', requirement: '필수', guide: '' }, { column: 2, label: '전용정보', requirement: '필수', guide: '' }])
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/template') ? { ok: true, json: async () => ({ template, rows: [createRegistrationRow(second, '파일 속 예시')] }) } : fallback(url, init)))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByRole('row', { name: `${row.name} 상품등록정보` })
    await waitFor(() => expect(screen.getByLabelText(`${row.name} 카테고리 엑셀 파일`)).toBeEnabled())
    fireEvent.change(screen.getByLabelText(`${row.name} 카테고리 엑셀 파일`), { target: { files: [new File(['product'], template.name)] } })
    const picker = await openCategoryPicker(screen.getByRole('row', { name: `${row.name} 상품등록정보` }))
    expect(await within(picker).findByRole('button', { name: `${template.sheets[0].name} · ${template.name} 선택` })).toBeEnabled()
    fireEvent.click(within(picker).getByRole('button', { name: '양식 선택 닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '카테고리 엑셀 양식 선택' })).not.toBeInTheDocument())
    expect(screen.queryByLabelText('전용정보')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '등록정보 저장' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => {
      const body = savedBodies().at(-1)
      expect(body?.draft.rows).toHaveLength(1)
      expect(body?.draft.rows[0]).toMatchObject({ id: row.id, templateId: '', sheetName: '' })
      expect(body?.draft.templates).toHaveLength(1)
    })
  })

  it('distinguishes identically named category sheets by their original file in the popup and saves the chosen file', async () => {
    const sheetName = 'QF_2379_가구_수납가구_선반'
    const older = manualTemplate('older-file', '선반_20261120.xlsx', sheetName, [{ column: 1, label: '상품명', requirement: '필수', guide: '' }])
    const latest = manualTemplate('latest-file', '선반_20261126.xlsx', sheetName, [{ column: 1, label: '상품명', requirement: '필수', guide: '' }, { column: 2, label: '새 양식 입력항목', requirement: '선택', guide: '' }])
    const row = { ...confirmPricing(createRegistrationRow(source, '베이지')), sourceCode: '', templateId: older.id, sheetName }
    mockSavedDraft({ ...blankDraft(), rows: [row], templates: [older, latest] })
    await loadSavedWorkbench()
    const picker = await openCategoryPicker(screen.getByRole('row', { name: row.name + ' 상품등록정보' }))
    expect(within(picker).getByRole('button', { name: `${sheetName} · ${older.name} 선택` })).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: `${sheetName} · ${latest.name} 선택` })).toBeInTheDocument()
    fireEvent.change(within(picker).getByRole('textbox', { name: '카테고리 양식 검색' }), { target: { value: '20261126' } })
    expect(within(picker).queryByRole('button', { name: `${sheetName} · ${older.name} 선택` })).not.toBeInTheDocument()
    fireEvent.click(within(picker).getByRole('button', { name: `${sheetName} · ${latest.name} 선택` }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '카테고리 엑셀 양식 선택' })).not.toBeInTheDocument())
    expect(await screen.findByLabelText('새 양식 입력항목')).toHaveValue('')
    await waitFor(() => expect(screen.getByRole('button', { name: '등록정보 저장' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0]).toMatchObject({ id: row.id, templateId: latest.id, sheetName }))
    expect(savedBodies().at(-1)?.draft.templates).toEqual([older, latest])
  })

  it('shows every original worksheet in its own category table and preserves edits while saving and reloading', async () => {
    const firstSheet: TemplateSheet = { name: 'QF_101_가방', columns: [
      { column: 1, label: '상품명', requirement: '필수', guide: '' },
      { column: 2, label: '가방종류', requirement: '필수', guide: '' },
      { column: 3, label: '가방선택정보', requirement: '선택', guide: '' },
    ] }
    const secondSheet: TemplateSheet = { name: 'QF_202_가구', columns: [
      { column: 1, label: '상품명', requirement: '필수', guide: '' },
      { column: 2, label: '가구재질', requirement: '필수', guide: '' },
      { column: 3, label: '설치방식', requirement: '선택', guide: '' },
    ] }
    const template = { ...manualTemplate('multi-sheet-template', '카테고리두시트원본.xlsx', firstSheet.name, firstSheet.columns), sheets: [firstSheet, secondSheet] }
    const first = { ...confirmPricing(createRegistrationRow(source, '베이지')), templateId: template.id, sheetName: firstSheet.name, fields: { 가방종류: '숄더백' } }
    const sameSheet = { ...confirmPricing(createRegistrationRow(source, '아이보리')), templateId: template.id, sheetName: firstSheet.name, fields: { 가방종류: '토트백' } }
    const furniture = { ...confirmPricing(createRegistrationRow(second, '블랙')), templateId: template.id, sheetName: secondSheet.name, fields: { 가구재질: '철제' } }
    const saved = mockSavedDraft({ ...blankDraft(), rows: [first, sameSheet, furniture], templates: [template] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const bagGroup = await screen.findByRole('region', { name: '가방 입력표' })
    const furnitureGroup = screen.getByRole('region', { name: '가구 입력표' })
    expect(within(bagGroup).getByRole('row', { name: `${first.name} 상품등록정보` })).toBeInTheDocument()
    expect(within(bagGroup).getByRole('row', { name: `${sameSheet.name} 상품등록정보` })).toBeInTheDocument()
    expect(within(bagGroup).getAllByRole('table')).toHaveLength(1)
    expect(within(bagGroup).queryByRole('columnheader', { name: /^가구재질/ })).not.toBeInTheDocument()
    expect(within(furnitureGroup).queryByRole('columnheader', { name: /^가방종류/ })).not.toBeInTheDocument()
    const optional = within(within(bagGroup).getByRole('row', { name: `${first.name} 상품등록정보` })).getByLabelText('가방선택정보')
    expect(optional).toHaveValue('')
    fireEvent.change(optional, { target: { value: '선택항목도 입력' } })
    expect(screen.queryByRole('tablist', { name: '카테고리 시트' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '상품등록정보 도구' })).getByText('전체 3개')).toBeInTheDocument()
    const installation = within(furnitureGroup).getByLabelText('설치방식')
    fireEvent.change(installation, { target: { value: '고객 조립' } })
    expect(within(within(bagGroup).getByRole('row', { name: `${first.name} 상품등록정보` })).getByLabelText('가방선택정보')).toHaveValue('선택항목도 입력')
    expect(screen.getAllByRole('table', { name: '상품등록정보 입력표' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => {
      const rows = savedBodies().at(-1)?.draft.rows
      expect(rows).toHaveLength(3)
      expect(rows?.[0]).toMatchObject({ id: first.id, fields: { 가방종류: '숄더백', 가방선택정보: '선택항목도 입력' } })
      expect(rows?.[1]).toMatchObject({ id: sameSheet.id, fields: { 가방종류: '토트백' } })
      expect(rows?.[2]).toMatchObject({ id: furniture.id, fields: { 가구재질: '철제', 설치방식: '고객 조립' } })
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '등록정보 저장' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const restoredBag = await screen.findByRole('region', { name: '가방 입력표' })
    expect(within(within(restoredBag).getByRole('row', { name: `${first.name} 상품등록정보` })).getByLabelText('가방선택정보')).toHaveValue('선택항목도 입력')
    expect(within(screen.getByRole('region', { name: '가구 입력표' })).getByLabelText('설치방식')).toHaveValue('고객 조립')
    expect(screen.getAllByRole('table', { name: '상품등록정보 입력표' })).toHaveLength(2)
  })

  it('automatically connects only the precise Funtastic category and remembers a manual ambiguous choice for the next draft', async () => {
    const shelf = 'QF_2379_가구_수납가구_선반'
    const cabinet = 'QF_2380_가구_수납가구_서랍장'
    const template = { ...manualTemplate('category-hash', '여러분류.xlsx', shelf, [{ column: 1, label: '상품명', requirement: '필수', guide: '' }, { column: 2, label: '선반단수', requirement: '필수', guide: '' }]), sheets: [
      { name: shelf, columns: [{ column: 1, label: '상품명', requirement: '필수', guide: '' }, { column: 2, label: '선반단수', requirement: '필수', guide: '' }] },
      { name: cabinet, columns: [{ column: 1, label: '상품명', requirement: '필수', guide: '' }, { column: 2, label: '서랍단수', requirement: '필수', guide: '' }] },
    ] }
    const first = confirmPricing(createRegistrationRow(source, '베이지'))
    const other = confirmPricing(createRegistrationRow(second, '블랙'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [first, other], templates: [template] })
    const fallback = vi.mocked(fetch)
    let mappings: Array<{ sourceCode: string; sourceCategoryName: string; sourceCategoryPath: string; targetSheetName: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/sheet-mappings')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body))
          mappings = body.sourceCodes.map((code: string) => ({ sourceCode: code, sourceCategoryName: '수납가구', sourceCategoryPath: '가구 > 수납가구', targetSheetName: body.targetSheetName }))
        }
        return { ok: true, json: async () => ({ mappings, failures: [] }) }
      }
      if (url.includes('/category-context?')) {
        const code = new URL(url, 'http://localhost').searchParams.get('code')!
        return { ok: true, json: async () => ({ context: { sourceCode: code, productName: '', categoryName: code === source.code ? '선반' : '수납가구', categoryPath: code === source.code ? '가구 > 수납가구 > 선반' : '가구 > 수납가구', keywords: [], queries: [] } }) }
      }
      return fallback(url, init)
    }))
    const rendered = render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByLabelText('선반단수')
    const automatic = screen.getByRole('row', { name: first.name + ' 상품등록정보' })
    expect(within(automatic).getByRole('button', { name: '업로드한 카테고리 양식' })).toHaveTextContent(shelf.replace(/^QF_\d+_/, ''))
    const ambiguous = screen.getByRole('row', { name: other.name + ' 상품등록정보' })
    expect(within(ambiguous).getByRole('button', { name: '업로드한 카테고리 양식' })).toHaveTextContent('업로드한 양식 선택')
    expect(within(ambiguous).getByText(/후보 여러 개/)).toBeInTheDocument()
    await chooseUploadedSheet(other.name, template, cabinet)
    await waitFor(() => expect(mappings).toHaveLength(1))
    expect(mappings[0]).toMatchObject({ sourceCode: other.sourceCode, targetSheetName: cabinet })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('서랍단수'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[1].fields).toMatchObject({ 서랍단수: '3' }))
    rendered.unmount()

    const fresh = mockSavedDraft({ ...blankDraft(), rows: [confirmPricing(createRegistrationRow(second, '블랙'))], templates: [{ ...template, id: 'new-download-hash' }] })
    const freshFallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/sheet-mappings')) return { ok: true, json: async () => ({ mappings }) }
      if (url.includes('/category-context?')) return { ok: true, json: async () => ({ context: { sourceCode: second.code, productName: '', categoryName: '수납가구', categoryPath: '가구 > 수납가구', keywords: [], queries: [] } }) }
      return freshFallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: fresh.id } })
    await screen.findByLabelText('서랍단수')
    expect(screen.getByRole('button', { name: '업로드한 카테고리 양식' })).toHaveTextContent(cabinet.replace(/^QF_\d+_/, ''))
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/sheet-mappings') && init?.method === 'POST')).toHaveLength(0)
  })

  it('keeps a selected row file snapshot when the native input clears its live FileList before parsing completes', async () => {
    const row = confirmPricing(createRegistrationRow(source, '베이지'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [row] })
    const template = manualTemplate('filelist-template', '선택직후초기화.xlsx', 'QF_8_한분류', [{ column: 1, label: '상품명', requirement: '필수', guide: '' }, { column: 2, label: '공식필수값', requirement: '필수', guide: '' }])
    const fallback = vi.mocked(fetch)
    let finish!: (value: { ok: boolean; json: () => Promise<unknown> }) => void
    const parsing = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => { finish = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/template') ? parsing : fallback(url, init)))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const card = await screen.findByRole('row', { name: `${row.name} 상품등록정보` })
    const liveFiles: File[] = [new File(['official'], template.name)]
    fireEvent.change(within(card).getByLabelText(`${row.name} 카테고리 엑셀 파일`), { target: { files: liveFiles } })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/template'))).toBe(true))
    liveFiles.length = 0
    finish({ ok: true, json: async () => ({ template, rows: [] }) })
    await chooseUploadedSheet(row.name, template)
    expect(await screen.findByLabelText('공식필수값')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0]).toMatchObject({ id: row.id, templateId: template.id, sheetName: template.sheets[0].name }))
  })

  it('preserves independent duplicate headers and an explicit clear across manual saves and reloads', async () => {
    const sheet: TemplateSheet = { name: 'QF_42_선반', columns: [
      { column: 1, label: '상품명', requirement: '필수', guide: '' },
      { column: 7, label: '색상', requirement: '필수', guide: '', choices: ['검정', '흰색'] },
      { column: 15, label: '설치지원방식', requirement: '선택', guide: '', choices: ['완전 조립', '조립 필요'] },
      { column: 53, label: '설치지원방식', requirement: '조건부 필수', guide: '', choices: ['고객직접설치', '방문설치'] },
      { column: 62, label: '색상', requirement: '필수', guide: '', choices: ['검정', '흰색'] },
    ] }
    const base = { ...confirmPricing(createRegistrationRow(source, '베이지')), templateId: 'duplicate-label-template', sheetName: sheet.name, fields: { 색상: '검정', 브랜드: '직접 입력 브랜드' } }
    const row = { ...base, fields: { ...base.fields, [registrationFieldKey(base, sheet, sheet.columns[2])]: '완전 조립', [registrationFieldKey(base, sheet, sheet.columns[3])]: '고객직접설치' } }
    const saved = mockSavedDraft({ ...blankDraft(), rows: [row], templates: [manualTemplate(row.templateId, '중복열원본.xlsx', sheet.name, sheet.columns)] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const card = await screen.findByRole('row', { name: `${row.name} 상품등록정보` })
    const table = screen.getByRole('table', { name: '상품등록정보 입력표' })
    await waitFor(() => expect(screen.getByRole('button', { name: '등록정보 저장' })).toBeEnabled())
    expect(within(table).getByRole('columnheader', { name: /^색상 2/ })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /^설치지원방식 2/ })).toBeInTheDocument()
    const assembly = within(card).getByLabelText('설치지원방식', { exact: true })
    const installation = within(card).getByLabelText('설치지원방식 (조건부)')
    expect(assembly).toHaveValue('완전 조립')
    expect(installation).toHaveValue('고객직접설치')
    const colors = within(card).getAllByLabelText('색상')
    expect(colors.map(element => (element as HTMLSelectElement).value)).toEqual(['검정', '검정'])
    fireEvent.change(assembly, { target: { value: '조립 필요' } })
    expect(installation).toHaveValue('고객직접설치')
    fireEvent.change(installation, { target: { value: '방문설치' } })
    expect(assembly).toHaveValue('조립 필요')
    fireEvent.change(colors[0], { target: { value: '' } })
    fireEvent.change(colors[1], { target: { value: '흰색' } })
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0].fields).toMatchObject({
      색상: '검정', [registrationFieldKey(row, sheet, sheet.columns[1])]: '', [registrationFieldKey(row, sheet, sheet.columns[2])]: '조립 필요', [registrationFieldKey(row, sheet, sheet.columns[3])]: '방문설치', [registrationFieldKey(row, sheet, sheet.columns[4])]: '흰색',
    }))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const restored = await screen.findByRole('row', { name: `${row.name} 상품등록정보` })
    expect(within(restored).getByLabelText('설치지원방식', { exact: true })).toHaveValue('조립 필요')
    expect(within(restored).getByLabelText('설치지원방식 (조건부)')).toHaveValue('방문설치')
    expect(within(restored).getAllByLabelText('색상')[0]).toHaveValue('')
    expect(within(restored).getAllByLabelText('색상')[1]).toHaveValue('흰색')
  })
  describe('completed rows and saved official downloads', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    it('returns a completed product to stage two inside fullscreen without losing saved information', async () => {
      const fixture = downloadFixture()
      const completed = confirmRegistration(fixture.first, '2026-11-24')
      const other = confirmRegistration(fixture.other, '2026-11-23')
      const initial = { ...fixture.draft, rows: [completed, other] }
      const saved = await openSavedWorkbench(initial)
      fireEvent.click(screen.getByRole('button', { name: '크게 보기' }))
      const dialog = await screen.findByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })
      fireEvent.click(within(dialog).getByRole('button', { name: `${completed.name} 2단계로 되돌리기` }))

      const restored = await within(dialog).findByRole('row', { name: `${completed.name} 상품등록정보` })
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
      expect(within(dialog).getByRole('tab', { name: /2단계 상품등록정보/ })).toHaveAttribute('aria-selected', 'true')
      expect(within(restored).getByText('17,700원')).toBeInTheDocument()
      expect(within(restored).getByText('29,500원')).toBeInTheDocument()
      expect(within(restored).getByLabelText('품질표시 파일명 또는 공개 URL')).toHaveValue(completed.label)
      const body = savedBodies().at(-1)!
      expect(body.draft.rows[0]).toEqual({ ...completed, stage: 'information', registrationCompletedAt: undefined })
      expect(body.draft.rows[1]).toEqual(other)
      expect(body.draft.labels).toEqual(initial.labels)
      expect(body.draft.templates).toEqual(initial.templates)
      expect(screen.getByRole('dialog', { name: '쿠팡상품등록 · 크게 보기' })).toBe(dialog)
      expect(saved.id).toBe('draft-1')
    })

    it('selects completed products without saving and returns only selected products in one save', async () => {
      const fixture = downloadFixture()
      const first = confirmRegistration(fixture.first, '2026-11-24')
      const other = confirmRegistration(fixture.other, '2026-11-23')
      const untouched = confirmRegistration({ ...fixture.other, id: crypto.randomUUID(), name: '선택하지 않은 완료 상품' }, '2026-11-22')
      const initial = { ...fixture.draft, rows: [first, other, untouched] }
      const pending = deferSavedDraft(initial)
      await loadSavedWorkbench()
      const all = screen.getByRole('checkbox', { name: '등록완료 상품 전체 선택' })
      expect(all).not.toBeChecked()
      expect(screen.getByRole('button', { name: '선택 0개 2단계로 되돌리기' })).toBeDisabled()
      fireEvent.click(all)
      for (const row of initial.rows) expect(screen.getByRole('checkbox', { name: `${row.name} 선택` })).toBeChecked()
      fireEvent.click(all)
      for (const row of initial.rows) expect(screen.getByRole('checkbox', { name: `${row.name} 선택` })).not.toBeChecked()
      expect(savedBodies()).toHaveLength(0)
      fireEvent.click(screen.getByRole('checkbox', { name: `${first.name} 선택` }))
      fireEvent.click(screen.getByRole('checkbox', { name: `${other.name} 선택` }))
      fireEvent.click(screen.getByRole('button', { name: '선택 2개 2단계로 되돌리기' }))

      expect(screen.getByRole('tab', { name: /2단계 상품등록정보/ })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('row', { name: `${first.name} 상품등록정보` })).toBeInTheDocument()
      expect(screen.getByRole('row', { name: `${other.name} 상품등록정보` })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /3단계 등록완료/ })).toHaveTextContent('1개')
      await waitFor(() => expect(savedBodies()).toHaveLength(1))
      expect(savedBodies()[0].draft.rows).toEqual([
        { ...first, stage: 'information', registrationCompletedAt: undefined },
        { ...other, stage: 'information', registrationCompletedAt: undefined },
        untouched,
      ])
      expect(savedBodies()[0].draft.templates).toEqual(initial.templates)
      expect(savedBodies()[0].draft.labels).toEqual(initial.labels)
      pending.release()
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
      fireEvent.click(screen.getByRole('tab', { name: /3단계 등록완료/ }))
      expect(screen.getByRole('row', { name: `${untouched.name} 등록완료 정보` })).toBeInTheDocument()
      expect(screen.queryByRole('row', { name: `${first.name} 등록완료 정보` })).not.toBeInTheDocument()
    })

    it('restores completed products and their completion dates when a bulk return cannot be saved', async () => {
      const fixture = downloadFixture()
      const first = confirmRegistration(fixture.first, '2026-11-24')
      const other = confirmRegistration(fixture.other, '2026-11-23')
      const pending = deferSavedDraft({ ...fixture.draft, rows: [first, other] }, true)
      await loadSavedWorkbench()
      fireEvent.click(screen.getByRole('checkbox', { name: '등록완료 상품 전체 선택' }))
      fireEvent.click(screen.getByRole('button', { name: '선택 2개 2단계로 되돌리기' }))
      expect(screen.getByRole('row', { name: `${first.name} 상품등록정보` })).toBeInTheDocument()
      expect(screen.getByRole('row', { name: `${other.name} 상품등록정보` })).toBeInTheDocument()
      await waitFor(() => expect(savedBodies()).toHaveLength(1))
      pending.release()
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
      expect(screen.getByRole('tab', { name: /3단계 등록완료/ })).toHaveAttribute('aria-selected', 'true')
      for (const row of [first, other]) {
        const restored = screen.getByRole('row', { name: `${row.name} 등록완료 정보` })
        expect(within(restored).getByLabelText(`${row.name} 등록완료일`)).toHaveValue(row.registrationCompletedAt)
        expect(within(restored).getByText('17,700원')).toBeInTheDocument()
        expect(within(restored).getByText('29,500원')).toBeInTheDocument()
      }
    })

    it.each([false, true])('shows price confirmation immediately and preserves entered prices when save fails: %s', async fail => {
      const fixture = downloadFixture()
      const pricing = { ...fixture.first, stage: 'pricing' as const, priceConfirmedAt: undefined, manualSupplyPrice: 18000, manualSalePrice: 31000 }
      const pending = deferSavedDraft({ ...fixture.draft, rows: [pricing] }, fail)
      await loadSavedWorkbench()
      fireEvent.click(screen.getByRole('button', { name: `${pricing.name} 가격설정 완료` }))
      expect(screen.getByRole('tab', { name: /2단계 상품등록정보/ })).toHaveAttribute('aria-selected', 'true')
      const information = screen.getByRole('row', { name: `${pricing.name} 상품등록정보` })
      expect(within(information).getByText('18,000원')).toBeInTheDocument()
      expect(within(information).getByText('31,000원')).toBeInTheDocument()
      await waitFor(() => expect(savedBodies()).toHaveLength(1))
      expect(screen.getByRole('status')).toBeInTheDocument()
      const listsBefore = draftListRequests().length
      pending.release()
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
      expect(draftListRequests()).toHaveLength(listsBefore)
      if (fail) {
        expect(screen.getByRole('tab', { name: /1단계 판매가설정/ })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByLabelText(`${pricing.name} 쿠팡공급가`)).toHaveValue(18000)
        expect(screen.getByLabelText(`${pricing.name} 쿠팡판매가`)).toHaveValue(31000)
      } else {
        expect(screen.getByRole('tab', { name: /2단계 상품등록정보/ })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByRole('row', { name: `${pricing.name} 상품등록정보` })).toHaveTextContent('31,000원')
      }
    })

    it.each([false, true])('updates completion immediately and restores information after a failed save: %s', async fail => {
      const fixture = downloadFixture()
      const pending = deferSavedDraft(fixture.draft, fail)
      await loadSavedWorkbench()
      fireEvent.click(screen.getByRole('checkbox', { name: `${fixture.first.name} 등록완료` }))
      expect(screen.getByRole('tab', { name: /2단계 상품등록정보/ })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('row', { name: `${fixture.first.name} 상품등록정보` })).not.toBeInTheDocument()
      expect(screen.getByRole('row', { name: `${fixture.other.name} 상품등록정보` })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /3단계 등록완료/ })).toHaveTextContent('1개')
      await waitFor(() => expect(savedBodies()).toHaveLength(1))
      expect(savedBodies()[0].draft.rows[0]).toMatchObject({ stage: 'registered', fields: fixture.first.fields, manualSupplyPrice: 17700, manualSalePrice: 29500 })
      pending.release()
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
      if (fail) {
        const restored = screen.getByRole('row', { name: `${fixture.first.name} 상품등록정보` })
        expect(within(restored).getByLabelText('검색태그')).toHaveValue(fixture.first.fields[SEARCH_TAGS_FIELD])
        expect(within(restored).getByText('17,700원')).toBeInTheDocument()
        expect(within(restored).getByText('29,500원')).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: /3단계 등록완료/ })).toHaveTextContent('0개')
      } else {
        fireEvent.click(screen.getByRole('tab', { name: /3단계 등록완료/ }))
        expect(screen.getByRole('row', { name: `${fixture.first.name} 등록완료 정보` })).toBeInTheDocument()
      }
    })

    it('deletes only the confirmed completed row, persists explicit deletion metadata and keeps it deleted after reloading', async () => {
      const fixture = downloadFixture()
      const completed = confirmRegistration(fixture.first, '2026-11-24')
      const retained = confirmRegistration({ ...fixture.other, name: '남길 완료 상품' }, '2026-11-23')
      const initial = { ...fixture.draft, rows: [completed, retained, fixture.other] }
      const saved = await openSavedWorkbench(initial)
      fireEvent.click(screen.getByRole('tab', { name: /3단계 등록완료/ }))
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      fireEvent.click(screen.getByRole('button', { name: `${completed.name} 등록완료 목록에서 삭제` }))
      await waitFor(() => expect(screen.queryByRole('row', { name: `${completed.name} 등록완료 정보` })).not.toBeInTheDocument())
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining(completed.name))
      expect(savedBodies().at(-1)).toMatchObject({ deleteCompletedRowIds: [completed.id] })
      expect(savedBodies().at(-1)!.draft.rows).toEqual([retained, fixture.other])
      expect(savedBodies().at(-1)!.draft.labels).toEqual(initial.labels)
      expect(savedBodies().at(-1)!.draft.templates).toEqual(initial.templates)
      await waitFor(() => expect(screen.getByRole('button', { name: '새 작업', exact: true })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: '새 작업', exact: true }))
      fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
      await screen.findByRole('row', { name: `${fixture.other.name} 상품등록정보` })
      fireEvent.click(screen.getByRole('tab', { name: /3단계 등록완료/ }))
      expect(screen.queryByRole('row', { name: `${completed.name} 등록완료 정보` })).not.toBeInTheDocument()
      expect(screen.getByRole('row', { name: `${retained.name} 등록완료 정보` })).toBeInTheDocument()
    })

    it('keeps a completed row without posting when its deletion is cancelled', async () => {
      const fixture = downloadFixture()
      const completed = confirmRegistration(fixture.first, '2026-11-24')
      await openSavedWorkbench({ ...fixture.draft, rows: [completed] })
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      fireEvent.click(screen.getByRole('button', { name: `${completed.name} 등록완료 목록에서 삭제` }))
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(savedBodies()).toHaveLength(0)
      expect(screen.getByRole('row', { name: `${completed.name} 등록완료 정보` })).toBeInTheDocument()
    })

    it('keeps the completed list intact when deletion cannot be saved', async () => {
      const fixture = downloadFixture()
      const completed = confirmRegistration(fixture.first, '2026-11-24')
      const other = confirmRegistration(fixture.other, '2026-11-23')
      mockSavedDraft({ ...fixture.draft, rows: [completed, other] })
      const fallback = vi.mocked(fetch)
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/drafts') && init?.method === 'POST'
        ? { ok: false, status: 409, json: async () => ({ error: '새로운 저장 내용이 있습니다.' }) }
        : fallback(url, init)))
      await loadSavedWorkbench()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      fireEvent.click(screen.getByRole('button', { name: `${completed.name} 등록완료 목록에서 삭제` }))
      await waitFor(() => expect(savedBodies()).toHaveLength(1))
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
      expect(screen.getByRole('row', { name: `${completed.name} 등록완료 정보` })).toBeInTheDocument()
      expect(screen.getByRole('row', { name: `${other.name} 등록완료 정보` })).toBeInTheDocument()
    })

    it('disables completed-row deletion for a verified legacy Supplier Hub receipt', async () => {
      const fixture = downloadFixture()
      const completed = {
        ...confirmRegistration(fixture.first, '2026-11-24'),
        submission: { status: 'succeeded' as const, completedAt: '2026-11-24T01:00:00.000Z', receiptId: 'verified-receipt' },
      }
      await openSavedWorkbench({ ...fixture.draft, rows: [completed] })
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const button = screen.getByRole('button', { name: `${completed.name} 등록완료 목록에서 삭제` })
      expect(button).toBeDisabled()
      fireEvent.click(button)
      expect(confirm).not.toHaveBeenCalled()
      expect(savedBodies()).toHaveLength(0)
    })

    it('waits for save and downloads all stage-two products from the server-saved draft, excluding other stages', async () => {
      const fixture = downloadFixture()
      const otherInformation = { ...fixture.other, priceConfirmedAt: '2026-11-21T00:00:00.000Z' }
      const completed = confirmRegistration({ ...fixture.other, id: crypto.randomUUID(), name: '완료된 별도 상품' }, '2026-11-20')
      const pricing = { ...createRegistrationRow(second, '블랙'), name: '가격 설정 중 상품' }
      const initial = { ...fixture.draft, rows: [fixture.first, otherInformation, completed, pricing] }
      mockSavedDraft(initial)
      const fallback = vi.mocked(fetch)
      let releaseSave!: () => void
      const pendingSave = new Promise<void>(resolve => { releaseSave = resolve })
      const serverName = '서버가 저장한 작업 이름'
      const filename = '쿠팡등록_원본.xlsx'
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/export')) return downloadResponse(filename)
        if (url.endsWith('/drafts') && init?.method === 'POST') {
          await pendingSave
          const response = await fallback(url, init)
          const body = await response.json()
          return { ...response, json: async () => ({ ...body, payload: { ...body.payload, name: serverName } }) }
        }
        return fallback(url, init)
      }))
      const browser = mockDownloadBrowser()
      await loadSavedWorkbench()
      fireEvent.click(screen.getByRole('tab', { name: /2단계 상품등록정보/ }))
      expect(await screen.findByRole('row', { name: `${otherInformation.name} 상품등록정보` })).toBeInTheDocument()
      expect(screen.queryByRole('row', { name: `${completed.name} 상품등록정보` })).not.toBeInTheDocument()
      expect(screen.queryByRole('row', { name: `${pricing.name} 상품등록정보` })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '엑셀 다운로드' }))
      await waitFor(() => expect(savedBodies()).toHaveLength(1))
      expect(exportBodies()).toHaveLength(0)
      expect(browser.createObjectURL).not.toHaveBeenCalled()
      releaseSave()
      await waitFor(() => expect(browser.clicks).toHaveLength(1))
      expect(exportBodies()).toEqual([{ draft: { ...savedBodies()[0].draft, name: serverName }, rowIds: [fixture.first.id, otherInformation.id] }])
      expect(savedBodies()[0].draft.rows.map(row => row.id)).toEqual(initial.rows.map(row => row.id))
      expect(browser.clicks[0]).toEqual({ download: filename, href: 'blob:official-download' })
      expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:official-download')
    })

    it('exports only selected stage-two row IDs and uses a ZIP filename returned by the server', async () => {
      const fixture = downloadFixture()
      mockSavedDraft(fixture.draft)
      const fallback = vi.mocked(fetch)
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/export') ? downloadResponse('카테고리별_엑셀.zip', true) : fallback(url, init)))
      const browser = mockDownloadBrowser()
      await loadSavedWorkbench()
      fireEvent.click(screen.getByRole('checkbox', { name: `${fixture.other.name} 선택` }))
      fireEvent.click(screen.getByRole('button', { name: '선택 1개 엑셀 다운로드' }))
      await waitFor(() => expect(browser.clicks).toHaveLength(1))
      expect(exportBodies()).toHaveLength(1)
      expect(exportBodies()[0].rowIds).toEqual([fixture.other.id])
      expect(exportBodies()[0].draft.rows).toHaveLength(2)
      expect(browser.clicks[0].download).toBe('카테고리별_엑셀.zip')
    })

    it('does not export or create a download when saving the draft fails with a revision conflict', async () => {
      const fixture = downloadFixture()
      mockSavedDraft(fixture.draft)
      const fallback = vi.mocked(fetch)
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/drafts') && init?.method === 'POST'
        ? { ok: false, status: 409, json: async () => ({ error: '새로운 저장 내용이 있습니다.' }) }
        : fallback(url, init)))
      const browser = mockDownloadBrowser()
      await loadSavedWorkbench()
      fireEvent.click(screen.getByRole('button', { name: '엑셀 다운로드' }))
      await waitFor(() => expect(savedBodies()).toHaveLength(1))
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
      expect(exportBodies()).toHaveLength(0)
      expect(browser.createObjectURL).not.toHaveBeenCalled()
      expect(screen.getByRole('row', { name: `${fixture.first.name} 상품등록정보` })).toBeInTheDocument()
    })
  })
})

function manualTemplate(id: string, name: string, sheetName: string, columns: TemplateSheet['columns']): RegistrationDraft['templates'][number] {
  return { id, name, file: { name, data: '' }, sheets: [{ name: sheetName, columns }] }
}

function savedBodies(): Array<{ draft: RegistrationDraft; deleteCompletedRowIds?: string[] }> {
  return vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)))
}

function draftListRequests() {
  return vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/drafts') && init?.method !== 'POST')
}

function deferSavedDraft(initial: RegistrationDraft, fail = false) {
  mockSavedDraft(initial)
  const fallback = vi.mocked(fetch)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/drafts') && init?.method === 'POST') {
      await pending
      if (fail) return { ok: false, status: 409, json: async () => ({ error: '새로운 저장 내용이 있습니다.' }) }
    }
    return fallback(url, init)
  }))
  return { release }
}

function downloadFixture() {
  const template = manualTemplate('download-template', '저장한_원본.xlsx', 'QF_99_저장양식', [
    { column: 1, label: '상품명', requirement: '필수', guide: '' },
    { column: 2, label: '공급가', requirement: '필수', guide: '' },
    { column: 3, label: '쿠팡 판매가', requirement: '필수', guide: '' },
  ])
  template.file.data = 'b3JpZ2luYWw='
  const makeRow = (name: string): RegistrationRow => ({
    ...confirmPricing({ ...createRegistrationRow(source, '베이지'), name, sourceCode: '', priceMode: 'manual', manualSupplyPrice: 17700, saleMode: 'manual', manualSalePrice: 29500 }, 1, '2026-11-20T00:00:00.000Z'),
    templateId: template.id, sheetName: template.sheets[0].name, label: '보존할_품질표시.jpg',
    fields: { 브랜드: '보존할 브랜드', [SEARCH_TAGS_FIELD]: '보존할 검색태그', [WARRANTY_FIELD]: WARRANTY_DEFAULT, [AS_CONTACT_FIELD]: AS_CONTACT_DEFAULT },
  })
  const first = makeRow('먼저 완료할 상품')
  const other = makeRow('다른 상품')
  const draft = { ...blankDraft(), name: '다운로드할 작업', rows: [first, other], templates: [template], labels: [{ name: '보존할_품질표시.jpg', data: 'aW1hZ2U=' }] }
  expect(rowIssues(first, draft)).toEqual([])
  expect(rowIssues(other, draft)).toEqual([])
  return { draft, first, other }
}

async function openSavedWorkbench(initial: RegistrationDraft) {
  const saved = mockSavedDraft(initial)
  await loadSavedWorkbench()
  return saved
}

async function loadSavedWorkbench() {
  render(<CoupangRegistrationWorkbench />)
  await screen.findByRole('option', { name: /단계 작업/ })
  fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: 'draft-1' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '새 작업으로 저장' })).toBeEnabled())
}

function exportBodies(): Array<{ draft: RegistrationDraft; rowIds: string[] }> {
  return vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/export') && init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)))
}

function downloadResponse(filename: string, zip = false) {
  const type = zip ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { ok: true, headers: new Headers({ 'Content-Type': type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }), blob: async () => new Blob(['official-download-bytes'], { type }) }
}

function mockDownloadBrowser() {
  const createObjectURL = vi.fn(() => 'blob:official-download')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }))
  const clicks: Array<{ download: string; href: string }> = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { clicks.push({ download: this.download, href: this.href }) })
  return { clicks, createObjectURL, revokeObjectURL }
}

async function openCatalogSearch(query: string) {
  await waitFor(() => expect(screen.getByLabelText('상품 검색어')).toBeEnabled())
  fireEvent.change(screen.getByLabelText('상품 검색어'), { target: { value: query } })
  await waitFor(() => expect(screen.getByRole('button', { name: '상품 검색' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '상품 검색' }))
  return screen.findByRole('dialog', { name: 'B2B 상품 검색' })
}

async function openCategoryPicker(row: HTMLElement) {
  const trigger = within(row).getByRole('button', { name: '업로드한 카테고리 양식' })
  await waitFor(() => expect(trigger).toBeEnabled())
  fireEvent.click(trigger)
  return screen.findByRole('dialog', { name: '카테고리 엑셀 양식 선택' })
}

async function chooseUploadedSheet(name: string, template: RegistrationDraft['templates'][number], sheetName = template.sheets[0].name) {
  const picker = await openCategoryPicker(screen.getByRole('row', { name: name + ' 상품등록정보' }))
  fireEvent.change(within(picker).getByRole('textbox', { name: '카테고리 양식 검색' }), { target: { value: template.name } })
  fireEvent.click(await within(picker).findByRole('button', { name: `${sheetName} · ${template.name} 선택` }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '카테고리 엑셀 양식 선택' })).not.toBeInTheDocument())
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
}

function mockSavedDraft(initial: RegistrationDraft) {
  const saved = { id: 'draft-1', name: '단계 작업', revision: 1, updatedAt: '2026-11-23' }
  let payload = initial
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => {
      if (url.endsWith('/drafts') && init?.method === 'POST') { payload = JSON.parse(String(init.body)).draft; return { ...saved, payload } }
      if (url.includes('?id=') || url.includes('/submissions?')) return { ...saved, payload, submissions: [], transfers: [] }
      if (url.endsWith('/sheet-mappings')) return { mappings: [] }
      if (url.includes('/category-context?')) return { context: { sourceCode: new URL(url, 'http://localhost').searchParams.get('code'), productName: '', categoryName: '', categoryPath: '', keywords: [], queries: [] } }
      if (url.endsWith('/costs')) return { costs: [] }
      if (url.endsWith('/catalog') && init?.method === 'POST') return { products: [source, second] }
      if (url.includes('/catalog?code=')) return { product: url.includes(second.code) ? second : source }
      if (url.includes('/catalog?q=')) return { products: [source, second] }
      return { drafts: [saved] }
    },
  })))
  return saved
}
