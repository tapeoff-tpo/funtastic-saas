import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  inventory,
  products,
  productVariants,
  purchaseRequestBatches,
  purchaseRequestItems,
} from '@/lib/db/schema'

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

export function getManualOutgoingMetrics(metadata: unknown) {
  const source = metadata && typeof metadata === 'object'
    ? (metadata as Record<string, unknown>).purchasingMetrics
    : null
  const metrics = source && typeof source === 'object' ? source as Record<string, unknown> : {}
  return {
    currentMonthOutgoing: nonNegativeNumber(metrics.currentMonthOutgoing),
    averageMonthlyOutgoing: nonNegativeNumber(metrics.threeMonthAverageOutgoing),
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
      productName: inventory.productName,
      optionName: inventory.optionName,
      availableStock: sql<number>`COALESCE(${inventory.availableStock}, 0)::int`,
      productMetadata: products.metadata,
    })
    .from(inventory)
    .innerJoin(productVariants, eq(productVariants.sku, inventory.sku))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(
      eq(inventory.userId, input.userId),
      eq(products.userId, input.userId),
      eq(products.manageInventory, true),
      ne(products.status, 'deleted'),
      eq(productVariants.isActive, true),
    ))

  if (inventoryRows.length === 0) {
    return { created: 0, skipped: 0, evaluated: 0, targetStockMonths }
  }

  const [activeRequestRows] = await Promise.all([
    db
      .select({ sku: purchaseRequestItems.sku })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        inArray(purchaseRequestItems.status, ['requested', 'purchased', 'china_arrived', 'outbound_requested']),
      )),
  ])

  const activeRequestSkus = new Set(activeRequestRows.map((row) => row.sku))
  const recommendations = inventoryRows.flatMap((row) => {
    if (activeRequestSkus.has(row.sku)) return []

    const { currentMonthOutgoing, averageMonthlyOutgoing } = getManualOutgoingMetrics(row.productMetadata)
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
      sourceFileName: `자동 발주 추천 ${formatDate(now)}`,
      sourceSheetName: '자동추천',
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

function nonNegativeNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : 0
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
