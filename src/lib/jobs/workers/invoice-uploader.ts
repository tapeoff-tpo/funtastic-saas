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
import { connection } from '../connection'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { updateShipmentStatus } from '@/lib/shipping/queries'
import type { InvoiceUploadJobData } from '@/lib/shipping/types'
import type { InvoiceData } from '@/lib/marketplace/types'

/**
 * Process a single invoice upload job.
 *
 * Exported separately for testing -- the worker wraps this function.
 */
export async function processInvoiceUpload(
  job: Job<InvoiceUploadJobData>,
): Promise<void> {
  const {
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

  // 3. Build invoice data
  const invoiceData: InvoiceData = {
    trackingNumber,
    carrierId,
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
      connection,
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
