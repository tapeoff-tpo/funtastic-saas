import { Queue } from 'bullmq'
import { eq, inArray } from 'drizzle-orm'
import { getConnection } from './connection'
import { db } from '@/lib/db'
import { marketplaceConnections, jobLogs } from '@/lib/db/schema'
import type { InvoiceUploadJobData } from '@/lib/shipping/types'
import type { ScrapeJobData } from '@/scrapers/types'

/** Job data shape for order collection jobs */
export interface OrderCollectionJobData {
  marketplaceId: string
  connectionId: string
  userId: string
  manualLookbackDays?: number
  /** Pre-created job_logs row ID (for manual collection via API route) */
  jobLogId?: string
  jobType?: string
}

// ─── Lazy Queue instances (created on first use so env vars are ready) ───

let _orderQueue: Queue<OrderCollectionJobData> | null = null
let _invoiceQueue: Queue<InvoiceUploadJobData> | null = null
let _scrapeQueue: Queue<ScrapeJobData> | null = null

export function getMarketplaceScrapeQueue(): Queue<ScrapeJobData> {
  if (!_scrapeQueue) {
    _scrapeQueue = new Queue('marketplace-scrape', { connection: getConnection() })
  }
  return _scrapeQueue
}

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

/**
 * Cancel manual collection jobs that are still waiting in the queue.
 * Already-running jobs cannot be cancelled (they will complete normally).
 */
export async function cancelManualJobs(jobLogIds: string[]): Promise<{
  cancelled: string[]
  alreadyRunning: string[]
}> {
  const queue = getOrderCollectionQueue()
  const cancelled: string[] = []
  const alreadyRunning: string[] = []

  // Get waiting jobs and match by jobLogId in data
  const waitingJobs = await queue.getJobs(['waiting', 'delayed'])

  for (const job of waitingJobs) {
    if (job.data.jobLogId && jobLogIds.includes(job.data.jobLogId)) {
      await job.remove()
      cancelled.push(job.data.jobLogId)
    }
  }

  // Check which requested IDs were not in waiting (already running or done)
  const cancelledSet = new Set(cancelled)
  for (const id of jobLogIds) {
    if (!cancelledSet.has(id)) {
      alreadyRunning.push(id)
    }
  }

  // Update job_logs for cancelled jobs
  if (cancelled.length > 0) {
    await db
      .update(jobLogs)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(inArray(jobLogs.id, cancelled))
  }

  return { cancelled, alreadyRunning }
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
