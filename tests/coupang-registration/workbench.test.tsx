import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CoupangRegistrationWorkbench } from '@/app/(auth)/operations/coupang-registration/workbench'
import { blankDraft, confirmPricing, createRegistrationRow, type RegistrationDraft, type RegistrationRow } from '@/lib/coupang-registration/model'
import { pingSupplierExtension, startSupplierRegistration, subscribeSupplierRegistration } from '@/lib/coupang-registration/supplier-bridge'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/coupang-registration/supplier-bridge', () => ({ checkSupplierRegistration: vi.fn(async () => ({ started: true })), pingSupplierExtension: vi.fn(async () => ({ connected: true })), startSupplierRegistration: vi.fn(async () => ({ started: true })), subscribeSupplierRegistration: vi.fn(() => () => undefined) }))
const source = { code: '1471', name: '마미백 플러스', price: 15000, status: 'SELLING', thumbnails: ['https://cdn.tapeoff.kr/front.jpg'], detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], options: [{ name: '베이지', addPrice: 0 }], notice: [], costCandidates: [{ sku: '112361-0001', name: '마미백 플러스', optionName: '베이지', costPrice: 10000 }] }
const second = {
  code: '1472', name: '루멘 철제 사이드 테이블', price: 20000, status: 'SELLING', thumbnails: [], detailImages: [],
  options: [{ name: '블랙', addPrice: 1000 }], notice: [], costCandidates: [{ sku: '112362-0001', name: '루멘 철제 사이드 테이블', optionName: '블랙', costPrice: 12000 }],
}

describe('registration pricing workbench', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    const draft = informationTemplate({ ...blankDraft(), rows: [row] })
    const saved = mockSavedDraft(draft)
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByLabelText('마미백 플러스 베이지 쿠팡공급가')
    expect(screen.queryByLabelText('브랜드 *')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '엑셀로 출력' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '마미백 플러스 베이지 가격설정 완료' }))
    const editorButton = await screen.findByRole('button', { name: '마미백 플러스 베이지 등록정보 입력' })
    expect(screen.getByRole('tab', { name: /2단계 상품등록정보/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByLabelText('마미백 플러스 베이지 쿠팡공급가')).not.toBeInTheDocument()
    fireEvent.click(editorButton)
    fireEvent.change(screen.getByLabelText('브랜드 *'), { target: { value: '생활살림' } })
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

  it('connects an empty category list without importing the workbook example products', async () => {
    const row = { ...confirmPricing(createRegistrationRow(source, '베이지')), manualSupplyPrice: 17700, label: '내 라벨.jpg', fields: { 브랜드: '사용자 브랜드' } }
    const initial = { ...blankDraft(), name: '가격설정 마친 작업', rows: [row], labels: [{ name: '내 라벨.jpg', data: 'kept' }] }
    const template = informationTemplate(blankDraft()).templates[0]
    const saved = mockSavedDraft(initial)
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/templates')) return { ok: true, json: async () => ({ templates: [] }) }
      if (url.endsWith('/template')) return { ok: true, json: async () => ({ template, rows: [createRegistrationRow(second, '블랙')] }) }
      return fallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    fireEvent.click(await screen.findByRole('button', { name: `${row.name} 등록정보 입력` }))
    const editor = screen.getByRole('region', { name: '상품등록정보 입력' })
    expect(within(editor).getByRole('option', { name: '연결된 쿠팡 카테고리 없음' })).toBeDisabled()
    expect(within(editor).getByRole('link', { name: '서플라이어허브에서 양식 받기' })).toHaveAttribute('href', 'https://supplier.coupang.com/qvt/registration')
    expect(screen.queryByLabelText('브랜드 *')).not.toBeInTheDocument()
    const input = screen.getByLabelText('쿠팡 견적서 파일')
    const pickFile = vi.spyOn(input, 'click')
    fireEvent.click(within(editor).getByRole('button', { name: '카테고리 양식 연결' }))
    expect(pickFile).toHaveBeenCalledOnce()
    fireEvent.change(input, { target: { files: [new File(['official'], template.name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })] } })
    await within(editor).findByRole('option', { name: '가방' })
    expect(screen.queryByLabelText('브랜드 *')).not.toBeInTheDocument()
    fireEvent.change(within(editor).getByLabelText('쿠팡 카테고리 양식'), { target: { value: 'template-1:QF_1_가방' } })
    expect(await within(editor).findByLabelText('브랜드 *')).toHaveValue('사용자 브랜드')
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      expect(call).toBeDefined()
      const body = JSON.parse(String(call![1]!.body))
      expect(body.id).toBe(saved.id)
      expect(body.revision).toBe(1)
      expect(body.draft).toEqual({ ...initial, templates: [template], rows: [{ ...row, templateId: template.id, sheetName: template.sheets[0].name }] })
    })
    pickFile.mockRestore()
  })

  it('reuses a saved category file for one row while preserving current draft data', async () => {
    const row = { ...confirmPricing(createRegistrationRow(source, '베이지')), name: '수정 상품명', label: '내 라벨.jpg', fields: { 브랜드: '직접입력' }, manualSupplyPrice: 16700 }
    const untouched = confirmPricing(createRegistrationRow(second, '블랙'))
    const existing = { ...informationTemplate(blankDraft()).templates[0], id: 'existing-template', sheets: [{ name: 'QF_2_가구', columns: [] }] }
    const template = informationTemplate(blankDraft()).templates[0]
    const initial = { ...blankDraft(), name: '내 작업명', rows: [row, untouched], templates: [existing], labels: [{ name: '내 라벨.jpg', data: 'kept' }] }
    const saved = mockSavedDraft(initial)
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/templates')) return { ok: true, json: async () => ({ templates: [{ id: template.id, name: template.name, sheets: template.sheets.map(({ name }) => ({ name })) }] }) }
      if (url.includes('/templates?id=')) return { ok: true, json: async () => ({ template }) }
      return fallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    fireEvent.click(await screen.findByRole('button', { name: `${row.name} 등록정보 입력` }))
    const select = screen.getByLabelText('쿠팡 카테고리 양식')
    expect(within(select).getByRole('option', { name: '가구' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: '가방' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: `${template.id}:${template.sheets[0].name}` } })
    expect(await screen.findByLabelText('브랜드 *')).toHaveValue('직접입력')
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      expect(call).toBeDefined()
      const body = JSON.parse(String(call![1]!.body))
      expect(body).toMatchObject({ id: saved.id, revision: 1 })
      expect(body.draft).toEqual({ ...initial, templates: [existing, template], rows: [{ ...row, templateId: template.id, sheetName: template.sheets[0].name }, untouched] })
    })
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/templates'))).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/templates?id='))).toHaveLength(1)
  })

  it('connects a library choice before bulk applying it and skips duplicate files', async () => {
    const initial = { ...blankDraft(), rows: [confirmPricing(createRegistrationRow(source, '베이지')), confirmPricing(createRegistrationRow(second, '블랙'))] }
    const template = informationTemplate(blankDraft()).templates[0]
    const saved = mockSavedDraft(initial)
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/templates')) return { ok: true, json: async () => ({ templates: [template] }) }
      if (url.includes('/templates?id=')) return { ok: true, json: async () => ({ template }) }
      return fallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const bulk = await screen.findByLabelText('일괄 카테고리')
    fireEvent.change(bulk, { target: { value: `${template.id}:${template.sheets[0].name}` } })
    await waitFor(() => expect(bulk).toHaveValue(`${template.id}:${template.sheets[0].name}`))
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      expect(call).toBeDefined()
      expect(JSON.parse(String(call![1]!.body)).draft).toEqual({ ...initial, templates: [template] })
    })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('보이는 상품 전체 선택'))
    fireEvent.click(screen.getByRole('button', { name: '카테고리 적용' }))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      expect(calls).toHaveLength(2)
      const { draft } = JSON.parse(String(calls.at(-1)![1]!.body))
      expect(draft.templates).toEqual([template])
      expect(draft.rows).toEqual(initial.rows.map((row) => ({ ...row, templateId: template.id, sheetName: template.sheets[0].name })))
    })
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/templates?id='))).toHaveLength(1)
  })

  it('keeps the six-template limit while allowing reuse of a connected category', async () => {
    const template = informationTemplate(blankDraft()).templates[0]
    const templates = Array.from({ length: 6 }, (_, index) => ({ ...template, id: `connected-${index}`, sheets: [{ ...template.sheets[0], name: `QF_${index}_기존${index}` }] }))
    const initial = { ...blankDraft(), rows: [confirmPricing(createRegistrationRow(source, '베이지'))], templates }
    const saved = mockSavedDraft(initial)
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/templates')) return { ok: true, json: async () => ({ templates: [template] }) }
      return fallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    const bulk = await screen.findByLabelText('일괄 카테고리')
    fireEvent.change(bulk, { target: { value: `${template.id}:${template.sheets[0].name}` } })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(bulk).toHaveValue('')
    fireEvent.change(bulk, { target: { value: 'connected-0:QF_0_기존0' } })
    await waitFor(() => expect(bulk).toHaveValue('connected-0:QF_0_기존0'))
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      expect(call).toBeDefined()
      expect(JSON.parse(String(call![1]!.body)).draft).toEqual(initial)
    })
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/templates?id='))).toBe(false)
  })

  it('continues importing workbook product rows from the original quotation import button', async () => {
    const initial = { ...blankDraft(), rows: [createRegistrationRow(source, '베이지')] }
    const template = informationTemplate(blankDraft()).templates[0]
    const imported = { ...createRegistrationRow(second, '블랙'), templateId: template.id, sheetName: template.sheets[0].name }
    const saved = mockSavedDraft(initial)
    const fallback = vi.mocked(fetch)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/template')) return { ok: true, json: async () => ({ template, rows: [imported] }) }
      return fallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    await screen.findByLabelText('마미백 플러스 베이지 쿠팡공급가')
    fireEvent.click(screen.getByRole('button', { name: '쿠팡 견적서 불러오기' }))
    fireEvent.change(screen.getByLabelText('쿠팡 견적서 파일'), { target: { files: [new File(['official'], template.name)] } })
    await screen.findByLabelText('루멘 철제 사이드 테이블 블랙 쿠팡공급가')
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      expect(call).toBeDefined()
      expect(JSON.parse(String(call![1]!.body)).draft).toEqual({ ...initial, templates: [template], rows: [...initial.rows, imported] })
    })
  })

  it('shows only receipt-confirmed successful products in the registered list', async () => {
    const complete: RegistrationRow = { ...confirmPricing(createRegistrationRow(source, '베이지')), stage: 'registered', registeredAt: '2026-11-23T03:00:00Z', submission: { jobId: 'job-1', status: 'succeeded', completedAt: '2026-11-23T03:00:00Z', receiptId: 'sku-123', receiptUrl: 'https://supplier.coupang.com/qvt/registration' } }
    const failed: RegistrationRow = { ...confirmPricing(createRegistrationRow(second, '블랙')), stage: 'registered', submission: { jobId: 'job-2', status: 'failed', message: '검증 실패' } }
    const saved = mockSavedDraft({ ...blankDraft(), rows: [complete, failed] })
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    fireEvent.click(await screen.findByRole('tab', { name: /3단계 등록완료/ }))
    expect(screen.getByRole('tabpanel', { name: '등록완료' })).toHaveTextContent('마미백 플러스 베이지')
    expect(screen.getByRole('tabpanel', { name: '등록완료' })).not.toHaveTextContent('루멘 철제 사이드 테이블 블랙')
    expect(screen.getByRole('link', { name: '허브 결과' })).toHaveAttribute('href', complete.submission!.receiptUrl)
    expect(screen.queryByRole('button', { name: /완료 처리|등록완료로 이동/ })).not.toBeInTheDocument()
  })

  it('does not queue a Supplier Hub registration when the browser extension is unavailable', async () => {
    vi.mocked(pingSupplierExtension).mockResolvedValue({ connected: false })
    const row = { ...confirmPricing(createRegistrationRow(source, '베이지')), fields: { 브랜드: '생활살림' } }
    const saved = mockSavedDraft(informationTemplate({ ...blankDraft(), rows: [row] }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    expect(await screen.findByRole('button', { name: '상품등록' })).toBeDisabled()
    expect(screen.getByText('쿠팡 등록 확장 연결 필요')).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/submit'))).toBe(false)
  })

  it('starts the extension and moves a product only after the server verifies its receipt', async () => {
    const row = { ...confirmPricing(createRegistrationRow(source, '베이지')), fields: { 브랜드: '생활살림' } }
    const initial = informationTemplate({ ...blankDraft(), rows: [row] })
    const saved = mockSavedDraft(initial)
    const fallback = vi.mocked(fetch)
    const transfer = { jobId: 'job-1', token: 'token-1', files: [{ name: '견적서.xlsx', data: '', kind: 'workbook' as const }], rows: [{ id: row.id, name: row.name }] }
    const queued: RegistrationDraft = { ...initial, rows: initial.rows.map((item) => ({ ...item, submission: { jobId: transfer.jobId, status: 'queued' } })) }
    const completed: RegistrationDraft = { ...initial, rows: initial.rows.map((item) => ({ ...item, stage: 'registered', registeredAt: '2026-11-23T03:00:00Z', submission: { jobId: transfer.jobId, status: 'succeeded', completedAt: '2026-11-23T03:00:00Z', receiptId: 'SKU-123' } })) }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/submit')) return { ok: true, json: async () => ({ ...saved, revision: 2, payload: queued, transfer }) }
      if (url.endsWith('/submissions') && init?.method === 'POST') return { ok: true, json: async () => ({ ...saved, revision: 3, payload: completed, submissions: [] }) }
      return fallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    fireEvent.click(await screen.findByRole('button', { name: '상품등록' }))
    await waitFor(() => expect(startSupplierRegistration).toHaveBeenCalledWith(transfer))
    expect(screen.getByRole('tab', { name: /3단계 등록완료/ })).toHaveTextContent('0개')
    const receive = vi.mocked(subscribeSupplierRegistration).mock.calls.at(-1)![0]
    await act(async () => { receive({ jobId: transfer.jobId, token: transfer.token, status: 'succeeded', message: '상품 검수 완료', completedAt: '2026-11-23T03:00:00Z', receiptId: 'SKU-123' }) })
    await waitFor(() => expect(screen.getByRole('tab', { name: /3단계 등록완료/ })).toHaveTextContent('1개'))
    fireEvent.click(screen.getByRole('tab', { name: /3단계 등록완료/ }))
    expect(screen.getByRole('tabpanel', { name: '등록완료' })).toHaveTextContent('SKU-123')
  })

  it('keeps the reservation when START times out instead of allowing another upload', async () => {
    const row = { ...confirmPricing(createRegistrationRow(source, '베이지')), fields: { 브랜드: '생활살림' } }
    const initial = informationTemplate({ ...blankDraft(), rows: [row] })
    const saved = mockSavedDraft(initial)
    const fallback = vi.mocked(fetch)
    const transfer = { jobId: 'job-timeout', token: 'token-timeout', files: [], rows: [{ id: row.id, name: row.name }] }
    const queued = { ...initial, rows: initial.rows.map((item) => ({ ...item, submission: { jobId: transfer.jobId, status: 'queued' } })) }
    vi.mocked(startSupplierRegistration).mockRejectedValueOnce(new Error('timeout'))
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/submit')) return { ok: true, json: async () => ({ ...saved, revision: 2, payload: queued, transfer }) }
      return fallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    fireEvent.click(await screen.findByRole('button', { name: '상품등록' }))
    await waitFor(() => expect(startSupplierRegistration).toHaveBeenCalledWith(transfer))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.getByText('등록 대기')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '상품등록' }))
    expect(startSupplierRegistration).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/submissions') && init?.method === 'POST')).toBe(false)
  })

  it('preserves edits made while progress is in flight and saves with the latest revision', async () => {
    const queued = { ...confirmPricing(createRegistrationRow(source, '베이지')), fields: { 브랜드: '생활살림' }, submission: { jobId: 'job-1', status: 'running' as const } }
    const editable = { ...confirmPricing(createRegistrationRow(second, '블랙')), fields: { 브랜드: '생활살림' } }
    const initial = informationTemplate({ ...blankDraft(), rows: [queued, editable] })
    const saved = mockSavedDraft(initial)
    const fallback = vi.mocked(fetch)
    let finish!: (value: unknown) => void
    const progress = new Promise((resolve) => { finish = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/submissions') && init?.method === 'POST') return { ok: true, json: () => progress }
      return fallback(url, init)
    }))
    render(<CoupangRegistrationWorkbench />)
    await screen.findByRole('option', { name: /단계 작업/ })
    fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: saved.id } })
    fireEvent.click(await screen.findByRole('button', { name: '루멘 철제 사이드 테이블 블랙 등록정보 입력' }))
    const receive = vi.mocked(subscribeSupplierRegistration).mock.calls.at(-1)![0]
    act(() => { receive({ jobId: 'job-1', token: 'token-1', status: 'running', message: '검수중' }) })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/submissions'))).toBe(true))
    fireEvent.change(screen.getByLabelText('브랜드 *'), { target: { value: '수정한 브랜드' } })
    await act(async () => { finish({ ...saved, revision: 3, payload: initial, submissions: [] }) })
    expect(screen.getByLabelText('브랜드 *')).toHaveValue('수정한 브랜드')
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/drafts') && init?.method === 'POST')
      expect(call).toBeDefined()
      const body = JSON.parse(String(call![1]!.body))
      expect(body.revision).toBe(3)
      expect(body.draft.rows[1].fields.브랜드).toBe('수정한 브랜드')
    })
  })
})

function informationTemplate(draft: RegistrationDraft): RegistrationDraft {
  return { ...draft, rows: draft.rows.map((row) => ({ ...row, templateId: 'template-1', sheetName: 'QF_1_가방' })), templates: [{ id: 'template-1', name: '쿠팡 양식.xlsx', file: { name: '쿠팡 양식.xlsx', data: '' }, sheets: [{ name: 'QF_1_가방', columns: [{ column: 1, label: '상품명', requirement: '필수', guide: '' }, { column: 2, label: '브랜드', requirement: '필수', guide: '' }, { column: 3, label: '고시명', requirement: '필수', guide: '카테고리에 따라 자동설정', autoGenerated: true }] }] }] }
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
