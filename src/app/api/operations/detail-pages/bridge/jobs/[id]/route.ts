import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateFigmaBridgeDevice,
  failDetailPageDraft,
  finishDetailPageDraft,
  touchFigmaBridgeDevice,
} from '@/lib/operations/detail-page-drafts'
import { bridgeHeaders, readBearerToken } from '@/lib/operations/detail-page-bridge-auth'

const bodySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('review'),
    figmaNodeId: z.string().trim().min(1).max(120),
    figmaUrl: z.string().trim().url().max(2_000),
  }),
  z.object({
    status: z.literal('failed'),
    errorMessage: z.string().trim().min(1).max(2_000),
  }),
])

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: bridgeHeaders() })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const token = readBearerToken(request)
  if (!token) return NextResponse.json({ error: 'Figma 플러그인 연결 토큰이 필요합니다.' }, { status: 401, headers: bridgeHeaders() })

  const device = await authenticateFigmaBridgeDevice(token)
  if (!device) return NextResponse.json({ error: '연결이 해제되었거나 만료된 Figma 플러그인입니다.' }, { status: 401, headers: bridgeHeaders() })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Figma 작업 결과가 올바르지 않습니다.' }, { status: 400, headers: bridgeHeaders() })
  const { id } = await context.params
  await touchFigmaBridgeDevice(device.id, request.headers.get('x-funtastic-plugin-version'))

  const job = body.data.status === 'review'
    ? await finishDetailPageDraft({ device, jobId: id, figmaNodeId: body.data.figmaNodeId, figmaUrl: body.data.figmaUrl })
    : await failDetailPageDraft({ device, jobId: id, errorMessage: body.data.errorMessage })
  if (!job) return NextResponse.json({ error: '처리 중인 Figma 초안 작업을 찾지 못했습니다.' }, { status: 404, headers: bridgeHeaders() })
  return NextResponse.json({ job }, { headers: bridgeHeaders() })
}
