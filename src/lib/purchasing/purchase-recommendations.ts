import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notExists } from 'drizzle-orm'
import {
  inventory,
  products,
  purchaseRequestBatches,
  purchaseRequestItems,
} from '@/lib/db/schema'
import { calculatePurchaseCosts } from './purchase-costs'
import { getSkuOutgoingMetrics } from './items'

const PRODUCT_GROUP_MOQ_RULES = [
  { productName: '테피 USB 캔들라이터', minimumOrderQuantity: 200, roundingUnit: 10 },
  { productName: '루멘 철제 사이드 테이블', minimumOrderQuantity: 200, roundingUnit: 10 },
  { productName: '린블 아기옷 원형 건조대', minimumOrderQuantity: 200, roundingUnit: 10 },
] as const

const DOMESTIC_PURCHASE_PRODUCT_KEYWORDS = [
  '\uC138\uC81C',
  '\uC138\uD0C1\uBE44\uB204',
  '\uC138\uCC99\uC81C',
  '\uC720\uC5F0\uC81C',
  '\uD45C\uBC31\uC81C',
] as const

const DEFAULT_PURCHASE_MINIMUM_QUANTITY = 10
const DEFAULT_PURCHASE_ROUNDING_UNIT = 10

export type PurchaseRecommendationInput = {
  averageMonthlyOutgoing: number
  currentMonthOutgoing: number
  availableStock: number
  targetStockMonths: number
}

export type PurchaseRecommendationCalculation = {
  targetStockQuantity: number
  recommendedQuantity: number
  stockCoverageMonths: number | null
}

export type SpikeGuardPurchaseRecommendationInput = PurchaseRecommendationInput & {
  effectiveMonthlyOutgoing: number
}

export type SpikeGuardPurchaseRecommendationCalculation = PurchaseRecommendationCalculation & {
  originalRecommendedQuantity: number
  spikeGuardAdjustedToMinimum: boolean
}

export type PurchaseBudgetCandidate = {
  sku: string
  recommendedQuantity: number
  stockCoverageMonths: number | null
  effectiveMonthlyOutgoing: number
  unitCostKrw: number | null
  moqProductGroupName?: string | null
  purchaseMinimumQuantity?: number | null
  purchaseRoundingUnit?: number | null
}

type AssessedPurchaseRow = ReturnType<typeof buildAssessedPurchaseRow>

export function isDomesticPurchaseProduct(productName: string | null | undefined) {
  const normalizedName = productName?.trim() ?? ''
  return DOMESTIC_PURCHASE_PRODUCT_KEYWORDS.some((keyword) => normalizedName.includes(keyword))
}

export function applyPurchaseMinimumQuantity(recommendedQuantity: number) {
  const normalizedQuantity = Math.max(0, Math.trunc(finiteNumber(recommendedQuantity)))
  if (normalizedQuantity === 0) return 0

  return Math.max(
    DEFAULT_PURCHASE_MINIMUM_QUANTITY,
    roundUpToUnit(normalizedQuantity, DEFAULT_PURCHASE_ROUNDING_UNIT),
  )
}

export function calculateStableMonthlyOutgoing(input: {
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
}) {
  const currentMonthOutgoing = Math.max(0, finiteNumber(input.currentMonthOutgoing))
  const threeMonthAverageOutgoing = Math.max(0, finiteNumber(input.threeMonthAverageOutgoing))
  const baselineMonthlyOutgoing = threeMonthAverageOutgoing
  const salesAnomalyDetected = currentMonthOutgoing >= baselineMonthlyOutgoing * 2
    && currentMonthOutgoing - baselineMonthlyOutgoing >= 20

  return {
    effectiveMonthlyOutgoing: roundToOneDecimal(baselineMonthlyOutgoing),
    baselineMonthlyOutgoing: roundToOneDecimal(baselineMonthlyOutgoing),
    salesAnomalyDetected,
  }
}

export function allocatePurchaseBudget<T extends PurchaseBudgetCandidate>(
  candidates: T[],
  budgetKrw: number,
) {
  const allocationUnits = buildBudgetAllocationUnits(candidates)

  const items: Array<T & { allocatedQuantity: number }> = []
  let spentBudgetKrw = 0
  let missingCostExcluded = 0
  let budgetLimitedCount = 0
  let moqBudgetExcludedGroupCount = 0

  for (const unit of allocationUnits) {
    if (unit.moqProductGroupName) {
      const missingCostCount = unit.candidates.filter(
        (candidate) => candidate.unitCostKrw === null || candidate.unitCostKrw <= 0,
      ).length
      if (missingCostCount > 0) {
        missingCostExcluded += missingCostCount
        moqBudgetExcludedGroupCount += 1
        continue
      }

      const groupCostKrw = unit.candidates.reduce(
        (total, candidate) => total + candidate.recommendedQuantity * candidate.unitCostKrw!,
        0,
      )
      if (spentBudgetKrw + groupCostKrw > budgetKrw) {
        budgetLimitedCount += unit.candidates.length
        moqBudgetExcludedGroupCount += 1
        continue
      }

      for (const candidate of unit.candidates) {
        items.push({ ...candidate, allocatedQuantity: candidate.recommendedQuantity })
      }
      spentBudgetKrw += groupCostKrw
      continue
    }

    const [candidate] = unit.candidates
    if (candidate.unitCostKrw === null || candidate.unitCostKrw <= 0) {
      missingCostExcluded += 1
      continue
    }
    const affordableQuantity = Math.max(
      0,
      Math.floor((budgetKrw - spentBudgetKrw) / candidate.unitCostKrw),
    )
    const roundingUnit = Math.max(1, Math.trunc(finiteNumber(candidate.purchaseRoundingUnit ?? 1)))
    const minimumQuantity = Math.max(1, Math.trunc(finiteNumber(candidate.purchaseMinimumQuantity ?? 1)))
    const roundedAffordableQuantity = Math.floor(affordableQuantity / roundingUnit) * roundingUnit
    const allocatedQuantity = Math.min(candidate.recommendedQuantity, roundedAffordableQuantity)
    if (allocatedQuantity < candidate.recommendedQuantity) budgetLimitedCount += 1
    if (allocatedQuantity < minimumQuantity) continue

    items.push({ ...candidate, allocatedQuantity })
    spentBudgetKrw += allocatedQuantity * candidate.unitCostKrw
  }

  return {
    items,
    spentBudgetKrw,
    remainingBudgetKrw: Math.max(0, budgetKrw - spentBudgetKrw),
    missingCostExcluded,
    budgetLimitedCount,
    moqBudgetExcludedGroupCount,
  }
}

function buildBudgetAllocationUnits<T extends PurchaseBudgetCandidate>(candidates: T[]) {
  const standaloneUnits: Array<{ moqProductGroupName: null; candidates: T[] }> = []
  const moqGroups = new Map<string, T[]>()

  for (const candidate of candidates) {
    const groupName = candidate.moqProductGroupName?.trim()
    if (!groupName) {
      standaloneUnits.push({ moqProductGroupName: null, candidates: [candidate] })
      continue
    }
    const group = moqGroups.get(groupName) ?? []
    group.push(candidate)
    moqGroups.set(groupName, group)
  }

  return [
    ...standaloneUnits,
    ...Array.from(moqGroups, ([moqProductGroupName, groupedCandidates]) => ({
      moqProductGroupName,
      candidates: groupedCandidates,
    })),
  ].sort((left, right) => comparePurchaseBudgetCandidates(
    mostUrgentBudgetCandidate(left.candidates),
    mostUrgentBudgetCandidate(right.candidates),
  ))
}

function mostUrgentBudgetCandidate<T extends PurchaseBudgetCandidate>(candidates: T[]) {
  return [...candidates].sort(comparePurchaseBudgetCandidates)[0]
}

function comparePurchaseBudgetCandidates(
  left: PurchaseBudgetCandidate,
  right: PurchaseBudgetCandidate,
) {
  const coverageDifference = (left.stockCoverageMonths ?? Number.POSITIVE_INFINITY)
    - (right.stockCoverageMonths ?? Number.POSITIVE_INFINITY)
  if (coverageDifference !== 0) return coverageDifference
  const outgoingDifference = right.effectiveMonthlyOutgoing - left.effectiveMonthlyOutgoing
  if (outgoingDifference !== 0) return outgoingDifference
  return left.sku.localeCompare(right.sku)
}

export function calculatePurchaseRecommendation(input: PurchaseRecommendationInput): PurchaseRecommendationCalculation {
  const averageMonthlyOutgoing = Math.max(0, finiteNumber(input.averageMonthlyOutgoing))
  const availableStock = Math.max(0, Math.trunc(finiteNumber(input.availableStock)))
  const targetStockMonths = Math.max(0, finiteNumber(input.targetStockMonths))

  if (averageMonthlyOutgoing <= 0 || targetStockMonths <= 0) {
    return {
      targetStockQuantity: 0,
      recommendedQuantity: 0,
      stockCoverageMonths: null,
    }
  }

  const targetStockQuantity = Math.ceil(averageMonthlyOutgoing * targetStockMonths)
  const recommendedQuantity = Math.max(0, targetStockQuantity - availableStock)

  return {
    targetStockQuantity,
    recommendedQuantity,
    stockCoverageMonths: roundToOneDecimal(availableStock / averageMonthlyOutgoing),
  }
}

export function calculatePurchaseRecommendationWithSpikeGuard(
  input: SpikeGuardPurchaseRecommendationInput,
): SpikeGuardPurchaseRecommendationCalculation {
  const originalCalculation = calculatePurchaseRecommendation({
    averageMonthlyOutgoing: input.averageMonthlyOutgoing,
    currentMonthOutgoing: input.currentMonthOutgoing,
    availableStock: input.availableStock,
    targetStockMonths: input.targetStockMonths,
  })
  const adjustedCalculation = calculatePurchaseRecommendation({
    averageMonthlyOutgoing: input.effectiveMonthlyOutgoing,
    currentMonthOutgoing: input.currentMonthOutgoing,
    availableStock: input.availableStock,
    targetStockMonths: input.targetStockMonths,
  })
  const spikeGuardAdjustedToMinimum = originalCalculation.recommendedQuantity > 0
    && adjustedCalculation.recommendedQuantity === 0

  return {
    ...adjustedCalculation,
    recommendedQuantity: spikeGuardAdjustedToMinimum
      ? 1
      : adjustedCalculation.recommendedQuantity,
    originalRecommendedQuantity: originalCalculation.recommendedQuantity,
    spikeGuardAdjustedToMinimum,
  }
}

export async function generatePurchaseRecommendations(input: {
  userId: string
  requestedByUserId: string
  targetStockMonths: number
  budgetKrw?: number | null
  now?: Date
}) {
  const targetStockMonths = clampTargetMonths(input.targetStockMonths)
  const budgetKrw = input.budgetKrw == null
    ? null
    : Math.max(0, Math.trunc(finiteNumber(input.budgetKrw)))
  const now = input.now ?? new Date()

  const inventoryRows = await db
    .select({
      sku: inventory.sku,
      productName: sql<string>`MAX(${inventory.productName})`,
      optionName: sql<string | null>`MAX(${inventory.optionName})`,
      availableStock: sql<number>`COALESCE(SUM(CASE WHEN ${inventory.warehouseZone} IN ('1창고', '쿠팡창고', '쿠팡', '2창고') THEN ${inventory.availableStock} ELSE 0 END), 0)::int`,
    })
    .from(inventory)
    .where(eq(inventory.userId, input.userId))
    .groupBy(inventory.sku)

  if (inventoryRows.length === 0) {
    return { created: 0, skipped: 0, evaluated: 0, targetStockMonths }
  }

  const recommendationInventoryRows = inventoryRows.filter(
    (row) => !isDomesticPurchaseProduct(row.productName),
  )

  const [outgoingMetricsBySku, productCostRows] = await Promise.all([
    getSkuOutgoingMetrics(input.userId, recommendationInventoryRows.map((row) => row.sku), now),
    db.select({
      sku: products.internalSku,
      unitCostYuan: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
      unitCostKrw: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'works 신규 원가', '')`,
    }).from(products).where(and(
      eq(products.userId, input.userId),
      inArray(products.internalSku, recommendationInventoryRows.map((row) => row.sku)),
    )),
  ])
  const productCostsBySku = new Map(productCostRows.map((row) => [row.sku, row]))
  const assessedRows = recommendationInventoryRows.map((row) => {
    const outgoingMetrics = outgoingMetricsBySku.get(row.sku)
    const currentMonthOutgoing = outgoingMetrics?.currentMonthOutgoing ?? 0
    const averageMonthlyOutgoing = outgoingMetrics?.threeMonthAverageOutgoing ?? 0
    const stableOutgoing = calculateStableMonthlyOutgoing({
      currentMonthOutgoing,
      threeMonthAverageOutgoing: averageMonthlyOutgoing,
    })
    const previousThreeMonthOutgoing = averageMonthlyOutgoing * 3
    const calculation = calculatePurchaseRecommendationWithSpikeGuard({
      averageMonthlyOutgoing,
      effectiveMonthlyOutgoing: stableOutgoing.effectiveMonthlyOutgoing,
      currentMonthOutgoing,
      availableStock: row.availableStock,
      targetStockMonths,
    })
    const productCosts = productCostsBySku.get(row.sku)
    const costs = calculatePurchaseCosts({
      requestedQuantity: 1,
      unitCostYuan: productCosts?.unitCostYuan,
      unitCostKrw: productCosts?.unitCostKrw,
    })

    return buildAssessedPurchaseRow({
      row,
      previousThreeMonthOutgoing,
      averageMonthlyOutgoing,
      currentMonthOutgoing,
      stableOutgoing,
      calculation,
      unitCostYuan: costs.unitCostYuan,
      unitCostKrw: costs.unitCostKrw,
    })
  })
  const salesAnomalyCount = assessedRows.filter((item) => item.salesAnomalyDetected).length

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${
      `purchase-recommendations:${input.userId}`
    }))`)
    const activeRequestRows = await tx
      .select({
        id: purchaseRequestItems.id,
        sku: purchaseRequestItems.sku,
        status: purchaseRequestItems.status,
        batchId: purchaseRequestItems.batchId,
        requestedQuantity: purchaseRequestItems.requestedQuantity,
        actualPurchaseQuantity: purchaseRequestItems.actualPurchaseQuantity,
        chinaReceivedQuantity: purchaseRequestItems.chinaReceivedQuantity,
        rawData: purchaseRequestItems.rawData,
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        inArray(purchaseRequestItems.status, ['requested', 'purchased', 'purchase_completed', 'china_arrived', 'outbound_requested']),
      ))

    const replaceableRows = activeRequestRows.filter(
      (row) => row.status === 'requested' && isAutoPurchaseRecommendation(row.rawData),
    )
    const replaceableIds = new Set(replaceableRows.map((row) => row.id))
    const pipelineQuantityBySku = new Map<string, number>()
    for (const row of activeRequestRows) {
      if (replaceableIds.has(row.id)) continue
      pipelineQuantityBySku.set(
        row.sku,
        (pipelineQuantityBySku.get(row.sku) ?? 0) + purchasePipelineQuantity(row),
      )
    }
    const adjustedRows = assessedRows.map((item) => {
      const pipelineQuantity = pipelineQuantityBySku.get(item.row.sku) ?? 0
      if (pipelineQuantity <= 0) {
        return {
          ...item,
          pipelineQuantity: 0,
          availableStockWithPipeline: item.row.availableStock,
        }
      }
      const availableStockWithPipeline = item.row.availableStock + pipelineQuantity
      const calculation = calculatePurchaseRecommendationWithSpikeGuard({
        averageMonthlyOutgoing: item.averageMonthlyOutgoing,
        effectiveMonthlyOutgoing: item.effectiveMonthlyOutgoing,
        currentMonthOutgoing: item.currentMonthOutgoing,
        availableStock: availableStockWithPipeline,
        targetStockMonths,
      })
      return {
        ...item,
        pipelineQuantity,
        availableStockWithPipeline,
        calculation,
        recommendedQuantity: calculation.recommendedQuantity,
        stockCoverageMonths: calculation.stockCoverageMonths,
      }
    })
    const recommendationCandidates = applyPurchaseMinimumQuantities(
      applyProductGroupMoq(adjustedRows),
    ).filter(
      (item) => item.recommendedQuantity > 0,
    )
    const allocation = budgetKrw === null
      ? {
          items: recommendationCandidates.map((item) => ({
            ...item,
            allocatedQuantity: item.recommendedQuantity,
          })),
          spentBudgetKrw: recommendationCandidates.reduce(
            (total, item) => total + (item.unitCostKrw ?? 0) * item.recommendedQuantity,
            0,
          ),
          remainingBudgetKrw: null,
          missingCostExcluded: 0,
          budgetLimitedCount: 0,
          moqBudgetExcludedGroupCount: 0,
        }
      : allocatePurchaseBudget(recommendationCandidates, budgetKrw)

    if (replaceableRows.length > 0) {
      await tx.delete(purchaseRequestItems).where(inArray(
        purchaseRequestItems.id,
        replaceableRows.map((row) => row.id),
      ))
      const replaceableBatchIds = [...new Set(
        replaceableRows.map((row) => row.batchId).filter((id): id is string => id !== null),
      )]
      if (replaceableBatchIds.length > 0) {
        await tx.delete(purchaseRequestBatches).where(and(
          inArray(purchaseRequestBatches.id, replaceableBatchIds),
          notExists(
            tx.select({ id: purchaseRequestItems.id })
              .from(purchaseRequestItems)
              .where(eq(purchaseRequestItems.batchId, purchaseRequestBatches.id)),
          ),
        ))
      }
    }

    const resultBase = {
      replaced: replaceableRows.length,
      skipped: inventoryRows.length - allocation.items.length,
      evaluated: inventoryRows.length,
      domesticPurchaseExcluded: inventoryRows.length - recommendationInventoryRows.length,
      targetStockMonths,
      budgetKrw,
      spentBudgetKrw: allocation.spentBudgetKrw,
      remainingBudgetKrw: allocation.remainingBudgetKrw,
      missingCostExcluded: allocation.missingCostExcluded,
      budgetLimitedCount: allocation.budgetLimitedCount,
      moqBudgetExcludedGroupCount: allocation.moqBudgetExcludedGroupCount,
      salesAnomalyCount,
    }
    if (allocation.items.length === 0) return { ...resultBase, created: 0 }

    const [batch] = await tx
      .insert(purchaseRequestBatches)
      .values({
        userId: input.userId,
        sourceFileName: `auto_purchase_recommendation ${formatSeoulDate(now)}`,
        sourceSheetName: 'auto_recommendation',
        totalRows: inventoryRows.length,
        importedRows: allocation.items.length,
        skippedRows: inventoryRows.length - allocation.items.length,
        uploadedByUserId: input.requestedByUserId,
      })
      .returning({ id: purchaseRequestBatches.id })

    let rowNumber = 1
    for (const chunk of chunks(allocation.items, 250)) {
      await tx.insert(purchaseRequestItems).values(chunk.map((item, index) => ({
        userId: input.userId,
        batchId: batch.id,
        rowNumber: rowNumber + index,
        requestDate: formatSeoulDate(now),
        sku: item.row.sku,
        productName: item.row.productName,
        optionName: item.row.optionName,
        requestedQuantity: item.allocatedQuantity,
        recommendationBasis: 'manual_stock_months',
        salesAverageWindowDays: 90,
        rawData: {
          source: 'auto_purchase_recommendation',
          targetStockMonths,
          budgetKrw,
          averageMonthlyOutgoing: item.averageMonthlyOutgoing,
          effectiveMonthlyOutgoing: item.effectiveMonthlyOutgoing,
          baselineMonthlyOutgoing: item.baselineMonthlyOutgoing,
          previousThreeMonthOutgoing: item.previousThreeMonthOutgoing,
          currentMonthOutgoing: item.currentMonthOutgoing,
          salesAnomalyDetected: item.salesAnomalyDetected,
          availableStock: item.row.availableStock,
          pipelineQuantity: item.pipelineQuantity,
          availableStockWithPipeline: item.availableStockWithPipeline,
          targetStockQuantity: item.calculation.targetStockQuantity,
          originalRecommendedQuantity: item.calculation.originalRecommendedQuantity,
          baseRecommendedQuantity: item.baseRecommendedQuantity,
          moqAdjustedQuantity: item.moqAdjustedQuantity,
          moqProductGroupName: item.moqProductGroupName,
          moqMinimumOrderQuantity: item.moqMinimumOrderQuantity,
          moqRoundingUnit: item.moqRoundingUnit,
          moqAddedQuantity: item.moqAddedQuantity,
          purchaseMinimumQuantity: item.purchaseMinimumQuantity,
          purchaseRoundingUnit: item.purchaseRoundingUnit,
          purchaseMinimumAdjustedQuantity: item.purchaseMinimumAdjustedQuantity,
          spikeGuardAdjustedToMinimum: item.calculation.spikeGuardAdjustedToMinimum,
          allocatedQuantity: item.allocatedQuantity,
          unitCostYuan: item.unitCostYuan,
          unitCostKrw: item.unitCostKrw,
          stockCoverageMonths: item.calculation.stockCoverageMonths,
        },
      })))
      rowNumber += chunk.length
    }

    return {
      ...resultBase,
      batchId: batch.id,
      created: allocation.items.length,
    }
  })
}

function buildAssessedPurchaseRow(input: {
  row: {
    sku: string
    productName: string
    optionName: string | null
    availableStock: number
  }
  previousThreeMonthOutgoing: number
  averageMonthlyOutgoing: number
  currentMonthOutgoing: number
  stableOutgoing: ReturnType<typeof calculateStableMonthlyOutgoing>
  calculation: SpikeGuardPurchaseRecommendationCalculation
  unitCostYuan: number | null
  unitCostKrw: number | null
}) {
  return {
    row: input.row,
    previousThreeMonthOutgoing: input.previousThreeMonthOutgoing,
    averageMonthlyOutgoing: input.averageMonthlyOutgoing,
    currentMonthOutgoing: input.currentMonthOutgoing,
    ...input.stableOutgoing,
    calculation: input.calculation,
    unitCostYuan: input.unitCostYuan,
    unitCostKrw: input.unitCostKrw,
    sku: input.row.sku,
    recommendedQuantity: input.calculation.recommendedQuantity,
    stockCoverageMonths: input.calculation.stockCoverageMonths,
  }
}

function applyProductGroupMoq<T extends AssessedPurchaseRow & {
  pipelineQuantity: number
  availableStockWithPipeline: number
}>(items: T[]) {
  const enriched = items.map((item) => ({
    ...item,
    baseRecommendedQuantity: item.calculation.recommendedQuantity,
    moqProductGroupName: null as string | null,
    moqMinimumOrderQuantity: null as number | null,
    moqRoundingUnit: null as number | null,
    moqAddedQuantity: 0,
  }))

  for (const rule of PRODUCT_GROUP_MOQ_RULES) {
    const groupItems = enriched.filter((item) => item.row.productName === rule.productName)
    if (groupItems.length === 0) continue

    const hasRecommendation = groupItems.some((item) => item.baseRecommendedQuantity > 0)
    if (!hasRecommendation) continue

    for (const item of groupItems) {
      item.moqProductGroupName = rule.productName
      item.moqMinimumOrderQuantity = rule.minimumOrderQuantity
      item.moqRoundingUnit = rule.roundingUnit
      item.recommendedQuantity = roundUpToUnit(item.baseRecommendedQuantity, rule.roundingUnit)
      item.moqAddedQuantity = item.recommendedQuantity - item.baseRecommendedQuantity
    }

    let totalQuantity = groupItems.reduce((total, item) => total + item.recommendedQuantity, 0)
    if (totalQuantity >= rule.minimumOrderQuantity) continue

    const allocationTargets = groupItems
      .filter((item) => purchaseMoqDemandScore(item) > 0)
      .sort((left, right) => {
        const scoreDifference = purchaseMoqDemandScore(right) - purchaseMoqDemandScore(left)
        if (scoreDifference !== 0) return scoreDifference
        return left.row.sku.localeCompare(right.row.sku)
      })
    const targets = allocationTargets.length > 0
      ? allocationTargets
      : [...groupItems].sort((left, right) => left.row.sku.localeCompare(right.row.sku))

    let targetIndex = 0
    while (totalQuantity < rule.minimumOrderQuantity && targets.length > 0) {
      const target = targets[targetIndex % targets.length]
      target.recommendedQuantity += rule.roundingUnit
      target.moqAddedQuantity += rule.roundingUnit
      totalQuantity += rule.roundingUnit
      targetIndex += 1
    }
  }

  return enriched.map((item) => ({
    ...item,
    moqAdjustedQuantity: item.recommendedQuantity,
  }))
}

function applyPurchaseMinimumQuantities<T extends {
  recommendedQuantity: number
}>(items: T[]) {
  return items.map((item) => {
    const purchaseMinimumAdjustedQuantity = applyPurchaseMinimumQuantity(item.recommendedQuantity)
    return {
      ...item,
      purchaseMinimumQuantity: DEFAULT_PURCHASE_MINIMUM_QUANTITY,
      purchaseRoundingUnit: DEFAULT_PURCHASE_ROUNDING_UNIT,
      purchaseMinimumAdjustedQuantity,
      recommendedQuantity: purchaseMinimumAdjustedQuantity,
    }
  })
}

function purchaseMoqDemandScore(item: AssessedPurchaseRow) {
  return Math.max(
    0,
    finiteNumber(item.effectiveMonthlyOutgoing),
    finiteNumber(item.averageMonthlyOutgoing),
    finiteNumber(item.currentMonthOutgoing),
  )
}

function roundUpToUnit(value: number, unit: number) {
  const safeUnit = Math.max(1, Math.trunc(finiteNumber(unit)))
  const safeValue = Math.max(0, Math.trunc(finiteNumber(value)))
  if (safeValue === 0) return 0
  return Math.ceil(safeValue / safeUnit) * safeUnit
}

function clampTargetMonths(value: number) {
  if (!Number.isFinite(value)) return 1.2
  return Math.min(12, Math.max(0.1, value))
}

function isAutoPurchaseRecommendation(rawData: unknown) {
  return typeof rawData === 'object'
    && rawData !== null
    && 'source' in rawData
    && rawData.source === 'auto_purchase_recommendation'
}

function purchasePipelineQuantity(input: {
  status: string
  requestedQuantity: number
  actualPurchaseQuantity: number | null
  chinaReceivedQuantity: number | null
  rawData: unknown
}) {
  const outboundRequestedQuantity = readPositiveInteger(input.rawData, 'outboundRequestedQuantity')
  const quantity = input.status === 'outbound_requested'
    ? outboundRequestedQuantity
      ?? input.chinaReceivedQuantity
      ?? input.actualPurchaseQuantity
      ?? input.requestedQuantity
    : input.status === 'china_arrived'
      ? input.chinaReceivedQuantity
        ?? input.actualPurchaseQuantity
        ?? input.requestedQuantity
      : input.status === 'purchase_completed' || input.status === 'purchased'
        ? input.actualPurchaseQuantity
          ?? input.requestedQuantity
        : input.requestedQuantity

  return Math.max(0, Math.trunc(finiteNumber(quantity)))
}

function readPositiveInteger(rawData: unknown, key: string) {
  if (typeof rawData !== 'object' || rawData === null || !(key in rawData)) return null
  const value = rawData[key as keyof typeof rawData]
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(numberValue) || numberValue < 0) return null
  return Math.trunc(numberValue)
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0
}


function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10
}

export function formatSeoulDate(value: Date) {
  const seoulDate = new Date(value.getTime() + 9 * 60 * 60 * 1000)
  return seoulDate.toISOString().slice(0, 10)
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
