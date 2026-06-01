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
import { claims, inventory, inventoryHistory, orderItems, orders, mappingCodes, mappingSources, mappingComponents } from '@/lib/db/schema'
import { eq, and, asc, desc, sql, inArray } from 'drizzle-orm'
import type { AdjustmentReason } from './types'
import { buildMappingIndex, lookupMappingRef, type MappingSource } from '@/lib/orders/mapping-match'

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
    .orderBy(
      sql`CASE WHEN ${inventory.warehouseZone} = '1창고' THEN 0 WHEN ${inventory.warehouseZone} IS NULL THEN 1 ELSE 2 END`,
      desc(inventory.availableStock),
      asc(inventory.createdAt),
    )
    .limit(1)
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
      .where(and(
        eq(inventory.userId, userId),
        eq(inventory.sku, sku),
        opts?.warehouseZone ? eq(inventory.warehouseZone, opts.warehouseZone) : sql`COALESCE(${inventory.warehouseZone}, '') = ''`,
        opts?.sectorCode ? eq(inventory.sectorCode, opts.sectorCode) : sql`COALESCE(${inventory.sectorCode}, '') = ''`,
      ))
      .limit(1)
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
export async function expandOrderItemsForDeduction(
  tx: DrizzleTransaction,
  userId: string,
  orderId: string,
): Promise<Array<{ sku: string; quantity: number }>> {
  const rawItems = await tx
    .select({
      marketplaceItemId: orderItems.marketplaceItemId,
      sku: orderItems.sku,
      optionText: orderItems.optionText,
      quantity: orderItems.quantity,
      skuMultiplier: orderItems.skuMultiplier,
      orderMarketplaceId: orders.marketplaceId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.orderId, orderId))

  if (rawItems.length === 0) return []

  // mapping_sources + components 한 번에 join — 사방넷 품번/단품 둘 다.
  const mappingRows = await tx
    .select({
      mappingCodeId: mappingSources.mappingCodeId,
      marketplaceId: mappingSources.marketplaceId,
      marketplaceProductId: mappingSources.marketplaceProductId,
      marketplaceOptionId: mappingSources.marketplaceOptionId,
      componentSku: mappingComponents.sku,
      componentQuantity: mappingComponents.quantity,
    })
    .from(mappingSources)
    .innerJoin(mappingCodes, eq(mappingCodes.id, mappingSources.mappingCodeId))
    .innerJoin(mappingComponents, eq(mappingComponents.mappingCodeId, mappingSources.mappingCodeId))
    .where(and(eq(mappingSources.userId, userId), eq(mappingCodes.isActive, true)))

  // mappingCodeId 별 components 모음
  const componentsByCode = new Map<string, Array<{ sku: string; quantity: number }>>()
  for (const m of mappingRows) {
    const list = componentsByCode.get(m.mappingCodeId) ?? []
    if (!list.some((c) => c.sku === m.componentSku && c.quantity === m.componentQuantity)) {
      list.push({ sku: m.componentSku, quantity: m.componentQuantity })
    }
    componentsByCode.set(m.mappingCodeId, list)
  }

  // sources index — 단품 우선, 품번 fallback
  const sourcesForIndex: MappingSource[] = []
  const seenSrc = new Set<string>()
  for (const m of mappingRows) {
    const key = `${m.marketplaceId}:${m.marketplaceProductId}:${m.marketplaceOptionId}`
    if (seenSrc.has(key)) continue
    seenSrc.add(key)
    sourcesForIndex.push({
      marketplaceId: m.marketplaceId,
      marketplaceProductId: m.marketplaceProductId,
      marketplaceOptionId: m.marketplaceOptionId,
      ref: m.mappingCodeId,
    })
  }
  const mappingIndex = buildMappingIndex(sourcesForIndex)

  // 합산 (같은 SKU 여러 번 → 한 번에 차감)
  const accumulated = new Map<string, number>()
  const add = (sku: string, qty: number) => {
    accumulated.set(sku, (accumulated.get(sku) ?? 0) + qty)
  }

  for (const r of rawItems) {
    const orderQty = r.quantity * (r.skuMultiplier ?? 1)
    const mappingCodeId = r.marketplaceItemId
      ? lookupMappingRef(mappingIndex, r.orderMarketplaceId, r.marketplaceItemId, r.optionText)
      : null
    const components = mappingCodeId ? componentsByCode.get(mappingCodeId) : null

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

async function resolveReturnProcessingClaimId(
  tx: DrizzleTransaction,
  userId: string,
  claimId: string,
): Promise<string | null> {
  const [requestedClaim] = await tx
    .select({
      id: claims.id,
      claimType: claims.claimType,
      rawData: claims.rawData,
    })
    .from(claims)
    .where(and(eq(claims.id, claimId), eq(claims.userId, userId), inArray(claims.claimType, ['return', 'exchange'])))
    .limit(1)

  if (!requestedClaim) return null

  const source = requestedClaim.rawData && typeof requestedClaim.rawData === 'object'
    ? (requestedClaim.rawData as { source?: unknown }).source
    : null
  if (source !== 'manual') return requestedClaim.id

  const pickupSource = requestedClaim.claimType === 'exchange'
    ? 'manual-exchange-pickup'
    : 'manual-return-pickup'
  const [pickupClaim] = await tx
    .select({ id: claims.id })
    .from(claims)
    .where(and(
      eq(claims.userId, userId),
      eq(claims.claimType, requestedClaim.claimType),
      sql`${claims.rawData}->>'source' = ${pickupSource}`,
      sql`${claims.rawData}->>'originalClaimId' = ${requestedClaim.id}`,
    ))
    .orderBy(desc(claims.requestedAt))
    .limit(1)

  return pickupClaim?.id ?? requestedClaim.id
}

export async function getReturnableItemsForClaim(
  userId: string,
  claimId: string,
): Promise<Array<{ sku: string; quantity: number }>> {
  return db.transaction(async (tx) => {
    const processingClaimId = await resolveReturnProcessingClaimId(tx, userId, claimId)
    if (!processingClaimId) return []

    const [claim] = await tx
      .select({ orderId: claims.orderId })
      .from(claims)
      .where(and(eq(claims.id, processingClaimId), eq(claims.userId, userId), inArray(claims.claimType, ['return', 'exchange'])))
      .limit(1)

    if (!claim) return []
    return expandOrderItemsForDeduction(tx, userId, claim.orderId)
  })
}

export async function completeReturnClaim(
  userId: string,
  claimId: string,
  quantities: Array<{ sku: string; availableQuantity: number; defectiveQuantity: number; warehouseZone?: string | null }>,
): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    const processingClaimId = await resolveReturnProcessingClaimId(tx, userId, claimId)
    if (!processingClaimId) return { success: false, error: '반품/교환 클레임을 찾을 수 없습니다.' }

    const [claim] = await tx
      .select({
        id: claims.id,
        orderId: claims.orderId,
        claimType: claims.claimType,
        claimStatus: claims.claimStatus,
        rawData: claims.rawData,
      })
      .from(claims)
      .where(and(eq(claims.id, processingClaimId), eq(claims.userId, userId), inArray(claims.claimType, ['return', 'exchange'])))
      .for('update')
      .limit(1)

    if (!claim) return { success: false, error: '반품/교환 클레임을 찾을 수 없습니다.' }
    if (claim.claimStatus === 'completed') return { success: false, error: '이미 완료 처리된 건입니다.' }

    const maxItems = await expandOrderItemsForDeduction(tx, userId, claim.orderId)
    const maxBySku = new Map(maxItems.map((item) => [item.sku, item.quantity]))
    const requested = new Map<string, { availableQuantity: number; defectiveQuantity: number; warehouseZone: string }>()

    for (const item of quantities) {
      const sku = item.sku?.trim()
      const availableQuantity = Number(item.availableQuantity)
      const defectiveQuantity = Number(item.defectiveQuantity)
      const warehouseZone = item.warehouseZone?.trim()
      if (
        !sku
        || !warehouseZone
        || !Number.isInteger(availableQuantity)
        || !Number.isInteger(defectiveQuantity)
        || availableQuantity < 0
        || defectiveQuantity < 0
      ) {
        return { success: false, error: '반품 창고 또는 수량이 올바르지 않습니다.' }
      }
      const key = `${sku}::${warehouseZone}`
      const existing = requested.get(key) ?? { availableQuantity: 0, defectiveQuantity: 0, warehouseZone }
      requested.set(key, {
        availableQuantity: existing.availableQuantity + availableQuantity,
        defectiveQuantity: existing.defectiveQuantity + defectiveQuantity,
        warehouseZone,
      })
    }

    const totalQuantity = Array.from(requested.values()).reduce(
      (sum, item) => sum + item.availableQuantity + item.defectiveQuantity,
      0,
    )
    if (totalQuantity === 0) {
      return { success: false, error: '가용 또는 불용 입고 수량을 1개 이상 입력해주세요.' }
    }

    const completionLabel = claim.claimType === 'exchange' ? '교환회수완료' : '반품회수완료'

    for (const [key, quantitiesByDisposition] of requested) {
      const sku = key.split('::')[0]
      const { availableQuantity, defectiveQuantity, warehouseZone } = quantitiesByDisposition
      const quantity = availableQuantity + defectiveQuantity
      const max = maxBySku.get(sku)
      if (max == null) return { success: false, error: `반품 대상 SKU가 아닙니다: ${sku}` }
      if (quantity > max) return { success: false, error: `${sku} 가용/불용 합계는 최대 ${max}개까지 처리할 수 있습니다.` }
      if (quantity === 0) continue

      const [record] = await tx
        .select()
        .from(inventory)
        .where(and(eq(inventory.userId, userId), eq(inventory.sku, sku), eq(inventory.warehouseZone, warehouseZone)))
        .orderBy(
          desc(inventory.availableStock),
          asc(inventory.createdAt),
        )
        .limit(1)
        .for('update')

      if (!record) {
        return { success: false, error: `선택한 창고(${warehouseZone})에 재고관리 SKU가 없습니다: ${sku}` }
      }

      const previousTotal = record.totalStock
      const newTotal = previousTotal + quantity
      await tx.update(inventory).set({
        totalStock: newTotal,
        availableStock: record.availableStock + availableQuantity,
        defectiveStock: record.defectiveStock + defectiveQuantity,
        updatedAt: new Date(),
      }).where(eq(inventory.id, record.id))
      if (availableQuantity > 0) {
        await tx.insert(inventoryHistory).values({
          inventoryId: record.id,
          userId,
          adjustmentReason: 'return',
          delta: availableQuantity,
          previousTotal,
          newTotal: previousTotal + availableQuantity,
          note: `${completionLabel} 가용재고 입고`,
          orderId: claim.orderId,
        })
      }
      if (defectiveQuantity > 0) {
        await tx.insert(inventoryHistory).values({
          inventoryId: record.id,
          userId,
          adjustmentReason: 'defective',
          delta: defectiveQuantity,
          previousTotal: previousTotal + availableQuantity,
          newTotal,
          note: `${completionLabel} 불용재고 입고`,
          orderId: claim.orderId,
        })
      }
    }

    await tx
      .update(claims)
      .set({
        claimStatus: 'completed',
        reason: claim.claimType === 'exchange' ? '교환회수완료' : '반품회수완료',
        updatedAt: new Date(),
      })
      .where(eq(claims.id, claim.id))

    const originalOrderId = claim.rawData
      && typeof claim.rawData === 'object'
      && !Array.isArray(claim.rawData)
      && typeof (claim.rawData as { originalOrderId?: unknown }).originalOrderId === 'string'
      ? (claim.rawData as { originalOrderId: string }).originalOrderId
      : null

    if (originalOrderId) {
      const completionReason = claim.claimType === 'exchange' ? '교환완료' : '반품완료'
      await tx
        .update(orders)
        .set({
          marketplaceStatus: completionReason,
          isHeld: false,
          holdReason: null,
          heldAt: null,
          logisticsMessage: null,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, originalOrderId), eq(orders.userId, userId)))
      await tx
        .update(claims)
        .set({
          claimStatus: 'completed',
          reason: completionReason,
          updatedAt: new Date(),
        })
        .where(and(eq(claims.orderId, originalOrderId), eq(claims.userId, userId), eq(claims.claimType, claim.claimType)))
    }

    return { success: true }
  })
}
