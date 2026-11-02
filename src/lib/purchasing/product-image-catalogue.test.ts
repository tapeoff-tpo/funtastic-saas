import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanProductImageUrls, resolvePurchasingProductImages } from './product-image-catalogue'

const input = { sku: '111090-0002', productName: '멜텐 스윗 도넛 플레이트 세트', localImages: null }
const product = { code: '1054', name: input.productName, imageUrl: 'https://images.example/main.jpg', thumbnailImages: ['https://images.example/first.jpg'] }
afterEach(() => vi.unstubAllGlobals())
function catalogue(products: unknown[], total = products.length) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ products, total })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
describe('purchasing product image matching', () => {
  it('prefers existing images in sort order and never calls B2B unnecessarily', async () => {
    const fetcher = catalogue([])
    expect(await resolvePurchasingProductImages({ ...input, localImages: [{ url: '/two.jpg', sortOrder: 2 }, { url: '/one.jpg', sortOrder: 1 }] })).toMatchObject({ source: 'item-master', imageUrls: ['/one.jpg', '/two.jpg'] })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('matches a unique exact product name across different SKU systems', async () => {
    const fetcher = catalogue([product])
    const result = await resolvePurchasingProductImages(input)
    expect(result).toMatchObject({ source: 'funtasticb2b', imageUrls: ['https://images.example/first.jpg', 'https://images.example/main.jpg'], sourceUrl: 'https://funtasticb2b.com/goods/view?no=1054' })
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('exactNames')).toBe(input.productName)
  })
  it('does not infer a match from a partial name, a SKU prefix or multiple exact names', async () => {
    catalogue([{ ...product, name: `${input.productName} 추가 구성` }])
    expect((await resolvePurchasingProductImages(input)).imageUrls).toEqual([])
    catalogue([product, { ...product, code: '111090' }])
    expect(await resolvePurchasingProductImages(input)).toMatchObject({ source: 'none', ambiguous: true })
  })
  it('rejects a truncated ambiguous search and accepts a corroborated exact SKU', async () => {
    catalogue([product], 21)
    expect((await resolvePurchasingProductImages(input)).imageUrls).toEqual([])
    catalogue([product, { ...product, code: input.sku }])
    expect((await resolvePurchasingProductImages(input)).source).toBe('funtasticb2b')
  })
  it('can bypass a broken saved image and handles unavailable catalogues as retryable errors', async () => {
    catalogue([product])
    expect((await resolvePurchasingProductImages({ ...input, localImages: [{ url: '/broken.jpg', sortOrder: 0 }], catalogueOnly: true })).source).toBe('funtasticb2b')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    await expect(resolvePurchasingProductImages(input)).rejects.toThrow('다시 불러오기')
  })
  it('filters unsafe URLs, resolves catalogue-relative images and removes duplicates', () => {
    expect(cleanProductImageUrls(['javascript:alert(1)', 'data:text/html,x', 'https://user:pass@host/x', '/one.jpg', '/one.jpg'], 'https://funtasticb2b.com')).toEqual(['https://funtasticb2b.com/one.jpg'])
  })
})
