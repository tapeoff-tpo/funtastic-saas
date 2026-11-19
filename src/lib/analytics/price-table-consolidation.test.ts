import { expect, it } from 'vitest'
import { consolidatePriceRows, CONSOLIDATED_PRICE_SHEET, type ConsolidationRow } from './price-table-consolidation'
const row = (id: string, sheet: string, code: string, raw: Record<string, unknown> = {}, option = '블랙'): ConsolidationRow => ({
  id, sourceSheetName: sheet, productCode: code, productName: '상품', optionName: option, rowNumber: 1, rawData: raw,
})
const run = (rows: ConsolidationRow[], referenceRows: ConsolidationRow[] = [], stocks = [{ sku: '112001-0001', quantity: 10, optionName: '블랙' }]) =>
  consolidatePriceRows({ rows, referenceRows, stocks, archiveKey: 'backup-key' })
it('keeps stocked options and archives zero/unknown stock without modifying registration rows', () => {
  const registration = row('registration', '상품등록', '112001-0001')
  const result = run([registration, row('stock', '메인', '112001-0001'), row('zero', '메인', '112002-0001'), row('unknown', '메인', '112003-0001')], [], [
    { sku: '112001-0001', quantity: 10, optionName: '블랙' }, { sku: '112002-0001', quantity: 0, optionName: '블랙' },
  ])
  expect(result.active).toHaveLength(1)
  expect(result.active[0]).toMatchObject({ id: 'stock', sourceSheetName: CONSOLIDATED_PRICE_SHEET })
  expect(result.archived.map(({ reason }) => reason)).toEqual(['현재 가용재고 없음', '재고 자료 미확인'])
  expect(registration.rawData).toEqual({})
})
it('merges explicit YL identifiers and matching options, keeping both registration numbers and conflicting source prices', () => {
  const result = run([
    row('main', '메인', '112001-0001', { 'B2B 판매가': '1000', '★ 판매가': '1100', '도매꾹(T) 상품번호': 'OLD' }),
    row('new', '뉴도매', 'YL001', { 'W트레이딩 상품코드': 'SAME', '도매꾹(T) 상품번호': 'NEW', '도매꾹(T) 판매가': '1200' }),
  ], [row('reference', '상품등록', '112001-0001', { 'W트레이딩 상품코드': 'SAME' })])
  expect(result.active).toHaveLength(1)
  expect(result.active[0].rawData['B2B 판매가']).toBe('1000')
  expect(result.active[0].rawData['★ 판매가']).toBe('1100')
  expect(JSON.parse(String(result.active[0].rawData['__registrationEdit:identifiers:domeme'])).map((n: { value: string }) => n.value)).toEqual(['OLD', 'NEW'])
  expect(String(result.active[0].rawData.__priceConsolidationSources)).toContain('1200')
  expect(result.archived[0].reason).toBe('같은 SKU로 통합')
})
it('never guesses identity from names, missing options, or ambiguous identifiers', () => {
  const result = run([row('name-only', '뉴도매', 'YL001'), row('ambiguous', '뉴도매', 'YL002', { 'W트레이딩 상품코드': 'SHARED' }), row('no-option', '뉴도매', 'YL003', { 'W트레이딩 상품코드': 'UNIQUE' }, '')], [
    row('a', '상품등록', '112001-0001', { 'W트레이딩 상품코드': 'SHARED' }),
    row('b', '상품등록', '112002-0001', { 'W트레이딩 상품코드': 'SHARED' }),
    row('c', '상품등록', '112003-0001', { 'W트레이딩 상품코드': 'UNIQUE' }),
  ])
  expect(result.active).toHaveLength(0)
  expect(result.archived).toHaveLength(3)
  expect(result.archived.every((entry) => entry.reason.includes('미확인'))).toBe(true)
})
it('retains separate option SKUs rather than collapsing all options into one product', () => {
  const result = run([row('a', '메인', '112001-0001'), row('b', '메인', '112001-0002')], [], [
    { sku: '112001-0001', quantity: 2, optionName: '블랙' }, { sku: '112001-0002', quantity: 3, optionName: '화이트' },
  ])
  expect(result.active).toHaveLength(2)
  expect(result.archived).toHaveLength(0)
})
it('respects a manually cleared legacy identifier rather than restoring the imported number', () => {
  const result = run([row('main', '메인', '112001-0001'), row('new', '뉴도매', 'YL001', {
    'W트레이딩 상품코드': 'SAME', '도매꾹(T) 상품번호': 'DO-NOT-RESTORE', '__registrationEdit:identifiers:new-domeme': '[]',
  })], [row('ref', '상품등록', '112001-0001', { 'W트레이딩 상품코드': 'SAME' })])
  expect(result.active).toHaveLength(1)
  expect(result.active[0].rawData['__registrationEdit:identifiers:domeme']).toBe('[]')
})
