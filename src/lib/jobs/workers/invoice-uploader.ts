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
import { orders } from '@/lib/db/schema'
import type { InvoiceUploadJobData } from '@/lib/shipping/types'
import type { InvoiceData } from '@/lib/marketplace/types'

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
    marketplaceOrderId,
    trackingNumber,
    carrierId,
  } = job.data

  // 1. Mark as uploading
  await updateShipmentStatus(shipmentId, 'uploading')

  // 2. Get marketplace adapter
  const adapter = marketplaceRegistry.get(marketplaceId)

  // 3. Build invoice data (with marketplace-specific extras)
  const invoiceData: InvoiceData = {
    trackingNumber,
    carrierId,
  }
  if (marketplaceId === '10x10') {
    const detailIdx = await resolveTenByTenDetailIdx(orderId)
    if (detailIdx) invoiceData.detailIdx = detailIdx
  }

  // 4. Call adapter
  const result = await adapter.uploadInvoice(marketplaceOrderId, invoiceData)

  // 5. Update status based on result
  if (result.success) {
    await updateShipmentStatus(shipmentId, 'uploaded')
  } else {
    const errorMessage = result.error || 'Unknown upload error'
    await updateShipmentStatus(shipmentId, 'failed', errorMessage)
    // Throw to trigger BullMQ retry
    throw new Error(errorMessage)
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
