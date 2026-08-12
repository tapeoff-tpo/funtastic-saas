import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { forceBulkUpdateStatus } from '@/lib/orders/actions'

// Confirming does not touch stock. Small batches keep the serverless request
// short while the next request naturally skips the rows already confirmed.
const CONFIRM_MAPPED_BATCH_SIZE = 100

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  try {
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const page = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(
        eq(orders.userId, workspaceUserId),
        eq(orders.status, 'new'),
        isNotNull(orders.mappedAt),
      ))
      .orderBy(asc(orders.createdAt), asc(orders.id))
      .limit(CONFIRM_MAPPED_BATCH_SIZE)

    const result = page.length > 0
      ? await forceBulkUpdateStatus(workspaceUserId, page.map((order) => order.id), 'confirmed')
      : { updated: 0, errors: [] }
    const processed = result.updated + result.errors.length

    return NextResponse.json({
      updated: result.updated,
      failed: result.errors.length,
      errors: result.errors,
      hasMore: page.length === CONFIRM_MAPPED_BATCH_SIZE && processed > 0 && result.errors.length === 0,
      nextCursor: null,
    })
  } catch (error) {
    console.error('Failed to confirm mapped orders', error)
    return NextResponse.json({
      error: '확인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    }, { status: 500 })
  }
}
