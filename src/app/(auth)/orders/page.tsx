import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import {
  createSearchParamsCache,
  parseAsString,
  parseAsInteger,
  parseAsBoolean,
} from 'nuqs/server'
import { createClient } from '@/lib/supabase/server'
import { getOrders, getOrderStats } from '@/lib/orders/queries'
import { DataTable } from './data-table'
import { OrderFilters } from './filters'
import { OrderTabs } from './order-tabs'
import type { OrderRow } from './columns'
import type { OrderFilters as OrderFiltersParams } from '@/lib/orders/types'
import type { ClaimType } from '@/lib/orders/types'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '주문 관리',
}

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(50),
  status: parseAsString,
  marketplace: parseAsString,
  search: parseAsString,
  dateFrom: parseAsString,
  dateTo: parseAsString,
  sort: parseAsString,
  order: parseAsString,
  claimType: parseAsString,
  mapping: parseAsString,
  held: parseAsBoolean,
  // Phase 8 — 취소 탭 통합 필터 (status='cancelled' OR claimType='cancel')
  cancel: parseAsBoolean,
})

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParamsCache.parse(searchParams)

  const [{ orders: orderList, total }, stats] = await Promise.all([
    getOrders({
      page: params.page,
      pageSize: params.pageSize,
      userId: user.id,
      status: (params.status ?? undefined) as OrderFiltersParams['status'],
      marketplace: params.marketplace ?? undefined,
      search: params.search ?? undefined,
      dateFrom: params.dateFrom ?? undefined,
      dateTo: params.dateTo ?? undefined,
      sort: params.sort ?? undefined,
      order: (params.order as 'asc' | 'desc') ?? undefined,
      claimType: (params.claimType ?? undefined) as ClaimType | undefined,
      mapping: (params.mapping ?? undefined) as 'mapped' | 'unmapped' | undefined,
      isHeld: params.held ?? undefined,
      cancelTab: params.cancel ?? undefined,
    }),
    getOrderStats(user.id),
  ])

  const data: OrderRow[] = orderList.map((o) => ({
    id: o.id,
    marketplaceId: o.marketplaceId,
    marketplaceOrderId: o.marketplaceOrderId,
    buyerName: o.buyerName,
    buyerPhone: o.buyerPhone,
    recipientName: o.recipientName,
    recipientPhone: o.recipientPhone,
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
    invoiceStatus: o.invoiceStatus as OrderRow['invoiceStatus'],
    trackingNumber: o.trackingNumber,
    carrierName: (o as { carrierName?: string | null }).carrierName ?? null,
    mappingStatus: o.mappingStatus,
    shipmentGroupId: (o as { shipmentGroupId?: string | null }).shipmentGroupId ?? null,
    shipmentGroupKey: (o as { shipmentGroupKey?: string | null }).shipmentGroupKey ?? null,
    items: o.items.map((item) => ({
      productName: item.productName,
      displayName: (item as { displayName?: string | null }).displayName ?? null,
      optionText: item.optionText,
      quantity: item.quantity,
      sku: item.sku ?? null,
      shippingCost: (item as { shippingCost?: string | null }).shippingCost ?? null,
    })),
  }))

  // OrderTabs counts — map OrderStats (server) → OrderTabsCounts (component)
  const orderTabsCounts = {
    all: stats.total ?? 0,
    new: stats.new,
    confirmed: stats.confirmed,
    preparing: stats.preparing,
    ready: stats.ready,
    shipped: stats.shipped,
    delivering: stats.delivering,
    delivered: stats.delivered,
    // 취소 탭 = status='cancelled' OR claimType='cancel' distinct (B-3)
    cancelled: stats.cancelTabCount,
    exchange: stats.claimExchange,
    return: stats.claimReturn,
  }

  return (
    <div className="space-y-2">
      {/* Compact header — title + count (Excel import entry-point removed in Phase 8) */}
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold">주문 관리</h1>
        <span className="text-sm text-muted-foreground">
          {total.toLocaleString('ko-KR')}건
        </span>
      </div>

      {/* Phase 8 — 9탭 통합 컴포넌트 (ClaimsFilter / stage-tabs 폐기) */}
      <Suspense>
        <OrderTabs counts={orderTabsCounts} />
      </Suspense>

      {/* Filters — marketplace / 날짜 / 검색 (W-3 유지) */}
      <Suspense>
        <OrderFilters />
      </Suspense>

      {/* Data Table */}
      <DataTable
        data={data}
        total={total}
        page={params.page}
        pageSize={params.pageSize}
      />
    </div>
  )
}
