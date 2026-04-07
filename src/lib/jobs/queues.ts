import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import { connection } from './connection'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import type { InvoiceUploadJobData } from '@/lib/shipping/types'

/** Job data shape for order collection jobs */
export interface OrderCollectionJobData {
  marketplaceId: string
  connectionId: string
  userId: string
  /** Pre-created job_logs row ID (for manual collection via API route) */
  jobLogId?: string
  jobType?: string
}

/** Queue for scheduled order collection from marketplace APIs */
export const orderCollectionQueue = new Queue<OrderCollectionJobData>(
  'order-collection',
  { connection }
)

/**
 * Schedule repeating order collection for a single marketplace connection.
 *
 * Uses `jobId: collect-${connectionId}` to prevent duplicate scheduling
 * (BullMQ deduplicates repeatable jobs by jobId).
 *
 * Polling interval: every 5 minutes (per D-01).
 */
export async function scheduleOrderCollection(
  marketplaceId: string,
  connectionId: string,
  userId: string
): Promise<void> {
  await orderCollectionQueue.add(
    `collect-${marketplaceId}`,
    { marketplaceId, connectionId, userId },
    {
      repeat: { every: 5 * 60 * 1000 },
      jobId: `collect-${connectionId}`,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  )
}

/**
 * Schedule order collection for all active marketplace connections.
 * Called on worker startup to ensure all connections have active schedules.
 */
export async function scheduleAllCollections(): Promise<void> {
  const activeConnections = await db
    .select({
      id: marketplaceConnections.id,
      marketplaceId: marketplaceConnections.marketplaceId,
      userId: marketplaceConnections.userId,
    })
    .from(marketplaceConnections)
    .where(eq(marketplaceConnections.status, 'connected'))

  for (const conn of activeConnections) {
    await scheduleOrderCollection(conn.marketplaceId, conn.id, conn.userId)
  }

  console.log(
    `[Queue] Scheduled order collection for ${activeConnections.length} active connections`
  )
}

/**
 * Add a one-off manual order collection job to the queue.
 * Called from the API route — the actual collection runs on the worker process.
 */
export async function queueManualCollection(
  data: OrderCollectionJobData & { jobLogId: string }
): Promise<string> {
  const job = await orderCollectionQueue.add(
    `manual-${data.marketplaceId}-${Date.now()}`,
    { ...data, jobType: 'manual-order-collection' },
    {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  )
  return job.id ?? data.jobLogId
}

// ─── Invoice Upload Queue ────────────────────────────────────────

/** Queue for invoice upload jobs to marketplace APIs */
export const invoiceUploadQueue = new Queue<InvoiceUploadJobData>(
  'invoice-upload',
  { connection },
)

/**
 * Add a single invoice upload job to the queue.
 *
 * Job options:
 * - attempts: 3 (per D-02 retry policy)
 * - backoff: exponential starting at 5s
 * - removeOnComplete/Fail: keep last N for debugging
 */
export async function queueInvoiceUploadJob(
  data: InvoiceUploadJobData,
): Promise<void> {
  await invoiceUploadQueue.add(
    `upload-${data.shipmentId}`,
    data,
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  )
}

/**
 * Remove the repeating schedule for a disconnected marketplace.
 */
export async function removeSchedule(connectionId: string): Promise<void> {
  const repeatableJobs = await orderCollectionQueue.getRepeatableJobs()
  const job = repeatableJobs.find(
    (j) => j.id === `collect-${connectionId}`
  )
  if (job) {
    await orderCollectionQueue.removeRepeatableByKey(job.key)
    console.log(`[Queue] Removed schedule for connection ${connectionId}`)
  }
}
