import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getChinaOutboundShipmentDetail } from '@/lib/purchasing/saas-china-outbound'
import { renderChinaPalletWorksheet } from '@/lib/purchasing/china-pallet-worksheet-print'
export const runtime = 'nodejs'
export async function GET(_request: Request, { params }: { params: Promise<{ shipmentId: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  const access = await getUserMenuAccess(user.id, user)
  if (!access || !canUseMenu(access, '/purchasing/china-shipments')) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  const { shipmentId } = await params
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(shipmentId)) return NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 })
  try {
    const userId = await getWorkspaceUserId(user.id)
    const detail = await getChinaOutboundShipmentDetail({ userId, shipmentId })
    if (!detail) return NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 })
    const nonce = randomUUID()
    return new NextResponse(renderChinaPalletWorksheet(detail, nonce), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`, 'X-Content-Type-Options': 'nosniff' } })
  } catch { return NextResponse.json({ error: '파레트 배정 작업지를 불러오지 못했습니다.' }, { status: 500 }) }
}
