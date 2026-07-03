import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getPurchaseRequests } from '@/lib/purchasing/purchase-requests'
import {
  getNextPurchaseStatus,
  PURCHASE_REQUEST_STATUS_LABELS,
  type PurchaseRequestStatus,
} from '@/lib/purchasing/purchase-request-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  PurchaseBulkSelectionProvider,
  PurchaseBulkStatusButton,
  PurchaseDeleteButton,
  PurchasePlanFields,
  PurchaseRecommendationGenerator,
  PurchaseRowCheckbox,
  PurchaseSelectAllCheckbox,
  PurchaseStatusButton,
} from './purchase-request-actions'

export const metadata: Metadata = {
  title: '발주',
}

const STATUSES = Object.keys(PURCHASE_REQUEST_STATUS_LABELS) as PurchaseRequestStatus[]

export default async function PurchasingOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const status = parseStatus(stringParam(params.status)) ?? 'requested'
  const search = stringParam(params.search)
  const page = Math.max(1, Number(stringParam(params.page) ?? '1') || 1)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const { items, total, statusCounts } = await getPurchaseRequests({
    userId: workspaceUserId,
    status,
    search: search ?? undefined,
    page,
    pageSize: 50,
  })
  const nextStatus = getNextPurchaseStatus(status)

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">발주</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            재고와 출고 이력을 기준으로 구매가 필요한 품목을 추천하고, 구매부터 중국창고 입고까지 관리합니다.
          </p>
        </div>
        <form className="flex items-center gap-2" action="/purchasing/orders">
          <input type="hidden" name="status" value={status} />
          <input
            name="search"
            defaultValue={search ?? ''}
            placeholder="품목코드, 상품명, 주문번호"
            className="h-8 w-64 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button type="submit" variant="outline">검색</Button>
        </form>
      </header>

      <PurchaseRecommendationGenerator />

      <nav className="flex flex-wrap gap-2">
        {STATUSES.map((item) => {
          const active = item === status
          const href = `/purchasing/orders?status=${item}${search ? `&search=${encodeURIComponent(search)}` : ''}`
          return (
            <Link
              key={item}
              href={href}
              className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm ${
                active ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:bg-muted'
              }`}
            >
              {PURCHASE_REQUEST_STATUS_LABELS[item]}
              <span className={active ? 'text-background/70' : 'text-muted-foreground'}>
                {(statusCounts[item] ?? 0).toLocaleString('ko-KR')}
              </span>
            </Link>
          )
        })}
      </nav>

      <PurchaseBulkSelectionProvider ids={items.map((item) => item.id)} nextStatus={nextStatus}>
        <section className="overflow-hidden rounded-md border bg-background">
          <div className="flex flex-col gap-2 border-b px-3 py-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold">{PURCHASE_REQUEST_STATUS_LABELS[status]} 목록</h2>
              <p className="text-xs text-muted-foreground">총 {total.toLocaleString('ko-KR')}건</p>
            </div>
            <PurchaseBulkStatusButton />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1780px] text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="w-12 px-3 py-2 font-medium">
                    <PurchaseSelectAllCheckbox />
                  </th>
                  <th className="w-28 px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium">상품</th>
                  <th className="w-24 px-3 py-2 font-medium">요청수량</th>
                  <th className="w-48 px-3 py-2 font-medium">추천 근거</th>
                  <th className="w-32 px-3 py-2 font-medium">입고요청일</th>
                  <th className="w-32 px-3 py-2 font-medium">관리코드</th>
                  <th className="w-[540px] px-3 py-2 font-medium">발주 계획</th>
                  <th className="w-28 px-3 py-2 font-medium">담당자</th>
                  <th className="w-48 px-3 py-2 font-medium">상태 변경</th>
                  <th className="w-24 px-3 py-2 font-medium">삭제</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-12 text-center text-sm text-muted-foreground">
                      조건에 맞는 발주 항목이 없습니다.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-2">
                        <PurchaseRowCheckbox id={item.id} />
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={item.status === 'completed' ? 'default' : 'secondary'}>
                          {PURCHASE_REQUEST_STATUS_LABELS[item.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.sku}{item.optionName ? ` · ${item.optionName}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {item.requestedQuantity.toLocaleString('ko-KR')}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        <RecommendationBasis rawData={item.rawData} />
                      </td>
                      <td className="px-3 py-2">{formatDate(item.chinaArrivalRequestDate)}</td>
                      <td className="px-3 py-2">{item.purchaseManagementCode ?? '-'}</td>
                      <td className="px-3 py-2">
                        <PurchasePlanFields
                          id={item.id}
                          supplierOrderNumber={item.supplierOrderNumber}
                          outboundExpectedDate={item.outboundExpectedDate}
                          purchaseMethod={item.purchaseMethod}
                          purchaseConfirmed={item.purchaseConfirmed}
                        />
                      </td>
                      <td className="px-3 py-2">{item.buyerName ?? item.managerCode ?? '-'}</td>
                      <td className="px-3 py-2">
                        <PurchaseStatusButton id={item.id} nextStatus={getNextPurchaseStatus(item.status)} />
                      </td>
                      <td className="px-3 py-2">
                        <PurchaseDeleteButton id={item.id} productName={item.productName} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </PurchaseBulkSelectionProvider>
    </div>
  )
}

function RecommendationBasis({ rawData }: { rawData: Record<string, unknown> }) {
  if (rawData.source !== 'auto_purchase_recommendation') return <span>-</span>

  return (
    <div className="space-y-0.5 tabular-nums">
      <div>3개월 평균 {formatNumber(rawData.averageMonthlyOutgoing)}개/月</div>
      <div>당월 출고 {formatNumber(rawData.currentMonthOutgoing)}개</div>
      <div>현재고 {formatNumber(rawData.availableStock)}개 · 목표 {formatNumber(rawData.targetStockQuantity)}개</div>
    </div>
  )
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parseStatus(value: string | undefined): PurchaseRequestStatus | null {
  if (!value) return null
  return STATUSES.includes(value as PurchaseRequestStatus) ? value as PurchaseRequestStatus : null
}

function formatDate(value: string | Date | null) {
  if (!value) return '-'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value
}

function formatNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
}
