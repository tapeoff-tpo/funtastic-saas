import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  listFigmaBridgeCommands,
  queueFigmaImageReplacement,
} from '@/lib/operations/detail-page-drafts'
import { getDetailPageWorkspaceUser } from '@/lib/operations/detail-page-bridge-auth'

const bodySchema = z.object({
  figmaFileKey: z.string().trim().min(1).max(120),
  targetFrameName: z.string().trim().min(1).max(500),
  targetNodeName: z.string().trim().min(1).max(500),
  imageUrl: z.string().trim().url().max(4_000),
})

export async function GET() {
  const identity = await getDetailPageWorkspaceUser()
  if (!identity) return NextResponse.json({ error: 'Login is required.' }, { status: 401 })

  const commands = await listFigmaBridgeCommands(identity.workspaceUserId)
  return NextResponse.json({ commands }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const identity = await getDetailPageWorkspaceUser()
  if (!identity) return NextResponse.json({ error: 'Login is required.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'The image replacement request is invalid.' }, { status: 400 })

  const command = await queueFigmaImageReplacement({
    userId: identity.workspaceUserId,
    ...body.data,
  })
  return NextResponse.json({ command }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
