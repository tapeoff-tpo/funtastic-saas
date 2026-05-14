import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections, jobLogs } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { collectOrdersForConnection } from '@/lib/jobs/workers/order-collector'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

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

  // Pre-create job_log entries (status: queued) and run collection in background
  const jobLogIds: string[] = []

  for (const conn of connections) {
    const [logRow] = await db
      .insert(jobLogs)
      .values({
        jobType: 'manual-order-collection',
        marketplaceId: conn.marketplaceId,
        connectionId: conn.id,
        status: 'queued',
      })
      .returning({ id: jobLogs.id })

    jobLogIds.push(logRow.id)

    // Run in background — do not await
    collectOrdersForConnection({
      marketplaceId: conn.marketplaceId,
      connectionId: conn.id,
      userId: workspaceUserId,
      jobType: 'manual-order-collection',
      jobLogId: logRow.id,
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
