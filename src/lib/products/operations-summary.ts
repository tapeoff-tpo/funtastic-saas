import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { analyticsPriceTableRows, inventory, inventoryHistory, productVariants, products } from '@/lib/db/schema'
import { findMarketplaceProductIds, getRegistrationMarketplaceColumns } from '@/app/(auth)/analytics/price-table/price-table-columns'

export type ProductOperationsSummary = {
  sku: string
  worksCost: number | null
  availableStock: number
  warehouseStock: Array<{ warehouse: string; quantity: number }>
  recentHistory: Array<{ createdAt: Date; reason: string; delta: number; note: string | null }>
  marketplaces: Array<{ marketplace: string; productId: string | null; price: string | null }>
}

export async function getProductOperationsSummary(userId: string, productId: string): Promise<ProductOperationsSummary | null> {
  const [product] = await db.select({
    internalSku: products.internalSku,
    costPrice: products.costPrice,
    metadata: products.metadata,
  }).from(products).where(and(eq(products.userId, userId), eq(products.id, productId))).limit(1)
  if (!product) return null

  const variants = await db.select({ sku: productVariants.sku })
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
  const skus = [...new Set([product.internalSku, ...variants.map((variant) => variant.sku).filter(Boolean)])]
  const [stockRows, historyRows, priceRows] = await Promise.all([
    db.select({
      warehouse: inventory.warehouseZone,
      quantity: sql<number>`COALESCE(SUM(${inventory.availableStock}), 0)::int`,
    }).from(inventory).where(and(eq(inventory.userId, userId), inArray(inventory.sku, skus))).groupBy(inventory.warehouseZone),
    db.select({
      createdAt: inventoryHistory.createdAt,
      reason: inventoryHistory.adjustmentReason,
      delta: inventoryHistory.delta,
      note: inventoryHistory.note,
    }).from(inventoryHistory)
      .innerJoin(inventory, eq(inventory.id, inventoryHistory.inventoryId))
      .where(and(eq(inventoryHistory.userId, userId), inArray(inventory.sku, skus)))
      .orderBy(desc(inventoryHistory.createdAt))
      .limit(5),
    db.select({ rawData: analyticsPriceTableRows.rawData })
      .from(analyticsPriceTableRows)
      .where(and(eq(analyticsPriceTableRows.userId, userId), inArray(analyticsPriceTableRows.productCode, skus)))
      .orderBy(desc(analyticsPriceTableRows.importedAt), analyticsPriceTableRows.rowNumber)
      .limit(30),
  ])

  const warehouseStock = stockRows.map((row) => ({ warehouse: row.warehouse ?? '미지정', quantity: Number(row.quantity) || 0 }))
  const marketplaces = collectMarketplacePrices(priceRows.map((row) => stringRecord(row.rawData)))
  return {
    sku: product.internalSku,
    worksCost: resolveWorksCost(product.metadata, product.costPrice),
    availableStock: warehouseStock.reduce((total, row) => total + row.quantity, 0),
    warehouseStock,
    recentHistory: historyRows.map((row) => ({ ...row, delta: Number(row.delta) || 0 })),
    marketplaces,
  }
}

function collectMarketplacePrices(rows: Record<string, string>[]): ProductOperationsSummary['marketplaces'] {
  const seen = new Set<string>()
  const result: ProductOperationsSummary['marketplaces'] = []
  for (const row of rows) {
    for (const column of getRegistrationMarketplaceColumns()) {
      const price = row[column.valueKey]?.trim() || null
      const productId = findMarketplaceProductIds(row, column)[0]?.value ?? null
      if (!price && !productId) continue
      const key = `${column.id}:${productId ?? price}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ marketplace: column.label, productId, price })
    }
  }
  return result
}

function resolveWorksCost(metadata: Record<string, unknown> | null, costPrice: string | null) {
  const esa = metadata?.esa009m
  const raw = esa && typeof esa === 'object'
    ? (esa as Record<string, unknown>)['works 신규 원가'] ?? (esa as Record<string, unknown>)['works 기존 원가']
    : null
  const parsed = parseNumber(raw)
  return parsed ?? parseNumber(costPrice)
}

function parseNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function stringRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry ?? '')]))
}
