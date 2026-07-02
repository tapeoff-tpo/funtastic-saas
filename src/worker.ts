/**
 * BullMQ worker process entrypoint.
 *
 * Start: node --import tsx src/worker.ts
 *
 * Starts two workers:
 *   - order-collection: polls marketplace APIs every 5 min per connection
 *   - invoice-upload:   uploads tracking numbers to marketplace APIs
 *
 * On startup, schedules repeating jobs for all active marketplace connections.
 * Handles graceful shutdown on SIGTERM/SIGINT (Railway sends SIGTERM on redeploy).
 */

import '@/lib/marketplace/adapters/configs'
import { Worker } from 'bullmq'
import { getConnection } from '@/lib/jobs/connection'
import { scheduleAllCollections } from '@/lib/jobs/queues'
import { processOrderCollection } from '@/lib/jobs/workers/order-collector'
import { createInvoiceUploadWorker } from '@/lib/jobs/workers/invoice-uploader'
import { startInquiryWorker } from './workers/inquiry-worker'

async function main() {
  console.log('[Worker] Starting BullMQ worker process')

  const conn = getConnection()

  // Order collection worker (concurrency 5: 멀티 스토어 병렬 처리)
  const orderWorker = new Worker(
    'order-collection',
    processOrderCollection,
    {
      connection: conn,
      concurrency: 5,
    }
  )

  // Invoice upload worker (concurrency 1, rate limited)
  const invoiceWorker = createInvoiceUploadWorker()

  // Phase 8: Inquiry collection worker (concurrency 2, no repeatable schedule
  // — manual .add() only for now per Phase 8 scope)
  const inquiryWorker = startInquiryWorker()

  orderWorker.on('completed', (job) => {
    const result = job.returnvalue as { ordersCollected: number; claimsCollected: number } | undefined
    console.log(
      `[OrderWorker] ${job.data.marketplaceId}: ` +
      `${result?.ordersCollected ?? 0}건 주문, ${result?.claimsCollected ?? 0}건 클레임 수집`
    )
  })

  orderWorker.on('failed', (job, err) => {
    console.error(`[OrderWorker] Job ${job?.id} (${job?.data?.marketplaceId}) failed: ${err.message}`)
  })

  orderWorker.on('error', (err) => {
    console.error(`[OrderWorker] Worker error: ${err.message}`)
  })

  // Dedicated hosted workers may schedule repeat collection. The local agent
  // only handles jobs explicitly queued from the SaaS buttons.
  if (process.env.DISABLE_AUTO_COLLECTION_SCHEDULE === 'true') {
    console.log('[Worker] Auto collection schedules disabled')
  } else {
    await scheduleAllCollections()
  }

  // Graceful shutdown — Railway sends SIGTERM before stopping a container
  const shutdown = async (signal: string) => {
    console.log(`[Worker] ${signal} received, draining workers...`)
    await Promise.all([
      orderWorker.close(),
      invoiceWorker.close(),
      inquiryWorker.close(),
    ])
    console.log('[Worker] Workers closed. Exiting.')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  console.log('[Worker] Workers started. Waiting for jobs...')
}

main().catch((err) => {
  console.error('[Worker] Fatal startup error:', err)
  process.exit(1)
})
