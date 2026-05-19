import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import {
  createSearchParamsCache,
  parseAsString,
  parseAsInteger,
  parseAsBoolean,
} from 'nuqs/server'
import { getOrders } from '@/lib/orders/queries'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { AUTO_MARKETPLACE_OPTIONS, MARKETPLACE_DISPLAY_NAMES } from '@/lib/marketplace/collect-options'
import { eq } from 'drizzle-orm'
import { DataTable } from './data-table'
import { OrderFilters } from './filters'
import { OrderTabs } from './order-tabs'
import { getProfile, getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import type { OrderRow } from './columns'
import type { OrderFilters as OrderFiltersParams } from '@/lib/orders/types'
import type { ClaimType } from '@/lib/orders/types'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '주문 관리',
}

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(25),
  status: parseAsString,
  marketplace: parseAsString,
  search: parseAsString,
  searchField: parseAsString,
  dateField: parseAsString,
  dateFrom: parseAsString,
  dateTo: parseAsString,
  datePreset: parseAsString,
  sort: parseAsString,
  order: parseAsString,
  claimType: parseAsString,
  mapping: parseAsString,
  scan: parseAsString,
  scanResult: parseAsString,
  held: parseAsBoolean,
  // Phase 8 — 취소 탭 통합 필터 (status='cancelled' OR claimType='cancel')
  cancel: parseAsBoolean,
  // 전체 탭 명시 키 — 사이드바 진입 직후(탭 미선택) 쿼리 스킵을 위한 sentinel
  tab: parseAsString,
})

type MarketplaceFilterOption = {
  value: string
  label: string
}

function buildMarketplaceFilterOptions(
  connections: Array<{
    marketplaceId: string
    displayName: string
    isManual: boolean
  }>,
): MarketplaceFilterOption[] {
  const options = new Map<string, string>()

  for (const marketplace of AUTO_MARKETPLACE_OPTIONS) {
    options.set(marketplace.marketplaceId, marketplace.displayName)
  }

  for (const connection of connections) {
    options.set(
      connection.marketplaceId,
      connection.isManual
        ? connection.displayName
        : (MARKETPLACE_DISPLAY_NAMES[connection.marketplaceId] ?? connection.displayName),
    )
  }

  return Array.from(options, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko-KR'))
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const params = await searchParamsCache.parse(searchParams)
  const [workspaceUserId, profile] = await Promise.all([
    getWorkspaceUserId(user.id),
    getProfile(user.id),
  ])
  const hasDateFilter = Boolean(params.dateFrom || params.dateTo || params.datePreset === 'all')
  const connectionsPromise = db
    .select({
      marketplaceId: marketplaceConnections.marketplaceId,
      displayName: marketplaceConnections.displayName,
      isManual: marketplaceConnections.isManual,
    })
    .from(marketplaceConnections)
    .where(eq(marketplaceConnections.userId, workspaceUserId))

  const isNewTab = params.status === 'new'
  const isScanFilterTab = params.status === 'preparing' || params.status === 'ready'
  const shouldExcludeHeld = !params.held && Boolean(params.status || params.claimType || params.cancel)
  const mappingFilter = isNewTab
    ? (params.mapping === 'all'
        ? undefined
        : ((params.mapping ?? 'unmapped') as 'mapped' | 'unmapped'))
    : (params.mapping === 'all'
        ? undefined
        : ((params.mapping ?? undefined) as 'mapped' | 'unmapped' | undefined))

  // 탭 미선택(사이드바 진입 직후) — 어떤 쿼리도 실행하지 않는다.
  // 탭(전체/신규/.../반품) 클릭 시점에만 status/claimType/cancel/tab 중 하나가 붙어 fetch 시작.
  const tabSelected = true

  // 탭별 카운트(getOrderStats)는 매 조회마다 11개 status COUNT 쿼리를 추가로 실행해
  // 응답을 느리게 한다. 현재 선택된 탭의 total 만 헤더에 노출하면 충분하므로 제거.
  const ordersPromise = tabSelected && hasDateFilter
    ? getOrders({
        page: params.page,
        pageSize: params.pageSize,
        userId: workspaceUserId,
        status: (params.status ?? undefined) as OrderFiltersParams['status'],
        marketplace: params.marketplace ?? undefined,
        search: params.search ?? undefined,
        searchField: (params.searchField ?? undefined) as OrderFiltersParams['searchField'],
        dateField: (params.dateField ?? undefined) as OrderFiltersParams['dateField'],
        dateFrom: params.dateFrom ?? undefined,
        dateTo: params.dateTo ?? undefined,
        sort: params.sort ?? undefined,
        order: (params.order as 'asc' | 'desc') ?? undefined,
        claimType: (params.claimType ?? undefined) as ClaimType | undefined,
        mapping: mappingFilter,
        scan: isScanFilterTab ? (params.scan ?? undefined) as OrderFiltersParams['scan'] : undefined,
        scanResult: isScanFilterTab ? (params.scanResult ?? undefined) as OrderFiltersParams['scanResult'] : undefined,
        isHeld: params.held ?? undefined,
        excludeHeld: shouldExcludeHeld,
        cancelTab: params.cancel ?? undefined,
        excludeClaimLikeOrders: isNewTab,
        includeMappingDetails: true,
        includeStock: true,
      })
    : { orders: [] as Awaited<ReturnType<typeof getOrders>>['orders'], total: 0 }
  const [connections, { orders: orderList, total }] = await Promise.all([
    connectionsPromise,
    ordersPromise,
  ])
  const marketplaceOptions = buildMarketplaceFilterOptions(connections)

  const data: OrderRow[] = orderList.map((o) => ({
    id: o.id,
    internalNo: (o as { internalNo: string }).internalNo,
    marketplaceId: o.marketplaceId,
    marketplaceName: (o as { marketplaceDisplayName?: string | null }).marketplaceDisplayName ?? null,
    marketplaceOrderId: o.marketplaceOrderId,
    buyerName: o.buyerName,
    buyerPhone: o.buyerPhone,
    buyerPhone2: (o as { buyerPhone2?: string | null }).buyerPhone2 ?? null,
    recipientName: o.recipientName,
    recipientPhone: o.recipientPhone,
    recipientPhone2: (o as { recipientPhone2?: string | null }).recipientPhone2 ?? null,
    status: o.status as OrderRow['status'],
    orderedAt: o.orderedAt,
    collectedAt: o.collectedAt,
    totalAmount: o.totalAmount,
    isHeld: o.isHeld,
    holdReason: o.holdReason,
    logisticsMessage: (o as { logisticsMessage?: string | null }).logisticsMessage ?? null,
    shippingType: (o as { shippingType?: string | null }).shippingType ?? null,
    shippingFee: (o as { shippingFee?: string | null }).shippingFee ?? null,
    hasInquiries: (o as { hasInquiries?: boolean }).hasInquiries ?? false,
    claimType: o.claimType as OrderRow['claimType'],
    claimId: o.claimId ?? null,
    claimStatus: o.claimStatus as OrderRow['claimStatus'],
    claimReason: o.claimReason ?? null,
    historicalClaimStatuses: (o as { historicalClaimStatuses?: string[] }).historicalClaimStatuses ?? [],
    invoiceStatus: o.invoiceStatus as OrderRow['invoiceStatus'],
    trackingNumber: o.trackingNumber,
    carrierName: (o as { carrierName?: string | null }).carrierName ?? null,
    mappingStatus: o.mappingStatus,
    shipmentGroupId: (o as { shipmentGroupId?: string | null }).shipmentGroupId ?? null,
    shipmentGroupKey: (o as { shipmentGroupKey?: string | null }).shipmentGroupKey ?? null,
    scanStatus: (o as { scanStatus?: OrderRow['scanStatus'] }).scanStatus ?? null,
    scannedAt: (o as { scannedAt?: Date | string | null }).scannedAt ?? null,
    scanTrackingNumber: (o as { scanTrackingNumber?: string | null }).scanTrackingNumber ?? null,
    isCopy: (o as { isCopy?: boolean }).isCopy ?? false,
    items: o.items.map((item) => ({
      id: item.id,
      marketplaceItemId: item.marketplaceItemId,
      productName: item.productName,
      displayName: (item as { displayName?: string | null }).displayName ?? null,
      displayOptionName: (item as { displayOptionName?: string | null }).displayOptionName ?? null,
      lockedAt: (item as { lockedAt?: Date | string | null }).lockedAt ?? null,
      optionText: item.optionText,
      quantity: item.quantity,
      sku: item.sku ?? null,
      shippingCost: (item as { shippingCost?: string | null }).shippingCost ?? null,
      availableStock: (item as { availableStock?: number | null }).availableStock ?? null,
    })),
  }))

  return (
    <div className="space-y-2">
      {/* Compact header — title + count (Excel import entry-point removed in Phase 8) */}
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold">주문 관리</h1>
        {tabSelected && hasDateFilter && (
          <span className="text-sm text-muted-foreground">
            {total.toLocaleString('ko-KR')}건
          </span>
        )}
      </div>

      {/* Phase 8 — 9탭 통합 컴포넌트 (ClaimsFilter / stage-tabs 폐기) */}
      <Suspense>
        <OrderTabs />
      </Suspense>

      {/* Filters — marketplace / 날짜 / 검색 (W-3 유지) */}
      <Suspense>
        <OrderFilters marketplaceOptions={marketplaceOptions} />
      </Suspense>

      {/* Data Table — 탭 미선택 시 안내 문구로 대체 (쿼리 0번) */}
      {tabSelected && hasDateFilter ? (
        <DataTable
          data={data}
          total={total}
          page={params.page}
          pageSize={params.pageSize}
          showMappingAction={isNewTab}
          canUnlockOrderSnapshots={profile?.role === 'super_admin'}
        />
      ) : (
        <div className="rounded border bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground">
          위 탭(전체 · 신규 · 확인 · …)을 선택하면 주문이 조회됩니다.
        </div>
      )}
    </div>
  )
}
