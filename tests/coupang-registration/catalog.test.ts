// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ select: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { select: mocks.select } }))
import { getCatalogProduct, searchCatalog } from '@/lib/coupang-registration/catalog'

const source = { code: '1471', name: '마미백 플러스', price: 14500, imageUrl: 'https://cdn.tapeoff.kr/front.jpg', detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], options: [{ optionName: '베이지' }] }

describe('fast registration catalogue search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    const builder = { from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), groupBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ sku: '112361-0001', name: source.name, optionName: '베이지', metadata: { esa009m: { 'works 신규 원가': '8776' } } }]) }
    mocks.select.mockReturnValue(builder)
  })
  it('returns 24 search results with one list request and no detail or inventory queries', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ products: Array.from({ length: 24 }, (_, index) => ({ ...source, code: String(index) })) }) })
    const result = await searchCatalog('workspace-owner', '마미백')
    expect(result).toHaveLength(24)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(String(mocks.fetch.mock.calls[0][0])).toContain('/api/products?')
    expect(mocks.select).not.toHaveBeenCalled()
    expect(result[0].costCandidates).toEqual([])
    expect(result[0].thumbnails).toEqual([source.imageUrl])
  })
  it('loads the selected product surcharge and current item new cost before it can be added', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...source, options: [{ optionName: '베이지', addPrice: 2500 }] }) })
    const product = await getCatalogProduct('workspace-owner', source.code)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(String(mocks.fetch.mock.calls[0][0])).toContain('/api/products/by-code?code=1471')
    expect(product.options).toEqual([{ name: '베이지', addPrice: 2500 }])
    expect(product.costCandidates[0]).toMatchObject({ sku: '112361-0001', costPrice: 8776 })
    expect(mocks.select).toHaveBeenCalledTimes(1)
  })
  it('does not query the source for an empty search', async () => {
    expect(await searchCatalog('workspace-owner', ' ')).toEqual([])
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
