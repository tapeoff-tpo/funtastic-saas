import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import { getConnection } from './connection'
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

// ─── Lazy Queue instances (created on first use so env vars are ready) ───

let _orderQueue: Queue<OrderCollectionJobData> | null = null
let _invoiceQueue: Queue<InvoiceUploadJobData> | null = null

export function getOrderCollectionQueue(): Queue<OrderCollectionJobData> {
  if (!_orderQueue) {
    _orderQueue = new Queue('order-collection', { connection: getConnection() })
  }
  return _orderQueue
}

function getInvoiceUploadQueue(): Queue<InvoiceUploadJobData> {
  if (!_invoiceQueue) {
    _invoiceQueue = new Queue('invoice-upload', { connection: getConnection() })
  }
  return _invoiceQueue
}

/**
 * Schedule repeating order collection for a single marketplace connection.
 */
export async function scheduleOrderCollection(
  marketplaceId: string,
  connectionId: string,
  userId: string
): Promise<void> {
  await getOrderCollectionQueue().add(
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
  const job = await getOrderCollectionQueue().add(
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

/**
 * Add a single invoice upload job to the queue.
 */
export async function queueInvoiceUploadJob(
  data: InvoiceUploadJobData,
): Promise<void> {
  await getInvoiceUploadQueue().add(
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
  const queue = getOrderCollectionQueue()
  const repeatableJobs = await queue.getRepeatableJobs()
  const job = repeatableJobs.find(
    (j) => j.id === `collect-${connectionId}`
  )
  if (job) {
    await queue.removeRepeatableByKey(job.key)
    console.log(`[Queue] Removed schedule for connection ${connectionId}`)
  }
}
