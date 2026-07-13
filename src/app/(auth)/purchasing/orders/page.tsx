import Link from 'next/link'
import type { Metadata } from 'next'
import { Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { calculatePurchaseCosts } from '@/lib/purchasing/purchase-costs'
import { isPurchaseDelayTrackingDate } from '@/lib/purchasing/purchase-delay'
import { getOutboundRequestedQuantity, getPurchaseRequests } from '@/lib/purchasing/purchase-requests'
import {
  getNextPurchaseStatus,
  PURCHASE_REQUEST_STATUSES,
  PURCHASE_REQUEST_STATUS_LABELS,
  type PurchaseRequestStatus,
} from '@/lib/purchasing/purchase-request-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  PurchaseBulkBuyerApply,
  PurchaseBulkDeleteButton,
  PurchaseBulkSelectionProvider,
  PurchaseBulkStatusButton,
  PurchaseBuyerField,
  PurchaseDeleteButton,
  PurchasePlanFieldsV2,
  PurchaseQuantityField,
  PurchaseRecommendationGenerator,
  PurchaseRequestExcelActions,
  PurchaseRowCheckbox,
  PurchaseSelectAllCheckbox,
  PurchaseStatusButton,
} from './purchase-request-actions'

export const metadata: Metadata = {
  title: '발주',
}

const ORDER_STATUSES = PURCHASE_REQUEST_STATUSES.filter((status) => status !== 'requested')

export default async function PurchasingOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <PurchasingOrdersView
      searchParams={searchParams}
      defaultStatus="purchased"
      allowedStatuses={ORDER_STATUSES}
      basePath="/purchasing/orders"
      title="발주"
      description="발주요청부터 구매완료, 중국창고도착, 중국출고요청, 중국출고완료까지 한 화면에서 관리합니다."
    />
  )
}

export async function PurchasingOrdersView({
  searchParams,
  defaultStatus,
  allowedStatuses,
  basePath,
  title,
  description,
  showRecommendationGenerator = false,
  overdueOnly = false,
  showStatusTabs = true,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
  defaultStatus: PurchaseRequestStatus
  allowedStatuses: readonly PurchaseRequestStatus[]
  basePath: string
  title: string
  description: string
  showRecommendationGenerator?: boolean
  overdueOnly?: boolean
  showStatusTabs?: boolean
}) {
  const params = await searchParams
  const status = parseStatus(stringParam(params.status), allowedStatuses) ?? defaultStatus
  const search = stringParam(params.search)
  const page = Math.max(1, Number(stringParam(params.page) ?? '1') || 1)
  const showCosts = stringParam(params.showCosts) === '1'
  const sort = stringParam(params.sort)
  const order = parseOrder(stringParam(params.order)) ?? 'desc'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const {
    items,
    total,
    costTotals,
    statusCounts,
    overduePurchasedCount,
    overduePurchaseRequestCount,
    overduePurchaseCompletedCount,
    overdueTotalCount,
  } = await getPurchaseRequests({
    userId: workspaceUserId,
    status: overdueOnly ? undefined : status,
    overdueOnly,
    search: search ?? undefined,
    page,
    pageSize: 50,
    sort: sort ?? undefined,
    order,
  })
  const nextStatus = getNextPurchaseStatus(status)
  const quantityColumn = getStageQuantityColumn(status)
  const isRequestedStatus = status === 'requested'
  const recommendationBasisParam = stringParam(params.showRecommendationBasis)
  const showRecommendationBasis = recommendationBasisParam === undefined
    ? isRequestedStatus
    : recommendationBasisParam === '1'
  const pageSize = 50
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(total, page * pageSize)
  const visibleColumnCount =
    8 +
    (showCosts ? 4 : 0) +
    (showRecommendationBasis ? 1 : 0) +
    (isRequestedStatus ? 0 : 2)
  const listLabel = overdueOnly ? title : PURCHASE_REQUEST_STATUS_LABELS[status]
  const costToggleParams = new URLSearchParams({ status })
  if (search) costToggleParams.set('search', search)
  if (page > 1) costToggleParams.set('page', String(page))
  if (sort) costToggleParams.set('sort', sort)
  if (order) costToggleParams.set('order', order)
  costToggleParams.set('showRecommendationBasis', showRecommendationBasis ? '1' : '0')
  if (!showCosts) costToggleParams.set('showCosts', '1')
  const costToggleHref = `${basePath}?${costToggleParams.toString()}`
  const basisToggleParams = new URLSearchParams({ status })
  if (search) basisToggleParams.set('search', search)
  if (page > 1) basisToggleParams.set('page', String(page))
  if (sort) basisToggleParams.set('sort', sort)
  if (order) basisToggleParams.set('order', order)
  if (showCosts) basisToggleParams.set('showCosts', '1')
  basisToggleParams.set('showRecommendationBasis', showRecommendationBasis ? '0' : '1')
  const basisToggleHref = `${basePath}?${basisToggleParams.toString()}`
  const excelExportParams = new URLSearchParams()
  if (!overdueOnly) excelExportParams.set('status', status)
  if (overdueOnly) excelExportParams.set('overdueOnly', '1')
  if (search) excelExportParams.set('search', search)
  const excelExportHref = `/api/purchasing/purchase-requests/export?${excelExportParams.toString()}`

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <form className="flex items-center gap-2" action={basePath}>
          <input type="hidden" name="status" value={status} />
          {showCosts ? <input type="hidden" name="showCosts" value="1" /> : null}
          <input type="hidden" name="showRecommendationBasis" value={showRecommendationBasis ? '1' : '0'} />
          {sort ? <input type="hidden" name="sort" value={sort} /> : null}
          {order ? <input type="hidden" name="order" value={order} /> : null}
          <input
            name="search"
            defaultValue={search ?? ''}
            placeholder="품목코드, 상품명, 주문번호"
            className="h-8 w-64 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button type="submit" variant="outline">검색</Button>
        </form>
      </header>

      {showRecommendationGenerator ? <PurchaseRecommendationGenerator /> : null}

      {!overdueOnly && status === 'purchased' && overduePurchaseRequestCount > 0 ? (
        <section className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <strong>구매 지연 확인 필요</strong>
          <span className="ml-2">
            2026년 7월 1일 이후 발주요청 중 날짜 기준 7일이 지난 항목 {overduePurchaseRequestCount.toLocaleString('ko-KR')}건이 있습니다.
            지연 항목은 빨간색으로 표시되며 구매/입고지연 메뉴에서 따로 볼 수 있습니다.
          </span>
        </section>
      ) : null}

      {!overdueOnly && status === 'purchase_completed' && overduePurchasedCount > 0 ? (
        <section className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <strong>도착 지연 확인 필요</strong>
          <span className="ml-2">
            구매날짜 기준 7일이 지난 항목 {overduePurchasedCount.toLocaleString('ko-KR')}건이 있습니다.
            지연 항목은 빨간색으로 표시되며 구매/입고지연 메뉴에서 따로 볼 수 있습니다.
          </span>
        </section>
      ) : null}

      {overdueOnly && overdueTotalCount > 0 ? (
        <section className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <strong>구매/입고지연</strong>
          <span className="ml-2">
            발주요청 지연 {overduePurchaseRequestCount.toLocaleString('ko-KR')}건,
            구매완료 입고지연 {overduePurchaseCompletedCount.toLocaleString('ko-KR')}건입니다.
          </span>
        </section>
      ) : null}

      <section className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border bg-muted/20 px-3 py-2">
        <span className="text-sm font-medium">
          {listLabel} 총 구매금액
        </span>
        <span className="text-sm tabular-nums">
          <span className="text-muted-foreground">元 </span>
          <strong>{formatCost(costTotals.totalCostYuan, 2)}</strong>
        </span>
        <span className="text-sm tabular-nums">
          <span className="text-muted-foreground">₩ </span>
          <strong>{formatCost(costTotals.totalCostKrw, 0)}</strong>
        </span>
        {costTotals.missingYuanCostCount > 0 || costTotals.missingKrwCostCount > 0 ? (
          <span className="text-xs text-amber-700">
            원가 누락: 元 {costTotals.missingYuanCostCount.toLocaleString('ko-KR')}건 / ₩ {costTotals.missingKrwCostCount.toLocaleString('ko-KR')}건
          </span>
        ) : null}
      </section>

      {showStatusTabs ? (
      <nav className="flex flex-wrap gap-2">
        {allowedStatuses.map((item) => {
          const active = item === status
          const href = purchaseOrdersHref({
            basePath,
            status: item,
            search,
            showCosts,
            showRecommendationBasis,
            sort,
            order,
          })
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
      ) : null}

      <PurchaseBulkSelectionProvider ids={items.map((item) => item.id)} nextStatus={nextStatus}>
        <section className="overflow-hidden rounded-md border bg-background">
          <div className="flex flex-col gap-2 border-b px-3 py-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold">{listLabel} 목록</h2>
              <p className="text-xs text-muted-foreground">총 {total.toLocaleString('ko-KR')}건</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <PurchaseRequestExcelActions exportHref={excelExportHref} defaultStatus={status} />
              {isRequestedStatus ? <PurchaseBulkBuyerApply /> : null}
              <Link
                href={costToggleHref}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap hover:bg-muted"
              >
                {showCosts ? <EyeOff /> : <Eye />}
                {showCosts ? '원가 닫기' : '원가 보기'}
              </Link>
              <Link
                href={basisToggleHref}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap hover:bg-muted"
              >
                {showRecommendationBasis ? <EyeOff /> : <Eye />}
                {showRecommendationBasis ? '추천근거 닫기' : '추천근거 보기'}
              </Link>
              <PurchaseBulkDeleteButton />
              {overdueOnly ? null : <PurchaseBulkStatusButton />}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full table-auto text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-20 w-px whitespace-nowrap bg-muted px-3 py-2 text-center font-medium">
                    <PurchaseSelectAllCheckbox />
                  </th>
                  <th className="sticky left-12 z-20 w-px whitespace-nowrap bg-muted px-3 py-2 text-center font-medium">No.</th>
                  <th className="w-px whitespace-nowrap px-2 py-2 text-center font-medium">
                    <SortHeader label="상태" column="status" status={status} search={search} showCosts={showCosts} showRecommendationBasis={showRecommendationBasis} currentSort={sort} currentOrder={order} basePath={basePath} align="center" />
                  </th>
                  <th className="min-w-[280px] px-3 py-2 font-medium">
                    <SortHeader label="상품" column="productName" status={status} search={search} showCosts={showCosts} showRecommendationBasis={showRecommendationBasis} currentSort={sort} currentOrder={order} basePath={basePath} />
                  </th>
                  <th className="w-px whitespace-nowrap px-2 py-2 text-center font-medium">
                    <SortHeader label={quantityColumn.label} column="requestedQuantity" status={status} search={search} showCosts={showCosts} showRecommendationBasis={showRecommendationBasis} currentSort={sort} currentOrder={order} basePath={basePath} align="center" />
                  </th>
                  {showCosts ? (
                    <>
                      <th className="w-px whitespace-nowrap px-3 py-2 text-right font-medium">
                        <SortHeader label="개당 원가(元)" column="unitCostYuan" status={status} search={search} showCosts={showCosts} showRecommendationBasis={showRecommendationBasis} currentSort={sort} currentOrder={order} basePath={basePath} align="right" />
                      </th>
                      <th className="w-px whitespace-nowrap px-3 py-2 text-right font-medium">
                        <SortHeader label="개당 원가(₩)" column="unitCostKrw" status={status} search={search} showCosts={showCosts} showRecommendationBasis={showRecommendationBasis} currentSort={sort} currentOrder={order} basePath={basePath} align="right" />
                      </th>
                      <th className="w-px whitespace-nowrap px-3 py-2 text-right font-medium">
                        <SortHeader label="총 원가(元)" column="totalCostYuan" status={status} search={search} showCosts={showCosts} showRecommendationBasis={showRecommendationBasis} currentSort={sort} currentOrder={order} basePath={basePath} align="right" />
                      </th>
                      <th className="w-px whitespace-nowrap px-3 py-2 text-right font-medium">
                        <SortHeader label="총 원가(₩)" column="totalCostKrw" status={status} search={search} showCosts={showCosts} showRecommendationBasis={showRecommendationBasis} currentSort={sort} currentOrder={order} basePath={basePath} align="right" />
                      </th>
                    </>
                  ) : null}
                  {showRecommendationBasis ? <th className="min-w-[360px] px-3 py-2 text-center font-medium">추천근거</th> : null}
                  {isRequestedStatus ? null : (
                    <th className="w-px whitespace-nowrap px-2 py-2 text-center font-medium">
                      <SortHeader label="구입관리코드" column="purchaseManagementCode" status={status} search={search} showCosts={showCosts} showRecommendationBasis={showRecommendationBasis} currentSort={sort} currentOrder={order} basePath={basePath} align="center" />
                    </th>
                  )}
                  {isRequestedStatus ? null : <th className="min-w-[430px] px-3 py-2 font-medium">구매 정보</th>}
                  <th className="w-px whitespace-nowrap px-2 py-2 text-center font-medium">
                    <SortHeader label="담당자" column="buyerName" status={status} search={search} showCosts={showCosts} showRecommendationBasis={showRecommendationBasis} currentSort={sort} currentOrder={order} basePath={basePath} align="center" />
                  </th>
                  <th className="w-px whitespace-nowrap px-2 py-2 text-center font-medium">상태 변경</th>
                  <th className="w-px whitespace-nowrap px-2 py-2 text-center font-medium">삭제</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnCount} className="px-3 py-12 text-center text-sm text-muted-foreground">
                      조건에 맞는 발주 항목이 없습니다.
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) => {
                    const rowNumber = (page - 1) * pageSize + index + 1
                    const outboundRequestedQuantity = getOutboundRequestedQuantity(item)
                    const stageQuantity = getStageQuantity(item, item.status, outboundRequestedQuantity)
                    const requestDateElapsedDays = item.requestDate ? daysSinceDateOnly(item.requestDate) : 0
                    const purchaseDateElapsedDays = item.outboundExpectedDate ? daysSinceDateOnly(item.outboundExpectedDate) : 0
                    const isPurchaseRequestOverdue = item.status === 'purchased'
                      && isPurchaseDelayTrackingDate(item.requestDate)
                      && requestDateElapsedDays >= 7
                    const isArrivalOverdue = item.status === 'purchase_completed' && purchaseDateElapsedDays >= 7
                    const isOverdueRow = isPurchaseRequestOverdue || isArrivalOverdue
                    const stickyCellClassName = isOverdueRow ? 'bg-red-50' : 'bg-background'
                    const costs = calculatePurchaseCosts({
                      requestedQuantity: item.requestedQuantity,
                      unitCostYuan: item.unitCostYuan,
                      unitCostKrw: item.unitCostKrw,
                    })
                    return (
                      <tr key={item.id} className={`border-t align-middle ${isOverdueRow ? 'bg-red-50/80' : ''}`}>
                      <td className={`sticky left-0 z-10 px-3 py-2 text-center align-middle ${stickyCellClassName}`}>
                        <PurchaseRowCheckbox id={item.id} />
                      </td>
                      <td className={`sticky left-12 z-10 px-3 py-2 text-center text-xs text-muted-foreground tabular-nums align-middle ${stickyCellClassName}`}>
                        {rowNumber.toLocaleString('ko-KR')}
                      </td>
                      <td className="px-2 py-2 text-center align-middle">
                        <Badge variant={item.status === 'completed' ? 'default' : 'secondary'}>
                          {PURCHASE_REQUEST_STATUS_LABELS[item.status]}
                        </Badge>
                        {isPurchaseRequestOverdue ? (
                          <div className="mt-1">
                            <Badge
                              className="max-w-full border-red-200 bg-red-100 px-1.5 text-[11px] text-red-800 hover:bg-red-100"
                              title={`발주요청 날짜 기준 ${requestDateElapsedDays}일 경과`}
                            >
                              {requestDateElapsedDays}일 지연
                            </Badge>
                          </div>
                        ) : null}
                        {isArrivalOverdue ? (
                          <div className="mt-1">
                            <Badge
                              className="max-w-full border-red-200 bg-red-100 px-1.5 text-[11px] text-red-800 hover:bg-red-100"
                              title={`구매날짜 기준 ${purchaseDateElapsedDays}일 경과`}
                            >
                              {purchaseDateElapsedDays}일 지연
                            </Badge>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="truncate font-medium" title={item.productName}>{item.productName}</div>
                        <div className="truncate text-xs text-muted-foreground" title={`${item.sku}${item.optionName ? ` · ${item.optionName}` : ''}`}>
                          {item.sku}{item.optionName ? ` · ${item.optionName}` : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums align-middle">
                        <PurchaseQuantityField
                          id={item.id}
                          field={quantityColumn.field}
                          quantity={stageQuantity}
                          stockLimit={item.status === 'outbound_requested' ? item.chinaCurrentStock : undefined}
                          costSummary={isRequestedStatus ? {
                            unitCostYuan: costs.unitCostYuan,
                            unitCostKrw: costs.unitCostKrw,
                          } : undefined}
                        />
                      </td>
                      {showCosts ? (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCost(costs.unitCostYuan, 2)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCost(costs.unitCostKrw, 0)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCost(costs.totalCostYuan, 2)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCost(costs.totalCostKrw, 0)}</td>
                        </>
                      ) : null}
                      {showRecommendationBasis ? (
                        <td className="px-3 py-2 text-xs text-muted-foreground align-middle">
                          <RecommendationBasisGrid rawData={item.rawData} />
                        </td>
                      ) : null}
                      {isRequestedStatus ? null : (
                        <td className="px-3 py-2 text-center align-middle">{item.purchaseManagementCode ?? '-'}</td>
                      )}
                      {isRequestedStatus ? null : (
                        <td className="px-3 py-2 align-middle">
                          <PurchasePlanFieldsV2
                            id={item.id}
                            supplierOrderNumber={item.supplierOrderNumber}
                            dateValue={item.status === 'purchased' ? item.requestDate : item.outboundExpectedDate}
                            dateField={item.status === 'purchased' ? 'requestDate' : 'outboundExpectedDate'}
                            dateLabel={item.status === 'purchased' ? '발주요청 날짜' : '구매날짜'}
                            purchaseMethod={item.purchaseMethod}
                          />
                        </td>
                      )}
                      <td className="px-2 py-2 text-center align-middle">
                        <PurchaseBuyerField id={item.id} buyerCode={item.buyerCode ?? item.managerCode} />
                      </td>
                      <td className="px-3 py-2 text-center align-middle">
                        <PurchaseStatusButton id={item.id} nextStatus={getNextPurchaseStatus(item.status)} />
                      </td>
                      <td className="px-3 py-2 text-center align-middle">
                        <PurchaseDeleteButton id={item.id} productName={item.productName} />
                      </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 border-t px-3 py-2 text-sm md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-muted-foreground">
              {pageStart.toLocaleString('ko-KR')}-{pageEnd.toLocaleString('ko-KR')} / {total.toLocaleString('ko-KR')}건
            </div>
            <div className="flex items-center justify-end gap-2">
              <Link
                href={purchaseOrdersHref({
                  basePath,
                  status,
                  search,
                  showCosts,
                  showRecommendationBasis,
                  sort,
                  order,
                  page: Math.max(1, page - 1),
                })}
                aria-disabled={page <= 1}
                className={`inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-medium ${
                  page <= 1
                    ? 'pointer-events-none border-border bg-muted text-muted-foreground'
                    : 'border-border bg-background hover:bg-muted'
                }`}
              >
                이전
              </Link>
              <span className="text-xs text-muted-foreground">
                {page.toLocaleString('ko-KR')} / {totalPages.toLocaleString('ko-KR')}
              </span>
              <Link
                href={purchaseOrdersHref({
                  basePath,
                  status,
                  search,
                  showCosts,
                  showRecommendationBasis,
                  sort,
                  order,
                  page: Math.min(totalPages, page + 1),
                })}
                aria-disabled={page >= totalPages}
                className={`inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-medium ${
                  page >= totalPages
                    ? 'pointer-events-none border-border bg-muted text-muted-foreground'
                    : 'border-border bg-background hover:bg-muted'
                }`}
              >
                다음
              </Link>
            </div>
          </div>
        </section>
      </PurchaseBulkSelectionProvider>
    </div>
  )
}

function SortHeader({
  label,
  column,
  status,
  search,
  showCosts,
  showRecommendationBasis,
  currentSort,
  currentOrder,
  basePath,
  align = 'left',
}: {
  label: string
  column: string
  status: PurchaseRequestStatus
  search: string | undefined
  showCosts: boolean
  showRecommendationBasis: boolean
  currentSort: string | undefined
  currentOrder: 'asc' | 'desc'
  basePath: string
  align?: 'left' | 'center' | 'right'
}) {
  const nextOrder = currentSort === column && currentOrder === 'asc' ? 'desc' : 'asc'
  const indicator = currentSort === column ? (currentOrder === 'asc' ? '↑' : '↓') : ''
  const href = purchaseOrdersHref({
    basePath,
    status,
    search,
    showCosts,
    showRecommendationBasis,
    sort: column,
    order: nextOrder,
  })

  return (
    <Link
      href={href}
      className={`inline-flex w-full items-center gap-1 hover:text-foreground ${
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
      }`}
    >
      {label}
      <span className="text-muted-foreground">{indicator}</span>
    </Link>
  )
}

function getStageQuantityColumn(status: PurchaseRequestStatus) {
  if (status === 'purchased' || status === 'purchase_completed') {
    return { label: '구매수량', field: 'actualPurchaseQuantity' as const }
  }
  if (status === 'china_arrived') {
    return { label: '중국도착수량', field: 'chinaReceivedQuantity' as const }
  }
  if (status === 'outbound_requested' || status === 'completed') {
    return { label: '출고요청수량', field: 'outboundRequestedQuantity' as const }
  }
  return { label: '요청수량', field: 'requestedQuantity' as const }
}

function getStageQuantity(
  item: {
    requestedQuantity: number
    actualPurchaseQuantity: number | null
    chinaReceivedQuantity: number | null
  },
  status: PurchaseRequestStatus,
  outboundRequestedQuantity: number,
) {
  if (status === 'purchased' || status === 'purchase_completed') return item.actualPurchaseQuantity ?? item.requestedQuantity
  if (status === 'china_arrived') {
    return item.chinaReceivedQuantity ?? item.actualPurchaseQuantity ?? item.requestedQuantity
  }
  if (status === 'outbound_requested' || status === 'completed') return outboundRequestedQuantity
  return item.requestedQuantity
}

function RecommendationBasisGrid({ rawData }: { rawData: Record<string, unknown> }) {
  if (rawData.source !== 'auto_purchase_recommendation') return <span>-</span>
  const anomalyNote = rawData.salesAnomalyDetected === true
    ? `급증 제외 적용평균 ${formatNumber(rawData.effectiveMonthlyOutgoing)}`
    : null
  const budgetNote = Number(rawData.originalRecommendedQuantity) > Number(rawData.allocatedQuantity)
    ? `예산 조정 ${formatNumber(rawData.originalRecommendedQuantity)} → ${formatNumber(rawData.allocatedQuantity)}`
    : null

  return (
    <div className="grid grid-cols-4 gap-2 text-center tabular-nums">
      <Metric label="현재고" value={formatNumber(rawData.availableStock)} />
      <Metric label="당월 출고" value={formatNumber(rawData.currentMonthOutgoing)} />
      <Metric label="3개월평균" value={formatNumber(rawData.averageMonthlyOutgoing)} />
      <Metric label="목표수량" value={formatNumber(rawData.targetStockQuantity)} />
      {anomalyNote || budgetNote ? (
        <div className="col-span-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[11px] font-medium">
          {anomalyNote ? <span className="text-amber-700">{anomalyNote}</span> : null}
          {budgetNote ? <span className="text-blue-700">{budgetNote}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  )
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parseStatus(value: string | undefined, allowedStatuses: readonly PurchaseRequestStatus[]): PurchaseRequestStatus | null {
  if (!value) return null
  return allowedStatuses.includes(value as PurchaseRequestStatus) ? value as PurchaseRequestStatus : null
}

function parseOrder(value: string | undefined): 'asc' | 'desc' | null {
  return value === 'asc' || value === 'desc' ? value : null
}

function daysSinceDateOnly(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 0
  const today = new Date()
  const start = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  return Math.floor((end - start) / millisecondsPerDay)
}

function purchaseOrdersHref({
  basePath,
  status,
  search,
  showCosts,
  showRecommendationBasis,
  sort,
  order,
  page,
}: {
  basePath: string
  status: PurchaseRequestStatus
  search?: string
  showCosts?: boolean
  showRecommendationBasis?: boolean
  sort?: string
  order?: 'asc' | 'desc'
  page?: number
}) {
  const params = new URLSearchParams({ status })
  if (search) params.set('search', search)
  if (showCosts) params.set('showCosts', '1')
  if (showRecommendationBasis !== undefined) params.set('showRecommendationBasis', showRecommendationBasis ? '1' : '0')
  if (sort) params.set('sort', sort)
  if (order) params.set('order', order)
  if (page && page > 1) params.set('page', String(page))
  return `${basePath}?${params.toString()}`
}

function formatNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
}

function formatCost(value: number | null, maximumFractionDigits: number) {
  if (value === null) return '-'
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })
}
