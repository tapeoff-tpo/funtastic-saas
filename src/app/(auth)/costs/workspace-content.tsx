import Link from 'next/link'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import type { Metadata } from 'next'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { ESA009M_HEADERS, getPurchasingItems } from '@/lib/purchasing/items'
import { listShipmentCostHistory, type ShipmentCostHistoryRow } from '@/lib/purchasing/shipment-cost-store'
import { CostsPageClient } from './costs-page-client'

export const metadata: Metadata = { title: '품목·원가' }

export default async function CostsPage({
  searchParams, exactSku,
}: {
  exactSku?: string
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(single(params.page)) || 1)
  const pageSize = 50
  const search = single(params.search)?.trim() || undefined
  const user = await getCurrentUser()
  if (!user) return null

  const access = await getUserMenuAccess(user.id, user)
  const canCalculateShipmentCost = access && canUseMenu(access, '/purchasing/import-documents')
  const userId = await getWorkspaceUserId(user.id)
  const { items, total } = await getPurchasingItems({
    userId,
    page,
    pageSize,
    search,
    exactSku,
    sort: 'createdAt',
    direction: 'desc',
  })
  const skus = items.map((item) => item.data['품목코드']?.trim()).filter((sku): sku is string => Boolean(sku))
  const historyBySku = new Map<string, ShipmentCostHistoryRow[]>()
  for (const entry of await listShipmentCostHistory(userId, skus)) {
    const history = historyBySku.get(entry.sku) ?? []
    history.push(entry)
    historyBySku.set(entry.sku, history)
  }
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      {canCalculateShipmentCost && <div className="flex justify-end"><Link href="/purchasing/import-documents/costs" className="rounded-md border bg-background px-3 py-2 text-sm">회차 원가 계산</Link></div>}
      <CostsPageClient
        headers={ESA009M_HEADERS}
        rows={items.map((item) => ({
          id: item.id,
          data: item.data,
          shipmentCostHistory: historyBySku.get(item.data['품목코드']?.trim() ?? ''),
          purchaseUrlVerificationStatus: item.purchaseUrlVerificationStatus,
          purchasingStatus: item.purchasingStatus,
          purchasingStatusNote: item.purchasingStatusNote,
          updatedAt: item.updatedAt.toISOString(),
        }))}
        total={total}
        page={page}
        pageCount={pageCount}
        search={search}
      />
    </div>
  )
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}
