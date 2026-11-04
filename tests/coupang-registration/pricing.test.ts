import { describe, expect, it } from 'vitest'
import { attachCatalog, calculatePrice, createRegistrationRow, detailHtml, matchCatalog, type CatalogProduct } from '@/lib/coupang-registration/model'

const source: CatalogProduct = { code: '1471', name: '마미백 플러스', price: 15000, status: 'SELLING', thumbnails: ['https://cdn.tapeoff.kr/front.jpg'], detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], options: [{ name: '베이지', addPrice: 0 }], notice: [], costCandidates: [] }

describe('Coupang pricing and matching', () => {
  it('gives Coupang 40% of retail while showing our profit against supply', () => {
    const row = { ...createRegistrationRow(source, '베이지'), costPrice: 10000 }
    expect(calculatePrice(row)).toMatchObject({ supply: 15000, sale: 25000, profit: 5000, coupangRate: 40 })
    expect(calculatePrice({ ...row, priceMode: 'markup', markupPercent: 20 })).toMatchObject({ supply: 18000, sale: 30000, profit: 8000, coupangRate: 40 })
    expect(calculatePrice({ ...row, priceMode: 'manual', manualSupplyPrice: 21000 })).toMatchObject({ supply: 21000, sale: 35000, profit: 11000 })
  })
  it('keeps unknown costs blank and rounds retail upward by the chosen unit', () => {
    const row = { ...createRegistrationRow(source), wholesalePrice: 10000 }
    expect(calculatePrice(row, 100)).toMatchObject({ supply: 10000, sale: 16700, profit: null })
    expect(calculatePrice({ ...row, wholesalePrice: null })).toMatchObject({ supply: null, sale: null })
    expect(calculatePrice({ ...row, costPrice: 12000 }).profit).toBe(-2000)
  })
  it('does not guess a wholesale price for an unmatched bundle or overwrite an imported supply price', () => {
    const row = { ...createRegistrationRow(), name: '마미백 플러스 베이지 2개입 세트', priceMode: 'manual' as const, manualSupplyPrice: 17000 }
    const result = attachCatalog(row, source)
    expect(result.wholesalePrice).toBeNull()
    expect(result.manualSupplyPrice).toBe(17000)
    expect(result.sourceCode).toBe('1471')
    expect(matchCatalog(row, [source, { ...source, code: 'OTHER' }])).toBeNull()
  })
  it('only produces escaped, scriptless HTML with public HTTPS JPEG/PNG images', () => {
    const html = detailHtml(['javascript:alert(1)', 'https://cdn.tapeoff.kr/image.svg', 'https://cdn.tapeoff.kr/a.jpg', 'https://cdn.tapeoff.kr/a.jpg'], '"><script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).toContain('&lt;script&gt;')
  })
})
