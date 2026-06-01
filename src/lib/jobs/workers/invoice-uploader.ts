/**
 * BullMQ worker for invoice upload with per-marketplace rate limiting.
 *
 * Processes invoice upload jobs by:
 * 1. Setting shipment status to 'uploading'
 * 2. Looking up the marketplace adapter
 * 3. Calling adapter.uploadInvoice()
 * 4. Updating shipment status to 'uploaded' or 'failed'
 *
 * Failed uploads throw to trigger BullMQ retry (exponential backoff, max 3 attempts).
 */

import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import { getConnection } from '../connection'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { updateShipmentStatus } from '@/lib/shipping/queries'
import { db } from '@/lib/db'
import { jobLogs, marketplaceConnections, orders } from '@/lib/db/schema'
import type { InvoiceUploadJobData } from '@/lib/shipping/types'
import type { InvoiceData } from '@/lib/marketplace/types'
import { markShipmentUploadedAndOrderShipped, markShipmentUploadFailed } from '@/lib/shipping/upload-status'
import { readCredential } from '@/lib/supabase/admin'
import { createAdapter } from './order-collector'

/**
 * For 10x10, look up detailIdx from the order's stored rawData.
 * Returns the first detail's DetailIdx — multi-line orders need separate work.
 */
async function resolveTenByTenDetailIdx(orderId: string): Promise<string | null> {
  const [row] = await db
    .select({ rawData: orders.rawData })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  if (!row?.rawData) return null
  const raw = row.rawData as Record<string, unknown>
  const details = raw.details as Array<{ DetailIdx?: string | number }> | undefined
  if (!details || details.length === 0) return null
  return details[0].DetailIdx != null ? String(details[0].DetailIdx) : null
}

async function resolveOrderRawData(orderId: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ rawData: orders.rawData })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  return (row?.rawData ?? null) as Record<string, unknown> | null
}

async function resolveInvoiceOrderContext(orderId: string) {
  const [row] = await db
    .select({
      rawData: orders.rawData,
      recipientName: orders.recipientName,
      connectionId: orders.connectionId,
      storeAlias: marketplaceConnections.storeAlias,
    })
    .from(orders)
    .leftJoin(marketplaceConnections, eq(orders.connectionId, marketplaceConnections.id))
    .where(eq(orders.id, orderId))
    .limit(1)

  if (!row) return null
  return {
    rawData: (row.rawData ?? null) as Record<string, unknown> | null,
    recipientName: row.recipientName,
    connectionId: row.connectionId,
    storeAlias: row.storeAlias,
  }
}

function firstInvoiceDetailIdx(rawData: Record<string, unknown> | null): string | null {
  const details = rawData?.details as Array<{ DetailIdx?: string | number }> | undefined
  const detailIdx = details?.find((detail) => detail.DetailIdx != null)?.DetailIdx
  return detailIdx != null ? String(detailIdx) : null
}

async function updateInvoiceJobLog(
  jobLogId: string | undefined,
  values: Partial<typeof jobLogs.$inferInsert>,
): Promise<void> {
  if (!jobLogId) return
  await db
    .update(jobLogs)
    .set(values)
    .where(eq(jobLogs.id, jobLogId))
    .catch(() => undefined)
}

/**
 * Process a single invoice upload job.
 *
 * Exported separately for testing -- the worker wraps this function.
 */
export async function processInvoiceUpload(
  job: Job<InvoiceUploadJobData>,
): Promise<void> {
  const {
    orderId,
    shipmentId,
    marketplaceId,
    trackingNumber,
    carrierId,
    userId,
  } = job.data
  const marketplaceOrderId = job.data.marketplaceOrderId ?? job.data.orderId

  await updateInvoiceJobLog(job.data.jobLogId, {
    status: 'running',
    startedAt: new Date(),
    progressMessage: '마켓 송장 송신 중...',
  })

  // 1. Mark as uploading
  await updateShipmentStatus(shipmentId, 'uploading')

  try {
  // 2. Get marketplace adapter with credentials
  const configAdapter = marketplaceRegistry.get(marketplaceId)
  const context = await resolveInvoiceOrderContext(orderId)
  const connectionId = job.data.connectionId || context?.connectionId
  if (!connectionId) {
    throw new Error('마켓 연동 정보가 없어 송장 송신을 진행할 수 없습니다.')
  }

  const aliasTag = (context?.storeAlias && context.storeAlias !== 'default') ? `_${context.storeAlias}` : ''
  const credentials: Record<string, string> = {}
  for (const key of configAdapter.config.requiredCredentials) {
    const val = await readCredential(marketplaceId, userId, `${key}${aliasTag}`)
    if (val) credentials[key] = val
  }
  const adapter = createAdapter(marketplaceId, credentials)

  // 3. Build invoice data (with marketplace-specific extras)
  const invoiceData: InvoiceData = {
    trackingNumber,
    carrierId,
  }
  const rawData = context?.rawData ?? await resolveOrderRawData(orderId)
  if (rawData) invoiceData.rawData = rawData
  if (context?.recipientName) invoiceData.recipientName = context.recipientName
  const firstRawItem = Array.isArray(rawData?.orderItems) ? rawData.orderItems[0] : null
  const firstRawItemData = firstRawItem && typeof firstRawItem === 'object'
    ? firstRawItem as Record<string, unknown>
    : {}
  if (rawData?.shipmentBoxId) invoiceData.shipmentBoxId = rawData.shipmentBoxId
  if (firstRawItemData.vendorItemId) invoiceData.vendorItemId = firstRawItemData.vendorItemId
  if (marketplaceId === '10x10') {
    const detailIdx = firstInvoiceDetailIdx(rawData) ?? await resolveTenByTenDetailIdx(orderId)
    if (detailIdx) invoiceData.detailIdx = detailIdx
  }

  // 4. Call adapter
  const result = await adapter.uploadInvoice(marketplaceOrderId, invoiceData)

  // 5. Update status based on result
  if (result.success) {
    await markShipmentUploadedAndOrderShipped(shipmentId, orderId, job.attemptsMade + 1)
    await updateInvoiceJobLog(job.data.jobLogId, {
      status: 'completed',
      completedAt: new Date(),
      progressMessage: '송장 송신 완료',
      ordersCollected: 1,
    })
  } else {
    const errorMessage = result.error || 'Unknown upload error'
    await markShipmentUploadFailed(shipmentId, errorMessage, job.attemptsMade + 1)
    await updateInvoiceJobLog(job.data.jobLogId, {
      status: 'failed',
      completedAt: new Date(),
      errorMessage,
      progressMessage: '송장 송신 실패',
    })
    // Throw to trigger BullMQ retry
    throw new Error(errorMessage)
  }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown upload error'
    await markShipmentUploadFailed(shipmentId, errorMessage, job.attemptsMade + 1)
    await updateInvoiceJobLog(job.data.jobLogId, {
      status: 'failed',
      completedAt: new Date(),
      errorMessage,
      progressMessage: '송장 송신 실패',
    })
    throw error
  }
}

/**
 * Create and return the invoice upload BullMQ worker.
 *
 * Worker config:
 * - concurrency: 1 (conservative for API rate limits)
 * - limiter: max 2 jobs per 1000ms (Naver's rate limit is ~2/s)
 */
export function createInvoiceUploadWorker() {
  const worker = new Worker<InvoiceUploadJobData>(
    'invoice-upload',
    processInvoiceUpload,
    {
      connection: getConnection(),
      concurrency: 1,
      limiter: {
        max: 2,
        duration: 1000,
      },
    },
  )

  worker.on('completed', (job) => {
    console.log(
      `[InvoiceUploader] Job ${job.id} completed: shipment ${job.data.shipmentId} uploaded`,
    )
  })

  worker.on('failed', (job, error) => {
    console.error(
      `[InvoiceUploader] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${error.message}`,
    )
  })

  worker.on('error', (error) => {
    console.error(`[InvoiceUploader] Worker error: ${error.message}`)
  })

  return worker
}
