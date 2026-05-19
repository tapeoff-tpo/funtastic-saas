import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { orders, shipments } from '@/lib/db/schema'
import { deductForOrder } from '@/lib/inventory/actions'

export async function markShipmentUploadedAndOrderShipped(
  shipmentId: string,
  orderId: string,
  uploadAttempts: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status, userId: orders.userId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')
      .limit(1)

    await tx.update(shipments).set({
      uploadStatus: 'uploaded',
      lastUploadAt: new Date(),
      uploadAttempts,
      marketplaceUploadError: null,
      updatedAt: new Date(),
    }).where(eq(shipments.id, shipmentId))

    if (order?.status === 'ready') {
      await tx.update(orders).set({
        status: 'shipped',
        previousStatus: 'ready',
        updatedAt: new Date(),
      }).where(eq(orders.id, orderId))
      await deductForOrder(tx, order.userId, orderId)
    }
  })
}

export async function markShipmentUploadFailed(
  shipmentId: string,
  errorMessage: string,
  uploadAttempts: number,
): Promise<void> {
  await db.update(shipments).set({
    uploadStatus: 'failed',
    marketplaceUploadError: errorMessage,
    uploadAttempts,
    updatedAt: new Date(),
  }).where(eq(shipments.id, shipmentId))
}
