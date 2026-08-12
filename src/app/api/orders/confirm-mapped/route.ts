import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { forceBulkUpdateStatus } from '@/lib/orders/actions'

const CONFIRM_MAPPED_BATCH_SIZE = 500

type Cursor = {
  createdAt: string
  id: string
}

function parseCursor(value: unknown): Cursor | null {
  if (typeof value !== 'string' || !value) return null

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>
    const createdAt = parsed.createdAt ? new Date(parsed.createdAt) : null
    if (!parsed.id || !createdAt || Number.isNaN(createdAt.getTime())) return null
    return { id: parsed.id, createdAt: createdAt.toISOString() }
  } catch {
    return null
  }
}

function createCursor(row: { id: string; createdAt: Date }) {
  return Buffer.from(JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() })).toString('base64url')
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { cursor?: string }
  try {
    body = await req.json() as { cursor?: string }
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const cursor = parseCursor(body.cursor)
  const cursorDate = cursor ? new Date(cursor.createdAt) : null
  const cursorCondition = cursor && cursorDate
    ? sql`(${orders.createdAt}, ${orders.id}) > (${cursorDate}, ${cursor.id}::uuid)`
    : undefined
  const candidates = await db
    .select({ id: orders.id, createdAt: orders.createdAt })
    .from(orders)
    .where(and(
      eq(orders.userId, workspaceUserId),
      eq(orders.status, 'new'),
      isNotNull(orders.mappedAt),
      cursorCondition,
    ))
    .orderBy(asc(orders.createdAt), asc(orders.id))
    .limit(CONFIRM_MAPPED_BATCH_SIZE + 1)

  const page = candidates.slice(0, CONFIRM_MAPPED_BATCH_SIZE)
  const result = page.length > 0
    ? await forceBulkUpdateStatus(workspaceUserId, page.map((order) => order.id), 'confirmed')
    : { updated: 0, errors: [] }
  const hasMore = candidates.length > CONFIRM_MAPPED_BATCH_SIZE

  return NextResponse.json({
    updated: result.updated,
    failed: result.errors.length,
    errors: result.errors,
    hasMore,
    nextCursor: hasMore && page.length > 0 ? createCursor(page[page.length - 1]) : null,
  })
}
