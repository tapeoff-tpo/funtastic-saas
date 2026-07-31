import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateFigmaBridgeDevice,
  failFigmaBridgeCommand,
  finishFigmaBridgeCommand,
  touchFigmaBridgeDevice,
} from '@/lib/operations/detail-page-drafts'
import { bridgeHeaders, readBearerToken } from '@/lib/operations/detail-page-bridge-auth'

const bodySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed') }),
  z.object({ status: z.literal('failed'), errorMessage: z.string().trim().min(1).max(2_000) }),
])

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: bridgeHeaders() })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const token = readBearerToken(request)
  if (!token) return NextResponse.json({ error: 'Figma bridge token is required.' }, { status: 401, headers: bridgeHeaders() })

  const device = await authenticateFigmaBridgeDevice(token)
  if (!device) return NextResponse.json({ error: 'The Figma bridge is not connected.' }, { status: 401, headers: bridgeHeaders() })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'The command result is invalid.' }, { status: 400, headers: bridgeHeaders() })

  const { id } = await context.params
  await touchFigmaBridgeDevice(device.id, request.headers.get('x-funtastic-plugin-version'))
  const command = body.data.status === 'completed'
    ? await finishFigmaBridgeCommand({ device, commandId: id })
    : await failFigmaBridgeCommand({ device, commandId: id, errorMessage: body.data.errorMessage })
  if (!command) return NextResponse.json({ error: 'The active Figma command was not found.' }, { status: 404, headers: bridgeHeaders() })
  return NextResponse.json({ command }, { headers: bridgeHeaders() })
}
