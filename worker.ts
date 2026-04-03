/**
 * Standalone BullMQ worker entry point.
 *
 * Runs separately from the Next.js app to process background jobs.
 * Run with: npx tsx worker.ts
 */
import { Worker } from 'bullmq'
import { connection } from './src/lib/jobs/connection'
import { processOrderCollection } from './src/lib/jobs/workers/order-collector'
import { scheduleAllCollections } from './src/lib/jobs/queues'

// Ensure marketplace adapters are registered
import './src/lib/marketplace/adapters/configs'

const worker = new Worker('order-collection', processOrderCollection, {
  connection,
  concurrency: 2,
})

worker.on('completed', (job) => {
  console.log(
    `[Worker] Job ${job.id} completed: ${JSON.stringify(job.returnvalue)}`
  )
})

worker.on('failed', (job, error) => {
  console.error(
    `[Worker] Job ${job?.id} failed: ${error.message}`
  )
})

worker.on('error', (error) => {
  console.error(`[Worker] Error: ${error.message}`)
})

// Schedule all active marketplace connections on startup
scheduleAllCollections()
  .then(() => console.log('[Worker] Order collection worker started'))
  .catch((err: Error) =>
    console.error(`[Worker] Failed to schedule collections: ${err.message}`)
  )

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`)
  await worker.close()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
