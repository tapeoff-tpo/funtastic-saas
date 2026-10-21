import { calculatePurchaseCosts } from './purchase-costs'

export type BudgetReviewRow = {
  sku: string
  productName: string
  optionName: string | null
  requestedQuantity: number
  costExchangeRateKrw: string | null
  rawData: Record<string, unknown>
}

export type BudgetComparisonCandidate = {
  sku: string
  productName: string
  optionName: string | null
  recommendedQuantity: number
  allocatedQuantity: number
  availableStock: number
  pipelineQuantity: number
  targetStockQuantity: number
  unitCostYuan: number | null
  unitCostKrw: number | null
  moqProductGroupName: string | null
  siblingOptionBundleGroupName: string | null
}

type ProductCost = {
  sku: string
  metadata: Record<string, unknown> | null
}

export type BudgetComparisonRow = {
  sku: string
  productName: string
  optionName: string
  change: '제외' | '수량 감소' | '유지' | '수량 증가' | '신규' | '예산 제외(신규 후보)' | '반영 확인 필요'
  beforeQuantity: number
  baselineQuantity: number
  allocatedQuantity: number
  afterQuantity: number
  quantityDifference: number
  availableStock: number | null
  pipelineQuantity: number | null
  targetStockQuantity: number | null
  unitCostYuan: number | null
  unitCostKrw: number | null
  beforeCostKrw: number | null
  afterCostKrw: number | null
  costDifferenceKrw: number | null
  reason: string
}

export type PurchaseBudgetComparison = {
  version: 1
  calculatedAt: string
  targetStockMonths: number
  budgetKrw: number
  spentBudgetKrw: number
  exchangeRateKrw: number
  rows: BudgetComparisonRow[]
}

export function buildPurchaseBudgetComparison(input: {
  calculatedAt: Date
  targetStockMonths: number
  budgetKrw: number
  spentBudgetKrw: number
  exchangeRateKrw: number
  beforeRows: BudgetReviewRow[]
  afterRows: BudgetReviewRow[]
  candidates: BudgetComparisonCandidate[]
  productCosts: ProductCost[]
}): PurchaseBudgetComparison {
  const costsBySku = new Map(input.productCosts.map((product) => [product.sku, costFields(product.metadata)]))
  const candidatesBySku = new Map(input.candidates.map((candidate) => [candidate.sku, candidate]))
  const beforeBySku = groupRowsBySku(input.beforeRows)
  const afterBySku = groupRowsBySku(input.afterRows)
  const skus = new Set([...beforeBySku.keys(), ...afterBySku.keys(), ...candidatesBySku.keys()])
  const missingCostGroups = new Set(input.candidates
    .filter((candidate) => candidate.unitCostKrw === null || candidate.unitCostKrw <= 0)
    .map(groupName)
    .filter((name): name is string => Boolean(name)))

  const rows = [...skus].map((sku): BudgetComparisonRow => {
    const before = beforeBySku.get(sku) ?? []
    const after = afterBySku.get(sku) ?? []
    const candidate = candidatesBySku.get(sku)
    const sample = after[0] ?? before[0]
    const beforeQuantity = sumQuantity(before)
    const afterQuantity = sumQuantity(after)
    const baselineQuantity = candidate?.recommendedQuantity ?? 0
    const allocatedQuantity = candidate?.allocatedQuantity ?? 0
    const beforeAutoQuantity = sumQuantity(before.filter(isAutoReview))
    const afterAutoQuantity = sumQuantity(after.filter(isAutoReview))
    const hasManualRows = [...before, ...after].some((row) => !isAutoReview(row))
    const cost = costsBySku.get(sku)
    const defaultCosts = calculatePurchaseCosts({
      requestedQuantity: 1,
      ...cost,
      exchangeRateKrw: input.exchangeRateKrw,
    })
    const beforeCostKrw = totalCost(before, cost, input.exchangeRateKrw)
    const afterCostKrw = totalCost(after, cost, input.exchangeRateKrw)
    const reasons: string[] = []
    if (baselineQuantity > allocatedQuantity) {
      reasons.push(candidate?.moqProductGroupName
        ? '예산 부족 · MOQ 묶음'
        : candidate?.siblingOptionBundleGroupName
          ? '예산 부족 · 옵션 묶음'
          : '예산 제한')
    }
    if (beforeAutoQuantity !== baselineQuantity) reasons.push('무예산 재계산 수량 변경')
    if (candidate && afterAutoQuantity !== allocatedQuantity) reasons.push('예산 배정과 최종 자동 검토 수량 불일치 · 상태 확인')
    if (candidate && (candidate.unitCostKrw === null || candidate.unitCostKrw <= 0
      || (groupName(candidate) && missingCostGroups.has(groupName(candidate)!)))) {
      reasons.push('원가 미확정 · 예산 외 포함 가능')
    }
    if (hasManualRows) reasons.push('수동 검토 포함')

    return {
      sku,
      productName: sample?.productName ?? candidate?.productName ?? '',
      optionName: sample?.optionName ?? candidate?.optionName ?? '',
      change: comparisonChange(beforeQuantity, afterQuantity, allocatedQuantity),
      beforeQuantity,
      baselineQuantity,
      allocatedQuantity,
      afterQuantity,
      quantityDifference: afterQuantity - beforeQuantity,
      availableStock: candidate?.availableStock ?? null,
      pipelineQuantity: candidate?.pipelineQuantity ?? null,
      targetStockQuantity: candidate?.targetStockQuantity ?? null,
      unitCostYuan: candidate?.unitCostYuan ?? defaultCosts.unitCostYuan,
      unitCostKrw: candidate?.unitCostKrw ?? defaultCosts.unitCostKrw,
      beforeCostKrw,
      afterCostKrw,
      costDifferenceKrw: beforeCostKrw === null || afterCostKrw === null ? null : afterCostKrw - beforeCostKrw,
      reason: reasons.join(' · ') || '변동 없음',
    }
  })
  const order: Record<BudgetComparisonRow['change'], number> = {
    제외: 0,
    '수량 감소': 1,
    '예산 제외(신규 후보)': 2,
    '반영 확인 필요': 3,
    신규: 4,
    '수량 증가': 5,
    유지: 6,
  }
  rows.sort((left, right) => order[left.change] - order[right.change] || left.sku.localeCompare(right.sku))

  return {
    version: 1,
    calculatedAt: input.calculatedAt.toISOString(),
    targetStockMonths: input.targetStockMonths,
    budgetKrw: input.budgetKrw,
    spentBudgetKrw: input.spentBudgetKrw,
    exchangeRateKrw: input.exchangeRateKrw,
    rows,
  }
}

function groupRowsBySku(rows: BudgetReviewRow[]) {
  const groups = new Map<string, BudgetReviewRow[]>()
  for (const row of rows) {
    if (row.requestedQuantity <= 0) continue
    const group = groups.get(row.sku) ?? []
    group.push(row)
    groups.set(row.sku, group)
  }
  return groups
}

function sumQuantity(rows: BudgetReviewRow[]) {
  return rows.reduce((sum, row) => sum + Math.max(0, row.requestedQuantity), 0)
}

function isAutoReview(row: BudgetReviewRow) {
  return row.rawData.source === 'auto_purchase_recommendation'
}

function groupName(candidate: BudgetComparisonCandidate) {
  return candidate.moqProductGroupName || candidate.siblingOptionBundleGroupName
}

function comparisonChange(before: number, after: number, allocated: number): BudgetComparisonRow['change'] {
  if (before === 0 && after === 0) return allocated > 0 ? '반영 확인 필요' : '예산 제외(신규 후보)'
  if (before === 0) return '신규'
  if (after === 0) return '제외'
  if (after < before) return '수량 감소'
  if (after > before) return '수량 증가'
  return '유지'
}

function costFields(metadata: Record<string, unknown> | null) {
  const source = metadata?.esa009m
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  const fields = source as Record<string, unknown>
  const asCost = (value: unknown) => typeof value === 'number' || typeof value === 'string' ? value : null
  return { specialPriceCny: asCost(fields['특가(元)']), newCostCny: asCost(fields['신규원가(元)']) }
}

function totalCost(
  rows: BudgetReviewRow[],
  cost: ReturnType<typeof costFields> | undefined,
  exchangeRateKrw: number,
) {
  let total = 0
  for (const row of rows) {
    const value = calculatePurchaseCosts({
      requestedQuantity: row.requestedQuantity,
      ...cost,
      exchangeRateKrw: row.costExchangeRateKrw ?? exchangeRateKrw,
    }).totalCostKrw
    if (value === null) return null
    total += value
  }
  return total
}
