// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), get: vi.fn(), match: vi.fn(), search: vi.fn(), costs: vi.fn(), masters: vi.fn() }))
vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
vi.mock('@/lib/coupang-registration/catalog', () => ({ getCatalogProduct: mocks.get, matchCatalogProducts: mocks.match, searchCatalog: mocks.search, findCostCandidates: mocks.costs }))
vi.mock('@/lib/coupang-registration/product-master', () => ({ findRegistrationProductMasters: mocks.masters }))
import { GET, POST } from '@/app/api/operations/coupang-registration/catalog/route'

const endpoint = 'http://test/api/operations/coupang-registration/catalog'

describe('registration catalogue phases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.mockResolvedValue('workspace-owner')
    mocks.get.mockResolvedValue({ code: '938' })
    mocks.match.mockResolvedValue([{ code: '938' }])
    mocks.search.mockResolvedValue([])
    mocks.masters.mockResolvedValue(new Map())
  })

  it('requires workspace access before either pricing or full catalogue lookup', async () => {
    mocks.workspace.mockResolvedValue(null)
    expect((await GET(new NextRequest(`${endpoint}?code=938&phase=pricing`))).status).toBe(403)
    expect((await POST(new NextRequest(endpoint, { method: 'POST', body: JSON.stringify({ names: [], codes: ['938'], phase: 'pricing' }) }))).status).toBe(403)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.match).not.toHaveBeenCalled()
    expect(mocks.masters).not.toHaveBeenCalled()
  })

  it('keeps product search on its existing lightweight path', async () => {
    expect((await GET(new NextRequest(`${endpoint}?q=행거`))).status).toBe(200)
    expect(mocks.search).toHaveBeenCalledWith('workspace-owner', '행거')
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it.each([
    ['&phase=pricing', false],
    ['&phase=information', true],
    ['', true],
  ])('uses the requested detail phase for individual products (%s)', async (query, includeProductMasters) => {
    expect((await GET(new NextRequest(`${endpoint}?code=938${query}`))).status).toBe(200)
    expect(mocks.get).toHaveBeenCalledWith('workspace-owner', '938', { includeProductMasters })
  })

  it.each([
    ['pricing', false],
    ['information', true],
    [undefined, true],
  ])('uses the requested detail phase for multiple products (%s)', async (phase, includeProductMasters) => {
    expect((await POST(new NextRequest(endpoint, { method: 'POST', body: JSON.stringify({ userId: 'other-owner', names: [], codes: ['938'], phase }) }))).status).toBe(200)
    expect(mocks.match).toHaveBeenCalledWith('workspace-owner', [], ['938'], { includeProductMasters })
    expect(mocks.masters).not.toHaveBeenCalled()
  })

  it('rejects an unsupported phase before looking up products', async () => {
    const response = await POST(new NextRequest(endpoint, { method: 'POST', body: JSON.stringify({ names: [], codes: ['938'], phase: 'skip-costs' }) }))
    expect(response.status).toBe(400)
    expect(mocks.match).not.toHaveBeenCalled()
  })

  it('matches separate option masters by each selected row SKU in one workspace batch', async () => {
    const product = {
      code: '1471', name: '마미백 플러스', options: [{ name: '베이지', addPrice: 0 }, { name: '블랙', addPrice: 0 }],
      costCandidates: [
        { sku: '112361-0001', name: '마미백 플러스', optionName: '베이지', costPrice: 10000 },
        { sku: '112361-0002', name: '마미백 플러스', optionName: '블랙', costPrice: 11000 },
      ],
    }
    const rows = [
      { id: 'beige-row', sourceCode: '1471', name: '내 등록 상품명', sourceName: '과거 이름', optionName: '베이지', internalSku: '112361-0001' },
      { id: 'black-row', sourceCode: '1471', name: '마미백 플러스 블랙', sourceName: '마미백 플러스', optionName: '블랙', internalSku: '' },
    ]
    const masters = { 'beige-row': { itemId: 'beige-master', match: 'sku', noticeMaterial: '베이지 캔버스' }, 'black-row': { itemId: 'black-master', match: 'sku', noticeMaterial: '검정 캔버스' } }
    mocks.match.mockResolvedValue([product])
    mocks.masters.mockResolvedValue(new Map(Object.entries(masters)))

    const response = await POST(new NextRequest(endpoint, { method: 'POST', body: JSON.stringify({ userId: 'forged-owner', names: [], codes: ['1471'], phase: 'information', rows }) }))
    expect(response.status).toBe(200)
    expect(mocks.match).toHaveBeenCalledTimes(1)
    expect(mocks.match).toHaveBeenCalledWith('workspace-owner', [], ['1471'], { includeProductMasters: false })
    expect(mocks.masters).toHaveBeenCalledTimes(1)
    expect(mocks.masters).toHaveBeenCalledWith('workspace-owner', [
      { id: 'beige-row', name: '마미백 플러스', skus: ['112361-0001'] },
      { id: 'black-row', name: '마미백 플러스', skus: ['112361-0002'] },
    ])
    expect(await response.json()).toEqual({ products: [product], productMasters: masters })
  })

  it('keeps a confirmed row SKU authoritative and does not substitute another option’s cost SKU', async () => {
    mocks.match.mockResolvedValue([{ code: '1471', name: '마미백 플러스', costCandidates: [{ sku: '112361-0002', name: '마미백 플러스', optionName: '베이지', costPrice: 10000 }] }])
    const response = await POST(new NextRequest(endpoint, { method: 'POST', body: JSON.stringify({ names: [], codes: ['1471'], rows: [{ id: 'selected', sourceCode: '1471', name: '마미백 플러스 베이지', sourceName: '마미백 플러스', optionName: '베이지', internalSku: ' 112361-0001 ' }] }) }))
    expect(response.status).toBe(200)
    expect(mocks.masters).toHaveBeenCalledWith('workspace-owner', [{ id: 'selected', name: '마미백 플러스', skus: ['112361-0001'] }])
  })

  it('does not attach another source product’s master when a requested code is missing', async () => {
    mocks.match.mockResolvedValue([{ code: '938', name: '다른 상품', productMaster: { itemId: 'other-master' } }])
    const response = await POST(new NextRequest(endpoint, { method: 'POST', body: JSON.stringify({ names: [], codes: ['1471'], rows: [{ id: 'selected', sourceCode: '1471', name: '마미백 플러스 베이지', sourceName: '마미백 플러스', optionName: '베이지', internalSku: '112361-0001' }] }) }))
    expect(response.status).toBe(200)
    expect((await response.json()).productMasters).toEqual({})
    expect(mocks.masters).not.toHaveBeenCalled()
  })

  it.each([
    { phase: 'pricing', codes: ['1471'], ids: ['first'], sourceCode: '1471' },
    { phase: 'information', codes: ['1471'], ids: ['same', 'same'], sourceCode: '1471' },
    { phase: 'information', codes: ['938'], ids: ['first'], sourceCode: '1471' },
  ])('rejects inconsistent option-row requests before any lookup: %j', async ({ phase, codes, ids, sourceCode }) => {
    const rows = ids.map(id => ({ id, sourceCode, name: '마미백 플러스 베이지', sourceName: '마미백 플러스', optionName: '베이지', internalSku: '112361-0001' }))
    const response = await POST(new NextRequest(endpoint, { method: 'POST', body: JSON.stringify({ names: [], codes, rows, phase }) }))
    expect(response.status).toBe(400)
    expect(mocks.match).not.toHaveBeenCalled()
    expect(mocks.masters).not.toHaveBeenCalled()
  })
})
