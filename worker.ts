/**
 * Standalone BullMQ worker entry point.
 *
 * Runs separately from the Next.js app to process background jobs.
 * Run with: npx tsx worker.ts
 */
import { Worker } from 'bullmq'
import { connection } from './src/lib/jobs/connection'
import { processOrderCollection } from './src/lib/jobs/workers/order-collector'
import { createInvoiceUploadWorker } from './src/lib/jobs/workers/invoice-uploader'
import { scheduleAllCollections } from './src/lib/jobs/queues'

// Ensure marketplace adapters are registered
import './src/lib/marketplace/adapters/configs'

// Order collection worker
const orderCollectionWorker = new Worker('order-collection', processOrderCollection, {
  connection,
  concurrency: 2,
})

orderCollectionWorker.on('completed', (job) => {
  console.log(
    `[Worker] Order collection job ${job.id} completed: ${JSON.stringify(job.returnvalue)}`
  )
})

orderCollectionWorker.on('failed', (job, error) => {
  console.error(
    `[Worker] Order collection job ${job?.id} failed: ${error.message}`
  )
})

orderCollectionWorker.on('error', (error) => {
  console.error(`[Worker] Order collection error: ${error.message}`)
})

// Invoice upload worker
const invoiceUploadWorker = createInvoiceUploadWorker()

// Schedule all active marketplace connections on startup
scheduleAllCollections()
  .then(() => console.log('[Worker] Order collection worker started'))
  .catch((err: Error) =>
    console.error(`[Worker] Failed to schedule collections: ${err.message}`)
  )

console.log('[Worker] Invoice upload worker started')

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`)
  await Promise.all([
    orderCollectionWorker.close(),
    invoiceUploadWorker.close(),
  ])
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
