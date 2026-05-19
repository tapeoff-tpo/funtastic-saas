import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { orders, shipments } from '@/lib/db/schema'
import { deductForOrder } from '@/lib/inventory/actions'
import { logOrderChange } from '@/lib/orders/change-log'

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

    await logOrderChange({
      orderId,
      userId: order.userId,
      action: 'invoice.sent',
      title: '송장 송신완료',
      description: '마켓 송장 송신이 완료되었습니다.',
      before: { uploadStatus: 'uploading' },
      after: { uploadStatus: 'uploaded' },
      metadata: { shipmentId },
    }, tx)

    if (order?.status === 'ready') {
      await tx.update(orders).set({
        status: 'shipped',
        previousStatus: 'ready',
        updatedAt: new Date(),
      }).where(eq(orders.id, orderId))
      await logOrderChange({
        orderId,
        userId: order.userId,
        action: 'status.shipped',
        title: '출고완료',
        description: '송장 송신 완료 후 출고완료 상태로 이동했습니다.',
        before: { status: order.status },
        after: { status: 'shipped' },
        metadata: { shipmentId },
      }, tx)
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
