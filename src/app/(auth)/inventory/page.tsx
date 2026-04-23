import {
  createSearchParamsCache,
  parseAsString,
  parseAsInteger,
} from 'nuqs/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { inventory } from '@/lib/db/schema'
import { eq, isNotNull, and } from 'drizzle-orm'
import { getInventoryList } from '@/lib/inventory/queries'
import { InventoryTable } from './inventory-table'
import type { InventoryFilters } from '@/lib/inventory/types'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '재고관리',
}

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(50),
  search: parseAsString,
  sort: parseAsString,
  order: parseAsString,
  warehouseZone: parseAsString,
})

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParamsCache.parse(searchParams)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const filters: InventoryFilters = {
    page: params.page,
    pageSize: params.pageSize,
    search: params.search ?? undefined,
    sort: params.sort ?? undefined,
    order: (params.order as 'asc' | 'desc') ?? undefined,
    warehouseZone: params.warehouseZone ?? undefined,
  }

  const [{ items, total }, warehouseZoneRows] = await Promise.all([
    getInventoryList(user.id, filters),
    db
      .selectDistinct({ warehouseZone: inventory.warehouseZone })
      .from(inventory)
      .where(and(eq(inventory.userId, user.id), isNotNull(inventory.warehouseZone))),
  ])

  const warehouseZones = warehouseZoneRows
    .map((r) => r.warehouseZone)
    .filter((z): z is string => z !== null)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">재고관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            전체 {total.toLocaleString('ko-KR')}개 품목
          </p>
        </div>
      </div>

      {/* Table */}
      <InventoryTable
        data={items.map((item) => ({
          id: item.id,
          sku: item.sku,
          productName: item.productName,
          optionName: item.optionName ?? null,
          warehouseZone: item.warehouseZone,
          sectorCode: item.sectorCode,
          totalStock: item.totalStock,
          reservedStock: item.reservedStock,
          availableStock: item.availableStock,
          monthlyIncoming: item.monthlyIncoming,
          monthlyOutgoing: item.monthlyOutgoing,
          lastIncomingAt: item.lastIncomingAt ?? null,
          lastOutgoingAt: item.lastOutgoingAt ?? null,
          updatedAt: item.updatedAt,
        }))}
        total={total}
        page={params.page}
        pageSize={params.pageSize}
        warehouseZones={warehouseZones}
      />
    </div>
  )
}
