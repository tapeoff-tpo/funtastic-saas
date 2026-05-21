import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, type SQL } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import { createCollectionJobLogsWithLock } from '@/lib/jobs/collection-lock'
import { collectCsForConnection } from '@/lib/jobs/workers/cs-collector'
import { getMarketplaceScrapeQueue } from '@/lib/jobs/queues'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const body = await request.json().catch(() => ({})) as {
    connectionIds?: string[]
    lookbackDays?: number
  }

  const requestedIds = Array.isArray(body.connectionIds)
    ? body.connectionIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  const lookbackDays = Number.isFinite(Number(body.lookbackDays))
    ? Math.min(Math.max(Math.floor(Number(body.lookbackDays)), 1), 14)
    : 7

  const conditions: SQL[] = [
    eq(marketplaceConnections.userId, workspaceUserId),
    eq(marketplaceConnections.status, 'connected'),
  ]
  if (requestedIds.length > 0) {
    conditions.push(inArray(marketplaceConnections.id, requestedIds))
  }

  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(and(...conditions))

  const targets = connections
    .map((conn) => {
      const integrationMethod = getIntegrationMethod(conn.marketplaceId, {
        isManual: conn.isManual,
        authType: conn.authType,
      })
      return { conn, integrationMethod }
    })
    .filter(({ integrationMethod }) => integrationMethod !== 'excel')

  if (targets.length === 0) {
    return NextResponse.json({ error: 'CS 수집 가능한 마켓 연동이 없습니다.' }, { status: 404 })
  }

  const lockResult = await createCollectionJobLogsWithLock(targets.map(({ conn, integrationMethod }) => ({
    jobType: integrationMethod === 'rpa' ? 'scrape-claims' : 'cs-collection',
    marketplaceId: conn.marketplaceId,
    connectionId: conn.id,
  })))

  if (!lockResult.ok) {
    return NextResponse.json(
      {
        error: '다른 수집 작업이 진행 중입니다. 현재 작업이 끝난 뒤 다시 실행해주세요.',
        activeJob: lockResult.activeJob,
      },
      { status: 409 },
    )
  }

  for (const [index, target] of targets.entries()) {
    const jobLogId = lockResult.jobLogIds[index]
    if (!jobLogId) continue
    if (target.integrationMethod === 'rpa') {
      await getMarketplaceScrapeQueue().add(
        `manual-cs-${target.conn.marketplaceId}-${Date.now()}`,
        {
          marketplaceId: target.conn.marketplaceId,
          connectionId: target.conn.id,
          userId: workspaceUserId,
          jobType: 'scrape-claims',
          jobLogId,
          since: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      )
      continue
    }

    collectCsForConnection({
      marketplaceId: target.conn.marketplaceId,
      connectionId: target.conn.id,
      userId: workspaceUserId,
      jobLogId,
      lookbackDays,
    }).catch((error) => {
      console.error('[cs-collect] Background CS collection failed:', error)
    })
  }

  return NextResponse.json({ jobLogIds: lockResult.jobLogIds })
}
