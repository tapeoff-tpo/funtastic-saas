import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  exportSaasChinaInventoryWorkbook,
  saasChinaInventoryExportFilename,
} from '@/lib/purchasing/saas-china-inventory-excel'
import { getSaasChinaInventory } from '@/lib/purchasing/saas-china-outbound'

export const runtime = 'nodejs'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const { items } = await getSaasChinaInventory(workspaceUserId)
    const buffer = await exportSaasChinaInventoryWorkbook(items)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8\'\'${encodeURIComponent(saasChinaInventoryExportFilename())}`,
      },
    })
  } catch (error) {
    console.error('SaaS China inventory export error:', error)
    return NextResponse.json({ error: 'SaaS 중국재고 현재 목록을 엑셀로 만들지 못했습니다.' }, { status: 500 })
  }
}