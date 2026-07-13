import { NextResponse } from 'next/server'
import { revokeSmsBridgeDevice } from '@/lib/operations/sms-bridge'
import { getSmsBridgeWorkspaceUserId } from '@/lib/operations/sms-bridge-auth'

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const userId = await getSmsBridgeWorkspaceUserId()
  if (!userId) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  const { id } = await context.params
  const revoked = await revokeSmsBridgeDevice(userId, id)
  if (!revoked) return NextResponse.json({ error: '연결된 기기를 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
