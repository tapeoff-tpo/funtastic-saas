import { db } from '@/lib/db'
import {
  inventory,
  mappingCodes,
  mappingComponents,
  mappingSources,
  orderItems,
  orders,
  products,
  userProfiles,
} from '@/lib/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { buildMappingIndex, lookupMappingRef, type MappingSource } from './mapping-match'

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type SnapshotComponent = {
  sku: string
  quantity: number
  productName: string | null
  optionName: string | null
}

type Snapshot = {
  lockedSku: string | null
  lockedProductName: string
  lockedOptionName: string | null
  lockedQuantity: number
  lockedMappingCodeId: string | null
  lockedMappingCode: string | null
}

async function getInventoryInfoBySku(tx: DrizzleTransaction, userId: string, skus: string[]) {
  const uniqueSkus = Array.from(new Set(skus.filter(Boolean)))
  if (uniqueSkus.length === 0) return new Map<string, { productName: string | null; optionName: string | null }>()

  const rows = await tx
    .select({
      sku: inventory.sku,
      productName: sql<string | null>`MAX(${inventory.productName})`,
      optionName: sql<string | null>`MAX(${inventory.optionName})`,
    })
    .from(inventory)
    .where(and(eq(inventory.userId, userId), inArray(inventory.sku, uniqueSkus)))
    .groupBy(inventory.sku)

  return new Map(rows.map((row) => [row.sku, { productName: row.productName, optionName: row.optionName }]))
}

async function getProductNameBySku(tx: DrizzleTransaction, userId: string, skus: string[]) {
  const uniqueSkus = Array.from(new Set(skus.filter(Boolean)))
  if (uniqueSkus.length === 0) return new Map<string, string>()

  const rows = await tx
    .select({ sku: products.internalSku, name: products.name })
    .from(products)
    .where(and(eq(products.userId, userId), inArray(products.internalSku, uniqueSkus)))

  return new Map(rows.map((row) => [row.sku, row.name]))
}

export async function lockOrderItemsForOrders(
  tx: DrizzleTransaction,
  userId: string,
  orderIds: string[],
  lockedByUserId?: string | null,
): Promise<number> {
  const uniqueOrderIds = Array.from(new Set(orderIds.filter(Boolean)))
  if (uniqueOrderIds.length === 0) return 0

  const itemRows = await tx
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      marketplaceId: orders.marketplaceId,
      marketplaceItemId: orderItems.marketplaceItemId,
      productName: orderItems.productName,
      optionText: orderItems.optionText,
      quantity: orderItems.quantity,
      sku: orderItems.sku,
      skuMultiplier: orderItems.skuMultiplier,
      lockedAt: orderItems.lockedAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.userId, userId), inArray(orderItems.orderId, uniqueOrderIds)))

  const unlockedItems = itemRows.filter((item) => !item.lockedAt)
  if (unlockedItems.length === 0) return 0

  const [sourceRows, componentRows] = await Promise.all([
    tx
      .select({
        mappingCodeId: mappingSources.mappingCodeId,
        marketplaceId: mappingSources.marketplaceId,
        marketplaceProductId: mappingSources.marketplaceProductId,
        marketplaceOptionId: mappingSources.marketplaceOptionId,
      })
      .from(mappingSources)
      .where(eq(mappingSources.userId, userId)),
    tx
      .select({
        mappingCodeId: mappingComponents.mappingCodeId,
        mappingCode: mappingCodes.code,
        sku: mappingComponents.sku,
        quantity: mappingComponents.quantity,
      })
      .from(mappingComponents)
      .innerJoin(mappingCodes, eq(mappingCodes.id, mappingComponents.mappingCodeId))
      .where(eq(mappingComponents.userId, userId)),
  ])

  const mappingIndex = buildMappingIndex(
    sourceRows.map<MappingSource>((source) => ({
      marketplaceId: source.marketplaceId,
      marketplaceProductId: source.marketplaceProductId,
      marketplaceOptionId: source.marketplaceOptionId,
      ref: source.mappingCodeId,
    })),
  )

  const componentSkus = componentRows.map((component) => component.sku)
  const directSkus = unlockedItems.map((item) => item.sku ?? '').filter(Boolean)
  const [inventoryBySku, productNameBySku] = await Promise.all([
    getInventoryInfoBySku(tx, userId, [...componentSkus, ...directSkus]),
    getProductNameBySku(tx, userId, directSkus),
  ])

  const componentsByCode = new Map<string, SnapshotComponent[]>()
  const mappingCodeById = new Map<string, string>()
  for (const component of componentRows) {
    mappingCodeById.set(component.mappingCodeId, component.mappingCode)
    const inventoryInfo = inventoryBySku.get(component.sku)
    const list = componentsByCode.get(component.mappingCodeId) ?? []
    list.push({
      sku: component.sku,
      quantity: component.quantity,
      productName: inventoryInfo?.productName ?? component.sku,
      optionName: inventoryInfo?.optionName ?? null,
    })
    componentsByCode.set(component.mappingCodeId, list)
  }

  const buildSnapshot = (item: typeof unlockedItems[number]): Snapshot => {
    const mappingCodeId = item.marketplaceItemId
      ? lookupMappingRef(mappingIndex, item.marketplaceId, item.marketplaceItemId, item.optionText)
      : null
    const components = mappingCodeId ? componentsByCode.get(mappingCodeId) : null
    const orderQuantity = item.quantity * (item.skuMultiplier ?? 1)

    if (mappingCodeId && components && components.length > 0) {
      return {
        lockedSku: components.length === 1 ? components[0].sku : null,
        lockedProductName: components.map((component) => component.productName ?? component.sku).join(' + '),
        lockedOptionName: components
          .map((component) => component.optionName)
          .filter((optionName): optionName is string => !!optionName)
          .join(' + ') || null,
        lockedQuantity: components.reduce((sum, component) => sum + component.quantity * orderQuantity, 0),
        lockedMappingCodeId: mappingCodeId,
        lockedMappingCode: mappingCodeById.get(mappingCodeId) ?? null,
      }
    }

    const directSku = item.sku ?? null
    const inventoryInfo = directSku ? inventoryBySku.get(directSku) : undefined
    const productName = directSku ? productNameBySku.get(directSku) : undefined

    return {
      lockedSku: directSku,
      lockedProductName: productName ?? inventoryInfo?.productName ?? item.productName,
      lockedOptionName: inventoryInfo?.optionName ?? item.optionText,
      lockedQuantity: orderQuantity,
      lockedMappingCodeId: null,
      lockedMappingCode: null,
    }
  }

  const lockedAt = new Date()
  for (const item of unlockedItems) {
    const snapshot = buildSnapshot(item)
    await tx
      .update(orderItems)
      .set({
        ...snapshot,
        lockedAt,
        lockedByUserId: lockedByUserId ?? null,
      })
      .where(eq(orderItems.id, item.id))
  }

  return unlockedItems.length
}

export async function unlockOrderItemsForOrders(
  userId: string,
  actorUserId: string,
  orderIds: string[],
): Promise<{ unlocked: number; error?: string }> {
  const [profile] = await db
    .select({ role: userProfiles.role, deactivatedAt: userProfiles.deactivatedAt })
    .from(userProfiles)
    .where(eq(userProfiles.id, actorUserId))
    .limit(1)

  if (!profile || profile.role !== 'super_admin' || profile.deactivatedAt) {
    return { unlocked: 0, error: 'super_admin만 잠금 해제할 수 있습니다.' }
  }

  const uniqueOrderIds = Array.from(new Set(orderIds.filter(Boolean)))
  if (uniqueOrderIds.length === 0) return { unlocked: 0 }

  const ownedOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.userId, userId), inArray(orders.id, uniqueOrderIds)))
  const ownedOrderIds = ownedOrders.map((order) => order.id)
  if (ownedOrderIds.length === 0) return { unlocked: 0 }

  const result = await db
    .update(orderItems)
    .set({
      lockedSku: null,
      lockedProductName: null,
      lockedOptionName: null,
      lockedQuantity: null,
      lockedMappingCodeId: null,
      lockedMappingCode: null,
      lockedAt: null,
      lockedByUserId: null,
    })
    .where(inArray(orderItems.orderId, ownedOrderIds))
    .returning({ id: orderItems.id })

  return { unlocked: result.length }
}
