import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections, jobLogs } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { collectOrdersForConnection } from '@/lib/jobs/workers/order-collector'
import { getMarketplaceScrapeQueue } from '@/lib/jobs/queues'
import { getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createCollectionJobLogsWithLock } from '@/lib/jobs/collection-lock'
import { isRegisteredScraperMarketplace } from '@/scrapers/supported'

/**
 * POST /api/orders/collect
 *
 * Manually trigger order collection for selected marketplaces.
 * Runs collection directly in the background (no BullMQ worker needed).
 *
 * Body: { connectionIds: string[], manualLookbackDays?: number, manualDateFrom?: string, manualDateTo?: string }
 * Response: { jobLogIds: string[] }
 */
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

  let body: {
    connectionIds: string[]
    manualLookbackDays?: number
    manualDateFrom?: string
    manualDateTo?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.connectionIds) || body.connectionIds.length === 0) {
    return NextResponse.json(
      { error: 'connectionIds must be a non-empty array' },
      { status: 400 }
    )
  }

  const manualLookbackDays = Number(body.manualLookbackDays)
  const safeManualLookbackDays =
    Number.isFinite(manualLookbackDays) && manualLookbackDays >= 1 && manualLookbackDays <= 14
      ? Math.floor(manualLookbackDays)
      : undefined
  const manualDateFrom = sanitizeDateInput(body.manualDateFrom)
  const manualDateTo = sanitizeDateInput(body.manualDateTo)

  if ((body.manualDateFrom || body.manualDateTo) && (!manualDateFrom || !manualDateTo)) {
    return NextResponse.json(
      { error: 'manualDateFrom and manualDateTo must both be YYYY-MM-DD' },
      { status: 400 }
    )
  }

  if (manualDateFrom && manualDateTo) {
    const from = new Date(`${manualDateFrom}T00:00:00+09:00`)
    const to = new Date(`${manualDateTo}T23:59:59.999+09:00`)
    const maxRangeMs = 14 * 24 * 60 * 60 * 1000
    if (from > to) {
      return NextResponse.json({ error: 'manualDateFrom must be before manualDateTo' }, { status: 400 })
    }
    if (to.getTime() - from.getTime() > maxRangeMs) {
      return NextResponse.json({ error: 'Manual collection range must be 14 days or less' }, { status: 400 })
    }
  }

  // Find connections for this user
  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(
      and(
        eq(marketplaceConnections.userId, workspaceUserId),
        inArray(marketplaceConnections.id, body.connectionIds)
      )
    )

  if (connections.length === 0) {
    return NextResponse.json(
      { error: 'No matching marketplace connections found' },
      { status: 404 }
    )
  }

  const plannedJobs = connections.map((conn) => {
    const integrationMethod = getIntegrationMethod(conn.marketplaceId, {
      isManual: conn.isManual,
      authType: conn.authType,
    })
    return {
      conn,
      integrationMethod,
      jobType: integrationMethod === 'rpa' ? 'scrape-orders' : 'manual-order-collection',
    }
  })

  const lockResult = await createCollectionJobLogsWithLock(plannedJobs.map(({ conn, jobType }) => ({
    jobType,
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

  const jobLogIds = lockResult.jobLogIds

  for (const [index, planned] of plannedJobs.entries()) {
    const { conn, integrationMethod } = planned
    const jobLogId = jobLogIds[index]
    if (!jobLogId) continue

    if (integrationMethod === 'rpa') {
      if (!isRegisteredScraperMarketplace(conn.marketplaceId)) {
        await db
          .update(jobLogs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            errorMessage: `${conn.displayName} RPA 수집 스크래퍼가 아직 구현되지 않았습니다. 먼저 해당 마켓 전용 RPA 스크래퍼를 추가해야 합니다.`,
          })
          .where(eq(jobLogs.id, jobLogId))
        continue
      }

      const since = manualDateFrom
        ? new Date(`${manualDateFrom}T00:00:00+09:00`)
        : new Date(Date.now() - (safeManualLookbackDays ?? 3) * 24 * 60 * 60 * 1000)
      await db
        .update(jobLogs)
        .set({
          progressMessage: '로컬 마켓 에이전트 대기 중... PC에서 start-market-agent.cmd가 실행 중이어야 합니다.',
        })
        .where(eq(jobLogs.id, jobLogId))
      await getMarketplaceScrapeQueue().add(
        `manual-scrape-${conn.marketplaceId}-${Date.now()}`,
        {
          marketplaceId: conn.marketplaceId,
          connectionId: conn.id,
          userId: workspaceUserId,
          jobType: 'scrape-orders',
          jobLogId,
          since: since.toISOString(),
        },
        {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      )
      continue
    }

    // Run in background — do not await
    collectOrdersForConnection({
      marketplaceId: conn.marketplaceId,
      connectionId: conn.id,
      userId: workspaceUserId,
      jobType: 'manual-order-collection',
      jobLogId,
      manualLookbackDays: safeManualLookbackDays,
      manualDateFrom: manualDateFrom ?? undefined,
      manualDateTo: manualDateTo ?? undefined,
    }).catch((err) => {
      console.error('[collect] Background collection failed:', err)
    })
  }

  return NextResponse.json({ jobLogIds })
}

function sanitizeDateInput(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}
