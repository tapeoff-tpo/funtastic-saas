import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  inventory,
  purchaseRequestBatches,
  purchaseRequestItems,
} from '@/lib/db/schema'
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

export async function generatePurchaseRecommendations(input: {
  userId: string
  requestedByUserId: string
  targetStockMonths: number
  now?: Date
}) {
  const targetStockMonths = clampTargetMonths(input.targetStockMonths)
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

  const [activeRequestRows, outgoingMetricsBySku] = await Promise.all([
    db
      .select({ sku: purchaseRequestItems.sku })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        inArray(purchaseRequestItems.status, ['requested', 'purchased', 'china_arrived', 'outbound_requested']),
      )),
    getSkuOutgoingMetrics(input.userId, inventoryRows.map((row) => row.sku), now),
  ])

  const activeRequestSkus = new Set(activeRequestRows.map((row) => row.sku))
  const recommendations = inventoryRows.flatMap((row) => {
    if (activeRequestSkus.has(row.sku)) return []

    const outgoingMetrics = outgoingMetricsBySku.get(row.sku)
    const currentMonthOutgoing = outgoingMetrics?.currentMonthOutgoing ?? 0
    const averageMonthlyOutgoing = outgoingMetrics?.threeMonthAverageOutgoing ?? 0
    const previousThreeMonthOutgoing = averageMonthlyOutgoing * 3
    const calculation = calculatePurchaseRecommendation({
      averageMonthlyOutgoing,
      currentMonthOutgoing,
      availableStock: row.availableStock,
      targetStockMonths,
    })

    if (calculation.recommendedQuantity <= 0) return []

    return [{
      row,
      previousThreeMonthOutgoing,
      averageMonthlyOutgoing,
      currentMonthOutgoing,
      calculation,
    }]
  })

  if (recommendations.length === 0) {
    return {
      created: 0,
      skipped: inventoryRows.length,
      evaluated: inventoryRows.length,
      targetStockMonths,
    }
  }

  const [batch] = await db
    .insert(purchaseRequestBatches)
    .values({
      userId: input.userId,
      sourceFileName: `auto_purchase_recommendation ${formatDate(now)}`,
      sourceSheetName: 'auto_recommendation',
      totalRows: inventoryRows.length,
      importedRows: recommendations.length,
      skippedRows: inventoryRows.length - recommendations.length,
      uploadedByUserId: input.requestedByUserId,
    })
    .returning({ id: purchaseRequestBatches.id })

  let rowNumber = 1
  for (const chunk of chunks(recommendations, 250)) {
    await db.insert(purchaseRequestItems).values(chunk.map((item, index) => ({
      userId: input.userId,
      batchId: batch.id,
      rowNumber: rowNumber + index,
      requestDate: formatDate(now),
      sku: item.row.sku,
      productName: item.row.productName,
      optionName: item.row.optionName,
      requestedQuantity: item.calculation.recommendedQuantity,
      recommendationBasis: 'manual_stock_months',
      salesAverageWindowDays: 90,
      rawData: {
        source: 'auto_purchase_recommendation',
        targetStockMonths,
        averageMonthlyOutgoing: item.averageMonthlyOutgoing,
        previousThreeMonthOutgoing: item.previousThreeMonthOutgoing,
        currentMonthOutgoing: item.currentMonthOutgoing,
        availableStock: item.row.availableStock,
        targetStockQuantity: item.calculation.targetStockQuantity,
        stockCoverageMonths: item.calculation.stockCoverageMonths,
      },
    })))
    rowNumber += chunk.length
  }

  return {
    batchId: batch.id,
    created: recommendations.length,
    skipped: inventoryRows.length - recommendations.length,
    evaluated: inventoryRows.length,
    targetStockMonths,
  }
}

function clampTargetMonths(value: number) {
  if (!Number.isFinite(value)) return 1.2
  return Math.min(12, Math.max(0.1, value))
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
