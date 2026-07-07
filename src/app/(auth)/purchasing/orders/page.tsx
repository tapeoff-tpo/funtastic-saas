import Link from 'next/link'
import type { Metadata } from 'next'
import { Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { calculatePurchaseCosts } from '@/lib/purchasing/purchase-costs'
import { getOutboundRequestedQuantity, getPurchaseRequests } from '@/lib/purchasing/purchase-requests'
import {
  getNextPurchaseStatus,
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
  PurchaseRowCheckbox,
  PurchaseSelectAllCheckbox,
  PurchaseStatusButton,
} from './purchase-request-actions'

export const metadata: Metadata = {
  title: '諛쒖＜',
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
  const showCosts = stringParam(params.showCosts) === '1'
  const sort = stringParam(params.sort)
  const order = parseOrder(stringParam(params.order)) ?? 'desc'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const { items, total, costTotals, statusCounts } = await getPurchaseRequests({
    userId: workspaceUserId,
    status,
    search: search ?? undefined,
    page,
    pageSize: 50,
    sort: sort ?? undefined,
    order,
  })
  const nextStatus = getNextPurchaseStatus(status)
  const quantityColumn = getStageQuantityColumn(status)
  const isRequestedStatus = status === 'requested'
  const visibleColumnCount = showCosts
    ? isRequestedStatus ? 12 : 14
    : isRequestedStatus ? 8 : 10
  const tableMinWidth = isRequestedStatus
    ? showCosts ? 'min-w-[1940px]' : 'min-w-[1460px]'
    : showCosts ? 'min-w-[2140px]' : 'min-w-[1660px]'
  const costToggleParams = new URLSearchParams({ status })
  if (search) costToggleParams.set('search', search)
  if (page > 1) costToggleParams.set('page', String(page))
  if (sort) costToggleParams.set('sort', sort)
  if (order) costToggleParams.set('order', order)
  if (!showCosts) costToggleParams.set('showCosts', '1')
  const costToggleHref = `/purchasing/orders?${costToggleParams.toString()}`

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">諛쒖＜</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ?ш퀬? 異쒓퀬 ?대젰??湲곗??쇰줈 援щℓ媛 ?꾩슂???덈ぉ??異붿쿇?섍퀬, 援щℓ遺??以묎뎅李쎄퀬 ?낃퀬源뚯? 愿由ы빀?덈떎.
          </p>
        </div>
        <form className="flex items-center gap-2" action="/purchasing/orders">
          <input type="hidden" name="status" value={status} />
          {showCosts ? <input type="hidden" name="showCosts" value="1" /> : null}
          {sort ? <input type="hidden" name="sort" value={sort} /> : null}
          {order ? <input type="hidden" name="order" value={order} /> : null}
          <input
            name="search"
            defaultValue={search ?? ''}
            placeholder="?덈ぉ肄붾뱶, ?곹뭹紐? 二쇰Ц踰덊샇"
            className="h-8 w-64 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button type="submit" variant="outline">검색</Button>
        </form>
      </header>

      <PurchaseRecommendationGenerator />

      <section className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border bg-muted/20 px-3 py-2">
        <span className="text-sm font-medium">
          {PURCHASE_REQUEST_STATUS_LABELS[status]} 총 구매금액
        </span>
        <span className="text-sm tabular-nums">
          <span className="text-muted-foreground">위안 </span>
          <strong>{formatCost(costTotals.totalCostYuan, 2)}</strong>
        </span>
        <span className="text-sm tabular-nums">
          <span className="text-muted-foreground">원화 </span>
          <strong>{formatCost(costTotals.totalCostKrw, 0)}</strong>
        </span>
        {costTotals.missingYuanCostCount > 0 || costTotals.missingKrwCostCount > 0 ? (
          <span className="text-xs text-amber-700">
            원가 누락: 위안 {costTotals.missingYuanCostCount.toLocaleString('ko-KR')}건 / 원화 {costTotals.missingKrwCostCount.toLocaleString('ko-KR')}건
          </span>
        ) : null}
      </section>

      <nav className="flex flex-wrap gap-2">
        {STATUSES.map((item) => {
          const active = item === status
          const href = purchaseOrdersHref({
            status: item,
            search,
            showCosts,
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

      <PurchaseBulkSelectionProvider ids={items.map((item) => item.id)} nextStatus={nextStatus}>
        <section className="overflow-hidden rounded-md border bg-background">
          <div className="flex flex-col gap-2 border-b px-3 py-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold">{PURCHASE_REQUEST_STATUS_LABELS[status]} 紐⑸줉</h2>
              <p className="text-xs text-muted-foreground">총 {total.toLocaleString('ko-KR')}건</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isRequestedStatus ? <PurchaseBulkBuyerApply /> : null}
              <Link
                href={costToggleHref}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap hover:bg-muted"
              >
                {showCosts ? <EyeOff /> : <Eye />}
                {showCosts ? '?먭? ?リ린' : '?먭? 蹂닿린'}
              </Link>
              <PurchaseBulkDeleteButton />
              <PurchaseBulkStatusButton />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className={`w-full table-fixed text-left text-sm ${tableMinWidth}`}>
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="w-12 px-3 py-2 text-center font-medium">
                    <PurchaseSelectAllCheckbox />
                  </th>
                  <th className="w-28 px-3 py-2 text-center font-medium">
                    <SortHeader label="?곹깭" column="status" status={status} search={search} showCosts={showCosts} currentSort={sort} currentOrder={order} align="center" />
                  </th>
                  <th className="w-[340px] px-3 py-2 font-medium">
                    <SortHeader label="?곹뭹" column="productName" status={status} search={search} showCosts={showCosts} currentSort={sort} currentOrder={order} />
                  </th>
                  <th className="w-32 px-3 py-2 text-center font-medium">
                    <SortHeader label={quantityColumn.label} column="requestedQuantity" status={status} search={search} showCosts={showCosts} currentSort={sort} currentOrder={order} align="center" />
                  </th>
                  {showCosts ? (
                    <>
                      <th className="w-28 px-3 py-2 text-right font-medium">
                        <SortHeader label="媛쒕떦 ?먭?(??" column="unitCostYuan" status={status} search={search} showCosts={showCosts} currentSort={sort} currentOrder={order} align="right" />
                      </th>
                      <th className="w-28 px-3 py-2 text-right font-medium">
                        <SortHeader label="媛쒕떦 ?먭?(??" column="unitCostKrw" status={status} search={search} showCosts={showCosts} currentSort={sort} currentOrder={order} align="right" />
                      </th>
                      <th className="w-32 px-3 py-2 text-right font-medium">
                        <SortHeader label="珥??먭?(??" column="totalCostYuan" status={status} search={search} showCosts={showCosts} currentSort={sort} currentOrder={order} align="right" />
                      </th>
                      <th className="w-32 px-3 py-2 text-right font-medium">
                        <SortHeader label="珥??먭?(??" column="totalCostKrw" status={status} search={search} showCosts={showCosts} currentSort={sort} currentOrder={order} align="right" />
                      </th>
                    </>
                  ) : null}
                  <th className="w-[460px] px-3 py-2 text-center font-medium">추천 근거</th>
                  {isRequestedStatus ? null : (
                    <th className="w-36 px-3 py-2 text-center font-medium">
                      <SortHeader label="구입관리코드" column="purchaseManagementCode" status={status} search={search} showCosts={showCosts} currentSort={sort} currentOrder={order} align="center" />
                    </th>
                  )}
                  {isRequestedStatus ? null : <th className="w-[540px] px-3 py-2 font-medium">발주 계획</th>}
                  <th className="w-28 px-3 py-2 text-center font-medium">
                    <SortHeader label="담당자" column="buyerName" status={status} search={search} showCosts={showCosts} currentSort={sort} currentOrder={order} align="center" />
                  </th>
                  <th className="w-48 px-3 py-2 text-center font-medium">상태 변경</th>
                  <th className="w-24 px-3 py-2 text-center font-medium">삭제</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnCount} className="px-3 py-12 text-center text-sm text-muted-foreground">
                      議곌굔??留욌뒗 諛쒖＜ ??ぉ???놁뒿?덈떎.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const outboundRequestedQuantity = getOutboundRequestedQuantity(item)
                    const stageQuantity = getStageQuantity(item, status, outboundRequestedQuantity)
                    const costs = calculatePurchaseCosts({
                      requestedQuantity: item.requestedQuantity,
                      unitCostYuan: item.unitCostYuan,
                      unitCostKrw: item.unitCostKrw,
                    })
                    return (
                      <tr key={item.id} className="border-t align-middle">
                      <td className="px-3 py-2 text-center align-middle">
                        <PurchaseRowCheckbox id={item.id} />
                      </td>
                      <td className="px-3 py-2 text-center align-middle">
                        <Badge variant={item.status === 'completed' ? 'default' : 'secondary'}>
                          {PURCHASE_REQUEST_STATUS_LABELS[item.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="truncate font-medium" title={item.productName}>{item.productName}</div>
                        <div className="truncate text-xs text-muted-foreground" title={`${item.sku}${item.optionName ? ` 쨌 ${item.optionName}` : ''}`}>
                          {item.sku}{item.optionName ? ` 쨌 ${item.optionName}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums align-middle">
                        <PurchaseQuantityField
                          id={item.id}
                          field={quantityColumn.field}
                          quantity={stageQuantity}
                        />
                        {isRequestedStatus ? <PurchaseCostSummary costs={costs} /> : null}
                      </td>
                      {showCosts ? (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCost(costs.unitCostYuan, 2)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCost(costs.unitCostKrw, 0)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCost(costs.totalCostYuan, 2)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCost(costs.totalCostKrw, 0)}</td>
                        </>
                      ) : null}
                      <td className="px-3 py-2 text-xs text-muted-foreground align-middle">
                        <RecommendationBasisGrid rawData={item.rawData} />
                      </td>
                      {isRequestedStatus ? null : (
                        <td className="px-3 py-2 text-center align-middle">{item.purchaseManagementCode ?? '-'}</td>
                      )}
                      {isRequestedStatus ? null : (
                        <td className="px-3 py-2 align-middle">
                          <PurchasePlanFieldsV2
                            id={item.id}
                            supplierOrderNumber={item.supplierOrderNumber}
                            outboundExpectedDate={item.outboundExpectedDate}
                            purchaseMethod={item.purchaseMethod}
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 text-center align-middle">
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
  currentSort,
  currentOrder,
  align = 'left',
}: {
  label: string
  column: string
  status: PurchaseRequestStatus
  search: string | undefined
  showCosts: boolean
  currentSort: string | undefined
  currentOrder: 'asc' | 'desc'
  align?: 'left' | 'center' | 'right'
}) {
  const nextOrder = currentSort === column && currentOrder === 'asc' ? 'desc' : 'asc'
  const indicator = currentSort === column ? (currentOrder === 'asc' ? '↑' : '↓') : ''
  const href = purchaseOrdersHref({
    status,
    search,
    showCosts,
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
  if (status === 'purchased') {
    return { label: '援щℓ?섎웾', field: 'actualPurchaseQuantity' as const }
  }
  if (status === 'china_arrived') {
    return { label: '以묎뎅?꾩갑?섎웾', field: 'chinaReceivedQuantity' as const }
  }
  if (status === 'outbound_requested' || status === 'completed') {
    return { label: '異쒓퀬?붿껌?섎웾', field: 'outboundRequestedQuantity' as const }
  }
  return { label: '?붿껌?섎웾', field: 'requestedQuantity' as const }
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
  if (status === 'purchased') return item.actualPurchaseQuantity ?? item.requestedQuantity
  if (status === 'china_arrived') {
    return item.chinaReceivedQuantity ?? item.actualPurchaseQuantity ?? item.requestedQuantity
  }
  if (status === 'outbound_requested' || status === 'completed') return outboundRequestedQuantity
  return item.requestedQuantity
}

function RecommendationBasisGrid({ rawData }: { rawData: Record<string, unknown> }) {
  if (rawData.source !== 'auto_purchase_recommendation') return <span>-</span>

  return (
    <div className="grid grid-cols-4 gap-2 text-center tabular-nums">
      <Metric label="현재고" value={formatNumber(rawData.availableStock)} />
      <Metric label="당월 출고" value={formatNumber(rawData.currentMonthOutgoing)} />
      <Metric label="3개월평균" value={formatNumber(rawData.averageMonthlyOutgoing)} />
      <Metric label="목표수량" value={formatNumber(rawData.targetStockQuantity)} />
      {rawData.salesAnomalyDetected === true ? (
        <div className="col-span-4 text-[11px] font-medium text-amber-700">
          급증 제외 적용평균 {formatNumber(rawData.effectiveMonthlyOutgoing)}
        </div>
      ) : null}
      {Number(rawData.originalRecommendedQuantity) > Number(rawData.allocatedQuantity) ? (
        <div className="col-span-4 text-[11px] font-medium text-blue-700">
          예산 조정 {formatNumber(rawData.originalRecommendedQuantity)} → {formatNumber(rawData.allocatedQuantity)}
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

function PurchaseCostSummary({
  costs,
}: {
  costs: ReturnType<typeof calculatePurchaseCosts>
}) {
  return (
    <div className="mt-1 space-y-0.5 text-center text-[11px] leading-tight tabular-nums">
      <div className="font-semibold text-foreground">
        ¥{formatCost(costs.totalCostYuan, 2)} / {formatCost(costs.totalCostKrw, 0)}원
      </div>
      <div className="text-muted-foreground">
        개당 ¥{formatCost(costs.unitCostYuan, 2)} / {formatCost(costs.unitCostKrw, 0)}원
      </div>
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

function parseOrder(value: string | undefined): 'asc' | 'desc' | null {
  return value === 'asc' || value === 'desc' ? value : null
}

function purchaseOrdersHref({
  status,
  search,
  showCosts,
  sort,
  order,
}: {
  status: PurchaseRequestStatus
  search?: string
  showCosts?: boolean
  sort?: string
  order?: 'asc' | 'desc'
}) {
  const params = new URLSearchParams({ status })
  if (search) params.set('search', search)
  if (showCosts) params.set('showCosts', '1')
  if (sort) params.set('sort', sort)
  if (order) params.set('order', order)
  return `/purchasing/orders?${params.toString()}`
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
