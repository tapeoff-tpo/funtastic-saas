// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), get: vi.fn(), match: vi.fn(), search: vi.fn(), costs: vi.fn() }))
vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
vi.mock('@/lib/coupang-registration/catalog', () => ({ getCatalogProduct: mocks.get, matchCatalogProducts: mocks.match, searchCatalog: mocks.search, findCostCandidates: mocks.costs }))
import { GET, POST } from '@/app/api/operations/coupang-registration/catalog/route'

const endpoint = 'http://test/api/operations/coupang-registration/catalog'

describe('registration catalogue phases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.mockResolvedValue('workspace-owner')
    mocks.get.mockResolvedValue({ code: '938' })
    mocks.match.mockResolvedValue([{ code: '938' }])
    mocks.search.mockResolvedValue([])
  })

  it('requires workspace access before either pricing or full catalogue lookup', async () => {
    mocks.workspace.mockResolvedValue(null)
    expect((await GET(new NextRequest(`${endpoint}?code=938&phase=pricing`))).status).toBe(403)
    expect((await POST(new NextRequest(endpoint, { method: 'POST', body: JSON.stringify({ names: [], codes: ['938'], phase: 'pricing' }) }))).status).toBe(403)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.match).not.toHaveBeenCalled()
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
  })

  it('rejects an unsupported phase before looking up products', async () => {
    const response = await POST(new NextRequest(endpoint, { method: 'POST', body: JSON.stringify({ names: [], codes: ['938'], phase: 'skip-costs' }) }))
    expect(response.status).toBe(400)
    expect(mocks.match).not.toHaveBeenCalled()
  })
})
