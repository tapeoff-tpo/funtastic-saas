/**
 * Inventory stock adjustment actions.
 *
 * Provides atomic stock operations with audit trail:
 * - adjustStock: manual delta adjustment with reason
 * - setStock: upsert inventory with physical count
 * - deductForOrder: auto-deduct when order ships (called inside tx)
 * - restoreForOrder: auto-restore when order cancels (called inside tx)
 * - restoreForClaim: standalone restore for return claims
 */

import { db } from '@/lib/db'
import { inventory, inventoryHistory, orderItems, orders, mappingSources, mappingComponents } from '@/lib/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import type { AdjustmentReason } from './types'

type ActionResult = { success: boolean; error?: string; newTotal?: number }

// Use the transaction type from Drizzle's callback parameter
type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Adjust stock by a delta amount with reason tracking.
 * Uses SELECT FOR UPDATE for atomicity (per D-02).
 * Returns error if inventory record does not exist -- admin must create via setStock first.
 */
export async function adjustStock(
  userId: string,
  sku: string,
  delta: number,
  reason: AdjustmentReason,
  opts?: { note?: string; orderId?: string },
): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    return adjustStockInTx(tx, userId, sku, delta, reason, opts)
  })
}

/**
 * Internal: adjust stock within an existing transaction.
 */
async function adjustStockInTx(
  tx: DrizzleTransaction,
  userId: string,
  sku: string,
  delta: number,
  reason: AdjustmentReason,
  opts?: { note?: string; orderId?: string },
): Promise<ActionResult> {
  // Lock the inventory row
  const [record] = await tx
    .select()
    .from(inventory)
    .where(and(eq(inventory.userId, userId), eq(inventory.sku, sku)))
    .for('update')

  if (!record) {
    return { success: false, error: `No inventory record for SKU '${sku}'` }
  }

  const previousTotal = record.totalStock
  const newTotal = previousTotal + delta
  const newAvailable = newTotal - record.reservedStock

  await tx
    .update(inventory)
    .set({
      totalStock: newTotal,
      availableStock: newAvailable,
      updatedAt: new Date(),
    })
    .where(eq(inventory.id, record.id))

  await tx.insert(inventoryHistory).values({
    inventoryId: record.id,
    userId,
    adjustmentReason: reason,
    delta,
    previousTotal,
    newTotal,
    note: opts?.note ?? null,
    orderId: opts?.orderId ?? null,
  })

  return { success: true, newTotal }
}

/**
 * Set stock level for a SKU (upsert).
 * Creates new inventory record or updates existing.
 * Records audit entry with reason 'physical_count'.
 */
export async function setStock(
  userId: string,
  sku: string,
  productName: string,
  totalStock: number,
  opts?: { warehouseZone?: string; sectorCode?: string },
): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    // Try to find existing record with lock
    const [existing] = await tx
      .select()
      .from(inventory)
      .where(and(eq(inventory.userId, userId), eq(inventory.sku, sku)))
      .for('update')

    if (existing) {
      const previousTotal = existing.totalStock
      const delta = totalStock - previousTotal
      const newAvailable = totalStock - existing.reservedStock

      await tx
        .update(inventory)
        .set({
          productName,
          totalStock,
          availableStock: newAvailable,
          ...(opts?.warehouseZone !== undefined && { warehouseZone: opts.warehouseZone || null }),
          ...(opts?.sectorCode !== undefined && { sectorCode: opts.sectorCode || null }),
          updatedAt: new Date(),
        })
        .where(eq(inventory.id, existing.id))

      await tx.insert(inventoryHistory).values({
        inventoryId: existing.id,
        userId,
        adjustmentReason: 'physical_count',
        delta,
        previousTotal,
        newTotal: totalStock,
        note: null,
        orderId: null,
      })
    } else {
      // Create new inventory record
      const [newRecord] = await tx
        .insert(inventory)
        .values({
          userId,
          sku,
          productName,
          warehouseZone: opts?.warehouseZone || null,
          sectorCode: opts?.sectorCode || null,
          totalStock,
          reservedStock: 0,
          availableStock: totalStock,
        })
        .returning({ id: inventory.id })

      await tx.insert(inventoryHistory).values({
        inventoryId: newRecord.id,
        userId,
        adjustmentReason: 'physical_count',
        delta: totalStock,
        previousTotal: 0,
        newTotal: totalStock,
        note: null,
        orderId: null,
      })
    }

    return { success: true }
  })
}

/**
 * orderItems → 차감 대상 SKU/수량 으로 전개.
 *
 * Phase C 매핑코드 시스템:
 *   1) (marketplaceId, marketplaceItemId) 가 mapping_sources 에 있으면
 *      mapping_components 의 SKU + 수량으로 전개 (단품=1행, 세트=N행).
 *   2) 매칭 없으면 fallback: orderItems.sku 직접 사용 (구 데이터 호환).
 *   3) sku 없고 매핑도 없으면 스킵 (차감 불가).
 *
 * 같은 SKU 가 여러 번 등장할 수 있으므로 합산해서 한 번에 차감.
 */
async function expandOrderItemsForDeduction(
  tx: DrizzleTransaction,
  userId: string,
  orderId: string,
): Promise<Array<{ sku: string; quantity: number }>> {
  const rawItems = await tx
    .select({
      marketplaceItemId: orderItems.marketplaceItemId,
      sku: orderItems.sku,
      quantity: orderItems.quantity,
      skuMultiplier: orderItems.skuMultiplier,
      orderMarketplaceId: orders.marketplaceId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.orderId, orderId))

  if (rawItems.length === 0) return []

  // 매핑 lookup 을 위해 (marketplaceId, marketplaceItemId) 셋 수집
  const sourceKeys = new Set<string>()
  for (const r of rawItems) {
    if (r.marketplaceItemId) {
      sourceKeys.add(`${r.orderMarketplaceId}:${r.marketplaceItemId}`)
    }
  }

  // mapping_sources + components 한 번에 join 으로 가져옴
  const mappingRows = sourceKeys.size > 0
    ? await tx
        .select({
          marketplaceId: mappingSources.marketplaceId,
          marketplaceProductId: mappingSources.marketplaceProductId,
          componentSku: mappingComponents.sku,
          componentQuantity: mappingComponents.quantity,
        })
        .from(mappingSources)
        .innerJoin(mappingComponents, eq(mappingComponents.mappingCodeId, mappingSources.mappingCodeId))
        .where(eq(mappingSources.userId, userId))
    : []

  // (marketplaceId:marketplaceItemId) → [{sku, quantity}, ...]
  const mappingByKey = new Map<string, Array<{ sku: string; quantity: number }>>()
  for (const row of mappingRows) {
    const key = `${row.marketplaceId}:${row.marketplaceProductId}`
    if (!sourceKeys.has(key)) continue
    const existing = mappingByKey.get(key) ?? []
    existing.push({ sku: row.componentSku, quantity: row.componentQuantity })
    mappingByKey.set(key, existing)
  }

  // 합산 (같은 SKU 여러 번 → 한 번에 차감)
  const accumulated = new Map<string, number>()
  const add = (sku: string, qty: number) => {
    accumulated.set(sku, (accumulated.get(sku) ?? 0) + qty)
  }

  for (const r of rawItems) {
    const orderQty = r.quantity * (r.skuMultiplier ?? 1)
    const key = r.marketplaceItemId
      ? `${r.orderMarketplaceId}:${r.marketplaceItemId}`
      : null
    const components = key ? mappingByKey.get(key) : null

    if (components && components.length > 0) {
      for (const c of components) add(c.sku, orderQty * c.quantity)
    } else if (r.sku) {
      add(r.sku, orderQty)
    }
    // else: 매핑도 없고 sku 도 없음 → 스킵
  }

  return Array.from(accumulated.entries()).map(([sku, quantity]) => ({ sku, quantity }))
}

/**
 * Deduct inventory for a shipped order.
 * Called INSIDE an existing transaction (receives tx parameter).
 * Queries order_items for SKU + quantity pairs and decrements stock.
 * Bundle SKUs are expanded to their component SKUs before deduction.
 * Items without SKU are silently skipped.
 * Does NOT fail if inventory record doesn't exist for a SKU -- logs warning and continues.
 */
export async function deductForOrder(
  tx: DrizzleTransaction,
  userId: string,
  orderId: string,
): Promise<void> {
  const items = await expandOrderItemsForDeduction(tx, userId, orderId)

  for (const item of items) {
    const result = await adjustStockInTx(tx, userId, item.sku, -item.quantity, 'order_ship', { orderId })
    if (!result.success) {
      console.warn(`[inventory] deductForOrder: SKU '${item.sku}' not found for order ${orderId}, skipping`)
    }
  }
}

/**
 * Restore inventory for a cancelled order.
 * Called INSIDE an existing transaction (receives tx parameter).
 * Bundle SKUs are expanded to their component SKUs before restoration.
 */
export async function restoreForOrder(
  tx: DrizzleTransaction,
  userId: string,
  orderId: string,
): Promise<void> {
  const items = await expandOrderItemsForDeduction(tx, userId, orderId)

  for (const item of items) {
    const result = await adjustStockInTx(tx, userId, item.sku, item.quantity, 'order_cancel', { orderId })
    if (!result.success) {
      console.warn(`[inventory] restoreForOrder: SKU '${item.sku}' not found for order ${orderId}, skipping`)
    }
  }
}

/**
 * Restore inventory for a completed return claim.
 * Standalone function (not inside a tx) since claims processing
 * is separate from order status changes.
 * Bundle SKUs are expanded to their component SKUs before restoration.
 */
export async function restoreForClaim(
  userId: string,
  orderId: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    const items = await expandOrderItemsForDeduction(tx, userId, orderId)

    for (const item of items) {
      const result = await adjustStockInTx(tx, userId, item.sku, item.quantity, 'return', {
        orderId,
        note: 'Return claim completed',
      })
      if (!result.success) {
        console.warn(`[inventory] restoreForClaim: SKU '${item.sku}' not found for order ${orderId}, skipping`)
      }
    }
  })
}
