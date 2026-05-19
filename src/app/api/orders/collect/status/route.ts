import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { jobLogs } from '@/lib/db/schema'
import { and, inArray, like, sql } from 'drizzle-orm'

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

  await db
    .update(jobLogs)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: 'RPA 작업이 제한시간 안에 끝나지 않았습니다. 다시 시도해주세요.',
    })
    .where(
      and(
        inArray(jobLogs.id, ids),
        inArray(jobLogs.status, ['queued', 'running']),
        like(jobLogs.jobType, 'scrape-%'),
        sql`coalesce(${jobLogs.startedAt}, ${jobLogs.createdAt}) < now() - interval '150 seconds'`,
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
