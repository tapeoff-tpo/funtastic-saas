// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ workspace: vi.fn() }))
vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
import { buildCategoryContext, getCategoryContext } from '@/lib/coupang-registration/category-context'
import { GET } from '@/app/api/operations/coupang-registration/category-context/route'

const product = {
  code: '938', name: '바뜨 옷장 레일행거',
  category: { name: '행거', naverCategoryName: '가구/인테리어 > 수납가구 > 행거' },
  tags: '드레스룸행거,옷장정리,바지걸이행거,드레스룸정리,바지행거,행거,바지걸이행거',
}

beforeEach(() => { vi.clearAllMocks(); mocks.workspace.mockResolvedValue('workspace-owner') })
afterEach(() => { vi.unstubAllGlobals() })

describe('B2B category context for Supplier Hub search', () => {
  it('starts with the registered source category and keeps the actual source name and keywords as follow-up searches', () => {
    const result = buildCategoryContext(product)
    expect(result).toMatchObject({ sourceCode: '938', productName: product.name, categoryName: '행거', categoryPath: product.category.naverCategoryName })
    expect(result.queries).toEqual(['행거', '바뜨 옷장 레일행거', '바지걸이', '드레스룸행거', '옷장정리', '바지걸이행거'])
    expect(result.keywords).toEqual(['드레스룸행거', '옷장정리', '바지걸이행거', '드레스룸정리', '바지행거', '행거'])
    expect(result).not.toHaveProperty('coupangCategoryId')
  })

  it('shortens only existing source compounds at 걸이 while preserving the original keywords', () => {
    const result = buildCategoryContext({ code: '3', name: '정리 용품', category: { name: '수납' }, tags: '바지걸이행거,바지걸이수납,슬라이딩옷걸이,정리함,수납' })
    expect(result.queries).toEqual(['수납', '정리 용품', '바지걸이', '바지걸이행거', '바지걸이수납', '슬라이딩옷걸이'])
    expect(result.keywords).toEqual(['바지걸이행거', '바지걸이수납', '슬라이딩옷걸이', '정리함', '수납'])
    expect(result.queries).not.toContain('옷걸이')
  })

  it('keeps a missing category explicit and uses a source path leaf only when that path exists', () => {
    expect(buildCategoryContext({ code: '1', name: '출처 상품', category: null, tags: null })).toEqual({
      sourceCode: '1', productName: '출처 상품', categoryName: '', categoryPath: '', keywords: [], queries: ['출처 상품'],
    })
    expect(buildCategoryContext({ code: '2', name: '다른 상품', category: { naverCategoryName: '생활용품 > 옷걸이' }, tags: ['옷걸이', ' 옷걸이 ', null] })).toMatchObject({ categoryName: '옷걸이', keywords: ['옷걸이'], queries: ['옷걸이', '다른 상품'] })
  })

  it('fetches only the fixed B2B endpoint and rejects an unrelated product response', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => product })
    vi.stubGlobal('fetch', fetcher)
    expect(await getCategoryContext('938')).toEqual(buildCategoryContext(product))
    expect(fetcher).toHaveBeenCalledWith('https://funtasticb2b.com/api/products/by-code?code=938', expect.objectContaining({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }))
    await expect(getCategoryContext('https://evil.test')).rejects.toThrow('코드')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(getCategoryContext('939')).rejects.toThrow('일치')
  })

  it('requires workspace authorization and validates the entire code before fetching', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    mocks.workspace.mockResolvedValue(null)
    const denied = await GET(new NextRequest('https://app.test/api/category-context?code=938'))
    expect(denied.status).toBe(403)
    mocks.workspace.mockResolvedValue('workspace-owner')
    for (const code of ['', '938/other', '9'.repeat(101), ' 938']) {
      const response = await GET(new NextRequest(`https://app.test/api/category-context?${new URLSearchParams({ code })}`))
      expect(response.status).toBe(400)
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns the context without caching and reports a source failure without inventing recommendations', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => product })
    vi.stubGlobal('fetch', fetcher)
    const response = await GET(new NextRequest('https://app.test/api/category-context?code=938'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ context: buildCategoryContext(product) })
    fetcher.mockResolvedValue({ ok: false, status: 503 })
    const unavailable = await GET(new NextRequest('https://app.test/api/category-context?code=938'))
    expect(unavailable.status).toBe(502)
    expect(await unavailable.json()).not.toHaveProperty('context')
  })
})
