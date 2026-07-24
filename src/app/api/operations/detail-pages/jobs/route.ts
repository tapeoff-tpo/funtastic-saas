import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createDetailPageDraft,
  listDetailPageDrafts,
} from '@/lib/operations/detail-page-drafts'
import { getDetailPageWorkspaceUser } from '@/lib/operations/detail-page-bridge-auth'

const productSchema = z.object({
  id: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(1_000),
  option: z.string().trim().max(1_000),
  purchaseUrl: z.string().trim().max(4_000),
  material: z.string().trim().max(500),
  size: z.string().trim().max(500),
  manufacturer: z.string().trim().max(500),
  weight: z.string().trim().max(500),
  country: z.string().trim().max(500),
  capacity: z.string().trim().max(500),
})

const createSchema = z.object({
  clientJobKey: z.string().trim().min(1).max(160),
  product: productSchema,
  imageUrls: z.array(z.string().trim().url().max(4_000)).min(1).max(30),
  template: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2_000).optional(),
})

export async function GET() {
  const identity = await getDetailPageWorkspaceUser()
  if (!identity) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const jobs = await listDetailPageDrafts(identity.workspaceUserId)
  return NextResponse.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const identity = await getDetailPageWorkspaceUser()
  if (!identity) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = createSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '상세페이지 초안 작업 정보가 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const job = await createDetailPageDraft({
      userId: identity.workspaceUserId,
      requestedByUserId: identity.user.id,
      ...body.data,
    })
    return NextResponse.json({ job }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Figma 초안 제작 작업을 저장하지 못했습니다.' },
      { status: 400 },
    )
  }
}
