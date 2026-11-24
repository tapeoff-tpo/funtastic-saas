import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductImageResult } from './product-image-catalogue'

const mocks = vi.hoisted(() => ({ find: vi.fn(), attachment: vi.fn() }))
vi.mock('@/lib/new-products/catalogue-images', () => ({ findSavedNewProductImagesBatch: mocks.find }))
vi.mock('@/lib/new-products/workflow', () => ({ getNewProductAttachment: mocks.attachment }))

import { getImportDocumentProductImages } from './import-document-product-images'

const imageId = '00000000-0000-4000-8000-000000000001'
const imageUrl = `/api/purchasing/product-images/files/${imageId}`
const input = { userId: 'workspace-owner', requestedByUserId: 'admin-two', items: [{ sku: 'SKU-A', productName: '상품 A' }] }
const imageMatch = (sku: string, imageUrls = [imageUrl]): ProductImageResult => ({ sku, productName: '상품 A', source: 'product-management', imageUrls })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.find.mockResolvedValue({})
  mocks.attachment.mockResolvedValue(null)
})

describe('import document product images', () => {
  it('deduplicates trimmed SKUs and reads one saved attachment under the shared workspace', async () => {
    const webp = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#336699' } }).webp().toBuffer()
    mocks.find.mockResolvedValue({ 'SKU-A': imageMatch('SKU-A', [imageUrl, imageUrl.replace(/1$/, '2')]) })
    mocks.attachment.mockResolvedValue({ contentType: 'image/webp', fileDataBase64: webp.toString('base64') })
    const result = await getImportDocumentProductImages({ ...input, items: [{ sku: ' SKU-A ', productName: '상품 A' }, { sku: 'SKU-A', productName: '중복 행' }, { sku: ' ', productName: '빈 코드' }] })
    expect(mocks.find).toHaveBeenCalledWith('workspace-owner', [{ id: 'SKU-A', sku: 'SKU-A', productName: '상품 A' }])
    expect(mocks.attachment).toHaveBeenCalledExactlyOnceWith({ userId: 'workspace-owner', requestedByUserId: 'admin-two', attachmentId: imageId })
    expect([...result.keys()]).toEqual(['SKU-A'])
    const image = result.get('SKU-A')!
    expect(image).toMatchObject({ width: 160, height: 80 })
    if ('error' in image) throw new Error('expected image')
    expect((await sharp(image.buffer).metadata()).format).toBe('png')
  })

  it('does not enlarge a small existing product image', async () => {
    const png = await sharp({ create: { width: 30, height: 60, channels: 4, background: '#ffffff00' } }).png().toBuffer()
    mocks.find.mockResolvedValue({ 'SKU-A': imageMatch('SKU-A') })
    mocks.attachment.mockResolvedValue({ contentType: 'image/png', fileDataBase64: png.toString('base64') })
    expect((await getImportDocumentProductImages(input)).get('SKU-A')).toMatchObject({ width: 30, height: 60 })
  })

  it('keeps missing or ambiguous images visible and does not fetch arbitrary URLs', async () => {
    expect((await getImportDocumentProductImages(input)).get('SKU-A')).toEqual({ error: 'missing' })
    mocks.find.mockResolvedValue({ 'SKU-A': imageMatch('SKU-A', ['https://example.com/product.jpg', '/api/new-products/attachments/other', `${imageUrl}?redirect=1`]) })
    expect((await getImportDocumentProductImages(input)).get('SKU-A')).toEqual({ error: 'missing' })
    expect(mocks.attachment).not.toHaveBeenCalled()
    mocks.find.mockResolvedValue({ 'SKU-A': imageMatch('SKU-A') })
    expect((await getImportDocumentProductImages(input)).get('SKU-A')).toEqual({ error: 'missing' })
  })

  it('marks an individual failed image read or decode unavailable without losing its SKU', async () => {
    mocks.find.mockResolvedValue({ 'SKU-A': imageMatch('SKU-A') })
    mocks.attachment.mockRejectedValueOnce(new Error('R2 unavailable'))
    expect((await getImportDocumentProductImages(input)).get('SKU-A')).toEqual({ error: 'unavailable' })
    mocks.attachment.mockResolvedValue({ contentType: 'image/webp', fileDataBase64: Buffer.from('not an image').toString('base64') })
    expect((await getImportDocumentProductImages(input)).get('SKU-A')).toEqual({ error: 'unavailable' })
    mocks.attachment.mockResolvedValue({ contentType: 'application/pdf', fileDataBase64: 'aW1hZ2U=' })
    expect((await getImportDocumentProductImages(input)).get('SKU-A')).toEqual({ error: 'unavailable' })
  })

  it('avoids empty queries, tolerates uninitialized image tables, and surfaces lookup outages', async () => {
    expect(await getImportDocumentProductImages({ ...input, items: [] })).toEqual(new Map())
    expect(mocks.find).not.toHaveBeenCalled()
    mocks.find.mockRejectedValueOnce({ cause: { code: '42P01' } })
    expect((await getImportDocumentProductImages(input)).get('SKU-A')).toEqual({ error: 'missing' })
    mocks.find.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(getImportDocumentProductImages(input)).rejects.toThrow('database unavailable')
  })

  it('limits concurrent attachment reads to five', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ sku: `SKU-${index}`, productName: '상품' }))
    mocks.find.mockResolvedValue(Object.fromEntries(items.map((item) => [item.sku, imageMatch(item.sku)])))
    let active = 0
    let maximum = 0
    mocks.attachment.mockImplementation(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return null
    })
    const result = await getImportDocumentProductImages({ ...input, items })
    expect(result.size).toBe(12)
    expect(maximum).toBe(5)
    expect(mocks.attachment).toHaveBeenCalledTimes(12)
  })
  it('tries another saved attachment if the first read or decode fails', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer()
    mocks.find.mockResolvedValue({ 'SKU-A': imageMatch('SKU-A', [imageUrl, imageUrl.replace(/1$/, '2')]) })
    mocks.attachment.mockRejectedValueOnce(new Error('missing object')).mockResolvedValueOnce({ contentType: 'image/png', fileDataBase64: png.toString('base64') })
    expect((await getImportDocumentProductImages(input)).get('SKU-A')).toMatchObject({ width: 10, height: 10 })
    expect(mocks.attachment).toHaveBeenCalledTimes(2)
  })

})
