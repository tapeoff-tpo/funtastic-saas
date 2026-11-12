import {
  createSearchParamsCache,
  parseAsString,
  parseAsInteger,
} from 'nuqs/server'
import { db } from '@/lib/db'
import { inventory } from '@/lib/db/schema'
import { eq, isNotNull, and } from 'drizzle-orm'
import { getInventoryList } from '@/lib/inventory/queries'
import { inventoryMonthEndImports, inventoryMonthEndStock } from '@/lib/inventory/snapshot-schema'
import { InventoryTable } from './inventory-table'
import type { InventoryFilters } from '@/lib/inventory/types'
import type { Metadata } from 'next'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getInventoryPeriod, isHistoricalInventoryMonth } from '@/lib/inventory/period'

export const metadata: Metadata = {
  title: '재고관리',
}

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(25),
  search: parseAsString,
  productCode: parseAsString,
  optionCode: parseAsString,
  maxStock: parseAsInteger,
  sort: parseAsString,
  order: parseAsString,
  warehouseZone: parseAsString,
  focusSku: parseAsString,
  // 검색 트리거 sentinel — 이게 없으면 페이지 진입 직후엔 fetch 하지 않는다.
  searched: parseAsString,
  year: parseAsInteger,
  month: parseAsInteger,
})

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParamsCache.parse(searchParams)

  const user = await getCurrentUser()

  if (!user) {
    return null
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const period = getInventoryPeriod(params.year, params.month)
  const historical = isHistoricalInventoryMonth(period.key)
  const stock = historical ? inventoryMonthEndStock : inventory

  const filters: InventoryFilters = {
    referenceMonth: period.key,
    page: params.page,
    pageSize: params.pageSize,
    search: params.search ?? undefined,
    productCode: params.productCode ?? undefined,
    optionCode: params.optionCode ?? undefined,
    maxStock: params.maxStock ?? undefined,
    sort: params.sort ?? undefined,
    order: (params.order as 'asc' | 'desc') ?? undefined,
    warehouseZone: params.warehouseZone ?? undefined,
  }

  // 검색 버튼 누르기 전엔 재고 fetch 하지 않음. 창고 목록은 항상 로드 (필터 select 채우기 위함).
  const searched = !!params.searched
  const [{ items, total }, warehouseZoneRows, snapshotRows] = await Promise.all([
    searched
      ? getInventoryList(workspaceUserId, filters)
      : Promise.resolve({
          items: [] as Awaited<ReturnType<typeof getInventoryList>>['items'],
          total: 0,
        }),
    db
      .selectDistinct({ warehouseZone: stock.warehouseZone })
      .from(stock)
      .where(and(eq(stock.userId, workspaceUserId), isNotNull(stock.warehouseZone), historical ? eq(inventoryMonthEndStock.referenceMonth, period.key) : undefined)),
    historical
      ? db.select({ month: inventoryMonthEndImports.referenceMonth }).from(inventoryMonthEndImports)
        .where(and(eq(inventoryMonthEndImports.userId, workspaceUserId), eq(inventoryMonthEndImports.referenceMonth, period.key))).limit(1)
      : Promise.resolve([]),
  ])

  const warehouseZones = warehouseZoneRows
    .map((r) => r.warehouseZone)
    .filter((z): z is string => z !== null)

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-bold">재고관리</h1>
        <span className="text-sm text-muted-foreground">
          {searched
            ? `전체 ${total.toLocaleString('ko-KR')}개 품목`
            : '검색 조건을 입력하고 검색 버튼을 눌러주세요.'}
        </span>
      </div>

      {/* Table */}
      <InventoryTable
        referenceMonth={period.key}
        snapshotAvailable={!historical || snapshotRows.length > 0}
        searched={searched}
        data={items}
        total={total}
        page={params.page}
        pageSize={params.pageSize}
        warehouseZones={warehouseZones}
        focusSku={params.focusSku ?? undefined}
      />
    </div>
  )
}
