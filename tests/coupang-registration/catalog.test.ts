// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
const mocks = vi.hoisted(() => ({ select: vi.fn(), fetch: vi.fn(), findProductMasters: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { select: mocks.select } }))
vi.mock('@/lib/coupang-registration/product-master', () => ({ findRegistrationProductMasters: mocks.findProductMasters }))
import { getCatalogProduct, matchCatalogProducts, searchCatalog } from '@/lib/coupang-registration/catalog'
import { createRegistrationRow } from '@/lib/coupang-registration/model'

const source = { code: '1471', name: '마미백 플러스', price: 14500, imageUrl: 'https://cdn.tapeoff.kr/front.jpg', detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], options: [{ optionName: '베이지' }] }

describe('fast registration catalogue search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.findProductMasters.mockResolvedValue(new Map())
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
  it('attaches a uniquely matched Product Management record to the selected catalogue product', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => source })
    mocks.findProductMasters.mockResolvedValue(new Map([['1471', {
      itemId: 'product-management-item', match: 'sku', noticeSize: '25*12*41cm', noticeWeight: '400g',
      noticeMaterial: '폴리에스터', noticeManufacturer: '제조사', noticeCountry: '중국',
    }]]))
    const product = await getCatalogProduct('workspace-owner', source.code)
    expect(product.productMaster).toMatchObject({ itemId: 'product-management-item', match: 'sku', noticeSize: '25*12*41cm' })
    expect(mocks.findProductMasters).toHaveBeenCalledWith('workspace-owner', [{ id: '1471', name: '마미백 플러스', skus: ['112361-0001'] }])
  })
  it('keeps current costs and option prices while deferring product-management information for pricing', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...source, options: [{ optionName: '베이지', addPrice: 2500 }] }) })
    const product = await getCatalogProduct('workspace-owner', source.code, { includeProductMasters: false })
    expect(createRegistrationRow(product, '베이지')).toMatchObject({ internalSku: '112361-0001', costPrice: 8776, wholesalePrice: 17000 })
    expect(mocks.select).toHaveBeenCalledTimes(1)
    expect(mocks.findProductMasters).not.toHaveBeenCalled()
    expect(product.productMaster).toBeUndefined()
  })
  it('fetches each supplied code once in parallel batches of at most four', async () => {
    const pending: Array<() => void> = []
    mocks.fetch.mockImplementation((url: string) => new Promise((resolve) => {
      const code = new URL(url).searchParams.get('code')!
      pending.push(() => resolve({ ok: true, json: async () => ({ ...source, code, options: [{ optionName: '베이지', addPrice: Number(code) }] }) }))
    }))
    const result = matchCatalogProducts('workspace-owner', [], ['1', '2', '3', '4', '5', '2', ''], { includeProductMasters: false })
    expect(mocks.fetch).toHaveBeenCalledTimes(4)
    for (const release of pending.splice(0)) release()
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(5))
    pending[0]()
    const products = await result
    expect(products.map((product) => product.code)).toEqual(['1', '2', '3', '4', '5'])
    expect(products.map((product) => product.options[0].addPrice)).toEqual([1, 2, 3, 4, 5])
    expect(mocks.fetch.mock.calls.map(([url]) => new URL(url).searchParams.get('code'))).toEqual(['1', '2', '3', '4', '5'])
    expect(mocks.select).toHaveBeenCalledTimes(1)
    expect(products[0].costCandidates[0]).toMatchObject({ sku: '112361-0001', costPrice: 8776 })
    expect(mocks.findProductMasters).not.toHaveBeenCalled()
  })
  it('hydrates overlapping name matches and explicit codes once using full details', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/api/products') return { ok: true, json: async () => ({ products: [{ ...source, price: 1 }] }) }
      return { ok: true, json: async () => ({ ...source, code: parsed.searchParams.get('code'), options: [{ optionName: '베이지', addPrice: 2500 }] }) }
    })
    const products = await matchCatalogProducts('workspace-owner', [source.name], [source.code, '1472', source.code])
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(products.map((product) => product.code)).toEqual(['1471', '1472'])
    expect(products[0]).toMatchObject({ price: 14500, options: [{ name: '베이지', addPrice: 2500 }] })
    expect(mocks.findProductMasters).toHaveBeenCalledTimes(1)
  })
  it('links option costs retained in the item master when legacy option product rows are hidden', async () => {
    const name = '바뜨 옷장 레일행거'
    const options = ['30B', '40B', '50B', '60B', '30B 블랙']
    const costs = [6878, 7679, 9023, 11466, 6640]
    const records = [
      { sku: '111180', name, optionName: '', status: 'active', metadata: null },
      ...options.map((optionName, index) => ({ sku: `111180-000${index + 1}`, name, optionName, status: 'deleted', metadata: { esa009m: { 품목명: name, 규격정보: optionName, 'works 신규 원가': String(costs[index]) } } })),
      { sku: '111180-9999', name, optionName: '30B', status: 'deleted', metadata: null },
    ]
    let condition: SQL
    const builder = {
      from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn((value: SQL) => { condition = value; return builder }), groupBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => {
        const statement = new PgDialect().sqlToQuery(condition)
        expect(statement.params).toContain('workspace-owner')
        // Exercise the query's status policy: only an actual ESA item can remain
        // a cost source after its old product-catalogue row was hidden.
        const keepsItems = /"products"\."status" <> \$\d+ or "products"\."metadata"->'esa009m' IS NOT NULL/.test(statement.sql)
        return records.filter((row) => row.status !== 'deleted' || keepsItems && row.metadata?.esa009m)
      }),
    }
    mocks.select.mockReturnValue(builder)
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ code: '938', name, price: 12480, options: options.map((optionName) => ({ optionName })) }) })
    const product = await getCatalogProduct('workspace-owner', '938')
    for (const [index, optionName] of options.entries()) {
      expect(createRegistrationRow(product, optionName)).toMatchObject({ internalSku: `111180-000${index + 1}`, costPrice: costs[index] })
    }
    expect(product.costCandidates.some((item) => item.sku === '111180-9999')).toBe(false)
  })
  it('does not query the source for an empty search', async () => {
    expect(await searchCatalog('workspace-owner', ' ')).toEqual([])
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
