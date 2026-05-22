import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { jobLogs, shipments } from '@/lib/db/schema'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { getMarketplaceScrapeQueue } from '@/lib/jobs/queues'
import { markShipmentUploadFailed } from '@/lib/shipping/upload-status'

const RPA_QUEUE_TIMEOUT_MESSAGE =
  'RPA 워커가 작업을 시작하지 못했습니다. scrape-worker 서비스가 실행 중인지 확인해주세요.'
const RPA_RUNNING_TIMEOUT_MESSAGE =
  'RPA 작업이 제한시간 안에 끝나지 않았습니다. 다시 시도해주세요.'
const RPA_INVOICE_TIMEOUT_SECONDS = 75
const RPA_SCRAPE_STALE_TIMEOUT_SECONDS = 540
const withLastProgress = (message: string) =>
  sql<string>`case
    when ${jobLogs.progressMessage} is not null and ${jobLogs.progressMessage} <> ''
      then ${message} || ' 마지막 단계: ' || ${jobLogs.progressMessage}
    else ${message}
  end`

async function markTimedOutInvoiceShipments(jobLogIds: string[], message: string): Promise<void> {
  if (jobLogIds.length === 0) return
  const queue = getMarketplaceScrapeQueue()
  const jobs = await queue.getJobs(['wait', 'active', 'delayed', 'prioritized', 'paused'], 0, 500)
  const targetIds = new Set(jobLogIds)

  await Promise.all(jobs.map(async (job) => {
    const data = job.data
    if (data.jobType !== 'upload-invoice' || !data.jobLogId || !targetIds.has(data.jobLogId) || !data.shipmentId) return

    const [shipment] = await db
      .select({ uploadAttempts: shipments.uploadAttempts })
      .from(shipments)
      .where(eq(shipments.id, data.shipmentId))
      .limit(1)
      .catch(() => [])

    await markShipmentUploadFailed(data.shipmentId, message, (shipment?.uploadAttempts ?? 0) + 1).catch(() => {})
    await job.remove().catch(() => {})
  }))
}

/**
 * GET /api/orders/collect/status?ids=id1,id2,id3
 *
 * Poll job_logs for manual collection job status.
 * Returns current status for each job log entry.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const idsParam = request.nextUrl.searchParams.get('ids')
  if (!idsParam) {
    return NextResponse.json({ error: 'ids parameter required' }, { status: 400 })
  }

  const ids = idsParam.split(',').filter(Boolean)
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids must not be empty' }, { status: 400 })
  }

  const timedOutQueuedInvoiceLogs = await db
    .update(jobLogs)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: withLastProgress(RPA_QUEUE_TIMEOUT_MESSAGE),
    })
    .where(
      and(
        inArray(jobLogs.id, ids),
        inArray(jobLogs.status, ['queued']),
        eq(jobLogs.jobType, 'scrape-upload-invoice'),
        sql`${jobLogs.createdAt} < now() - (${RPA_INVOICE_TIMEOUT_SECONDS} * interval '1 second')`,
      ),
    )
    .returning({ id: jobLogs.id })

  await markTimedOutInvoiceShipments(
    timedOutQueuedInvoiceLogs.map((log) => log.id),
    RPA_QUEUE_TIMEOUT_MESSAGE,
  )

  const timedOutRunningInvoiceLogs = await db
    .update(jobLogs)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: withLastProgress(RPA_RUNNING_TIMEOUT_MESSAGE),
    })
    .where(
      and(
        inArray(jobLogs.id, ids),
        inArray(jobLogs.status, ['running']),
        eq(jobLogs.jobType, 'scrape-upload-invoice'),
        sql`coalesce(${jobLogs.startedAt}, ${jobLogs.createdAt}) < now() - (${RPA_INVOICE_TIMEOUT_SECONDS} * interval '1 second')`,
      ),
    )
    .returning({ id: jobLogs.id })

  await markTimedOutInvoiceShipments(
    timedOutRunningInvoiceLogs.map((log) => log.id),
    RPA_RUNNING_TIMEOUT_MESSAGE,
  )

  await db
    .update(jobLogs)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: withLastProgress(RPA_QUEUE_TIMEOUT_MESSAGE),
    })
    .where(
      and(
        inArray(jobLogs.id, ids),
        inArray(jobLogs.status, ['queued']),
        like(jobLogs.jobType, 'scrape-%'),
        sql`${jobLogs.createdAt} < now() - (${RPA_SCRAPE_STALE_TIMEOUT_SECONDS} * interval '1 second')`,
      ),
    )

  await db
    .update(jobLogs)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: withLastProgress(RPA_RUNNING_TIMEOUT_MESSAGE),
    })
    .where(
      and(
        inArray(jobLogs.id, ids),
        inArray(jobLogs.status, ['running']),
        like(jobLogs.jobType, 'scrape-%'),
        sql`coalesce(${jobLogs.startedAt}, ${jobLogs.createdAt}) < now() - (${RPA_SCRAPE_STALE_TIMEOUT_SECONDS} * interval '1 second')`,
      ),
    )

  await db
    .update(jobLogs)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: withLastProgress(
        '투비즈온 RPA가 0건 완료로 끝났습니다. 최신 scrape-worker 코드라면 0건 완료가 아니라 실패해야 하므로, scrape-worker 서비스 재배포 상태를 확인해주세요.',
      ),
    })
    .where(
      and(
        inArray(jobLogs.id, ids),
        inArray(jobLogs.status, ['completed']),
        like(jobLogs.jobType, 'scrape-%'),
        sql`${jobLogs.marketplaceId} = 'tobizon'`,
        sql`coalesce(${jobLogs.ordersCollected}, 0) = 0`,
      ),
    )

  const logs = await db
    .select({
      id: jobLogs.id,
      marketplaceId: jobLogs.marketplaceId,
      connectionId: jobLogs.connectionId,
      status: jobLogs.status,
      ordersCollected: jobLogs.ordersCollected,
      claimsCollected: jobLogs.claimsCollected,
      errorMessage: jobLogs.errorMessage,
      progressMessage: jobLogs.progressMessage,
      completedAt: jobLogs.completedAt,
    })
    .from(jobLogs)
    .where(inArray(jobLogs.id, ids))

  // Check if all jobs are done (completed, failed, or cancelled)
  const allDone = logs.length > 0 && logs.every(
    (l) => l.status === 'completed' || l.status === 'failed' || l.status === 'cancelled'
  )

  return NextResponse.json({ logs, allDone })
}
