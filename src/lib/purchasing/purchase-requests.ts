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
  overdueOnly?: boolean
  search?: string
  page?: number
  pageSize?: number
  sort?: string
  order?: string
}) {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 50
  const conditions: SQL[] = [eq(purchaseRequestItems.userId, input.userId)]

  if (input.overdueOnly) {
    if (input.status === 'purchased') {
      conditions.push(eq(purchaseRequestItems.status, 'purchased'))
      conditions.push(sql`${purchaseRequestItems.requestDate} IS NOT NULL`)
      conditions.push(sql`${purchaseRequestItems.requestDate} <= CURRENT_DATE - INTERVAL '7 days'`)
    } else if (input.status === 'purchase_completed') {
      conditions.push(eq(purchaseRequestItems.status, 'purchase_completed'))
      conditions.push(sql`${purchaseRequestItems.outboundExpectedDate} IS NOT NULL`)
      conditions.push(sql`${purchaseRequestItems.outboundExpectedDate} <= CURRENT_DATE - INTERVAL '7 days'`)
    } else {
      conditions.push(or(
        and(
          eq(purchaseRequestItems.status, 'purchased'),
          sql`${purchaseRequestItems.requestDate} IS NOT NULL`,
          sql`${purchaseRequestItems.requestDate} <= CURRENT_DATE - INTERVAL '7 days'`,
        ),
        and(
          eq(purchaseRequestItems.status, 'purchase_completed'),
          sql`${purchaseRequestItems.outboundExpectedDate} IS NOT NULL`,
          sql`${purchaseRequestItems.outboundExpectedDate} <= CURRENT_DATE - INTERVAL '7 days'`,
        ),
      )!)
    }
  } else if (input.status) {
    conditions.push(eq(purchaseRequestItems.status, input.status))
  }
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
  const orderBy = purchaseRequestOrderBy(input.sort, input.order, input.status)
  const overduePurchaseRequestConditions: SQL[] = [
    eq(purchaseRequestItems.userId, input.userId),
    eq(purchaseRequestItems.status, 'purchased'),
    sql`${purchaseRequestItems.requestDate} IS NOT NULL`,
    sql`${purchaseRequestItems.requestDate} <= CURRENT_DATE - INTERVAL '7 days'`,
  ]
  const overduePurchaseCompletedConditions: SQL[] = [
    eq(purchaseRequestItems.userId, input.userId),
    eq(purchaseRequestItems.status, 'purchase_completed'),
    sql`${purchaseRequestItems.outboundExpectedDate} IS NOT NULL`,
    sql`${purchaseRequestItems.outboundExpectedDate} <= CURRENT_DATE - INTERVAL '7 days'`,
  ]
  if (input.search) {
    const pattern = `%${input.search}%`
    const searchCondition = or(
      ilike(purchaseRequestItems.sku, pattern),
      ilike(purchaseRequestItems.productName, pattern),
      ilike(purchaseRequestItems.optionName, pattern),
      ilike(purchaseRequestItems.purchaseManagementCode, pattern),
      ilike(purchaseRequestItems.supplierOrderNumber, pattern),
    )!
    overduePurchaseRequestConditions.push(searchCondition)
    overduePurchaseCompletedConditions.push(searchCondition)
  }
  const overduePurchaseRequestWhere = and(...overduePurchaseRequestConditions)
  const overduePurchaseCompletedWhere = and(...overduePurchaseCompletedConditions)
  const chinaCurrentStock = sql<number>`(
    SELECT COALESCE(SUM(
      CASE
        WHEN (active.raw_data->>'outboundRequestedQuantity') ~ '^[0-9]+$'
          THEN (active.raw_data->>'outboundRequestedQuantity')::int
        ELSE COALESCE(
          active.china_received_quantity,
          active.actual_purchase_quantity,
          active.requested_quantity,
          0
        )
      END
    ), 0)::int
    FROM ${purchaseRequestItems} active
    WHERE active.user_id = ${purchaseRequestItems.userId}
      AND active.sku = ${purchaseRequestItems.sku}
      AND COALESCE(active.option_name, '') = COALESCE(${purchaseRequestItems.optionName}, '')
      AND active.status IN ('china_arrived', 'outbound_requested')
  )`
  const [items, [{ total }], statusCounts, costRows, overduePurchaseRequestRows, overduePurchaseCompletedRows] = await Promise.all([
    db
      .select({
        ...getTableColumns(purchaseRequestItems),
        unitCostYuan: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
        unitCostKrw: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'works 신규 원가', '')`,
        chinaCurrentStock,
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
    db.select({ total: count() }).from(purchaseRequestItems).where(overduePurchaseRequestWhere),
    db.select({ total: count() }).from(purchaseRequestItems).where(overduePurchaseCompletedWhere),
  ])
  const overduePurchaseRequestCount = overduePurchaseRequestRows[0]?.total ?? 0
  const overduePurchaseCompletedCount = overduePurchaseCompletedRows[0]?.total ?? 0

  return {
    items,
    total,
    costTotals: sumPurchaseCosts(costRows),
    overduePurchasedCount: overduePurchaseCompletedCount,
    overduePurchaseRequestCount,
    overduePurchaseCompletedCount,
    overdueTotalCount: overduePurchaseRequestCount + overduePurchaseCompletedCount,
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
    }
    if (input.status === 'completed') {
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
      values.requestDate = current.requestDate ?? todayKstDate()
      values.actualPurchaseQuantity = current.actualPurchaseQuantity ?? current.requestedQuantity
      if (!current.purchaseManagementCode) {
        const assignment = await nextPurchaseManagementAssignment(tx, current)
        values.sequence = assignment.sequence
        values.buyerCode = assignment.buyerCode
        values.buyerName = current.buyerName ?? assignment.buyerName
        values.purchaseManagementCode = assignment.purchaseManagementCode
      }
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
  requestDate?: string | null
  requestedQuantity?: number
  actualPurchaseQuantity?: number | null
  chinaReceivedQuantity?: number | null
  outboundRequestedQuantity?: number | null
  supplierOrderNumber?: string | null
  outboundExpectedDate?: string | null
  purchaseMethod?: string | null
  purchaseConfirmed?: boolean
  buyerCode?: string | null
  buyerName?: string | null
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
  if (input.requestDate !== undefined) {
    values.requestDate = input.requestDate || null
  }
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
  if (input.buyerCode !== undefined) {
    const buyerCode = normalizePurchaseBuyerCode(input.buyerCode)
    values.buyerCode = buyerCode
    values.buyerName = PURCHASE_BUYERS[buyerCode]
  } else if (input.buyerName !== undefined) {
    values.buyerName = emptyToNull(input.buyerName)
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
    if (outboundRequestedQuantity !== undefined && current.status === 'completed') {
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

export function purchaseRequestOrderBy(sort?: string, order?: string, status?: PurchaseRequestStatus): SQL[] {
  const direction = order === 'asc' ? asc : desc
  const unitCostYuan = sql<number>`NULLIF(regexp_replace(COALESCE(${products.metadata}->'esa009m'->>'신규원가(元)', ''), '[^0-9.-]', '', 'g'), '')::numeric`
  const unitCostKrw = sql<number>`NULLIF(regexp_replace(COALESCE(${products.metadata}->'esa009m'->>'works 신규 원가', ''), '[^0-9.-]', '', 'g'), '')::numeric`
  const totalCostYuan = sql<number>`COALESCE(${unitCostYuan}, 0) * ${purchaseRequestItems.requestedQuantity}`
  const totalCostKrw = sql<number>`COALESCE(${unitCostKrw}, 0) * ${purchaseRequestItems.requestedQuantity}`
  const purchaseDate = sql<Date>`COALESCE(${purchaseRequestItems.requestDate}, ${purchaseRequestItems.createdAt}::date)`

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
    case 'purchaseManagementCode':
      return [direction(purchaseRequestItems.purchaseManagementCode), desc(purchaseRequestItems.createdAt)]
    case 'buyerName':
      return [direction(purchaseRequestItems.buyerName), desc(purchaseRequestItems.createdAt)]
    case 'createdAt':
      return [direction(purchaseRequestItems.createdAt)]
    default:
      return [
        desc(purchaseDate),
        asc(purchaseRequestItems.productName),
        asc(purchaseRequestItems.sku),
        asc(purchaseRequestItems.optionName),
        desc(purchaseRequestItems.createdAt),
      ]
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
    eq(purchaseRequestItems.userId, input.userId),
    sql`${purchaseRequestItems.status} IN ('china_arrived', 'outbound_requested')`,
  ]
  if (input.search) {
    const pattern = `%${input.search}%`
    conditions.push(or(
      ilike(purchaseRequestItems.sku, pattern),
      ilike(purchaseRequestItems.productName, pattern),
      ilike(purchaseRequestItems.optionName, pattern),
    )!)
  }

  const where = and(...conditions)
  const optionKey = sql<string>`COALESCE(${purchaseRequestItems.optionName}, '')`
  const warehouseQuantity = sql<number>`COALESCE(SUM(
    CASE
      WHEN (${purchaseRequestItems.rawData}->>'outboundRequestedQuantity') ~ '^[0-9]+$'
        THEN (${purchaseRequestItems.rawData}->>'outboundRequestedQuantity')::int
      ELSE COALESCE(
        ${purchaseRequestItems.chinaReceivedQuantity},
        ${purchaseRequestItems.actualPurchaseQuantity},
        ${purchaseRequestItems.requestedQuantity},
        0
      )
    END
  ), 0)::int`
  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        id: sql<string>`MIN(${purchaseRequestItems.id}::text)`,
        userId: purchaseRequestItems.userId,
        sku: purchaseRequestItems.sku,
        productName: sql<string>`MAX(${purchaseRequestItems.productName})`,
        optionKey,
        optionName: purchaseRequestItems.optionName,
        totalQuantity: warehouseQuantity,
        availableQuantity: warehouseQuantity,
        lastArrivedAt: sql<Date | null>`MAX(${purchaseRequestItems.chinaReceivedAt})`,
        lastOutboundRequestedAt: sql<Date | null>`MAX(CASE WHEN ${purchaseRequestItems.status} = 'outbound_requested' THEN ${purchaseRequestItems.updatedAt} ELSE NULL END)`,
        createdAt: sql<Date>`MIN(${purchaseRequestItems.createdAt})`,
        updatedAt: sql<Date>`MAX(${purchaseRequestItems.updatedAt})`,
      })
      .from(purchaseRequestItems)
      .where(where)
      .groupBy(purchaseRequestItems.userId, purchaseRequestItems.sku, purchaseRequestItems.optionName)
      .orderBy(asc(purchaseRequestItems.sku), asc(optionKey))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({
        total: sql<number>`COUNT(DISTINCT (${purchaseRequestItems.sku}, COALESCE(${purchaseRequestItems.optionName}, '')))::int`,
      })
      .from(purchaseRequestItems)
      .where(where),
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
    return
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

  if (!inventoryRow) return
  if (inventoryRow.availableQuantity < quantity) {
    return
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

const PURCHASE_BUYERS: Record<string, string> = {
  '1': '한상철',
  '2': '김기환',
  '3': '최종석',
  '4': '오지은',
  '5': '김소희',
}

async function nextPurchaseManagementAssignment(tx: DbTransaction, item: PurchaseRequestItem) {
  const dateKey = formatSeoulDateKey(new Date())
  const buyerCode = normalizePurchaseBuyerCode(item.buyerCode ?? item.managerCode)
  const buyerName = PURCHASE_BUYERS[buyerCode]
  const prefix = `${dateKey}-${buyerCode}-`
  const rows = await tx
    .select({
      sequence: purchaseRequestItems.sequence,
      purchaseManagementCode: purchaseRequestItems.purchaseManagementCode,
    })
    .from(purchaseRequestItems)
    .where(and(
      eq(purchaseRequestItems.userId, item.userId),
      ilike(purchaseRequestItems.purchaseManagementCode, `${prefix}%`),
    ))

  const sequence = rows.reduce((maxSequence, row) => {
    const suffix = row.purchaseManagementCode?.slice(prefix.length)
    const codeSequence = suffix && /^\d+$/.test(suffix) ? Number(suffix) : 0
    return Math.max(maxSequence, row.sequence ?? 0, codeSequence)
  }, 0) + 1
  return {
    buyerCode,
    buyerName,
    sequence,
    purchaseManagementCode: `${prefix}${sequence}`,
  }
}

function normalizePurchaseBuyerCode(value: string | null | undefined) {
  const code = value?.trim()
  return code && PURCHASE_BUYERS[code] ? code : '4'
}

function formatSeoulDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '00'
  const day = parts.find((part) => part.type === 'day')?.value ?? '00'
  return `${year}${month}${day}`
}

function todayKstDate() {
  const key = formatSeoulDateKey(new Date())
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

