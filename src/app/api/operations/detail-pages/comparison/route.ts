import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  listFigmaFrameCaptures,
  queueFigmaFinalComposition,
} from '@/lib/operations/detail-page-drafts'
import { getDetailPageWorkspaceUser } from '@/lib/operations/detail-page-bridge-auth'

const FIGMA_FILE_KEY = 'X8yYgVtrAFKycEA0yy0kWI'

const composeSchema = z.object({
  action: z.literal('compose'),
  productName: z.string().trim().min(1).max(160),
  selections: z.array(z.object({
    sourceFrameId: z.string().trim().min(1).max(120),
    sectionId: z.string().trim().min(1).max(120),
    sectionName: z.string().trim().min(1).max(500),
  })).min(3).max(24),
})

export async function GET() {
  const identity = await getDetailPageWorkspaceUser()
  if (!identity) return NextResponse.json({ error: 'Login is required.' }, { status: 401 })

  const captures = await listFigmaFrameCaptures(identity.workspaceUserId, FIGMA_FILE_KEY)
  return NextResponse.json({ captures }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const identity = await getDetailPageWorkspaceUser()
  if (!identity) return NextResponse.json({ error: 'Login is required.' }, { status: 401 })

  const body = composeSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'The final composition is invalid.' }, { status: 400 })

  const command = await queueFigmaFinalComposition({
    userId: identity.workspaceUserId,
    figmaFileKey: FIGMA_FILE_KEY,
    productName: body.data.productName,
    selections: body.data.selections,
  })
  return NextResponse.json({ command }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
