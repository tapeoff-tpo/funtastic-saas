import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ values: vi.fn(), previous: [] as Record<string, unknown>[], stocks: [] as Record<string, unknown>[] }))
vi.mock('@/lib/db', () => ({ db: {
  execute: vi.fn().mockResolvedValue([]),
  transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
    execute: vi.fn().mockResolvedValue([]),
    delete: () => ({ where: () => ({ returning: async () => mocks.previous }) }),
    select: () => ({ from: () => ({ where: () => ({ groupBy: async () => mocks.stocks }) }) }),
    insert: () => ({ values: mocks.values }),
  }),
} }))
vi.mock('xlsx', () => ({
  read: () => ({ Sheets: {
    '상품등록': [[], [], ['상품코드', '상품명', '옵션'], ['112001-0001', '등록 상품', '블랙']],
    '메인': [[], ['상품코드', '상품명', '옵션', 'B2B 판매가'], ['112001-0001', '상품', '블랙', '1000'], ['112002-0001', '재고없음', '블랙', '2000']],
  } }),
  utils: { sheet_to_json: (sheet: unknown) => sheet },
}))
import { importPriceTableRows } from './price-table'
it('keeps old workbook uploads consolidated, archives nonstock rows and retains manual price edits', async () => {
  mocks.previous = [{ sourceSheetName: '재고통합', productCode: '112001-0001', productName: '상품', optionName: '블랙',
    rawData: { '__registrationEdit:price:coupang': '1200' } }]
  mocks.stocks = [{ sku: '112001-0001', quantity: 5, optionName: '블랙' }, { sku: '112002-0001', quantity: 0, optionName: '블랙' }]
  mocks.values.mockResolvedValue(undefined)
  const result = await importPriceTableRows({ userId: 'owner', fileBuffer: new ArrayBuffer(0), sourceFileName: 'original.xlsx' })
  const rows = mocks.values.mock.calls.flatMap(([rows]) => rows)
  expect(rows.find((row) => row.sourceSheetName === '재고통합').rawData['__registrationEdit:price:coupang']).toBe('1200')
  expect(rows.find((row) => row.sourceSheetName === '상품등록').productName).toBe('등록 상품')
  expect(rows.find((row) => row.productCode === '112002-0001').rawData.__priceTableArchive).toContain('통합 업로드 원본')
  expect(result.sheets).toEqual([{ name: '상품등록', rows: 1 }, { name: '재고통합', rows: 1 }])
  expect(result.imported).toBe(2)
})
