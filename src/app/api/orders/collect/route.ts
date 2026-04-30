import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections, jobLogs } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { queueManualCollection } from '@/lib/jobs/queues'

/**
 * POST /api/orders/collect
 *
 * Manually trigger order collection for selected marketplaces.
 * Creates job_logs entries (status: 'queued') and adds jobs to the BullMQ queue.
 * The actual marketplace API calls happen on the worker process (which has a whitelisted IP).
 *
 * Body: { connectionIds: string[] }
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

  let body: { connectionIds: string[] }
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

  // Find connections for this user
  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(
      and(
        eq(marketplaceConnections.userId, user.id),
        inArray(marketplaceConnections.id, body.connectionIds)
      )
    )

  if (connections.length === 0) {
    return NextResponse.json(
      { error: 'No matching marketplace connections found' },
      { status: 404 }
    )
  }

  // Create job_logs entries (status: queued) and add BullMQ jobs
  const jobLogIds: string[] = []

  for (const conn of connections) {
    // 1. Pre-create job_log with 'queued' status
    const [logRow] = await db
      .insert(jobLogs)
      .values({
        jobType: 'manual-order-collection',
        marketplaceId: conn.marketplaceId,
        connectionId: conn.id,
        status: 'queued',
      })
      .returning({ id: jobLogs.id })

    // 2. Add job to BullMQ queue (worker will pick it up)
    await queueManualCollection({
      marketplaceId: conn.marketplaceId,
      connectionId: conn.id,
      userId: user.id,
      jobLogId: logRow.id,
    })

    jobLogIds.push(logRow.id)
  }

  return NextResponse.json({ jobLogIds })
}
