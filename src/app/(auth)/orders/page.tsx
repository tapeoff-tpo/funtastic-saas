import { Suspense } from 'react'
import {
  createSearchParamsCache,
  parseAsString,
  parseAsInteger,
} from 'nuqs/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, orderItems, shipments, productNameMappings, products, productVariants } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { getOrders, matchStage } from '@/lib/orders/queries'
import { DataTable } from './data-table'
import { OrderFilters } from './filters'
import { ClaimsFilter } from './claims-filter'
import { StageTabs } from './stage-tabs'
import type { OrderRow } from './columns'
import type { OrderFilters as OrderFiltersParams, MappingStatus, OrderStage } from '@/lib/orders/types'
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
  stage: parseAsString,
})

/** 각 단계별 건수 계산 (전체 사용자 주문 기준, 필터 무관) */
async function computeStageCounts(userId: string): Promise<Record<OrderStage | 'all', number>> {
  // Fetch all active orders (not cancelled/delivered) with required fields
  const orderRows = await db
    .select({
      id: orders.id,
      marketplaceId: orders.marketplaceId,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.userId, userId))

  const orderIds = orderRows.map((o) => o.id)
  if (orderIds.length === 0) {
    return { all: 0, mapping: 0, confirm: 0, invoice: 0, shipping: 0, done: 0 }
  }

  const [itemRows, shipmentRows, nameMappings, productSkus, variantSkus] = await Promise.all([
    db.select({ orderId: orderItems.orderId, productName: orderItems.productName, sku: orderItems.sku })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds)),
    db.select({ orderId: shipments.orderId, trackingNumber: shipments.trackingNumber })
      .from(shipments)
      .where(inArray(shipments.orderId, orderIds)),
    db.select({ marketplaceId: productNameMappings.marketplaceId, marketplaceName: productNameMappings.marketplaceName })
      .from(productNameMappings)
      .where(eq(productNameMappings.userId, userId)),
    db.select({ sku: products.internalSku }).from(products).where(eq(products.userId, userId)),
    db.select({ sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(products.userId, userId)),
  ])

  const nameKeys = new Set(nameMappings.map((m) => `${m.marketplaceId}::${m.marketplaceName}`))
  const skuSet = new Set<string>()
  for (const p of productSkus) skuSet.add(p.sku)
  for (const v of variantSkus) skuSet.add(v.sku)

  const itemsByOrderId = new Map<string, typeof itemRows>()
  for (const it of itemRows) {
    const arr = itemsByOrderId.get(it.orderId) ?? []
    arr.push(it)
    itemsByOrderId.set(it.orderId, arr)
  }

  const trackingByOrderId = new Map<string, string | null>()
  for (const s of shipmentRows) {
    if (!trackingByOrderId.has(s.orderId) || s.trackingNumber) {
      trackingByOrderId.set(s.orderId, s.trackingNumber)
    }
  }

  const getMappingStatus = (mid: string, items: typeof itemRows): MappingStatus => {
    if (items.length === 0) return 'unmapped'
    let mapped = 0
    for (const it of items) {
      const nameMatch = nameKeys.has(`${mid}::${it.productName}`)
      const skuMatch = it.sku ? skuSet.has(it.sku.trim()) : false
      if (nameMatch || skuMatch) mapped++
    }
    if (mapped === items.length) return 'mapped'
    if (mapped === 0) return 'unmapped'
    return 'partial'
  }

  const counts = { all: orderRows.length, mapping: 0, confirm: 0, invoice: 0, shipping: 0, done: 0 }

  for (const o of orderRows) {
    const items = itemsByOrderId.get(o.id) ?? []
    const mappingStatus = getMappingStatus(o.marketplaceId, items)
    const trackingNumber = trackingByOrderId.get(o.id) ?? null
    const enriched = { status: o.status, mappingStatus, trackingNumber }
    if (matchStage(enriched, 'mapping')) counts.mapping++
    if (matchStage(enriched, 'confirm')) counts.confirm++
    if (matchStage(enriched, 'invoice')) counts.invoice++
    if (matchStage(enriched, 'shipping')) counts.shipping++
    if (matchStage(enriched, 'done')) counts.done++
  }

  return counts
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParamsCache.parse(searchParams)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const stageCounts = await computeStageCounts(user.id)

  const { orders: orderList, total } = await getOrders({
    page: params.page,
    pageSize: params.pageSize,
    status: (params.status ?? undefined) as OrderFiltersParams['status'],
    marketplace: params.marketplace ?? undefined,
    search: params.search ?? undefined,
    dateFrom: params.dateFrom ?? undefined,
    dateTo: params.dateTo ?? undefined,
    sort: params.sort ?? undefined,
    order: (params.order as 'asc' | 'desc') ?? undefined,
    claimType: (params.claimType ?? undefined) as ClaimType | undefined,
    mapping: (params.mapping ?? undefined) as 'mapped' | 'unmapped' | undefined,
    stage: (params.stage ?? undefined) as OrderStage | undefined,
  })

  const data: OrderRow[] = orderList.map((o) => ({
    id: o.id,
    marketplaceId: o.marketplaceId,
    marketplaceOrderId: o.marketplaceOrderId,
    buyerName: o.buyerName,
    status: o.status as OrderRow['status'],
    orderedAt: o.orderedAt,
    totalAmount: o.totalAmount,
    isHeld: o.isHeld,
    holdReason: o.holdReason,
    claimType: o.claimType as OrderRow['claimType'],
    invoiceStatus: o.invoiceStatus as OrderRow['invoiceStatus'],
    trackingNumber: o.trackingNumber,
    mappingStatus: o.mappingStatus,
    items: o.items.map((item) => ({
      productName: item.productName,
      optionText: item.optionText,
      quantity: item.quantity,
    })),
  }))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">주문 관리</h1>
        <div className="flex items-center gap-4">
          <p className="mt-1 text-sm text-muted-foreground">
            전체 {total.toLocaleString('ko-KR')}건의 주문
          </p>
          <a
            href="/orders/import"
            className="text-sm text-blue-600 hover:underline"
          >
            엑셀 업로드
          </a>
        </div>
      </div>

      {/* Workflow stage tabs */}
      <Suspense>
        <StageTabs counts={stageCounts} />
      </Suspense>

      {/* Claims filter */}
      <Suspense>
        <ClaimsFilter />
      </Suspense>

      {/* Filters */}
      <Suspense>
        <OrderFilters />
      </Suspense>

      {/* Data Table */}
      <DataTable
        data={data}
        total={total}
        page={params.page}
        pageSize={params.pageSize}
        stage={(params.stage ?? undefined) as OrderStage | undefined}
      />
    </div>
  )
}
