import { describe, expect, it } from 'vitest'
import { attachCatalog, calculatePrice, createRegistrationRow, detailHtml, matchCatalog, resolveItemCost, type CatalogProduct } from '@/lib/coupang-registration/model'
import { itemNewCost } from '@/lib/coupang-registration/item-cost'
import { rowSchema } from '@/lib/coupang-registration/schema'

const source: CatalogProduct = { code: '1471', name: '마미백 플러스', price: 15000, status: 'SELLING', thumbnails: ['https://cdn.tapeoff.kr/front.jpg'], detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], options: [{ name: '베이지', addPrice: 0 }], notice: [], costCandidates: [] }

describe('Coupang pricing and matching', () => {
  it('gives Coupang 40% of retail while showing our profit against supply', () => {
    const row = { ...createRegistrationRow(source, '베이지'), costPrice: 10000 }
    expect(calculatePrice(row)).toMatchObject({ supply: 15000, sale: 25000, profit: 15000 - 10000 - 15000 / 11, coupangRate: 40 })
    expect(calculatePrice({ ...row, priceMode: 'markup', markupPercent: 20 })).toMatchObject({ supply: 18000, sale: 30000, profit: 18000 - 10000 - 18000 / 11, coupangRate: 40 })
    expect(calculatePrice({ ...row, priceMode: 'manual', manualSupplyPrice: 21000 })).toMatchObject({ supply: 21000, sale: 35000, profit: 21000 - 10000 - 21000 / 11 })
  })
  it('keeps unknown costs blank and rounds retail upward by the chosen unit', () => {
    const row = { ...createRegistrationRow(source), wholesalePrice: 10000 }
    expect(calculatePrice(row, 100)).toMatchObject({ supply: 10000, sale: 16700, profit: null })
    expect(calculatePrice({ ...row, wholesalePrice: null })).toMatchObject({ supply: null, sale: null })
    expect(calculatePrice({ ...row, costPrice: 12000 }).profit).toBeCloseTo(10000 - 12000 - 10000 / 11)
  })
  it('does not guess a wholesale price for an unmatched bundle or overwrite an imported supply price', () => {
    const row = { ...createRegistrationRow(), name: '마미백 플러스 베이지 2개입 세트', priceMode: 'manual' as const, manualSupplyPrice: 17000 }
    const result = attachCatalog(row, source)
    expect(result.wholesalePrice).toBeNull()
    expect(result.manualSupplyPrice).toBe(17000)
    expect(result.sourceCode).toBe('1471')
    expect(matchCatalog(row, [source, { ...source, code: 'OTHER' }])).toBeNull()
  })
  it('matches the current workbook VAT and net profit formulas', () => {
    const result = calculatePrice({ ...createRegistrationRow(), costPrice: 2646, priceMode: 'manual', manualSupplyPrice: 4800, saleMode: 'manual', manualSalePrice: 8000 })
    expect(result.salesVat).toBeCloseTo(4800 / 11)
    expect(result.profit).toBeCloseTo(4800 - 2646 - 4800 / 11)
    expect(result.profitRate).toBeCloseTo((4800 - 2646 - 4800 / 11) / 4800 * 100)
    expect(result.coupangRate).toBe(40)
  })
  it('retains manual retail independently and supports legacy saved rows', () => {
    const row = { ...createRegistrationRow(source), saleMode: 'manual' as const, manualSalePrice: 28000 }
    expect(calculatePrice(row, 1000)).toMatchObject({ supply: 15000, sale: 28000 })
    expect(calculatePrice({ ...row, priceMode: 'manual', manualSupplyPrice: 16000 }).sale).toBe(28000)
    expect(calculatePrice({ ...row, manualSalePrice: null }).sale).toBeNull()
    expect(calculatePrice({ ...row, manualSalePrice: 0 }).sale).toBeNull()
    const { saleMode, manualSalePrice, ...legacy } = row
    expect(rowSchema.parse(legacy)).toMatchObject({ saleMode: 'auto', manualSalePrice: null })
    expect(calculatePrice(legacy).sale).toBe(25000)
  })
  it('matches the 2026 workbook row 101 with the saved 10% supply deduction', () => {
    const row = rowSchema.parse({
      ...createRegistrationRow(), costPrice: 6886, priceMode: 'manual', manualSupplyPrice: 11000,
      saleMode: 'manual', manualSalePrice: 16000, supplyDeductionPercent: 10,
    })
    const result = calculatePrice(row)
    expect(result).toMatchObject({ salesVat: 1000, deduction: 1100, profit: 2014, coupangRate: 31.25 })
    expect(result.profitRate).toBeCloseTo(18.3090909091)
    const legacy = { ...row, supplyDeductionPercent: undefined }
    expect(rowSchema.parse(legacy).supplyDeductionPercent).toBe(0)
    expect(calculatePrice(legacy).profit).toBe(3114)
  })
  it('preserves fractional supply and uses the entered VAT for a bundle', () => {
    const row = rowSchema.parse({
      ...createRegistrationRow(), costPrice: 2549, priceMode: 'manual', manualSupplyPrice: 6134.4,
      saleMode: 'manual', manualSalePrice: 10224, supplyDeductionPercent: 10, manualSalesVat: 950.25,
    })
    const result = calculatePrice(row)
    expect(result.supply).toBe(6134.4)
    expect(result.salesVat).toBe(950.25)
    expect(result.profit).toBeCloseTo(2021.71)
    expect(result.coupangRate).toBeCloseTo(40)
    expect(calculatePrice({ ...row, manualSalesVat: null }).salesVat).toBeCloseTo(6134.4 / 11)
  })
  it('connects known SKUs and normalized option titles without substituting another option', () => {
    const costs = [
      { sku: '112361', name: '마미백 플러스', optionName: '', costPrice: null },
      { sku: '112361-0001', name: '마미백 플러스', optionName: '베이지(소)', costPrice: 8776 },
      { sku: '112361-0002', name: '마미백 플러스', optionName: '블랙', costPrice: null },
    ]
    const base = { name: '마미백플러스 베이지 소', internalSku: '', sourceName: '', optionName: '' }
    expect(resolveItemCost(base, costs)?.costPrice).toBe(8776)
    expect(resolveItemCost({ ...base, internalSku: '112361-0002' }, costs)?.costPrice).toBeNull()
    expect(resolveItemCost({ ...base, sourceName: '마미백 플러스', optionName: '다른 옵션' }, costs)).toBeUndefined()
    expect(resolveItemCost({ ...base, sourceName: '마미백 플러스' }, costs)).toBeUndefined()
  })
  it('reads only item-master new KRW cost and preserves missing versus zero', () => {
    expect(itemNewCost({ esa009m: { 'works 신규 원가': '8,776', 'works 기존 원가': '10000', '신규원가(元)': '20' } })).toBe(8776)
    for (const value of ['', '  ', null, undefined]) expect(itemNewCost({ esa009m: { 'works 신규 원가': value, 'works 기존 원가': '10000' } })).toBeNull()
    expect(itemNewCost({ esa009m: { 'works 신규 원가': '0' } })).toBe(0)
    expect(itemNewCost(null)).toBeNull()
  })
  it('only produces escaped, scriptless HTML with public HTTPS JPEG/PNG images', () => {
    const html = detailHtml(['javascript:alert(1)', 'https://cdn.tapeoff.kr/image.svg', 'https://cdn.tapeoff.kr/a.jpg', 'https://cdn.tapeoff.kr/a.jpg'], '"><script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).toContain('&lt;script&gt;')
  })
})
