import { beforeEach, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
const mocks = vi.hoisted(() => ({ values: vi.fn(), where: vi.fn(), includeRegistration: true }))
vi.mock('@/lib/db', () => ({ db: {
  execute: vi.fn().mockResolvedValue([]),
  transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
    execute: vi.fn().mockResolvedValue([]),
    delete: () => ({ where: (condition: unknown) => { mocks.where(condition); return { returning: async () => [{
      sourceSheetName: '상품등록', productCode: '112001-0001', productName: '등록 상품', optionName: '블랙',
      rawData: { '__registrationEdit:price:coupang': '1200' },
    }] } } }),
    insert: () => ({ values: mocks.values }),
  }),
} }))
vi.mock('xlsx', () => ({
  read: () => ({ Sheets: {
    ...(mocks.includeRegistration ? { '상품등록': [[], [], ['상품코드', '상품명', '옵션'], ['112001-0001', '등록 상품', '블랙']] } : {}),
    '메인': [[], ['상품코드', '상품명', '옵션', 'B2B 판매가'], ['112001-0001', '상품', '블랙', '1000']],
    '뉴도매': [[], ['상품코드', '상품명', '옵션'], ['YL001', '상품', '블랙']],
    '재고통합': [['상품코드', '상품명', '옵션'], ['112002-0001', '다른 상품', '화이트']],
  } }),
  utils: { sheet_to_json: (sheet: unknown) => sheet },
}))
import { importPriceTableRows } from './price-table'
beforeEach(() => { vi.clearAllMocks(); mocks.includeRegistration = true; mocks.values.mockResolvedValue(undefined) })
it('imports only registration and restricts replacement to that sheet, preserving manual price edits', async () => {
  const result = await importPriceTableRows({ userId: 'owner', fileBuffer: new ArrayBuffer(0), sourceFileName: 'original.xlsx' })
  const rows = mocks.values.mock.calls.flatMap(([rows]) => rows)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ sourceSheetName: '상품등록', productName: '등록 상품', rawData: { '__registrationEdit:price:coupang': '1200' } })
  const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0])
  expect(query.sql).toContain('"source_sheet_name" =')
  expect(query.params).toContain('상품등록')
  expect(result.sheets).toEqual([{ name: '상품등록', rows: 1 }])
  expect(result.imported).toBe(1)
})
it('rejects a workbook without registration before replacing any operational rows', async () => {
  mocks.includeRegistration = false
  await expect(importPriceTableRows({ userId: 'owner', fileBuffer: new ArrayBuffer(0), sourceFileName: 'main-only.xlsx' })).rejects.toThrow('상품등록 시트가 없습니다')
  expect(mocks.where).not.toHaveBeenCalled()
  expect(mocks.values).not.toHaveBeenCalled()
})
