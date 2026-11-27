import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CoupangRegistrationWorkbench } from '@/app/(auth)/operations/coupang-registration/workbench'
import { blankDraft, createRegistrationRow, type RegistrationDraft } from '@/lib/coupang-registration/model'
import { pingSupplierExtension, startSupplierRegistration } from '@/lib/coupang-registration/supplier-bridge'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/coupang-registration/supplier-bridge', () => ({
  pingSupplierExtension: vi.fn(async () => ({ connected: true, supportsIndividual: true })),
  startSupplierRegistration: vi.fn(async () => ({ started: true })),
  checkSupplierRegistration: vi.fn(), attachSupplierRegistration: vi.fn(), resumeSupplierRegistration: vi.fn(),
  stopSupplierRegistration: vi.fn(), openSupplierRegistration: vi.fn(),
  searchSupplierCategories: vi.fn(async () => []), getSupplierCategoryTemplate: vi.fn(),
  subscribeSupplierRegistration: vi.fn(() => () => undefined),
}))

const draftId = 'cb68d41b-33ca-4de4-b6dd-7358e0090bb0'
const jobId = '04f662d8-c34f-4994-8e18-7f65e8d908aa'
const token = 'a'.repeat(48)
const makeRow = (id: string, name: string) => ({
  ...createRegistrationRow(), id, name, stage: 'information' as const,
  priceConfirmedAt: '2026-11-20T00:00:00.000Z', sourceCode: '',
  priceMode: 'manual' as const, manualSupplyPrice: 12000, saleMode: 'manual' as const, manualSalePrice: 20000,
})
const fixture = (): RegistrationDraft => ({ ...blankDraft(), name: '등록 테스트', rows: [makeRow('first', '선택 상품'), makeRow('second', '선택하지 않은 상품')] })

function mockRegistrationApi(initial = fixture()) {
  let payload = initial
  let revision = 1
  const requests: Array<{path: string; body: Record<string, unknown>}> = []
  const saved = () => ({ id: draftId, name: payload.name, updatedAt: '2026-11-26', revision, payload })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, 'http://localhost')
    const path = parsed.pathname.split('/').at(-1)!
    const method = init?.method ?? 'GET'
    let response: unknown
    if (path === 'drafts' && method === 'GET') response = parsed.searchParams.has('id') ? saved() : { drafts: [saved()] }
    else if (path === 'drafts' && method === 'POST') {
      const body = JSON.parse(String(init?.body)); requests.push({ path, body }); payload = body.draft; revision++
      response = saved()
    } else if (path === 'submissions' && method === 'GET') response = { ...saved(), submissions: [], transfers: [] }
    else if (path === 'submit' && method === 'POST') {
      const body = JSON.parse(String(init?.body)); requests.push({ path, body }); revision++
      const submission = { jobId, mode: body.mode, status: 'queued', message: '대기 중', rowIds: body.rowIds, control: { jobId, token } }
      const transfer = body.mode === 'individual'
        ? { mode: 'individual', jobId, token, products: [{ id: 'first', name: '선택 상품' }] }
        : { jobId, token, files: [{ name: '상품.xlsx', data: 'UEs=', kind: 'workbook' }], rows: [{ id: 'first', name: '선택 상품' }] }
      response = { ...saved(), submission, transfer }
    } else if (path === 'sheet-mappings') response = { mappings: [] }
    else if (path === 'templates') response = { templates: [] }
    else if (path === 'costs') response = { costs: [] }
    else if (path === 'catalog') response = { products: [] }
    else throw new Error(`Unexpected local test request: ${method} ${path}`)
    return { ok: true, json: async () => response }
  }))
  return requests
}

async function openSelection() {
  render(<CoupangRegistrationWorkbench />)
  await screen.findByRole('option', { name: /등록 테스트/ })
  fireEvent.change(screen.getByLabelText('저장된 작업 불러오기'), { target: { value: draftId } })
  const choice = await screen.findByRole('checkbox', { name: '선택 상품 선택' })
  fireEvent.click(choice)
  await waitFor(() => expect(screen.getByLabelText('등록 대상 상품 수')).toHaveTextContent('선택 1개'))
}

describe('workbench registration handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/operations/coupang-registration')
    vi.mocked(pingSupplierExtension).mockResolvedValue({ connected: true, supportsIndividual: true })
    vi.mocked(startSupplierRegistration).mockResolvedValue({ started: true })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['excel', 'individual'] as const)('saves and sends only the selected product for %s registration', async mode => {
    const requests = mockRegistrationApi()
    await openSelection()
    fireEvent.change(screen.getByRole('combobox', { name: '쿠팡 등록 방식' }), { target: { value: mode } })
    fireEvent.click(screen.getByRole('button', { name: mode === 'excel' ? '엑셀 대량등록' : '개별등록 준비' }))

    await waitFor(() => expect(startSupplierRegistration).toHaveBeenCalledOnce())
    expect(pingSupplierExtension).toHaveBeenCalledWith({ requireIndividual: mode === 'individual' })
    expect(requests.map(request => request.path)).toEqual(['drafts', 'submit'])
    expect(requests[0].body).toMatchObject({ id: draftId, revision: 1 })
    expect(requests[1].body).toMatchObject({ draftId, revision: 2, rowIds: ['first'], mode })
    if (mode === 'individual') {
      expect(requests[1].body.categoryContexts).toEqual({})
      expect(startSupplierRegistration).toHaveBeenCalledWith(expect.objectContaining({ mode, jobId, products: [{ id: 'first', name: '선택 상품' }] }))
    } else {
      expect(startSupplierRegistration).toHaveBeenCalledWith(expect.objectContaining({ jobId, rows: [{ id: 'first', name: '선택 상품' }] }))
    }
  })

  it.each(['excel', 'individual'] as const)('does not save or submit %s registration when its extension is unavailable', async mode => {
    const requests = mockRegistrationApi()
    vi.mocked(pingSupplierExtension).mockResolvedValue(mode === 'individual' ? { connected: true, supportsIndividual: false } : { connected: false })
    await openSelection()
    fireEvent.change(screen.getByRole('combobox', { name: '쿠팡 등록 방식' }), { target: { value: mode } })
    fireEvent.click(screen.getByRole('button', { name: mode === 'excel' ? '엑셀 대량등록' : '개별등록 준비' }))
    await waitFor(() => expect(pingSupplierExtension).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: mode === 'excel' ? '엑셀 대량등록' : '개별등록 준비' })).toBeEnabled())
    expect(requests).toEqual([])
    expect(startSupplierRegistration).not.toHaveBeenCalled()
  })

  it('confirms only displayed nonempty automatic individual values when the user reviews them together', async () => {
    const first = '전기용품 및 생활용품, 어린이 (KC) 인증 마크 타입'
    const second = '방송통신 기자재 (EMC) 인증 번호'
    const initial = fixture()
    initial.rows[0] = {
      ...initial.rows[0],
      fields: { [first]: '해당사항없음', [second]: '해당사항없음', 유통기간: '' },
      defaultedFields: { [first]: '해당사항없음', [second]: '해당사항없음', 유통기간: '', unrelated: '보존' },
    }
    const requests = mockRegistrationApi(initial)
    await openSelection()
    fireEvent.click(screen.getByRole('button', { name: '선택 상품 상세정보' }))
    expect(screen.getByLabelText(`개별등록 ${first}`)).toHaveValue('해당사항없음')
    expect(screen.getByLabelText('개별등록 유통기간')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: /표시된 자동 입력값 \d+개를 모두 확인했습니다/ }))
    expect(screen.queryByRole('button', { name: /표시된 자동 입력값 \d+개를 모두 확인했습니다/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '등록정보 저장' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    const saved = requests[0].body.draft as RegistrationDraft
    expect(saved.rows[0].fields).toMatchObject({ [first]: '해당사항없음', [second]: '해당사항없음', 유통기간: '' })
    expect(saved.rows[0].defaultedFields).not.toHaveProperty(first)
    expect(saved.rows[0].defaultedFields).not.toHaveProperty(second)
    expect(saved.rows[0].defaultedFields).toMatchObject({ 유통기간: '', unrelated: '보존' })
  })
})
