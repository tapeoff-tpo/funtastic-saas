/**
 * Phase 8 — Marketplace inquiry collection worker.
 *
 * BullMQ queue `inquiry-collection` polls marketplace inquiry endpoints and
 * upserts into the inquiries table. Currently Coupang only — Naver / 11st etc.
 * skip silently if their adapter does not implement getInquiries (per
 * MarketplaceAdapter optional method signature in src/lib/marketplace/types.ts).
 *
 * Phase 8 scope ends at "수집 가능" — no repeatable scheduling here. Manual
 * `.add()` from admin / API / tests remains available via the exported queue.
 *
 * Adapter resolution: directly instantiates CoupangAdapter (matches the
 * existing factory pattern in src/lib/jobs/workers/order-collector.ts which
 * also uses a switch on marketplaceId — but order-collector's createAdapter
 * returns a Pick<> that excludes getInquiries, so we instantiate locally).
 */

import { Queue, Worker, type Job } from 'bullmq'
import { getConnection } from '@/lib/jobs/connection'
import { CoupangAdapter } from '@/lib/marketplace/adapters/coupang/adapter'
import type { MarketplaceAdapter } from '@/lib/marketplace/types'
import { readCredential } from '@/lib/supabase/admin'
import { upsertInquiries } from '@/lib/orders/inquiry-queries'

export const INQUIRY_QUEUE = 'inquiry-collection'

export interface InquiryJobData {
  userId: string
  marketplaceId: string
  /** ISO date — last collection timestamp; worker fetches inquiries since then */
  since: string
}

let _inquiryQueue: Queue<InquiryJobData> | null = null
export function getInquiryQueue(): Queue<InquiryJobData> {
  if (!_inquiryQueue) {
    _inquiryQueue = new Queue<InquiryJobData>(INQUIRY_QUEUE, { connection: getConnection() })
  }
  return _inquiryQueue
}

/**
 * Build an inquiry-capable adapter for the given marketplace.
 * Returns null when the marketplace has no inquiry support (so the worker
 * can skip without erroring — Naver/etc. land here in Phase 8).
 */
async function createInquiryAdapter(
  userId: string,
  marketplaceId: string,
): Promise<MarketplaceAdapter | null> {
  switch (marketplaceId) {
    case 'coupang': {
      const accessKey = await readCredential(marketplaceId, userId, 'access_key')
      const secretKey = await readCredential(marketplaceId, userId, 'secret_key')
      const vendorId = await readCredential(marketplaceId, userId, 'vendor_id')
      if (!accessKey || !secretKey || !vendorId) {
        throw new Error(
          `Missing Coupang credentials for user ${userId} (access_key/secret_key/vendor_id)`,
        )
      }
      return new CoupangAdapter({
        access_key: accessKey,
        secret_key: secretKey,
        vendor_id: vendorId,
      })
    }
    default:
      return null
  }
}

export type InquiryJobResult =
  | { skipped: true; reason: string }
  | { fetched: number; inserted: number; updated: number }

export async function processInquiryCollection(
  job: Job<InquiryJobData>,
): Promise<InquiryJobResult> {
  const { userId, marketplaceId, since } = job.data
  console.log(
    `[InquiryWorker] start userId=${userId} marketplace=${marketplaceId} since=${since}`,
  )

  const adapter = await createInquiryAdapter(userId, marketplaceId)
  if (!adapter) {
    console.warn(
      `[InquiryWorker] no inquiry adapter for ${marketplaceId} — skipping`,
    )
    return { skipped: true, reason: `no inquiry adapter for ${marketplaceId}` }
  }
  if (!adapter.getInquiries) {
    console.warn(
      `[InquiryWorker] ${marketplaceId} adapter does not implement getInquiries — skipping`,
    )
    return { skipped: true, reason: `${marketplaceId}.getInquiries not implemented` }
  }

  const fetched = await adapter.getInquiries(new Date(since))
  const result = await upsertInquiries(userId, marketplaceId, fetched)

  console.log(
    `[InquiryWorker] done userId=${userId} marketplace=${marketplaceId} ` +
      `fetched=${fetched.length} inserted=${result.inserted} updated=${result.updated}`,
  )

  return { fetched: fetched.length, ...result }
}

/**
 * Construct and start the BullMQ inquiry-collection worker.
 * Caller is responsible for keeping the returned Worker around and calling
 * close() during graceful shutdown (mirrors src/worker.ts pattern for
 * order-collection / invoice-upload workers).
 */
export function startInquiryWorker(): Worker<InquiryJobData, InquiryJobResult> {
  const worker = new Worker<InquiryJobData, InquiryJobResult>(
    INQUIRY_QUEUE,
    processInquiryCollection,
    { connection: getConnection(), concurrency: 2 },
  )

  worker.on('completed', (job) => {
    const r = job.returnvalue
    if (r && 'skipped' in r) {
      console.log(`[InquiryWorker] job ${job.id} skipped: ${r.reason}`)
    } else if (r) {
      console.log(
        `[InquiryWorker] job ${job.id} ${job.data.marketplaceId}: ` +
          `fetched=${r.fetched} inserted=${r.inserted} updated=${r.updated}`,
      )
    }
  })

  worker.on('failed', (job, err) => {
    console.error(
      `[InquiryWorker] job ${job?.id} (${job?.data?.marketplaceId}) failed: ${err.message}`,
    )
  })

  worker.on('error', (err) => {
    console.error(`[InquiryWorker] worker error: ${err.message}`)
  })

  return worker
}
