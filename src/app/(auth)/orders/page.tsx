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
import { ClaimsFilter } from './claims-filter'
import type { OrderRow } from './columns'
import type { OrderFilters as OrderFiltersParams, OrderStage } from '@/lib/orders/types'
import type { ClaimType } from '@/lib/orders/types'
import type { Metadata } from 'next'

const STAGE_LABELS: Record<OrderStage, { title: string; desc: string }> = {
  prep: { title: '출고 준비', desc: '매핑이 필요하거나 몰 통보가 안된 주문입니다. 처리되면 송장 발급으로 이동합니다.' },
  mapping: { title: '매핑 필요', desc: '상품매핑이 완료되지 않은 주문입니다.' },
  confirm: { title: '확정 대기', desc: '자동 몰 통보 실패. 수동 재시도 필요.' },
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
  held: parseAsBoolean,
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
  const stage = (params.stage ?? undefined) as OrderStage | undefined

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
      stage,
      isHeld: params.held ?? undefined,
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
      optionText: item.optionText,
      quantity: item.quantity,
      sku: item.sku ?? null,
    })),
  }))

  const stageInfo = stage ? STAGE_LABELS[stage] : null
  const pageTitle = stageInfo?.title ?? '주문 관리'

  return (
    <div className="space-y-2">
      {/* Compact header — inline title + count + action */}
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold">{pageTitle}</h1>
        <span className="text-sm text-muted-foreground">
          {total.toLocaleString('ko-KR')}건
        </span>
        {stageInfo && (
          <span className="text-sm text-muted-foreground">· {stageInfo.desc}</span>
        )}
        {!stage && (
          <a
            href="/orders/import"
            className="ml-auto text-sm text-blue-600 hover:underline"
          >
            엑셀 업로드
          </a>
        )}
      </div>

      {/* CS-focused tab bar (only on 전체 view) */}
      {!stage && (
        <Suspense>
          <ClaimsFilter counts={stats} />
        </Suspense>
      )}

      {/* prep 하위 탭 — 전체 / 매핑 필요 / 확정 대기 */}
      {(stage === 'prep' || stage === 'mapping' || stage === 'confirm') && (
        <div className="flex gap-1 border-b text-sm">
          {[
            { s: 'prep' as OrderStage, label: '전체' },
            { s: 'mapping' as OrderStage, label: '매핑 필요' },
            { s: 'confirm' as OrderStage, label: '확정 대기' },
          ].map((tab) => (
            <a
              key={tab.s}
              href={`/orders?stage=${tab.s}`}
              className={`border-b-2 px-4 py-2 font-medium transition-colors ${
                stage === tab.s
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </a>
          ))}
        </div>
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
