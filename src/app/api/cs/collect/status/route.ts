import { NextRequest, NextResponse } from 'next/server'
import { and, inArray, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { jobLogs } from '@/lib/db/schema'

const TIMEOUT_MESSAGE = 'CS 수집 작업이 제한시간 안에 끝나지 않았습니다. 다시 시도해주세요.'

const withLastProgress = (message: string) =>
  sql<string>`case
    when ${jobLogs.progressMessage} is not null and ${jobLogs.progressMessage} <> ''
      then ${message} || ' 마지막 단계: ' || ${jobLogs.progressMessage}
    else ${message}
  end`

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
      errorMessage: withLastProgress(TIMEOUT_MESSAGE),
    })
    .where(
      and(
        inArray(jobLogs.id, ids),
        inArray(jobLogs.status, ['queued', 'running']),
        sql`(${jobLogs.jobType} = 'cs-collection' or ${jobLogs.jobType} = 'scrape-claims')`,
        sql`coalesce(${jobLogs.startedAt}, ${jobLogs.createdAt}) < now() - interval '360 seconds'`,
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
    .where(and(inArray(jobLogs.id, ids), sql`(${jobLogs.jobType} = 'cs-collection' or ${jobLogs.jobType} = 'scrape-claims')`))

  const allDone = logs.length > 0 && logs.every(
    (log) => log.status === 'completed' || log.status === 'failed' || log.status === 'cancelled',
  )

  return NextResponse.json({ logs, allDone })
}
