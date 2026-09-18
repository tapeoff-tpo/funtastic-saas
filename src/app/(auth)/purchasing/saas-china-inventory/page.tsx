import type { Metadata } from 'next'
import Link from 'next/link'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSaasChinaInventory } from '@/lib/purchasing/saas-china-outbound'
import { ProductFlowNav } from '@/components/product-flow-nav'
import { SaasChinaInventoryBoard, type SaasChinaInventoryViewItem } from './saas-china-inventory-board'

export const metadata: Metadata = {
  title: '중국재고(SaaS)',
}

export default async function SaasChinaInventoryPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const { items, summary } = await getSaasChinaInventory(workspaceUserId)
  const viewItems: SaasChinaInventoryViewItem[] = items.map((item) => ({
    id: item.id,
    warehouseCode: item.warehouseCode,
    sku: item.sku,
    productName: item.productName,
    optionName: item.optionName,
    onHandQuantity: item.onHandQuantity,
    reservedQuantity: item.reservedQuantity,
    availableQuantity: item.availableQuantity,
    lastReceivedAt: item.lastReceivedAt?.toISOString() ?? null,
    lastOutboundAt: item.lastOutboundAt?.toISOString() ?? null,
  }))

  return (
    <div className="space-y-4">
      <ProductFlowNav />
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">중국재고(SaaS)</h1>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">개발용 독립 재고</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            엑셀 원본 재고를 창고별로 따로 보관합니다. 기존 중국재고·Ecount 로우데이터와는 합산하지 않으며, 중국출고 작업에서는 중국창고 재고만 선택합니다.
          </p>
        </div>
        <Link
          href="/purchasing/china-shipments"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          중국출고 작업하기
        </Link>
      </header>

      <SaasChinaInventoryBoard items={viewItems} summary={summary} />
    </div>
  )
}
