import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { exportChinaOutboundRegistrationTemplateWorkbook } from '@/lib/purchasing/china-outbound-registration-workbook'
import { getSaasChinaInventory, listSaasChinaOutboundWarehouses } from '@/lib/purchasing/saas-china-outbound'

export const runtime = 'nodejs'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    // Resolve the canonical workspace before returning a shared operational
    // template, matching the import routes' ownership boundary.
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const [warehouses, { items: currentInventory }] = await Promise.all([
      listSaasChinaOutboundWarehouses(workspaceUserId),
      getSaasChinaInventory(workspaceUserId),
    ])
    const defaultWarehouseCode = warehouses.find((warehouse) => warehouse.isDefault)?.warehouseCode ?? null
    const buffer = await exportChinaOutboundRegistrationTemplateWorkbook({
      defaultWarehouseCode,
      warehouseCodes: warehouses.map((warehouse) => warehouse.warehouseCode),
      currentInventory,
    })
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('중국출고_박스쉽먼트_등록양식.xlsx')}`,
      },
    })
  } catch (error) {
    console.error('China outbound registration template export error:', error)
    return NextResponse.json({ error: '중국출고 엑셀 등록 양식을 만들지 못했습니다.' }, { status: 500 })
  }
}
