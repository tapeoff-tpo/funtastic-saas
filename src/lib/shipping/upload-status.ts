import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { orders, shipments } from '@/lib/db/schema'
import { deductForOrder } from '@/lib/inventory/actions'
import { logOrderChange } from '@/lib/orders/change-log'

export async function markShipmentUploadedAndOrderShipped(
  shipmentId: string,
  _orderId: string,
  uploadAttempts: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [seed] = await tx
      .select({
        shipmentId: shipments.id,
        userId: shipments.userId,
        trackingNumber: shipments.trackingNumber,
        carrierId: shipments.carrierId,
        orderId: orders.id,
        orderStatus: orders.status,
        orderUserId: orders.userId,
        marketplaceId: orders.marketplaceId,
        marketplaceOrderId: orders.marketplaceOrderId,
      })
      .from(shipments)
      .innerJoin(orders, eq(orders.id, shipments.orderId))
      .where(eq(shipments.id, shipmentId))
      .for('update')
      .limit(1)

    if (!seed) return

    const relatedRows = seed.marketplaceId === 'playauto-emp'
      ? [{
          shipmentId: seed.shipmentId,
          orderId: seed.orderId,
          orderStatus: seed.orderStatus,
          orderUserId: seed.orderUserId,
        }]
      : await tx
        .select({
          shipmentId: shipments.id,
          orderId: orders.id,
          orderStatus: orders.status,
          orderUserId: orders.userId,
        })
        .from(shipments)
        .innerJoin(orders, eq(orders.id, shipments.orderId))
        .where(and(
          eq(shipments.userId, seed.userId),
          eq(shipments.trackingNumber, seed.trackingNumber),
          eq(shipments.carrierId, seed.carrierId),
          eq(orders.marketplaceId, seed.marketplaceId),
          eq(orders.marketplaceOrderId, seed.marketplaceOrderId),
        ))
        .for('update')

    const activeRows = relatedRows.filter((row) => row.orderStatus !== 'cancelled')
    const shipmentIds = activeRows.map((row) => row.shipmentId)
    if (shipmentIds.length === 0) return

    await tx.update(shipments).set({
      uploadStatus: 'uploaded',
      lastUploadAt: new Date(),
      uploadAttempts,
      marketplaceUploadError: null,
      updatedAt: new Date(),
    }).where(inArray(shipments.id, shipmentIds))

    for (const row of activeRows) {
      await logOrderChange({
        orderId: row.orderId,
        userId: row.orderUserId,
        action: 'invoice.sent',
        title: '송장 송신완료',
        description: '마켓 송장 송신이 완료되었습니다.',
        before: { uploadStatus: 'uploading' },
        after: { uploadStatus: 'uploaded' },
        metadata: { shipmentId: row.shipmentId, sourceShipmentId: shipmentId },
      }, tx)
    }

    const shippableStatuses = new Set(['new', 'confirmed', 'preparing', 'ready'])
    const shippableOrderIds = activeRows
      .filter((row) => shippableStatuses.has(row.orderStatus))
      .map((row) => row.orderId)

    if (shippableOrderIds.length === 0) return

    const shippableOrders = await tx
      .select({ id: orders.id, status: orders.status, userId: orders.userId })
      .from(orders)
      .where(inArray(orders.id, shippableOrderIds))
      .for('update')

    for (const order of shippableOrders) {
      if (!shippableStatuses.has(order.status)) continue
      const related = activeRows.find((row) => row.orderId === order.id)
      await tx.update(orders).set({
        status: 'shipped',
        previousStatus: order.status,
        updatedAt: new Date(),
      }).where(eq(orders.id, order.id))
      await logOrderChange({
        orderId: order.id,
        userId: order.userId,
        action: 'status.shipped',
        title: '출고완료',
        description: '송장 송신 완료 후 출고완료 상태로 이동했습니다.',
        before: { status: order.status },
        after: { status: 'shipped' },
        metadata: { shipmentId: related?.shipmentId ?? shipmentId, sourceShipmentId: shipmentId },
      }, tx)
      await deductForOrder(tx, order.userId, order.id)
    }
  })
}

export async function markShipmentUploadFailed(
  shipmentId: string,
  errorMessage: string,
  uploadAttempts: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [seed] = await tx
      .select({
        shipmentId: shipments.id,
        userId: shipments.userId,
        trackingNumber: shipments.trackingNumber,
        carrierId: shipments.carrierId,
        marketplaceId: orders.marketplaceId,
        marketplaceOrderId: orders.marketplaceOrderId,
      })
      .from(shipments)
      .innerJoin(orders, eq(orders.id, shipments.orderId))
      .where(eq(shipments.id, shipmentId))
      .limit(1)

    if (!seed) return

    const [uploadedSibling] = seed.marketplaceId === 'playauto-emp'
      ? []
      : await tx
        .select({ id: shipments.id })
        .from(shipments)
        .innerJoin(orders, eq(orders.id, shipments.orderId))
        .where(and(
          eq(shipments.userId, seed.userId),
          eq(shipments.trackingNumber, seed.trackingNumber),
          eq(shipments.carrierId, seed.carrierId),
          eq(orders.marketplaceId, seed.marketplaceId),
          eq(orders.marketplaceOrderId, seed.marketplaceOrderId),
          eq(shipments.uploadStatus, 'uploaded'),
        ))
        .limit(1)

    if (uploadedSibling) {
      await tx.update(shipments).set({
        uploadStatus: 'uploaded',
        marketplaceUploadError: null,
        lastUploadAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(shipments.id, shipmentId))
      return
    }

    await tx.update(shipments).set({
      uploadStatus: 'failed',
      marketplaceUploadError: errorMessage,
      uploadAttempts,
      updatedAt: new Date(),
    }).where(eq(shipments.id, shipmentId))
  })
}
