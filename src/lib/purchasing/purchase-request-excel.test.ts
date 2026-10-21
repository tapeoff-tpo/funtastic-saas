// @vitest-environment node
import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'
import { canonicalPurchaseRequestExcelHeader, exportPurchaseRequestsExcel } from './purchase-request-excel'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({ orderBy: async () => mocks.rows }),
        }),
      }),
    }),
  },
}))
vi.mock('@/lib/new-products/cny-cost', () => ({
  getLatestCnyKrwReferenceRate: async () => ({ rate: 200 }),
}))
vi.mock('./items', () => ({ getSkuOutgoingMetrics: async () => new Map() }))
vi.mock('./purchase-payment-tracking', () => ({ ensurePurchasePaymentTrackingSchema: async () => {} }))

describe('canonicalPurchaseRequestExcelHeader', () => {
  it.each([
    ['품목코드', '품목코드'],
    ['상품코드', '품목코드'],
    ['상품 코드', '품목코드'],
    ['SKU', '품목코드'],
    ['품명', '상품명'],
    ['품목명', '상품명'],
    ['제품명', '상품명'],
    ['옵션', '옵션명'],
    ['규격', '옵션명'],
    ['수량', '요청수량'],
    ['발주수량', '요청수량'],
    ['구매 수량', '요청수량'],
    ['주문수량', '요청수량'],
    ['지연사유', '지연사유'],
    ['지연 상세', '지연 상세'],
    ['품목 발주상태', '품목 발주상태'],
    ['총 현재고', '총 현재고'],
    ['목표수량', '목표수량'],
  ])('%s 열을 %s 열로 인식한다', (input, expected) => {
    expect(canonicalPurchaseRequestExcelHeader(input)).toBe(expected)
  })

  it('알 수 없는 열은 무시한다', () => {
    expect(canonicalPurchaseRequestExcelHeader('판매가')).toBeNull()
  })
})

describe('exportPurchaseRequestsExcel', () => {
  it('화면에 표시된 추천 시점의 현재고와 목표수량을 숫자로 내보낸다', async () => {
    mocks.rows = [
      {
        id: 'automatic', status: 'requested', sku: '100001-0001', productName: '자동 추천',
        requestedQuantity: 20,
        rawData: { source: 'auto_purchase_recommendation', availableStock: 85, targetStockQuantity: 128 },
      },
      {
        id: 'negative', status: 'requested', sku: '100001-0002', productName: '음수 재고',
        requestedQuantity: 20,
        rawData: { source: 'auto_purchase_recommendation', availableStock: '-3', targetStockQuantity: 0 },
      },
      {
        id: 'manual', status: 'requested', sku: '100001-0003', productName: '수동 등록',
        requestedQuantity: 10,
        rawData: { source: 'purchase_request_excel', availableStock: 50, targetStockQuantity: 100 },
      },
      {
        id: 'missing', status: 'requested', sku: '100001-0004', productName: '추천근거 없음',
        requestedQuantity: 10,
        rawData: { source: 'auto_purchase_recommendation', availableStock: null, targetStockQuantity: '잘못된 값' },
      },
    ]

    const bytes = await exportPurchaseRequestsExcel({ userId: 'workspace', status: 'requested' })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const sheet = workbook.getWorksheet('발주')!
    const headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).map(String)
    const stockColumn = headers.indexOf('총 현재고')
    const targetColumn = headers.indexOf('목표수량')

    expect(stockColumn).toBeGreaterThan(0)
    expect(targetColumn).toBeGreaterThan(stockColumn)
    expect(sheet.getRow(2).getCell(stockColumn).value).toBe(85)
    expect(sheet.getRow(2).getCell(targetColumn).value).toBe(128)
    expect(sheet.getRow(3).getCell(stockColumn).value).toBe(-3)
    expect(sheet.getRow(3).getCell(targetColumn).value).toBe(0)
    expect(sheet.getRow(4).getCell(stockColumn).value).toBe('')
    expect(sheet.getRow(4).getCell(targetColumn).value).toBe('')
    expect(sheet.getRow(5).getCell(stockColumn).value).toBe('')
    expect(sheet.getRow(5).getCell(targetColumn).value).toBe('')
  })
})
