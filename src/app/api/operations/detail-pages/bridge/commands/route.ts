import { NextResponse } from 'next/server'
import {
  authenticateFigmaBridgeDevice,
  claimNextFigmaBridgeCommand,
  touchFigmaBridgeDevice,
} from '@/lib/operations/detail-page-drafts'
import { bridgeHeaders, readBearerToken } from '@/lib/operations/detail-page-bridge-auth'

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: bridgeHeaders() })
}

export async function POST(request: Request) {
  const token = readBearerToken(request)
  if (!token) return NextResponse.json({ error: 'Figma bridge token is required.' }, { status: 401, headers: bridgeHeaders() })

  const device = await authenticateFigmaBridgeDevice(token)
  if (!device) return NextResponse.json({ error: 'The Figma bridge is not connected.' }, { status: 401, headers: bridgeHeaders() })

  await touchFigmaBridgeDevice(device.id, request.headers.get('x-funtastic-plugin-version'))
  const command = await claimNextFigmaBridgeCommand(device)
  return NextResponse.json({ command }, { headers: bridgeHeaders() })
}
