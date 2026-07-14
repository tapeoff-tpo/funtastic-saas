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
}

export function calculateStableMonthlyOutgoing(input: {
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
}) {
  const currentMonthOutgoing = Math.max(0, finiteNumber(input.currentMonthOutgoing))
  const threeMonthAverageOutgoing = Math.max(0, finiteNumber(input.threeMonthAverageOutgoing))
  const previousTwoMonthAverageOutgoing = Math.max(
    0,
    (threeMonthAverageOutgoing * 3 - currentMonthOutgoing) / 2,
  )
  const salesAnomalyDetected = currentMonthOutgoing >= previousTwoMonthAverageOutgoing * 2
    && currentMonthOutgoing - previousTwoMonthAverageOutgoing >= 20

  return {
    effectiveMonthlyOutgoing: roundToOneDecimal(
      salesAnomalyDetected ? previousTwoMonthAverageOutgoing : threeMonthAverageOutgoing,
    ),
    previousTwoMonthAverageOutgoing: roundToOneDecimal(previousTwoMonthAverageOutgoing),
    salesAnomalyDetected,
  }
}

export function allocatePurchaseBudget<T extends PurchaseBudgetCandidate>(
  candidates: T[],
  budgetKrw: number,
) {
  const sorted = [...candidates].sort((left, right) => {
    const coverageDifference = (left.stockCoverageMonths ?? Number.POSITIVE_INFINITY)
      - (right.stockCoverageMonths ?? Number.POSITIVE_INFINITY)
    if (coverageDifference !== 0) return coverageDifference
    const outgoingDifference = right.effectiveMonthlyOutgoing - left.effectiveMonthlyOutgoing
    if (outgoingDifference !== 0) return outgoingDifference
    return left.sku.localeCompare(right.sku)
  })

  const items: Array<T & { allocatedQuantity: number }> = []
  let spentBudgetKrw = 0
  let missingCostExcluded = 0
  let budgetLimitedCount = 0

  for (const candidate of sorted) {
    if (candidate.unitCostKrw === null || candidate.unitCostKrw <= 0) {
      missingCostExcluded += 1
      continue
    }
    const affordableQuantity = Math.max(
      0,
      Math.floor((budgetKrw - spentBudgetKrw) / candidate.unitCostKrw),
    )
    const allocatedQuantity = Math.min(candidate.recommendedQuantity, affordableQuantity)
    if (allocatedQuantity < candidate.recommendedQuantity) budgetLimitedCount += 1
    if (allocatedQuantity <= 0) continue

    items.push({ ...candidate, allocatedQuantity })
    spentBudgetKrw += allocatedQuantity * candidate.unitCostKrw
  }

  return {
    items,
    spentBudgetKrw,
    remainingBudgetKrw: Math.max(0, budgetKrw - spentBudgetKrw),
    missingCostExcluded,
    budgetLimitedCount,
  }
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

  const [outgoingMetricsBySku, productCostRows] = await Promise.all([
    getSkuOutgoingMetrics(input.userId, inventoryRows.map((row) => row.sku), now),
    db.select({
      sku: products.internalSku,
      unitCostYuan: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
      unitCostKrw: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'works 신규 원가', '')`,
    }).from(products).where(and(
      eq(products.userId, input.userId),
      inArray(products.internalSku, inventoryRows.map((row) => row.sku)),
    )),
  ])
  const productCostsBySku = new Map(productCostRows.map((row) => [row.sku, row]))
  const assessedRows = inventoryRows.map((row) => {
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

    return {
      row,
      previousThreeMonthOutgoing,
      averageMonthlyOutgoing,
      currentMonthOutgoing,
      ...stableOutgoing,
      calculation,
      unitCostYuan: costs.unitCostYuan,
      unitCostKrw: costs.unitCostKrw,
      sku: row.sku,
      recommendedQuantity: calculation.recommendedQuantity,
      stockCoverageMonths: calculation.stockCoverageMonths,
    }
  })
  const recommendationCandidates = assessedRows.filter(
    (item) => item.calculation.recommendedQuantity > 0,
  )
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
    const adjustedCandidates = recommendationCandidates.map((item) => {
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
    }).filter(
      (item) => item.calculation.recommendedQuantity > 0,
    )
    const allocation = budgetKrw === null
      ? {
          items: adjustedCandidates.map((item) => ({
            ...item,
            allocatedQuantity: item.calculation.recommendedQuantity,
          })),
          spentBudgetKrw: adjustedCandidates.reduce(
            (total, item) => total + (item.unitCostKrw ?? 0) * item.calculation.recommendedQuantity,
            0,
          ),
          remainingBudgetKrw: null,
          missingCostExcluded: 0,
          budgetLimitedCount: 0,
        }
      : allocatePurchaseBudget(adjustedCandidates, budgetKrw)

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
      targetStockMonths,
      budgetKrw,
      spentBudgetKrw: allocation.spentBudgetKrw,
      remainingBudgetKrw: allocation.remainingBudgetKrw,
      missingCostExcluded: allocation.missingCostExcluded,
      budgetLimitedCount: allocation.budgetLimitedCount,
      salesAnomalyCount,
    }
    if (allocation.items.length === 0) return { ...resultBase, created: 0 }

    const [batch] = await tx
      .insert(purchaseRequestBatches)
      .values({
        userId: input.userId,
        sourceFileName: `auto_purchase_recommendation ${formatDate(now)}`,
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
        requestDate: formatDate(now),
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
          previousTwoMonthAverageOutgoing: item.previousTwoMonthAverageOutgoing,
          previousThreeMonthOutgoing: item.previousThreeMonthOutgoing,
          currentMonthOutgoing: item.currentMonthOutgoing,
          salesAnomalyDetected: item.salesAnomalyDetected,
          availableStock: item.row.availableStock,
          pipelineQuantity: item.pipelineQuantity,
          availableStockWithPipeline: item.availableStockWithPipeline,
          targetStockQuantity: item.calculation.targetStockQuantity,
          originalRecommendedQuantity: item.calculation.originalRecommendedQuantity,
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

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
