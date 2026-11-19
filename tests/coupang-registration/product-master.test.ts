// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('uses a normalized exact product name only when no SKU match exists and it is unique', async () => {
    mocks.execute.mockResolvedValue([{ ...base, requestId: 'legacy', skuMatch: false, qualityPdfId: null, qualityPdfFileName: null, qualityPdfContentType: null }])
    const result = await findRegistrationProductMasters('workspace-owner', [{ id: 'legacy', name: '마미백 플러스', skus: [] }])
    expect(result.get('1471')).toBeUndefined()
    expect(result.get('legacy')).toMatchObject({ itemId: 'item-1', match: 'name' })
    expect(result.get('legacy')).not.toHaveProperty('qualityPdf')
  })
})
