// @vitest-environment node
import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'
import { canonicalPurchaseRequestExcelHeader, exportPurchaseRequestsExcel } from './purchase-request-excel'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  metrics: new Map<string, Record<string, number | string | null>>(),
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
vi.mock('./purchase-requests', () => ({
  getPurchaseReviewOperationalMetricsBySku: async () => mocks.metrics,
  getPurchaseReviewList: async () => ({
    items: mocks.rows.map((row) => {
      const rawData = row.rawData as Record<string, unknown>
      const stockCoverageMonths = Number(rawData.stockCoverageMonths)
      const urgent = rawData.source === 'auto_purchase_recommendation'
        && Number.isFinite(stockCoverageMonths)
        && stockCoverageMonths <= 1
      return {
        id: typeof row.id === 'string' ? row.id : null,
        reviewStatus: Number(row.requestedQuantity ?? 0) > 0 ? 'review' : 'not_required',
        status: 'requested',
        sku: String(row.sku ?? ''),
        productName: String(row.productName ?? ''),
        optionName: null,
        requestedQuantity: Number(row.requestedQuantity ?? 0),
        actualPurchaseQuantity: null,
        chinaReceivedQuantity: null,
        rawData,
        requestDate: null,
        outboundExpectedDate: null,
        purchaseManagementCode: null,
        supplierOrderNumber: null,
        trackingNumber: null,
        purchaseMethod: null,
        paymentStatus: 'pending',
        paymentPaidAt: null,
        bulkPaymentPending: false,
        bulkPaymentDueDate: null,
        delayReason: null,
        delayNote: null,
        memo: null,
        buyerCode: null,
        buyerName: null,
        managerCode: null,
        purchaseUrl: null,
        purchasingStatus: null,
        purchasingStatusNote: null,
        chinaCurrentStock: 0,
        costExchangeRateKrw: null,
        specialPriceCny: null,
        newCostCny: null,
        unitCostYuan: null,
        unitCostKrw: null,
        totalCostYuan: null,
        totalCostKrw: null,
        purchaseReviewMetrics: mocks.metrics.get(String(row.sku ?? '')) ?? null,
        purchaseReviewHistory: null,
        purchaseUrgencyStatus: urgent ? 'urgent' : null,
      }
    }),
  }),
}))
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
    ['요청수량', '발주수량'],
    ['수량', '발주수량'],
    ['발주수량', '발주수량'],
    ['구매 수량', '발주수량'],
    ['주문수량', '발주수량'],
    ['송장번호', '송장번호'],
    ['중국출고요청수량', '중국출고요청수량'],
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
  it('발주검토 외 엑셀의 기존 열 순서는 유지한다', async () => {
    mocks.rows = []
    mocks.metrics = new Map()
    const bytes = await exportPurchaseRequestsExcel({ userId: 'workspace', status: 'purchased' })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const sheet = workbook.getWorksheet('발주')!
    expect(sheet.getCell('A1').value).toBe('ID')
    expect(sheet.getCell('B1').value).toBe('상태')
  })

  it('발주검토 다운로드 B열에 화면과 같은 추천근거를 넣고 ID를 유지한다', async () => {
    mocks.rows = [{
      id: 'review-id', status: 'requested', sku: '100001-0001', productName: '테스트', requestedQuantity: 20,
      rawData: {
        source: 'auto_purchase_recommendation', targetStockQuantity: 128, stockCoverageMonths: 0.8,
        salesTrend: 'increasing', effectiveMonthlyOutgoing: 65.5,
        salesAnomalyDetected: true, oneOffCurrentMonthSpikeDetected: true,
        currentMonthLargestOrderQuantity: 80, currentMonthOrderCount: 1,
        moqProductGroupName: '테스트', moqMinimumOrderQuantity: 200, baseRecommendedQuantity: 20,
        moqAdjustedQuantity: 200, allocatedQuantity: 100,
      },
    }]
    mocks.metrics = new Map([['100001-0001', {
      lastPurchaseQuantity: 40, purchaseInProgressQuantity: 30, chinaOutboundScheduledQuantity: 15,
      domesticCurrentStock: 76, chinaCurrentStock: 15, currentStock: 91,
      currentMonthOutgoing: 45, threeMonthAverageOutgoing: 85.3, targetStockQuantity: 103,
    }]])
    const bytes = await exportPurchaseRequestsExcel({ userId: 'workspace', status: 'requested' })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const sheet = workbook.getWorksheet('발주')!
    expect(sheet.getCell('A1').value).toBe('ID')
    expect(sheet.getCell('B1').value).toBe('추천근거')
    expect(sheet.getCell('A2').value).toBe('review-id')
    const basis = String(sheet.getCell('B2').value)
    expect(basis).toContain('총 현재고: 91')
    expect(basis).toContain('목표수량: 128')
    expect(basis).toContain('판매 증가 · 평균 50% + 당월 50% (65.5)')
    expect(basis).toContain('단일 주문 급증 80개 / 1건 · 평균 제외')
    expect(basis).toContain('MOQ 제품 · 최소 200개 · 보정 20 → 200')
    expect(basis).toContain('예산 조정 200 → 100')
    expect(sheet.getCell('B2').alignment.wrapText).toBe(true)
    expect(canonicalPurchaseRequestExcelHeader('추천근거')).toBe('추천근거')
  })

  it('현재 재고·진행 구매·중국출고 예정과 목표수량을 함께 내보낸다', async () => {
    mocks.rows = [
      {
        id: 'automatic', status: 'requested', sku: '100001-0001', productName: '자동 추천',
        requestedQuantity: 20,
        rawData: {
          source: 'auto_purchase_recommendation', availableStock: 85, targetStockQuantity: 128, stockCoverageMonths: 0.8,
        },
      },
      {
        id: 'negative', status: 'requested', sku: '100001-0002', productName: '음수 재고',
        requestedQuantity: 20,
        rawData: {
          source: 'auto_purchase_recommendation', availableStock: '-3', targetStockQuantity: 0, stockCoverageMonths: -0.3,
        },
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
    mocks.metrics = new Map([
      ['100001-0001', {
        lastPurchaseQuantity: 40,
        purchaseInProgressQuantity: 30,
        chinaOutboundScheduledQuantity: 15,
        domesticCurrentStock: 76,
        chinaCurrentStock: 15,
        currentStock: 91,
        currentMonthOutgoing: 45,
        threeMonthAverageOutgoing: 85.3,
        targetStockQuantity: 103,
      }],
      ['100001-0002', {
        lastPurchaseQuantity: null,
        purchaseInProgressQuantity: 0,
        chinaOutboundScheduledQuantity: 0,
        domesticCurrentStock: -3,
        chinaCurrentStock: 0,
        currentStock: -3,
        currentMonthOutgoing: 2,
        threeMonthAverageOutgoing: 10,
        targetStockQuantity: 12,
      }],
      ['100001-0003', {
        lastPurchaseQuantity: 20,
        purchaseInProgressQuantity: 5,
        chinaOutboundScheduledQuantity: 4,
        domesticCurrentStock: 47,
        chinaCurrentStock: 4,
        currentStock: 51,
        currentMonthOutgoing: 12,
        threeMonthAverageOutgoing: 22,
        targetStockQuantity: 27,
      }],
    ])

    const bytes = await exportPurchaseRequestsExcel({ userId: 'workspace', status: 'requested' })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const sheet = workbook.getWorksheet('발주')!
    const headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).map(String)
    const stockColumn = headers.indexOf('총 현재고')
    const latestPurchaseColumn = headers.indexOf('최근 발주수량')
    const inProgressColumn = headers.indexOf('진행 구매수량')
    const outboundScheduledColumn = headers.indexOf('중국출고 예정수량')
    const domesticStockColumn = headers.indexOf('국내재고')
    const chinaStockColumn = headers.indexOf('중국재고')
    const targetColumn = headers.indexOf('목표수량')
    const urgencyColumn = headers.indexOf('구매 우선상태')
    const coverageColumn = headers.indexOf('재고 보유개월')

    expect(stockColumn).toBeGreaterThan(0)
    expect(latestPurchaseColumn).toBeGreaterThan(0)
    expect(inProgressColumn).toBeGreaterThan(latestPurchaseColumn)
    expect(outboundScheduledColumn).toBeGreaterThan(inProgressColumn)
    expect(domesticStockColumn).toBeGreaterThan(outboundScheduledColumn)
    expect(chinaStockColumn).toBeGreaterThan(domesticStockColumn)
    expect(targetColumn).toBeGreaterThan(stockColumn)
    expect(headers).toContain('발주수량')
    expect(headers).not.toContain('요청수량')
    expect(headers).not.toContain('중국출고요청수량')
    expect(urgencyColumn).toBeGreaterThan(0)
    expect(coverageColumn).toBeGreaterThan(targetColumn)
    expect(sheet.getRow(2).getCell(stockColumn).value).toBe(91)
    expect(sheet.getRow(2).getCell(latestPurchaseColumn).value).toBe(40)
    expect(sheet.getRow(2).getCell(inProgressColumn).value).toBe(30)
    expect(sheet.getRow(2).getCell(outboundScheduledColumn).value).toBe(15)
    expect(sheet.getRow(2).getCell(domesticStockColumn).value).toBe(76)
    expect(sheet.getRow(2).getCell(chinaStockColumn).value).toBe(15)
    expect(sheet.getRow(2).getCell(targetColumn).value).toBe(128)
    expect(sheet.getRow(2).getCell(urgencyColumn).value).toBe('긴급구매')
    expect(sheet.getRow(2).getCell(coverageColumn).value).toBe(0.8)
    expect(sheet.getRow(3).getCell(stockColumn).value).toBe(-3)
    expect(sheet.getRow(3).getCell(latestPurchaseColumn).value).toBe('')
    expect(sheet.getRow(3).getCell(inProgressColumn).value).toBe(0)
    expect(sheet.getRow(3).getCell(outboundScheduledColumn).value).toBe(0)
    expect(sheet.getRow(3).getCell(domesticStockColumn).value).toBe(-3)
    expect(sheet.getRow(3).getCell(chinaStockColumn).value).toBe(0)
    expect(sheet.getRow(3).getCell(targetColumn).value).toBe(0)
    expect(sheet.getRow(3).getCell(urgencyColumn).value).toBe('긴급구매')
    expect(sheet.getRow(3).getCell(coverageColumn).value).toBe(-0.3)
    expect(sheet.getRow(4).getCell(stockColumn).value).toBe(51)
    expect(sheet.getRow(4).getCell(latestPurchaseColumn).value).toBe(20)
    expect(sheet.getRow(4).getCell(inProgressColumn).value).toBe(5)
    expect(sheet.getRow(4).getCell(outboundScheduledColumn).value).toBe(4)
    expect(sheet.getRow(4).getCell(domesticStockColumn).value).toBe(47)
    expect(sheet.getRow(4).getCell(chinaStockColumn).value).toBe(4)
    expect(sheet.getRow(4).getCell(targetColumn).value).toBe(27)
    expect(sheet.getRow(4).getCell(urgencyColumn).value).toBe('')
    expect(sheet.getRow(4).getCell(coverageColumn).value).toBe('')
    expect(sheet.getRow(5).getCell(stockColumn).value).toBe('')
    expect(sheet.getRow(5).getCell(latestPurchaseColumn).value).toBe('')
    expect(sheet.getRow(5).getCell(inProgressColumn).value).toBe(0)
    expect(sheet.getRow(5).getCell(outboundScheduledColumn).value).toBe(0)
    expect(sheet.getRow(5).getCell(domesticStockColumn).value).toBe('')
    expect(sheet.getRow(5).getCell(chinaStockColumn).value).toBe('')
    expect(sheet.getRow(5).getCell(targetColumn).value).toBe('')
    expect(sheet.getRow(5).getCell(urgencyColumn).value).toBe('')
    expect(sheet.getRow(5).getCell(coverageColumn).value).toBe('')
  })

  it('전상품 발주검토 엑셀에는 발주불필요 품목도 수량 0으로 포함한다', async () => {
    mocks.rows = [
      {
        id: 'review', status: 'requested', sku: '100002-0001', productName: '발주 필요 품목',
        requestedQuantity: 20,
        rawData: { source: 'auto_purchase_recommendation', stockCoverageMonths: 1.2 },
      },
      {
        sku: '100002-0002', productName: '발주 불필요 품목',
        requestedQuantity: 0,
        rawData: {},
      },
    ]
    mocks.metrics = new Map()

    const bytes = await exportPurchaseRequestsExcel({ userId: 'workspace', status: 'requested' })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const sheet = workbook.getWorksheet('발주')!
    const headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).map(String)
    const statusColumn = headers.indexOf('상태')
    const quantityColumn = headers.indexOf('발주수량')

    expect(statusColumn).toBeGreaterThan(0)
    expect(quantityColumn).toBeGreaterThan(0)
    expect(sheet.getRow(2).getCell(statusColumn).value).toBe('발주검토')
    expect(sheet.getRow(2).getCell(quantityColumn).value).toBe(20)
    expect(sheet.getRow(3).getCell(statusColumn).value).toBe('발주불필요')
    expect(sheet.getRow(3).getCell(quantityColumn).value).toBe(0)
  })
})
