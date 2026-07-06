import { and, asc, count, desc, eq, getTableColumns, ilike, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  chinaWarehouseInventory,
  chinaWarehouseInventoryMovements,
  products,
  purchaseRequestItems,
} from '@/lib/db/schema'
import { sumPurchaseCosts } from './purchase-costs'
import type { PurchaseRequestStatus } from './purchase-request-status'

export async function getPurchaseRequests(input: {
  userId: string
  status?: PurchaseRequestStatus
  search?: string
  page?: number
  pageSize?: number
  sort?: string
  order?: string
}) {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 50
  const conditions: SQL[] = [eq(purchaseRequestItems.userId, input.userId)]

  if (input.status) conditions.push(eq(purchaseRequestItems.status, input.status))
  if (input.search) {
    const pattern = `%${input.search}%`
    conditions.push(or(
      ilike(purchaseRequestItems.sku, pattern),
      ilike(purchaseRequestItems.productName, pattern),
      ilike(purchaseRequestItems.optionName, pattern),
      ilike(purchaseRequestItems.purchaseManagementCode, pattern),
      ilike(purchaseRequestItems.supplierOrderNumber, pattern),
    )!)
  }

  const where = and(...conditions)
  const orderBy = purchaseRequestOrderBy(input.sort, input.order)
  const [items, [{ total }], statusCounts, costRows] = await Promise.all([
    db
      .select({
        ...getTableColumns(purchaseRequestItems),
        unitCostYuan: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
        unitCostKrw: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'works 신규 원가', '')`,
      })
      .from(purchaseRequestItems)
      .leftJoin(products, and(
        eq(products.userId, purchaseRequestItems.userId),
        eq(products.internalSku, purchaseRequestItems.sku),
      ))
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(purchaseRequestItems).where(where),
    db
      .select({
        status: purchaseRequestItems.status,
        total: count(),
      })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.userId, input.userId))
      .groupBy(purchaseRequestItems.status),
    db
      .select({
        requestedQuantity: purchaseRequestItems.requestedQuantity,
        unitCostYuan: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
        unitCostKrw: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'works 신규 원가', '')`,
      })
      .from(purchaseRequestItems)
      .leftJoin(products, and(
        eq(products.userId, purchaseRequestItems.userId),
        eq(products.internalSku, purchaseRequestItems.sku),
      ))
      .where(where),
  ])

  return {
    items,
    total,
    costTotals: sumPurchaseCosts(costRows),
    statusCounts: Object.fromEntries(statusCounts.map((row) => [row.status, row.total])) as Partial<Record<PurchaseRequestStatus, number>>,
  }
}

export async function updatePurchaseRequestStatus(input: {
  userId: string
  id: string
  status: PurchaseRequestStatus
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!current) return null
    if (current.status === input.status) return { id: current.id }

    if (input.status === 'china_arrived') {
      await addChinaWarehouseStock(tx, current)
    }
    if (input.status === 'outbound_requested') {
      if (current.status === 'china_arrived') {
        await addChinaWarehouseStock(tx, current)
      }
      await subtractChinaWarehouseStock(tx, current)
    }

    const values: Partial<typeof purchaseRequestItems.$inferInsert> = {
      status: input.status,
      updatedAt: new Date(),
    }
    if (input.status === 'purchased') {
      values.actualPurchaseQuantity = current.actualPurchaseQuantity ?? current.requestedQuantity
    }
    if (input.status === 'china_arrived') {
      values.chinaReceivedAt = current.chinaReceivedAt ?? new Date()
      values.chinaReceivedQuantity = current.chinaReceivedQuantity ?? purchaseQuantity(current)
    }

    const [row] = await tx
      .update(purchaseRequestItems)
      .set(values)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .returning({ id: purchaseRequestItems.id })

    return row ?? null
  })
}

export async function updatePurchaseRequestPlanFields(input: {
  userId: string
  id: string
  requestedQuantity?: number
  actualPurchaseQuantity?: number | null
  chinaReceivedQuantity?: number | null
  outboundRequestedQuantity?: number | null
  supplierOrderNumber?: string | null
  outboundExpectedDate?: string | null
  purchaseMethod?: string | null
  purchaseConfirmed?: boolean
}) {
  const requestedQuantity = normalizePurchaseRequestQuantity(input.requestedQuantity)
  const actualPurchaseQuantity = normalizeOptionalPurchaseRequestQuantity(input.actualPurchaseQuantity)
  const chinaReceivedQuantity = normalizeOptionalPurchaseRequestQuantity(input.chinaReceivedQuantity)
  const outboundRequestedQuantity = normalizeOptionalPurchaseRequestQuantity(input.outboundRequestedQuantity)
  if (requestedQuantity === null) return null
  if (actualPurchaseQuantity === null) return null
  if (chinaReceivedQuantity === null) return null
  if (outboundRequestedQuantity === null) return null
  const values: Partial<typeof purchaseRequestItems.$inferInsert> = {
    updatedAt: new Date(),
  }
  if (requestedQuantity !== undefined) values.requestedQuantity = requestedQuantity
  if (actualPurchaseQuantity !== undefined) values.actualPurchaseQuantity = actualPurchaseQuantity
  if (chinaReceivedQuantity !== undefined) values.chinaReceivedQuantity = chinaReceivedQuantity
  if (input.supplierOrderNumber !== undefined) {
    values.supplierOrderNumber = emptyToNull(input.supplierOrderNumber)
  }
  if (input.outboundExpectedDate !== undefined) {
    values.outboundExpectedDate = input.outboundExpectedDate || null
  }
  if (input.purchaseMethod !== undefined) {
    values.purchaseMethod = emptyToNull(input.purchaseMethod)
  }
  if (input.purchaseConfirmed !== undefined) {
    values.purchaseConfirmed = input.purchaseConfirmed
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!current) return null

    if (outboundRequestedQuantity !== undefined) {
      values.rawData = {
        ...current.rawData,
        outboundRequestedQuantity,
      }
    }
    if (chinaReceivedQuantity !== undefined) {
      await adjustChinaWarehouseArrivalQuantity(tx, current, chinaReceivedQuantity)
    }
    if (outboundRequestedQuantity !== undefined) {
      await adjustChinaWarehouseOutboundQuantity(tx, current, outboundRequestedQuantity)
    }

    const [row] = await tx
      .update(purchaseRequestItems)
      .set(values)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .returning({ id: purchaseRequestItems.id })

    return row ?? null
  })
}

export function normalizePurchaseRequestQuantity(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  const quantity = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(quantity) || quantity < 1) return null
  return quantity
}

export function normalizeOptionalPurchaseRequestQuantity(value: unknown) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const quantity = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(quantity) || quantity < 0) return null
  return quantity
}

export function getOutboundRequestedQuantity(item: {
  rawData: Record<string, unknown>
  chinaReceivedQuantity: number | null
  actualPurchaseQuantity: number | null
  requestedQuantity: number
}) {
  const rawQuantity = item.rawData.outboundRequestedQuantity
  const outboundRequestedQuantity = typeof rawQuantity === 'number' ? rawQuantity : Number(rawQuantity)
  if (Number.isInteger(outboundRequestedQuantity) && outboundRequestedQuantity >= 0) {
    return outboundRequestedQuantity
  }
  return item.chinaReceivedQuantity ?? item.actualPurchaseQuantity ?? item.requestedQuantity
}

export function purchaseRequestOrderBy(sort?: string, order?: string): SQL[] {
  const direction = order === 'asc' ? asc : desc
  const unitCostYuan = sql<number>`NULLIF(regexp_replace(COALESCE(${products.metadata}->'esa009m'->>'신규원가(元)', ''), '[^0-9.-]', '', 'g'), '')::numeric`
  const unitCostKrw = sql<number>`NULLIF(regexp_replace(COALESCE(${products.metadata}->'esa009m'->>'works 신규 원가', ''), '[^0-9.-]', '', 'g'), '')::numeric`
  const totalCostYuan = sql<number>`COALESCE(${unitCostYuan}, 0) * ${purchaseRequestItems.requestedQuantity}`
  const totalCostKrw = sql<number>`COALESCE(${unitCostKrw}, 0) * ${purchaseRequestItems.requestedQuantity}`

  switch (sort) {
    case 'status':
      return [direction(purchaseRequestItems.status), desc(purchaseRequestItems.createdAt)]
    case 'productName':
      return [
        direction(purchaseRequestItems.productName),
        asc(purchaseRequestItems.sku),
        desc(purchaseRequestItems.createdAt),
      ]
    case 'sku':
      return [direction(purchaseRequestItems.sku), desc(purchaseRequestItems.createdAt)]
    case 'requestedQuantity':
      return [direction(purchaseRequestItems.requestedQuantity), desc(purchaseRequestItems.createdAt)]
    case 'unitCostYuan':
      return [direction(unitCostYuan), desc(purchaseRequestItems.createdAt)]
    case 'unitCostKrw':
      return [direction(unitCostKrw), desc(purchaseRequestItems.createdAt)]
    case 'totalCostYuan':
      return [direction(totalCostYuan), desc(purchaseRequestItems.createdAt)]
    case 'totalCostKrw':
      return [direction(totalCostKrw), desc(purchaseRequestItems.createdAt)]
    case 'chinaArrivalRequestDate':
      return [direction(purchaseRequestItems.chinaArrivalRequestDate), desc(purchaseRequestItems.createdAt)]
    case 'purchaseManagementCode':
      return [direction(purchaseRequestItems.purchaseManagementCode), desc(purchaseRequestItems.createdAt)]
    case 'buyerName':
      return [direction(purchaseRequestItems.buyerName), desc(purchaseRequestItems.createdAt)]
    case 'createdAt':
      return [direction(purchaseRequestItems.createdAt)]
    default:
      return [desc(purchaseRequestItems.createdAt)]
  }
}

export async function deletePurchaseRequestItem(input: {
  userId: string
  id: string
}) {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: purchaseRequestItems.id })
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!item) return null

    const movements = await tx
      .select()
      .from(chinaWarehouseInventoryMovements)
      .where(and(
        eq(chinaWarehouseInventoryMovements.userId, input.userId),
        eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, input.id),
      ))

    for (const movement of movements) {
      await tx
        .update(chinaWarehouseInventory)
        .set({
          totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} - ${movement.delta}`,
          availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} - ${movement.delta}`,
          updatedAt: new Date(),
        })
        .where(eq(chinaWarehouseInventory.id, movement.inventoryId))
    }

    await tx
      .delete(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))

    await tx
      .delete(chinaWarehouseInventory)
      .where(and(
        eq(chinaWarehouseInventory.userId, input.userId),
        eq(chinaWarehouseInventory.totalQuantity, 0),
        eq(chinaWarehouseInventory.availableQuantity, 0),
      ))

    return { id: input.id }
  })
}

export async function getChinaWarehouseInventory(input: {
  userId: string
  search?: string
  page?: number
  pageSize?: number
}) {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 50
  const conditions: SQL[] = [
    eq(chinaWarehouseInventory.userId, input.userId),
    sql`${chinaWarehouseInventory.totalQuantity} > 0`,
  ]
  if (input.search) {
    const pattern = `%${input.search}%`
    conditions.push(or(
      ilike(chinaWarehouseInventory.sku, pattern),
      ilike(chinaWarehouseInventory.productName, pattern),
      ilike(chinaWarehouseInventory.optionName, pattern),
    )!)
  }

  const where = and(...conditions)
  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(chinaWarehouseInventory)
      .where(where)
      .orderBy(asc(chinaWarehouseInventory.sku), asc(chinaWarehouseInventory.optionKey))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(chinaWarehouseInventory).where(where),
  ])

  return { items, total }
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type PurchaseRequestItem = typeof purchaseRequestItems.$inferSelect

async function addChinaWarehouseStock(tx: DbTransaction, item: PurchaseRequestItem) {
  const quantity = purchaseQuantity(item)
  if (quantity <= 0) return
  const optionKey = item.optionName ?? ''

  if (await hasChinaWarehouseMovement(tx, item.id, 'arrival')) return

  await tx
    .insert(chinaWarehouseInventory)
    .values({
      userId: item.userId,
      sku: item.sku,
      productName: item.productName,
      optionKey,
      optionName: item.optionName,
      totalQuantity: quantity,
      availableQuantity: quantity,
      lastArrivedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        chinaWarehouseInventory.userId,
        chinaWarehouseInventory.sku,
        chinaWarehouseInventory.optionKey,
      ],
      set: {
        productName: item.productName,
        optionName: item.optionName,
        totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} + ${quantity}`,
        availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} + ${quantity}`,
        lastArrivedAt: new Date(),
        updatedAt: new Date(),
      },
    })

  const [inventoryRow] = await tx
    .select()
    .from(chinaWarehouseInventory)
    .where(and(
      eq(chinaWarehouseInventory.userId, item.userId),
      eq(chinaWarehouseInventory.sku, item.sku),
      eq(chinaWarehouseInventory.optionKey, optionKey),
    ))
    .limit(1)

  if (!inventoryRow) throw new Error('중국창고 재고 반영에 실패했습니다.')

  await tx.insert(chinaWarehouseInventoryMovements).values({
    inventoryId: inventoryRow.id,
    userId: item.userId,
    purchaseRequestItemId: item.id,
    movementType: 'arrival',
    delta: quantity,
    quantityBefore: inventoryRow.totalQuantity - quantity,
    quantityAfter: inventoryRow.totalQuantity,
    note: '중국창고도착 상태 이동',
  }).onConflictDoNothing()
}

async function subtractChinaWarehouseStock(tx: DbTransaction, item: PurchaseRequestItem) {
  const quantity = outboundQuantity(item)
  if (quantity <= 0) return
  const optionKey = item.optionName ?? ''

  if (await hasChinaWarehouseMovement(tx, item.id, 'outbound_request')) return
  if (!await hasChinaWarehouseMovement(tx, item.id, 'arrival')) {
    throw new Error('중국창고도착으로 입고된 발주 항목만 출고요청으로 이동할 수 있습니다.')
  }

  const [inventoryRow] = await tx
    .select()
    .from(chinaWarehouseInventory)
    .where(and(
      eq(chinaWarehouseInventory.userId, item.userId),
      eq(chinaWarehouseInventory.sku, item.sku),
      eq(chinaWarehouseInventory.optionKey, optionKey),
    ))
    .limit(1)

  if (!inventoryRow) throw new Error('중국창고 재고가 없는 상품은 출고요청으로 이동할 수 없습니다.')
  if (inventoryRow.availableQuantity < quantity) {
    throw new Error(`중국창고 재고가 부족합니다. 현재 ${inventoryRow.availableQuantity}개, 요청 ${quantity}개`)
  }

  await tx
    .update(chinaWarehouseInventory)
    .set({
      totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} - ${quantity}`,
      availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} - ${quantity}`,
      lastOutboundRequestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(chinaWarehouseInventory.id, inventoryRow.id))

  await tx.insert(chinaWarehouseInventoryMovements).values({
    inventoryId: inventoryRow.id,
    userId: item.userId,
    purchaseRequestItemId: item.id,
    movementType: 'outbound_request',
    delta: -quantity,
    quantityBefore: inventoryRow.totalQuantity,
    quantityAfter: inventoryRow.totalQuantity - quantity,
    note: '출고요청 상태 이동',
  }).onConflictDoNothing()

  await deleteEmptyChinaWarehouseInventory(tx, item.userId)
}

async function adjustChinaWarehouseArrivalQuantity(
  tx: DbTransaction,
  item: PurchaseRequestItem,
  nextQuantity: number,
) {
  const [movement] = await tx
    .select()
    .from(chinaWarehouseInventoryMovements)
    .where(and(
      eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, item.id),
      eq(chinaWarehouseInventoryMovements.movementType, 'arrival'),
    ))
    .limit(1)

  if (!movement) return
  const difference = nextQuantity - movement.delta
  if (difference === 0) return
  if (difference < 0) {
    const [inventoryRow] = await tx
      .select({ availableQuantity: chinaWarehouseInventory.availableQuantity })
      .from(chinaWarehouseInventory)
      .where(eq(chinaWarehouseInventory.id, movement.inventoryId))
      .limit(1)
    if (!inventoryRow || inventoryRow.availableQuantity < Math.abs(difference)) {
      throw new Error('이미 출고요청된 수량보다 중국도착수량을 적게 줄일 수 없습니다.')
    }
  }

  await tx
    .update(chinaWarehouseInventory)
    .set({
      totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} + ${difference}`,
      availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} + ${difference}`,
      updatedAt: new Date(),
    })
    .where(eq(chinaWarehouseInventory.id, movement.inventoryId))

  await tx
    .update(chinaWarehouseInventoryMovements)
    .set({
      delta: nextQuantity,
      quantityAfter: movement.quantityBefore + nextQuantity,
    })
    .where(eq(chinaWarehouseInventoryMovements.id, movement.id))

  await deleteEmptyChinaWarehouseInventory(tx, item.userId)
}

async function adjustChinaWarehouseOutboundQuantity(
  tx: DbTransaction,
  item: PurchaseRequestItem,
  nextQuantity: number,
) {
  const [movement] = await tx
    .select()
    .from(chinaWarehouseInventoryMovements)
    .where(and(
      eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, item.id),
      eq(chinaWarehouseInventoryMovements.movementType, 'outbound_request'),
    ))
    .limit(1)

  if (!movement) return
  const currentQuantity = Math.abs(movement.delta)
  const difference = nextQuantity - currentQuantity
  if (difference === 0) return

  const [inventoryRow] = await tx
    .select({ availableQuantity: chinaWarehouseInventory.availableQuantity })
    .from(chinaWarehouseInventory)
    .where(eq(chinaWarehouseInventory.id, movement.inventoryId))
    .limit(1)
  if (!inventoryRow) throw new Error('중국창고 재고를 찾을 수 없습니다.')
  if (difference > 0 && inventoryRow.availableQuantity < difference) {
    throw new Error(`중국창고 재고가 부족합니다. 현재 ${inventoryRow.availableQuantity}개, 추가 출고요청 ${difference}개`)
  }

  await tx
    .update(chinaWarehouseInventory)
    .set({
      totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} - ${difference}`,
      availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} - ${difference}`,
      updatedAt: new Date(),
    })
    .where(eq(chinaWarehouseInventory.id, movement.inventoryId))

  await tx
    .update(chinaWarehouseInventoryMovements)
    .set({
      delta: -nextQuantity,
      quantityAfter: movement.quantityBefore - nextQuantity,
    })
    .where(eq(chinaWarehouseInventoryMovements.id, movement.id))

  await deleteEmptyChinaWarehouseInventory(tx, item.userId)
}

async function hasChinaWarehouseMovement(
  tx: DbTransaction,
  purchaseRequestItemId: string,
  movementType: 'arrival' | 'outbound_request',
) {
  const [existingMovement] = await tx
    .select({ id: chinaWarehouseInventoryMovements.id })
    .from(chinaWarehouseInventoryMovements)
    .where(and(
      eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, purchaseRequestItemId),
      eq(chinaWarehouseInventoryMovements.movementType, movementType),
    ))
    .limit(1)

  return Boolean(existingMovement)
}

async function deleteEmptyChinaWarehouseInventory(tx: DbTransaction, userId: string) {
  await tx
    .delete(chinaWarehouseInventory)
    .where(and(
      eq(chinaWarehouseInventory.userId, userId),
      eq(chinaWarehouseInventory.totalQuantity, 0),
      eq(chinaWarehouseInventory.availableQuantity, 0),
    ))
}

function purchaseQuantity(item: PurchaseRequestItem) {
  return item.chinaReceivedQuantity ?? item.actualPurchaseQuantity ?? item.requestedQuantity ?? 0
}

function outboundQuantity(item: PurchaseRequestItem) {
  return getOutboundRequestedQuantity({
    rawData: item.rawData,
    chinaReceivedQuantity: item.chinaReceivedQuantity,
    actualPurchaseQuantity: item.actualPurchaseQuantity,
    requestedQuantity: item.requestedQuantity,
  })
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

