import { NextResponse } from 'next/server'
import { z } from 'zod'
import { completeDetailPageReview, deleteDetailPageDraft } from '@/lib/operations/detail-page-drafts'
import { getDetailPageWorkspaceUser } from '@/lib/operations/detail-page-bridge-auth'

const bodySchema = z.object({ status: z.literal('completed') })

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await getDetailPageWorkspaceUser()
  if (!identity) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '변경할 상태가 올바르지 않습니다.' }, { status: 400 })

  const { id } = await context.params
  const job = await completeDetailPageReview(identity.workspaceUserId, id)
  if (!job) return NextResponse.json({ error: '검수 가능한 Figma 초안 작업을 찾지 못했습니다.' }, { status: 404 })
  return NextResponse.json({ job }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await getDetailPageWorkspaceUser()
  if (!identity) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const { id } = await context.params
  const deleted = await deleteDetailPageDraft(identity.workspaceUserId, id)
  if (!deleted) return NextResponse.json({ error: '삭제할 Figma 초안 작업을 찾지 못했습니다.' }, { status: 404 })
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
