/**
 * GET /api/orders/[id]/memos — list memos for this order (newest first)
 * POST /api/orders/[id]/memos — add a memo { content, memoType?, attachments? }
 *
 * Both verify the order belongs to the authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { and, desc, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orderMemos, orders } from '@/lib/db/schema'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

interface MemoAttachment {
  name: string
  type: string
  dataUrl: string
  size: number
  expiresAt?: string
}

const MAX_ATTACHMENTS = 5
const MAX_IMAGE_BYTES = 1024 * 1024
const MAX_VIDEO_BYTES = 20 * 1024 * 1024
const ATTACHMENT_RETENTION_DAYS = 30

function normalizeAttachments(value: unknown): MemoAttachment[] {
  const expiresAt = new Date(Date.now() + ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_ATTACHMENTS).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const source = item as Partial<MemoAttachment>
    const name = typeof source.name === 'string' ? source.name.trim().slice(0, 180) : 'image'
    const type = typeof source.type === 'string' ? source.type.trim() : ''
    const dataUrl = typeof source.dataUrl === 'string' ? source.dataUrl : ''
    const size = Number(source.size)
    const isImage = type.startsWith('image/')
    const isVideo = type.startsWith('video/')
    if (!isImage && !isVideo) return []
    if (!dataUrl.startsWith(`data:${type};base64,`)) return []
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
    if (!Number.isFinite(size) || size <= 0 || size > maxBytes) return []
    return [{ name: name || 'image', type, dataUrl, size, expiresAt }]
  })
}

async function verifyOrderOwnership(orderId: string, userId: string) {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1)
  return !!row
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  if (!(await verifyOrderOwnership(id, workspaceUserId))) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  }

  const memos = await db
    .select()
    .from(orderMemos)
    .where(eq(orderMemos.orderId, id))
    .orderBy(desc(orderMemos.createdAt))

  return NextResponse.json({ memos })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  if (!(await verifyOrderOwnership(id, workspaceUserId))) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  }

  const body = (await req.json()) as { content?: string; memoType?: string; attachments?: unknown }
  const content = body.content?.trim() ?? ''
  const attachments = normalizeAttachments(body.attachments)
  if (!content && attachments.length === 0) {
    return NextResponse.json({ error: '메모 내용 또는 첨부 파일을 추가하세요.' }, { status: 400 })
  }
  if (Array.isArray(body.attachments) && body.attachments.length > 0 && attachments.length === 0) {
    return NextResponse.json({ error: '첨부 가능한 파일은 1MB 이하 이미지 또는 20MB 이하 동영상입니다.' }, { status: 400 })
  }

  const [created] = await db
    .insert(orderMemos)
    .values({
      orderId: id,
      userId: workspaceUserId,
      content,
      memoType: body.memoType?.trim() || 'general',
      attachments,
    })
    .returning()

  if (created.memoType === 'mobile_return_inspection' || created.memoType === 'return_inspection') {
    revalidatePath('/dashboard')
    revalidatePath('/cs')
  }

  return NextResponse.json({ memo: created })
}
