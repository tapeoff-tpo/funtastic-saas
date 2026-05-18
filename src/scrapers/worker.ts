/**
 * Scraping worker — runs Playwright-based scrapers.
 *
 * This is a SEPARATE worker process from the main BullMQ worker because:
 * - Chromium needs ~500MB RAM (vs 256MB for normal jobs)
 * - Playwright must run in a long-lived process to reuse the browser
 * - Failures here shouldn't kill API/invoice workers
 *
 * Triggered by jobs in the `marketplace-scrape` queue.
 *
 * Boot via `npm run scrape-worker` (script defined in package.json).
 * In Railway, deploy as a dedicated service with start command: npm run scrape-worker
 */

import { Worker, type Job } from 'bullmq'
import { getConnection } from '@/lib/jobs/connection'
import { getScraper, hasScraper } from './registry'
import { closeBrowser } from './browser'
import { readScrapeCredentials } from './credentials'
import { db } from '@/lib/db'
import { jobLogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { ScrapeJobData } from './types'
import type { MarketplaceId } from '@/lib/marketplace/types'
import { saveNormalizedOrdersForConnection } from '@/lib/jobs/workers/order-collector'

// Side-effect import — registers all scraper instances on the registry
import './register'

async function processScrapeJob(job: Job<ScrapeJobData>): Promise<void> {
  const { marketplaceId, connectionId, userId, jobType, jobLogId, since, orderId, invoice } = job.data

  if (!hasScraper(marketplaceId as MarketplaceId)) {
    throw new Error(`No scraper registered for ${marketplaceId}`)
  }

  const scraper = getScraper(marketplaceId as MarketplaceId)
  if (!scraper) throw new Error(`Scraper missing: ${marketplaceId}`)

  // Load encrypted credentials from Supabase Vault
  const credentials = await readScrapeCredentials(marketplaceId, userId, connectionId)
  if (!credentials) throw new Error(`No credentials for ${marketplaceId}/${connectionId}`)

  // Log job start
  const logValues = {
    ...(jobLogId ? { id: jobLogId } : {}),
    jobType: `scrape-${jobType}`,
    marketplaceId,
    connectionId,
    status: 'running',
    startedAt: new Date(),
  } as const
  const [logRow] = await db
    .insert(jobLogs)
    .values(logValues)
    .onConflictDoUpdate({
      target: [jobLogs.id],
      set: { status: 'running', startedAt: new Date() },
    })
    .returning({ id: jobLogs.id })

  try {
    if (jobType === 'scrape-orders') {
      const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000)
      const orders = await scraper.getOrders(credentials, sinceDate)
      const result = await saveNormalizedOrdersForConnection({
        marketplaceId,
        connectionId,
        userId,
        normalizedOrders: orders,
      })
      console.log(`[scrape-worker] ${marketplaceId}: ${orders.length} orders fetched`)
      await db
        .update(jobLogs)
        .set({ status: 'completed', completedAt: new Date(), ordersCollected: result.ordersCollected })
        .where(eq(jobLogs.id, logRow.id))
    } else if (jobType === 'scrape-claims') {
      const sinceDate = since ? new Date(since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const claims = await scraper.getClaimsOrders(credentials, sinceDate)
      console.log(`[scrape-worker] ${marketplaceId}: ${claims.length} claims fetched`)
      await db
        .update(jobLogs)
        .set({ status: 'completed', completedAt: new Date(), claimsCollected: claims.length })
        .where(eq(jobLogs.id, logRow.id))
    } else if (jobType === 'upload-invoice') {
      if (!orderId || !invoice) throw new Error('orderId/invoice required for upload-invoice')
      const result = await scraper.uploadInvoice(credentials, orderId, invoice)
      if (!result.success) throw new Error(result.error || 'invoice upload failed')
      await db
        .update(jobLogs)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(jobLogs.id, logRow.id))
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error(`[scrape-worker] ${marketplaceId} ${jobType} failed:`, msg)
    await db
      .update(jobLogs)
      .set({ status: 'failed', completedAt: new Date(), errorMessage: msg })
      .where(eq(jobLogs.id, logRow.id))
      .catch(() => {})
    throw e
  }
}

const worker = new Worker<ScrapeJobData>('marketplace-scrape', processScrapeJob, {
  connection: getConnection(),
  concurrency: 1, // 1 scrape at a time per worker — Chromium is heavy
  limiter: { max: 1, duration: 5000 }, // throttle to avoid bot detection
})

worker.on('completed', (job) => {
  console.log(`[scrape-worker] ${job.data.marketplaceId} ${job.data.jobType} done (${job.id})`)
})

worker.on('failed', (job, err) => {
  console.error(
    `[scrape-worker] ${job?.data.marketplaceId} ${job?.data.jobType} failed (attempt ${job?.attemptsMade}): ${err.message}`,
  )
})

worker.on('error', (err) => {
  console.error('[scrape-worker] worker error:', err.message)
})

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('[scrape-worker] shutting down…')
  await worker.close()
  await closeBrowser()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log('[scrape-worker] online — listening on queue: marketplace-scrape')
