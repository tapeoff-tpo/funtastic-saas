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
import type { OrderFilters as OrderFiltersParams, OrderStatus } from '@/lib/orders/types'
import { ORDER_STATUS_LABELS, type ClaimType } from '@/lib/orders/types'
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
  orderSource: parseAsString,
  dateField: parseAsString,
  dateFrom: parseAsString,
  dateTo: parseAsString,
  datePreset: parseAsString,
  sort: parseAsString,
  order: parseAsString,
  claimType: parseAsString,
  mapping: parseAsString,
  carrier: parseAsString,
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

const SCAN_FILTER_STATUSES = new Set(['preparing', 'ready', 'shipped'])

function parseStatusFilter(value: string | null): OrderStatus[] {
  if (!value) return []
  const validStatuses = new Set(Object.keys(ORDER_STATUS_LABELS))
  return value
    .split(',')
    .map((status) => status.trim())
    .filter((status): status is OrderStatus => validStatuses.has(status))
}

function parseCommaFilter(value: string | null): string[] {
  if (!value) return []
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ))
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
  const selectedStatuses = parseStatusFilter(params.status)
  const singleStatus = selectedStatuses.length === 1 ? selectedStatuses[0] : undefined
  const multipleStatuses = selectedStatuses.length > 1 ? selectedStatuses : undefined
  const selectedMarketplaces = parseCommaFilter(params.marketplace)
  const singleMarketplace = selectedMarketplaces.length === 1 ? selectedMarketplaces[0] : undefined
  const multipleMarketplaces = selectedMarketplaces.length > 1 ? selectedMarketplaces : undefined
  const connectionsPromise = db
    .select({
      marketplaceId: marketplaceConnections.marketplaceId,
      displayName: marketplaceConnections.displayName,
      isManual: marketplaceConnections.isManual,
    })
    .from(marketplaceConnections)
    .where(eq(marketplaceConnections.userId, workspaceUserId))

  const isNewTab = singleStatus === 'new'
  const isConfirmedTab = singleStatus === 'confirmed'
  const isScanFilterTab = selectedStatuses.length > 0 && selectedStatuses.every((status) => SCAN_FILTER_STATUSES.has(status))
  const isGeneralStatusTab = Boolean(params.status) && !params.claimType && !params.cancel && !params.held
  const needsMappingDetails = true
  const needsStockDetails = isNewTab || isConfirmedTab || isScanFilterTab
  const shouldExcludeHeld = !params.held && Boolean(params.status || params.claimType || params.cancel)
  const mappingFilter = params.mapping === 'all'
    ? undefined
    : ((params.mapping ?? undefined) as 'mapped' | 'unmapped' | undefined)

  // 탭 미선택(사이드바 진입 직후) — 어떤 쿼리도 실행하지 않는다.
  // 탭(전체/신규/.../반품) 클릭 시점에만 status/claimType/cancel/tab 중 하나가 붙어 fetch 시작.
  const tabSelected = true
  const shouldRunQuery = tabSelected && (hasDateFilter || Boolean(params.held))

  // 탭별 카운트(getOrderStats)는 매 조회마다 11개 status COUNT 쿼리를 추가로 실행해
  // 응답을 느리게 한다. 현재 선택된 탭의 total 만 헤더에 노출하면 충분하므로 제거.
  const ordersPromise = shouldRunQuery
    ? getOrders({
        page: params.page,
        pageSize: params.pageSize,
        userId: workspaceUserId,
        status: singleStatus,
        statuses: multipleStatuses as OrderFiltersParams['statuses'],
        marketplace: singleMarketplace,
        marketplaces: multipleMarketplaces,
        carrierId: params.carrier ?? undefined,
        search: params.search ?? undefined,
        searchField: (params.searchField ?? undefined) as OrderFiltersParams['searchField'],
        orderSource: (params.orderSource === 'saas' || params.orderSource === 'sabangnet')
          ? params.orderSource
          : undefined,
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
        excludeClaimLikeOrders: isGeneralStatusTab,
        includeMappingDetails: needsMappingDetails,
        includeStock: needsStockDetails,
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
    orderSourceType: (o as { orderSourceType?: OrderRow['orderSourceType'] }).orderSourceType ?? 'saas',
    connectionId: o.connectionId,
    marketplaceOrderId: o.marketplaceOrderId,
    marketplaceStatus: o.marketplaceStatus,
    marketplaceCollectionStatus: (o as { marketplaceCollectionStatus?: OrderRow['marketplaceCollectionStatus'] }).marketplaceCollectionStatus ?? null,
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
    claimRequestReason: (o as { claimRequestReason?: string | null }).claimRequestReason ?? null,
    claimRequestReasonRegisteredAt: (o as { claimRequestReasonRegisteredAt?: Date | string | null }).claimRequestReasonRegisteredAt
      ? new Date((o as { claimRequestReasonRegisteredAt: Date | string }).claimRequestReasonRegisteredAt).toISOString()
      : null,
    claimRequestReasonHistory: ((o as {
      claimRequestReasonHistory?: Array<{ reason: string; registeredAt: Date | string }>
    }).claimRequestReasonHistory ?? []).map((entry) => ({
      reason: entry.reason,
      registeredAt: new Date(entry.registeredAt).toISOString(),
    })),
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
        {shouldRunQuery && (
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
      {shouldRunQuery ? (
        <DataTable
          data={data}
          total={total}
          page={params.page}
          pageSize={params.pageSize}
          showMappingAction={isNewTab}
          showMappingColumn={isNewTab || isConfirmedTab}
          showScanColumn={isScanFilterTab}
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
