import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { collectOrdersForConnection } from '@/lib/jobs/workers/order-collector'

export const maxDuration = 60

/**
 * POST /api/orders/collect
 *
 * Manually trigger order collection for selected marketplaces.
 * Works without BullMQ/Redis — calls marketplace APIs directly.
 *
 * Body: { marketplaceIds: string[] }
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

  let body: { marketplaceIds: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.marketplaceIds) || body.marketplaceIds.length === 0) {
    return NextResponse.json(
      { error: 'marketplaceIds must be a non-empty array' },
      { status: 400 }
    )
  }

  // Find connected marketplaces for this user
  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(
      and(
        eq(marketplaceConnections.userId, user.id),
        inArray(marketplaceConnections.marketplaceId, body.marketplaceIds)
      )
    )

  if (connections.length === 0) {
    return NextResponse.json(
      { error: 'No matching marketplace connections found' },
      { status: 404 }
    )
  }

  // Collect orders sequentially (respect rate limits)
  const results: Array<{
    marketplaceId: string
    success: boolean
    ordersCollected?: number
    claimsCollected?: number
    error?: string
  }> = []

  for (const conn of connections) {
    try {
      const result = await collectOrdersForConnection({
        marketplaceId: conn.marketplaceId,
        connectionId: conn.id,
        userId: user.id,
        jobType: 'manual-order-collection',
      })
      results.push({
        marketplaceId: conn.marketplaceId,
        success: true,
        ordersCollected: result.ordersCollected,
        claimsCollected: result.claimsCollected,
      })
    } catch (error) {
      results.push({
        marketplaceId: conn.marketplaceId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return NextResponse.json({ results })
}
