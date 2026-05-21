import { and, desc, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { jobLogs } from '@/lib/db/schema'

const COLLECTION_JOB_TYPES = [
  'order-collection',
  'manual-order-collection',
  'scrape-orders',
  'scrape-claims',
  'scrape-inquiries',
  'cs-collection',
] as const

export interface CollectionJobLogInput {
  jobType: string
  marketplaceId: string
  connectionId: string
}

export interface ActiveCollectionJob {
  id: string
  jobType: string
  marketplaceId: string | null
  connectionId: string | null
  status: string
  progressMessage: string | null
  startedAt: Date | null
  createdAt: Date
}

export interface CollectionLockResult {
  ok: boolean
  jobLogIds: string[]
  activeJob?: ActiveCollectionJob
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function markStaleCollectionJobsFailed(tx: Tx) {
  await tx
    .update(jobLogs)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: '수집 작업이 제한시간을 초과해 자동 종료되었습니다.',
    })
    .where(
      and(
        inArray(jobLogs.status, ['queued', 'running']),
        inArray(jobLogs.jobType, [...COLLECTION_JOB_TYPES]),
        sql`(
          (${jobLogs.jobType} like 'scrape-%' and coalesce(${jobLogs.startedAt}, ${jobLogs.createdAt}) < now() - interval '360 seconds')
          or (${jobLogs.jobType} not like 'scrape-%' and coalesce(${jobLogs.startedAt}, ${jobLogs.createdAt}) < now() - interval '15 minutes')
        )`,
      ),
    )
}

export async function createCollectionJobLogsWithLock(
  inputs: CollectionJobLogInput[],
): Promise<CollectionLockResult> {
  if (inputs.length === 0) return { ok: true, jobLogIds: [] }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('funtastic:collection-lock'))`)
    await markStaleCollectionJobsFailed(tx)

    const [activeJob] = await tx
      .select({
        id: jobLogs.id,
        jobType: jobLogs.jobType,
        marketplaceId: jobLogs.marketplaceId,
        connectionId: jobLogs.connectionId,
        status: jobLogs.status,
        progressMessage: jobLogs.progressMessage,
        startedAt: jobLogs.startedAt,
        createdAt: jobLogs.createdAt,
      })
      .from(jobLogs)
      .where(
        and(
          inArray(jobLogs.status, ['queued', 'running']),
          inArray(jobLogs.jobType, [...COLLECTION_JOB_TYPES]),
        ),
      )
      .orderBy(desc(jobLogs.createdAt))
      .limit(1)

    if (activeJob) {
      return { ok: false, jobLogIds: [], activeJob }
    }

    const rows = await tx
      .insert(jobLogs)
      .values(inputs.map((input) => ({
        jobType: input.jobType,
        marketplaceId: input.marketplaceId,
        connectionId: input.connectionId,
        status: 'queued',
      })))
      .returning({ id: jobLogs.id })

    return { ok: true, jobLogIds: rows.map((row) => row.id) }
  })
}
