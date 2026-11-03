import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getSaasChinaInventory } from '@/lib/purchasing/saas-china-outbound'
import { getPurchasingItemLabelDataBySku } from '@/lib/purchasing/items'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  await assertMenuAccess('/purchasing/china-shipments')
  const owner = await getWorkspaceUserId(user.id)
  const { items } = await getSaasChinaInventory(owner)
  const available = items.filter((item) => item.availableQuantity > 0)
  const names = await getPurchasingItemLabelDataBySku(owner, available.map((item) => item.sku))
  return NextResponse.json({ items: available.map((item) => ({
    id: item.id, warehouseCode: item.warehouseCode, sku: item.sku, productName: item.productName,
    chineseProductName: names.get(item.sku)?.chineseProductName ?? '', optionName: item.optionName,
    onHandQuantity: item.onHandQuantity, reservedQuantity: item.reservedQuantity, availableQuantity: item.availableQuantity,
    lastReceivedAt: item.lastReceivedAt?.toISOString() ?? null,
  })) }, { headers: { 'Cache-Control': 'private, no-store' } })
}
