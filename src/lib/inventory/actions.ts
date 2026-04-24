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
import { inventory, inventoryHistory, orderItems, productBundleItems } from '@/lib/db/schema'
import { eq, and, isNotNull, inArray } from 'drizzle-orm'
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
 * Expand order items accounting for bundle SKUs.
 * Returns flat list of {sku, quantity} to actually deduct/restore.
 * Bundle SKU → each component SKU × (componentQty × orderQty).
 * Non-bundle SKU → returned as-is.
 */
async function expandBundleItems(
  tx: DrizzleTransaction,
  userId: string,
  items: Array<{ sku: string | null; quantity: number }>,
): Promise<Array<{ sku: string; quantity: number }>> {
  const skus = items.map((i) => i.sku).filter((s): s is string => !!s)
  if (skus.length === 0) return []

  const bundleRows = await tx
    .select({
      bundleSku: productBundleItems.bundleSku,
      componentSku: productBundleItems.componentSku,
      quantity: productBundleItems.quantity,
    })
    .from(productBundleItems)
    .where(and(eq(productBundleItems.userId, userId), inArray(productBundleItems.bundleSku, skus)))

  // Map: bundleSku → [{componentSku, quantity}]
  const bundleMap = new Map<string, Array<{ componentSku: string; quantity: number }>>()
  for (const row of bundleRows) {
    const existing = bundleMap.get(row.bundleSku) ?? []
    existing.push({ componentSku: row.componentSku, quantity: row.quantity })
    bundleMap.set(row.bundleSku, existing)
  }

  const expanded: Array<{ sku: string; quantity: number }> = []
  for (const item of items) {
    if (!item.sku) continue
    const components = bundleMap.get(item.sku)
    if (components && components.length > 0) {
      // Bundle: replace with component deductions
      for (const comp of components) {
        expanded.push({ sku: comp.componentSku, quantity: comp.quantity * item.quantity })
      }
    } else {
      expanded.push({ sku: item.sku, quantity: item.quantity })
    }
  }
  return expanded
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
  const rawItemsRaw = await tx
    .select({
      sku: orderItems.sku,
      quantity: orderItems.quantity,
      skuMultiplier: orderItems.skuMultiplier,
    })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), isNotNull(orderItems.sku)))

  const rawItems = rawItemsRaw.map((r) => ({
    sku: r.sku,
    quantity: r.quantity * (r.skuMultiplier ?? 1),
  }))

  const items = await expandBundleItems(tx, userId, rawItems)

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
  const rawItemsRaw = await tx
    .select({
      sku: orderItems.sku,
      quantity: orderItems.quantity,
      skuMultiplier: orderItems.skuMultiplier,
    })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), isNotNull(orderItems.sku)))

  const rawItems = rawItemsRaw.map((r) => ({
    sku: r.sku,
    quantity: r.quantity * (r.skuMultiplier ?? 1),
  }))

  const items = await expandBundleItems(tx, userId, rawItems)

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
    const rawItems = await tx
      .select({ sku: orderItems.sku, quantity: orderItems.quantity })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), isNotNull(orderItems.sku)))

    const items = await expandBundleItems(tx, userId, rawItems)

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
