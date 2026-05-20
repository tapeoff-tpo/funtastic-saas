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
import { jobLogs, shipments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { ScrapeJobData } from './types'
import type { MarketplaceId } from '@/lib/marketplace/types'
import { saveNormalizedOrdersForConnection } from '@/lib/jobs/workers/order-collector'
import { markShipmentUploadedAndOrderShipped, markShipmentUploadFailed } from '@/lib/shipping/upload-status'

// Side-effect import — registers all scraper instances on the registry
import './register'

const SCRAPE_JOB_TIMEOUT_MS = 120_000

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`RPA 작업이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다.`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function processScrapeJob(job: Job<ScrapeJobData>): Promise<void> {
  const { marketplaceId, connectionId, userId, jobType, jobLogId, since, orderId, shipmentId, invoice } = job.data

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

  const setProgress = async (message: string) => {
    await db.update(jobLogs).set({ progressMessage: message }).where(eq(jobLogs.id, logRow.id)).catch(() => {})
  }

  try {
    if (jobType === 'scrape-orders') {
      await setProgress('RPA 브라우저로 주문 페이지 접속 중...')
      const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000)
      const orders = await runWithTimeout(scraper.getOrders(credentials, sinceDate), SCRAPE_JOB_TIMEOUT_MS)
      await setProgress(`${orders.length}건 수집 완료, 주문 저장 중...`)
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
      await setProgress('RPA 브라우저로 클레임 페이지 접속 중...')
      const sinceDate = since ? new Date(since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const claims = await runWithTimeout(scraper.getClaimsOrders(credentials, sinceDate), SCRAPE_JOB_TIMEOUT_MS)
      console.log(`[scrape-worker] ${marketplaceId}: ${claims.length} claims fetched`)
      await db
        .update(jobLogs)
        .set({ status: 'completed', completedAt: new Date(), claimsCollected: claims.length })
        .where(eq(jobLogs.id, logRow.id))
    } else if (jobType === 'upload-invoice') {
      await setProgress('RPA 브라우저로 송장 전송 준비 중...')
      if (!orderId || !shipmentId || !invoice) throw new Error('orderId/shipmentId/invoice required for upload-invoice')
      const [shipment] = await db
        .select({ orderId: shipments.orderId, uploadAttempts: shipments.uploadAttempts })
        .from(shipments)
        .where(eq(shipments.id, shipmentId))
        .limit(1)
      if (!shipment) throw new Error(`Shipment not found: ${shipmentId}`)

      const result = await runWithTimeout(
        scraper.uploadInvoice(credentials, orderId, invoice),
        SCRAPE_JOB_TIMEOUT_MS,
      )
      if (!result.success) throw new Error(result.error || 'invoice upload failed')
      await markShipmentUploadedAndOrderShipped(shipmentId, shipment.orderId, shipment.uploadAttempts + 1)
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
    if (jobType === 'upload-invoice' && shipmentId) {
      const [shipment] = await db
        .select({ uploadAttempts: shipments.uploadAttempts })
        .from(shipments)
        .where(eq(shipments.id, shipmentId))
        .limit(1)
        .catch(() => [])
      await markShipmentUploadFailed(shipmentId, msg, (shipment?.uploadAttempts ?? 0) + 1).catch(() => {})
    }
    await closeBrowser().catch(() => {})
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
