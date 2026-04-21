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
import type { OrderFilters as OrderFiltersParams, OrderStage } from '@/lib/orders/types'
import type { ClaimType } from '@/lib/orders/types'
import type { Metadata } from 'next'

const STAGE_LABELS: Record<OrderStage, { title: string; desc: string }> = {
  mapping: { title: '매핑 필요', desc: '상품매핑이 완료되지 않은 주문입니다. 매핑 후 확정 대기로 이동합니다.' },
  confirm: { title: '확정 대기', desc: '매핑 완료된 신규 주문. 발주확인(신규→주문확인)을 진행하세요.' },
  invoice: { title: '송장 발급', desc: '주문확인 완료. 택배사별 엑셀을 다운받아 송장번호를 등록하세요.' },
  shipping: { title: '출고 대기', desc: '송장번호가 등록됨. 출고 후 몰에 송장번호를 전송하세요.' },
  done: { title: '완료', desc: '출고/배송 완료된 주문입니다.' },
}

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

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParamsCache.parse(searchParams)
  const stage = (params.stage ?? undefined) as OrderStage | undefined

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
    stage,
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

  const stageInfo = stage ? STAGE_LABELS[stage] : null
  const pageTitle = stageInfo?.title ?? '주문 관리'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{pageTitle}</h1>
        <div className="mt-1 flex items-center gap-4">
          <p className="text-sm text-muted-foreground">
            {stageInfo?.desc ?? `전체 ${total.toLocaleString('ko-KR')}건의 주문`}
          </p>
          {!stage && (
            <a
              href="/orders/import"
              className="text-sm text-blue-600 hover:underline"
            >
              엑셀 업로드
            </a>
          )}
        </div>
        {stageInfo && (
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString('ko-KR')}건
          </p>
        )}
      </div>

      {/* Claims filter (only show on 전체) */}
      {!stage && (
        <Suspense>
          <ClaimsFilter />
        </Suspense>
      )}

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
        stage={stage}
      />
    </div>
  )
}
