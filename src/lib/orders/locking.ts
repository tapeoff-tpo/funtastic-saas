import { db } from '@/lib/db'
import {
  inventory,
  mappingCodes,
  mappingComponents,
  mappingSources,
  orderItems,
  orders,
  products,
  productVariants,
  userProfiles,
} from '@/lib/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  getRawMappingCandidateIdsForItem,
  isIgnoredMappingCandidate,
  lookupCompatibleMappingRef,
  normalizeMappingOptionText,
  type MappingSource,
} from './mapping-match'

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

type SkuInfo = {
  productName: string | null
  optionName: string | null
}

type HistoricalAliasRow = {
  mappingCodeId: string
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId: string
}

async function getSkuInfoBySku(tx: DrizzleTransaction, userId: string, skus: string[]) {
  const uniqueSkus = Array.from(new Set(skus.map((sku) => sku.trim()).filter(Boolean)))
  const info = new Map<string, SkuInfo>()
  if (uniqueSkus.length === 0) return info

  const inventoryRows = await tx
    .select({
      sku: inventory.sku,
      productName: sql<string | null>`MAX(${inventory.productName})`,
      optionName: sql<string | null>`MAX(${inventory.optionName})`,
    })
    .from(inventory)
    .where(and(eq(inventory.userId, userId), inArray(inventory.sku, uniqueSkus)))
    .groupBy(inventory.sku)

  for (const row of inventoryRows) {
    info.set(row.sku, { productName: row.productName, optionName: row.optionName })
  }

  const productRows = await tx
    .select({ sku: products.internalSku, name: products.name })
    .from(products)
    .where(and(eq(products.userId, userId), inArray(products.internalSku, uniqueSkus)))

  for (const row of productRows) {
    const current = info.get(row.sku)
    info.set(row.sku, {
      productName: current?.productName ?? row.name,
      optionName: current?.optionName ?? null,
    })
  }

  const variantRows = await tx
    .select({ sku: productVariants.sku, name: products.name, optionName: productVariants.optionName })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(products.userId, userId), inArray(productVariants.sku, uniqueSkus)))

  for (const row of variantRows) {
    const current = info.get(row.sku)
    info.set(row.sku, {
      productName: current?.productName ?? row.name,
      optionName: current?.optionName ?? row.optionName ?? null,
    })
  }

  return info
}

function getSkuPrefixes(skus: string[]) {
  return Array.from(new Set(skus.map((sku) => {
    const match = sku.trim().match(/^(.+)-\d+$/)
    return match?.[1] ?? null
  }).filter((prefix): prefix is string => Boolean(prefix))))
}

async function addInventoryInfoBySkuPrefixes(
  tx: DrizzleTransaction,
  userId: string,
  info: Map<string, SkuInfo>,
  skus: string[],
) {
  const prefixes = getSkuPrefixes(skus)
  if (prefixes.length === 0) return

  for (const prefix of prefixes) {
    const rows = await tx
      .select({
        sku: inventory.sku,
        productName: sql<string | null>`MAX(${inventory.productName})`,
        optionName: sql<string | null>`MAX(${inventory.optionName})`,
      })
      .from(inventory)
      .where(and(
        eq(inventory.userId, userId),
        sql`${inventory.sku} LIKE ${`${prefix}-%`}`,
      ))
      .groupBy(inventory.sku)

    for (const row of rows) {
      const current = info.get(row.sku)
      info.set(row.sku, {
        productName: current?.productName ?? row.productName,
        optionName: current?.optionName ?? row.optionName,
      })
    }
  }
}

function optionMatchesOrder(skuInfo: SkuInfo | undefined, orderOptionText: string | null) {
  const orderOption = normalizeMappingOptionText(orderOptionText)
  const skuOption = normalizeMappingOptionText(skuInfo?.optionName)
  if (!orderOption || !skuOption) return true
  return orderOption === skuOption || orderOption.includes(skuOption) || skuOption.includes(orderOption)
}

function findDirectSkuForOrder(
  candidateIds: string[],
  skuInfoBySku: Map<string, SkuInfo>,
  optionText: string | null,
) {
  const exactOptionCandidate = candidateIds.find((candidateId) =>
    skuInfoBySku.has(candidateId) && optionMatchesOrder(skuInfoBySku.get(candidateId), optionText),
  )
  if (exactOptionCandidate) return exactOptionCandidate

  const directCandidate = candidateIds.find((candidateId) => skuInfoBySku.has(candidateId))
  const directInfo = directCandidate ? skuInfoBySku.get(directCandidate) : undefined
  if (!directCandidate || !directInfo) return null
  if (optionMatchesOrder(directInfo, optionText)) return directCandidate

  for (const [sku, info] of skuInfoBySku) {
    if (info.productName === directInfo.productName && optionMatchesOrder(info, optionText)) {
      return sku
    }
  }

  return null
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
      lockedSku: orderItems.lockedSku,
      lockedMappingCodeId: orderItems.lockedMappingCodeId,
      lockedProductName: orderItems.lockedProductName,
      lockedQuantity: orderItems.lockedQuantity,
      lockedAt: orderItems.lockedAt,
      rawData: orders.rawData,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.userId, userId), inArray(orderItems.orderId, uniqueOrderIds)))

  const unlockedItems = itemRows.filter((item) =>
    !item.lockedAt
    || (!item.lockedSku && !item.lockedMappingCodeId)
    || !item.lockedProductName
    || !item.lockedQuantity,
  )
  if (unlockedItems.length === 0) return 0

  const [sourceRows, componentRows, historicalAliasResult] = await Promise.all([
    tx
      .select({
        mappingCodeId: mappingSources.mappingCodeId,
        marketplaceId: mappingSources.marketplaceId,
        marketplaceProductId: mappingSources.marketplaceProductId,
        marketplaceOptionId: mappingSources.marketplaceOptionId,
        productNameSnapshot: mappingSources.productNameSnapshot,
        optionNameSnapshot: mappingSources.optionNameSnapshot,
      })
      .from(mappingSources)
      .innerJoin(mappingCodes, eq(mappingCodes.id, mappingSources.mappingCodeId))
      .where(and(eq(mappingSources.userId, userId), eq(mappingCodes.isActive, true))),
    tx
      .select({
        mappingCodeId: mappingComponents.mappingCodeId,
        mappingCode: mappingCodes.code,
        sku: mappingComponents.sku,
        quantity: mappingComponents.quantity,
      })
      .from(mappingComponents)
      .innerJoin(mappingCodes, eq(mappingCodes.id, mappingComponents.mappingCodeId))
      .where(and(eq(mappingComponents.userId, userId), eq(mappingCodes.isActive, true))),
    tx.execute<HistoricalAliasRow>(sql`
      SELECT DISTINCT
        ms.mapping_code_id AS "mappingCodeId",
        ms.marketplace_id AS "marketplaceId",
        oi.sku AS "marketplaceProductId",
        ms.marketplace_option_id AS "marketplaceOptionId"
      FROM mapping_sources ms
      INNER JOIN mapping_codes mc ON mc.id = ms.mapping_code_id AND mc.user_id = ms.user_id AND mc.is_active = TRUE
      INNER JOIN order_items oi ON oi.marketplace_item_id = ms.marketplace_product_id
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE ms.user_id = ${userId}
        AND ms.marketplace_id = 'funtastic-b2b'
        AND o.user_id = ms.user_id
        AND o.marketplace_id = ms.marketplace_id
        AND NULLIF(oi.sku, '') IS NOT NULL
    `),
  ])
  const historicalAliasRows = Array.isArray(historicalAliasResult)
    ? historicalAliasResult as HistoricalAliasRow[]
    : (historicalAliasResult as unknown as { rows?: HistoricalAliasRow[] }).rows ?? []

  const mappingSourcesForLookup = sourceRows.map<MappingSource>((source) => ({
    marketplaceId: source.marketplaceId,
    marketplaceProductId: source.marketplaceProductId,
    marketplaceOptionId: source.marketplaceOptionId,
    productNameSnapshot: source.productNameSnapshot,
    optionNameSnapshot: source.optionNameSnapshot,
    ref: source.mappingCodeId,
  })).concat(historicalAliasRows.map<MappingSource>((source) => ({
    marketplaceId: source.marketplaceId,
    marketplaceProductId: source.marketplaceProductId,
    marketplaceOptionId: source.marketplaceOptionId,
    productNameSnapshot: null,
    optionNameSnapshot: null,
    ref: source.mappingCodeId,
  })))

  const componentSkus = componentRows.map((component) => component.sku)
  const candidateSkus = unlockedItems.flatMap((item) => [
    item.marketplaceItemId ?? '',
    item.sku ?? '',
    ...getRawMappingCandidateIdsForItem(item.rawData, item.marketplaceItemId),
  ])
  const skuInfoBySku = await getSkuInfoBySku(tx, userId, [...componentSkus, ...candidateSkus])
  await addInventoryInfoBySkuPrefixes(tx, userId, skuInfoBySku, candidateSkus)

  const componentsByCode = new Map<string, SnapshotComponent[]>()
  const mappingCodeById = new Map<string, string>()
  for (const component of componentRows) {
    mappingCodeById.set(component.mappingCodeId, component.mappingCode)
    const skuInfo = skuInfoBySku.get(component.sku)
    const list = componentsByCode.get(component.mappingCodeId) ?? []
    list.push({
      sku: component.sku,
      quantity: component.quantity,
      productName: skuInfo?.productName ?? component.sku,
      optionName: skuInfo?.optionName ?? null,
    })
    componentsByCode.set(component.mappingCodeId, list)
  }

  const buildSnapshot = (item: typeof unlockedItems[number]): Snapshot | null => {
    const candidateIds = Array.from(new Set(
      [item.marketplaceItemId, item.sku, ...getRawMappingCandidateIdsForItem(item.rawData, item.marketplaceItemId)]
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id))
        .filter((id) => !isIgnoredMappingCandidate(item.marketplaceId, id)),
    ))
    const mappingCodeId = lookupCompatibleMappingRef(
      mappingSourcesForLookup,
      item.marketplaceId,
      candidateIds,
      item.optionText,
      item.productName,
    )
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

    const directSku = findDirectSkuForOrder(candidateIds, skuInfoBySku, item.optionText)
    if (!directSku) return null
    const skuInfo = directSku ? skuInfoBySku.get(directSku) : undefined

    return {
      lockedSku: directSku,
      lockedProductName: skuInfo?.productName ?? item.productName,
      lockedOptionName: skuInfo?.optionName ?? item.optionText,
      lockedQuantity: orderQuantity,
      lockedMappingCodeId: null,
      lockedMappingCode: null,
    }
  }

  const lockedAt = new Date()
  let lockedCount = 0
  for (const item of unlockedItems) {
    const snapshot = buildSnapshot(item)
    if (!snapshot) continue
    await tx
      .update(orderItems)
      .set({
        ...snapshot,
        lockedAt,
        lockedByUserId: lockedByUserId ?? null,
      })
      .where(eq(orderItems.id, item.id))
    lockedCount += 1
  }

  return lockedCount
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
