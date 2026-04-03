import { Suspense } from 'react'
import {
  createSearchParamsCache,
  parseAsString,
  parseAsInteger,
} from 'nuqs/server'
import { getOrders } from '@/lib/orders/queries'
import { DataTable } from './data-table'
import { OrderFilters } from './filters'
import { ClaimsFilter } from './claims-filter'
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
})

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParamsCache.parse(searchParams)

  const { orders, total } = await getOrders({
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
  })

  // Map DB rows to OrderRow shape
  const data: OrderRow[] = orders.map((o) => ({
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
    items: o.items.map((item) => ({
      productName: item.productName,
      optionText: item.optionText,
      quantity: item.quantity,
    })),
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">주문 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          전체 {total.toLocaleString('ko-KR')}건의 주문
        </p>
      </div>

      {/* Claims filter tabs */}
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
      />
    </div>
  )
}
