import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CoupangRegistrationWorkbench } from '@/app/(auth)/operations/coupang-registration/workbench'
import { blankDraft, confirmPricing, createRegistrationRow, registrationFieldKey, type RegistrationDraft, type TemplateSheet } from '@/lib/coupang-registration/model'
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
  it('builds one registration row from searched components and saves their quantities', async () => {
    render(<CoupangRegistrationWorkbench />)
    fireEvent.click(screen.getByRole('button', { name: '새 빈 세트 만들기' }))
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
    fireEvent.click(await within(dialog).findByLabelText('마미백 플러스 베이지 선택'))
    fireEvent.click(within(dialog).getByRole('button', { name: '선택 상품 1개 추가' }))
    await screen.findByLabelText('마미백 플러스 베이지 원가')
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
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const dialog = screen.getByRole('dialog', { name: 'B2B 상품 검색' })
    fireEvent.change(within(dialog).getByLabelText('B2B 상품명 또는 코드'), { target: { value: '테이블' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '검색' }))
    fireEvent.click(await within(dialog).findByLabelText('마미백 플러스 베이지 선택'))
    fireEvent.click(within(dialog).getByLabelText('루멘 철제 사이드 테이블 블랙 선택'))
    fireEvent.click(within(dialog).getByRole('button', { name: '선택 상품 2개 추가' }))

    expect(await screen.findByLabelText('마미백 플러스 베이지 원가')).toHaveValue(10000)
    expect(screen.getByLabelText('루멘 철제 사이드 테이블 블랙 원가')).toHaveValue(12000)
    expect(within(dialog).getByText('선택한 상품·옵션 0개')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '상품 검색 닫기' }))
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const reopened = screen.getByRole('dialog', { name: 'B2B 상품 검색' })
    fireEvent.change(within(reopened).getByLabelText('B2B 상품명 또는 코드'), { target: { value: '테이블' } })
    fireEvent.click(within(reopened).getByRole('button', { name: '검색' }))
    expect(await within(reopened).findByLabelText('마미백 플러스 베이지 선택')).toBeDisabled()
    expect(within(reopened).getByLabelText('루멘 철제 사이드 테이블 블랙 선택')).toBeDisabled()
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
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const dialog = screen.getByRole('dialog', { name: 'B2B 상품 검색' })
    fireEvent.change(within(dialog).getByLabelText('B2B 상품명 또는 코드'), { target: { value: '테이블' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '검색' }))
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
    expect(screen.queryByLabelText('브랜드 *')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '엑셀로 출력' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '마미백 플러스 베이지 가격설정 완료' }))
    const editor = await screen.findByRole('region', { name: '마미백 플러스 베이지 상품등록정보' })
    expect(screen.getByRole('tab', { name: /2단계 상품등록정보/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByLabelText('마미백 플러스 베이지 쿠팡공급가')).not.toBeInTheDocument()
    expect(within(editor).getByLabelText('브랜드')).toHaveValue('생활살림')
    expect(within(editor).getByLabelText('제조국')).toHaveValue('중국')
    fireEvent.change(within(editor).getByLabelText('브랜드'), { target: { value: '생활살림' } })
    expect(screen.queryByLabelText('고시명 *')).not.toBeInTheDocument()
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

  it('expands all information products inline without invoking Hub automation or exposing Excel output', async () => {
    const first = confirmPricing(createRegistrationRow(source, '베이지'))
    const other = confirmPricing(createRegistrationRow(second, '블랙'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [first, other] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const firstCard = await screen.findByRole('region', { name: `${first.name} 상품등록정보` })
    const secondCard = screen.getByRole('region', { name: `${other.name} 상품등록정보` })
    expect(within(firstCard).getByLabelText('등록 상품명')).toHaveValue(first.name)
    expect(within(secondCard).getByLabelText('등록 상품명')).toHaveValue(other.name)
    expect(within(firstCard).getByLabelText('브랜드')).toBeEnabled()
    expect(within(secondCard).getByLabelText('브랜드')).toBeEnabled()
    expect(screen.queryByRole('button', { name: '등록정보 입력', exact: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '상품등록', exact: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /엑셀.*출력|엑셀.*생성|엑셀.*다운로드/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /등록 확장|서플라이어허브/ })).not.toBeInTheDocument()
    for (const command of [pingSupplierExtension, searchSupplierCategories, getSupplierCategoryTemplate, startSupplierRegistration, subscribeSupplierRegistration]) expect(command).not.toHaveBeenCalled()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /\/(export|submit|submissions|category-context|category-template)(?:\?|$)/.test(String(url)))).toBe(false)
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
    const card = await screen.findByRole('region', { name: `${row.name} 상품등록정보` })
    fireEvent.change(within(card).getByLabelText('브랜드'), { target: { value: '직접 입력한 브랜드' } })
    fireEvent.change(within(card).getByLabelText('제조국'), { target: { value: '미국' } })
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => expect(savedBodies().at(-1)?.draft.rows[0].fields).toMatchObject({ 브랜드: '직접 입력한 브랜드', 제조국: '미국' }))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.change(within(card).getByLabelText(`${row.name} 카테고리 엑셀 파일`), { target: { files: [new File(['official'], template.name)] } })
    expect(await within(card).findByLabelText('인증정보 *')).toHaveValue('')
    expect(within(card).queryByLabelText('제조국 *')).not.toBeInTheDocument()
    expect(within(card).getByLabelText('브랜드 *')).toHaveValue('직접 입력한 브랜드')
    expect(within(card).getByRole('list')).toHaveTextContent('인증정보 누락')
    fireEvent.change(within(card).getByLabelText('인증정보 *'), { target: { value: '사용자 확인 정보' } })
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => {
      const body = savedBodies().at(-1)
      expect(body?.draft.name).toBe(initial.name)
      expect(body?.draft.labels).toEqual(initial.labels)
      expect(body?.draft.rows).toHaveLength(1)
      expect(body?.draft.rows[0]).toMatchObject({ id: row.id, templateId: template.id, sheetName: template.sheets[0].name, manualSupplyPrice: 17700, manualSalePrice: 29500, label: row.label, fields: { 브랜드: '직접 입력한 브랜드', 제조국: '미국', 인증정보: '사용자 확인 정보' } })
    })
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
    const firstCard = await screen.findByRole('region', { name: `${first.name} 상품등록정보` })
    const otherCard = screen.getByRole('region', { name: `${other.name} 상품등록정보` })
    fireEvent.change(within(firstCard).getByLabelText(`${first.name} 카테고리 엑셀 파일`), { target: { files: [new File(['first'], firstTemplate.name)] } })
    expect(await within(firstCard).findByLabelText('가방종류 *')).toHaveValue('')
    expect(within(otherCard).queryByLabelText('가방종류 *')).not.toBeInTheDocument()
    fireEvent.change(within(otherCard).getByLabelText(`${other.name} 카테고리 엑셀 파일`), { target: { files: [new File(['other'], otherTemplate.name)] } })
    expect(await within(otherCard).findByLabelText('가구재질 *')).toHaveValue('')
    expect(within(firstCard).queryByLabelText('가구재질 *')).not.toBeInTheDocument()
    fireEvent.change(within(firstCard).getByLabelText('가방종류 *'), { target: { value: '숄더백' } })
    fireEvent.change(within(otherCard).getByLabelText('가구재질 *'), { target: { value: '철제' } })
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

  it('treats the global category upload as metadata only and requires an explicit row assignment', async () => {
    const row = confirmPricing(createRegistrationRow(source, '베이지'))
    const saved = mockSavedDraft({ ...blankDraft(), rows: [row] })
    const template = manualTemplate('global-template', '전체연결원본.xlsx', 'QF_3_가방', [{ column: 1, label: '상품명', requirement: '필수', guide: '' }, { column: 2, label: '전용정보', requirement: '필수', guide: '' }])
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/template') ? { ok: true, json: async () => ({ template, rows: [createRegistrationRow(second, '파일 속 예시')] }) } : fallback(url, init)))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByRole('region', { name: `${row.name} 상품등록정보` })
    fireEvent.change(screen.getByLabelText('카테고리 엑셀 파일', { exact: true }), { target: { files: [new File(['global'], template.name)] } })
    await screen.findAllByRole('option', { name: new RegExp(template.name.replace('.', '\\.')) })
    expect(screen.queryByLabelText('전용정보 *')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => {
      const body = savedBodies().at(-1)
      expect(body?.draft.rows).toHaveLength(1)
      expect(body?.draft.rows[0]).toMatchObject({ id: row.id, templateId: '', sheetName: '' })
      expect(body?.draft.templates).toHaveLength(1)
    })
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
    const card = await screen.findByRole('region', { name: `${row.name} 상품등록정보` })
    const liveFiles: File[] = [new File(['official'], template.name)]
    fireEvent.change(within(card).getByLabelText(`${row.name} 카테고리 엑셀 파일`), { target: { files: liveFiles } })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/template'))).toBe(true))
    liveFiles.length = 0
    finish({ ok: true, json: async () => ({ template, rows: [] }) })
    expect(await within(card).findByLabelText('공식필수값 *')).toHaveValue('')
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
    const card = await screen.findByRole('region', { name: `${row.name} 상품등록정보` })
    const assembly = within(card).getByLabelText('설치지원방식', { exact: true })
    const installation = within(card).getByLabelText('설치지원방식 (조건부)')
    expect(assembly).toHaveValue('완전 조립')
    expect(installation).toHaveValue('고객직접설치')
    const colors = within(card).getAllByLabelText('색상 *')
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
    const restored = await screen.findByRole('region', { name: `${row.name} 상품등록정보` })
    expect(within(restored).getByLabelText('설치지원방식', { exact: true })).toHaveValue('조립 필요')
    expect(within(restored).getByLabelText('설치지원방식 (조건부)')).toHaveValue('방문설치')
    expect(within(restored).getAllByLabelText('색상 *')[0]).toHaveValue('')
    expect(within(restored).getAllByLabelText('색상 *')[1]).toHaveValue('흰색')
  })
})

function manualTemplate(id: string, name: string, sheetName: string, columns: TemplateSheet['columns']): RegistrationDraft['templates'][number] {
  return { id, name, file: { name, data: '' }, sheets: [{ name: sheetName, columns }] }
}

function savedBodies(): Array<{ draft: RegistrationDraft }> {
  return vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)))
}

function mockSavedDraft(initial: RegistrationDraft) {
  const saved = { id: 'draft-1', name: '단계 작업', revision: 1, updatedAt: '2026-11-23' }
  let payload = initial
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => {
      if (url.endsWith('/drafts') && init?.method === 'POST') { payload = JSON.parse(String(init.body)).draft; return { ...saved, payload } }
      if (url.includes('?id=') || url.includes('/submissions?')) return { ...saved, payload, submissions: [], transfers: [] }
      if (url.endsWith('/costs')) return { costs: [] }
      return { drafts: [saved] }
    },
  })))
  return saved
}
