// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute } }))

import { findRegistrationProductMasters } from '@/lib/coupang-registration/product-master'

const base = {
  requestId: '1471', itemId: 'item-1', skuMatch: true,
  noticeSize: '25*12*41 (cm)', noticeWeight: '400g', noticeMaterial: '폴리에스터',
  noticeManufacturer: '제조사', noticeCountry: '중국', qualityPdfId: 'pdf-1', qualityPdfFileName: '품질표시.pdf', qualityPdfContentType: 'application/pdf',
}

describe('Coupang registration Product Management lookup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses one exact SKU match and carries the product data without copying the PDF bytes', async () => {
    mocks.execute.mockResolvedValue([base])
    const result = await findRegistrationProductMasters('workspace-owner', [{ id: '1471', name: '마미백 플러스', skus: ['112361-0001'] }])
    expect(result.get('1471')).toEqual({
      itemId: 'item-1', match: 'sku', noticeSize: '25*12*41 (cm)', noticeWeight: '400g', noticeMaterial: '폴리에스터',
      noticeManufacturer: '제조사', noticeCountry: '중국', qualityPdf: { id: 'pdf-1', fileName: '품질표시.pdf', contentType: 'application/pdf' },
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('does not use a name match when the SKU identifies multiple Product Management items', async () => {
    mocks.execute.mockResolvedValue([
      base,
      { ...base, itemId: 'item-2', noticeCountry: '한국' },
    ])
    const result = await findRegistrationProductMasters('workspace-owner', [{ id: '1471', name: '마미백 플러스', skus: ['112361-0001'] }])
    expect(result.has('1471')).toBe(false)
  })

  it('uses the matched product’s stored keywords without inventing or reformatting tags', async () => {
    mocks.execute.mockResolvedValue([
      { ...base, productKeywords: '  수납가방, 기저귀가방\n여행용 가방  ' },
      { ...base, itemId: 'different-name-match', skuMatch: false, productKeywords: '다른 상품 키워드' },
    ])
    const result = await findRegistrationProductMasters('workspace-owner', [{ id: '1471', name: '마미백 플러스', skus: ['112361-0001'] }])
    expect(result.get('1471')).toMatchObject({ itemId: 'item-1', match: 'sku', productKeywords: '수납가방, 기저귀가방\n여행용 가방' })
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0])
    expect(query.sql).toContain('item.product_keywords AS "productKeywords"')
    expect(query.sql).toContain('source."productKeywords"')
    expect(query.sql).toMatch(/WHERE item\.user_id = \$\d+::uuid/)
    expect(query.params).toContain('workspace-owner')
  })

  it.each([null, '', '  ', undefined])('leaves missing product keywords empty for manual confirmation (%s)', async (productKeywords) => {
    mocks.execute.mockResolvedValue([{ ...base, productKeywords }])
    const result = await findRegistrationProductMasters('workspace-owner', [{ id: '1471', name: '마미백 플러스', skus: ['112361-0001'] }])
    expect(result.get('1471')).not.toHaveProperty('productKeywords')
  })

  it('carries stored contents and capacity only when provided by the matching product', async () => {
    mocks.execute.mockResolvedValue([{ ...base, noticeComponents: ' 본체 1개, 조립 나사 4개 ', noticeCapacity: ' 2L ' }])
    const result = await findRegistrationProductMasters('workspace-owner', [{ id: '1471', name: '마미백 플러스', skus: ['112361-0001'] }])
    expect(result.get('1471')).toMatchObject({ noticeComponents: '본체 1개, 조립 나사 4개', noticeCapacity: '2L' })
    mocks.execute.mockResolvedValue([{ ...base, noticeComponents: null, noticeCapacity: ' ' }])
    const missing = await findRegistrationProductMasters('workspace-owner', [{ id: '1471', name: '마미백 플러스', skus: ['112361-0001'] }])
    expect(missing.get('1471')).not.toHaveProperty('noticeComponents')
    expect(missing.get('1471')).not.toHaveProperty('noticeCapacity')
  })

  it('uses a normalized exact product name only when no SKU match exists and it is unique', async () => {
    mocks.execute.mockResolvedValue([{ ...base, requestId: 'legacy', skuMatch: false, qualityPdfId: null, qualityPdfFileName: null, qualityPdfContentType: null }])
    const result = await findRegistrationProductMasters('workspace-owner', [{ id: 'legacy', name: '마미백 플러스', skus: [] }])
    expect(result.get('1471')).toBeUndefined()
    expect(result.get('legacy')).toMatchObject({ itemId: 'item-1', match: 'name' })
    expect(result.get('legacy')).not.toHaveProperty('qualityPdf')
  })
})
