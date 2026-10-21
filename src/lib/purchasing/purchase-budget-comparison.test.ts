// @vitest-environment node
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildPurchaseBudgetComparison, type BudgetComparisonCandidate, type BudgetReviewRow } from './purchase-budget-comparison'
import { exportPurchaseBudgetComparisonExcel } from './purchase-budget-comparison-excel'

function review(sku: string, quantity: number, source = 'auto_purchase_recommendation'): BudgetReviewRow {
  return {
    sku, productName: `상품 ${sku}`, optionName: '옵션', requestedQuantity: quantity,
    costExchangeRateKrw: null, rawData: { source },
  }
}

function candidate(sku: string, recommendedQuantity: number, allocatedQuantity: number, extra: Partial<BudgetComparisonCandidate> = {}): BudgetComparisonCandidate {
  return {
    sku, productName: `상품 ${sku}`, optionName: '옵션', recommendedQuantity, allocatedQuantity,
    availableStock: -3, pipelineQuantity: 10, targetStockQuantity: 100,
    unitCostYuan: 10, unitCostKrw: 2100, moqProductGroupName: null, siblingOptionBundleGroupName: null,
    ...extra,
  }
}

function comparison() {
  return buildPurchaseBudgetComparison({
    calculatedAt: new Date('2026-10-21T02:00:00.000Z'),
    targetStockMonths: 1.5,
    budgetKrw: 6_000_000,
    spentBudgetKrw: 5_950_000,
    exchangeRateKrw: 200,
    beforeRows: [review('A', 100), review('B', 100), review('C', 50), review('C', 5, 'manual'), review('E', 20)],
    afterRows: [review('B', 40), review('C', 50), review('C', 5, 'manual'), review('D', 10)],
    candidates: [
      candidate('A', 100, 0, { moqProductGroupName: 'MOQ 그룹' }),
      candidate('B', 100, 40),
      candidate('C', 50, 50),
      candidate('D', 10, 10),
      candidate('F', 20, 0),
    ],
    productCosts: ['A', 'B', 'C', 'D', 'E', 'F'].map((sku) => ({
      sku, metadata: sku === 'E' ? null : { esa009m: { '특가(元)': '10', '신규원가(元)': '20' } },
    })),
  })
}

describe('purchase budget comparison', () => {
  it('compares actual before and after quantities by SKU, including manually entered rows', () => {
    const result = comparison()
    const bySku = new Map(result.rows.map((row) => [row.sku, row]))
    expect(bySku.get('A')).toMatchObject({ change: '제외', beforeQuantity: 100, baselineQuantity: 100, allocatedQuantity: 0, afterQuantity: 0, reason: '예산 부족 · MOQ 묶음' })
    expect(bySku.get('B')).toMatchObject({ change: '수량 감소', beforeQuantity: 100, afterQuantity: 40, quantityDifference: -60 })
    expect(bySku.get('C')).toMatchObject({ change: '유지', beforeQuantity: 55, baselineQuantity: 50, afterQuantity: 55, reason: '수동 검토 포함' })
    expect(bySku.get('D')).toMatchObject({ change: '신규', beforeQuantity: 0, afterQuantity: 10 })
    expect(bySku.get('E')).toMatchObject({ change: '제외', beforeCostKrw: null, costDifferenceKrw: null, reason: '무예산 재계산 수량 변경' })
    expect(bySku.get('F')).toMatchObject({ change: '예산 제외(신규 후보)', beforeQuantity: 0, baselineQuantity: 20, afterQuantity: 0 })
    expect(bySku.get('B')).toMatchObject({ beforeCostKrw: 210_000, afterCostKrw: 84_000, costDifferenceKrw: -126_000, availableStock: -3 })
  })

  it('marks every option in an unbudgeted group when any group member lacks a cost', () => {
    const result = buildPurchaseBudgetComparison({
      calculatedAt: new Date('2026-10-21T02:00:00.000Z'), targetStockMonths: 1.5, budgetKrw: 10_000,
      spentBudgetKrw: 0, exchangeRateKrw: 200, beforeRows: [],
      afterRows: [review('A', 10), review('B', 10)],
      candidates: [
        candidate('A', 10, 10, { moqProductGroupName: '묶음' }),
        candidate('B', 10, 10, { moqProductGroupName: '묶음', unitCostKrw: null, unitCostYuan: null }),
      ],
      productCosts: [{ sku: 'A', metadata: { esa009m: { '특가(元)': '10' } } }, { sku: 'B', metadata: null }],
    })
    expect(result.rows.every((row) => row.reason.includes('원가 미확정'))).toBe(true)
    expect(result.rows.find((row) => row.sku === 'B')?.afterCostKrw).toBeNull()
  })

  it('does not describe an allocated item missing from the final review as budget-excluded', () => {
    const result = buildPurchaseBudgetComparison({
      calculatedAt: new Date('2026-10-21T02:00:00.000Z'), targetStockMonths: 1.5, budgetKrw: 100_000,
      spentBudgetKrw: 21_000, exchangeRateKrw: 200, beforeRows: [], afterRows: [],
      candidates: [candidate('A', 10, 10)], productCosts: [],
    })
    expect(result.rows[0]).toMatchObject({ change: '반영 확인 필요', allocatedQuantity: 10 })
    expect(result.rows[0].reason).toContain('최종 자동 검토 수량 불일치')
  })

  it('creates an Excel file with summary counts, filterable SKU rows, and numeric cells', async () => {
    const bytes = await exportPurchaseBudgetComparisonExcel(comparison())
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const sheet = workbook.getWorksheet('예산 비교')!
    expect(sheet.getCell('B3').value).toBe(4)
    expect(sheet.getCell('D3').value).toBe(3)
    expect(sheet.getCell('F3').value).toBe(2)
    expect(sheet.getCell('H3').value).toBe(1)
    expect(sheet.getCell('D4').value).toBe(1)
    expect(sheet.autoFilter).toBeTruthy()
    expect(sheet.getCell('A7').value).toBe('비교 결과')
    expect(sheet.getCell('B8').value).toBe('A')
    expect(sheet.getCell('E8').value).toBe(100)
    expect(sheet.getCell('H8').value).toBe(0)
    expect(sheet.getCell('J8').value).toBe(-3)
  })
})
