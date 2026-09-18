import { PaymentFlowPendingLink } from './payment-flow-pending-link'
import type {
  PurchaseCostSummary,
  PurchasePaymentFlowSummary,
  PurchasePaymentFlowSort,
  PurchasePaymentFlowView,
} from '@/lib/purchasing/purchase-requests'

export function PurchasePaymentFlowSummaryPanel({
  summary,
  activeView,
  search,
  pageSize,
  sort,
  order,
}: {
  summary: PurchasePaymentFlowSummary
  activeView: PurchasePaymentFlowView
  search: string
  pageSize: number
  sort: PurchasePaymentFlowSort | null
  order: 'asc' | 'desc'
}) {
  const shouldShowStageSummary =
    summary.purchaseBefore.itemCount > 0 ||
    summary.purchaseCompleted.itemCount > 0 ||
    summary.chinaArrived.itemCount > 0 ||
    summary.outboundRequested.itemCount > 0 ||
    activeView === 'purchase_before' ||
    activeView === 'purchase_completed' ||
    activeView === 'china_arrived' ||
    activeView === 'outbound_requested'
  const shouldShowAttentionSummary =
    summary.outstanding.itemCount > 0 ||
    summary.bulkPending.itemCount > 0 ||
    activeView === 'outstanding' ||
    activeView === 'bulk_pending'

  return (
    <section className="space-y-3 border-t pt-4" aria-label="발주금액 흐름">
      <div>
        <h3 className="text-sm font-semibold">발주금액 현황</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          진행 중 발주를 단계별로 봅니다. 원가는 특가(元)를 우선하고 없으면 신규원가(元)를 사용합니다.
        </p>
      </div>

      <PurchaseFlowTotalLink
        summary={summary.total}
        active={activeView === 'total'}
        search={search}
        pageSize={pageSize}
        sort={sort}
        order={order}
      />

      {shouldShowStageSummary ? (
        <div className="space-y-2" aria-labelledby="purchase-stage-summary-heading">
          <h4 id="purchase-stage-summary-heading" className="text-xs font-medium text-muted-foreground">
            발주 단계 · 진행 중 발주 합계를 상태별로 나눈 값
          </h4>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
            {(summary.purchaseBefore.itemCount > 0 || activeView === 'purchase_before') ? <PurchaseFlowCard label="발주요청" view="purchase_before" summary={summary.purchaseBefore} description="발주 화면의 발주요청과 동일" active={activeView === 'purchase_before'} search={search} pageSize={pageSize} sort={sort} order={order} /> : null}
            {(summary.purchaseCompleted.itemCount > 0 || activeView === 'purchase_completed') ? <PurchaseFlowCard label="구매완료" view="purchase_completed" summary={summary.purchaseCompleted} description="발주 화면의 구매완료와 동일" active={activeView === 'purchase_completed'} search={search} pageSize={pageSize} sort={sort} order={order} /> : null}
            {(summary.chinaArrived.itemCount > 0 || activeView === 'china_arrived') ? <PurchaseFlowCard label="중국창고도착" view="china_arrived" summary={summary.chinaArrived} description="발주 화면의 중국창고도착과 동일" active={activeView === 'china_arrived'} search={search} pageSize={pageSize} sort={sort} order={order} /> : null}
            {(summary.outboundRequested.itemCount > 0 || activeView === 'outbound_requested') ? <PurchaseFlowCard label="중국출고요청" view="outbound_requested" summary={summary.outboundRequested} description="발주 화면의 중국출고요청과 동일" active={activeView === 'outbound_requested'} search={search} pageSize={pageSize} sort={sort} order={order} /> : null}
          </div>
        </div>
      ) : null}

      {shouldShowAttentionSummary ? (
        <div className="space-y-2" aria-labelledby="purchase-attention-summary-heading">
          <h4 id="purchase-attention-summary-heading" className="text-xs font-medium text-muted-foreground">
            확인 필요 · 진행 중 발주에 포함된 항목
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {(summary.outstanding.itemCount > 0 || activeView === 'outstanding') ? <PurchaseFlowCard label="주문번호 확인 필요" view="outstanding" summary={summary.outstanding} description="대량결제를 제외한 주문번호 미입력 건" tone="warning" active={activeView === 'outstanding'} search={search} pageSize={pageSize} sort={sort} order={order} /> : null}
            {(summary.bulkPending.itemCount > 0 || activeView === 'bulk_pending') ? <PurchaseFlowCard label="대량결제 잔금" view="bulk_pending" summary={summary.bulkPending} description="해당 발주의 누적 선금을 제외한 남은 결제액" tone="warning" active={activeView === 'bulk_pending'} search={search} pageSize={pageSize} sort={sort} order={order} /> : null}
          </div>
        </div>
      ) : null}

      {activeView === 'order_number_registered' ? (
        <p className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground" role="status">
          주문서번호 등록 기준 목록을 보고 있습니다. 이 기준은 발주 단계와 별개입니다.
        </p>
      ) : null}

      {search ? (
        <p className="text-xs text-muted-foreground">카드 금액·건수는 전체 현황이고, 바로 아래 목록만 “{search}” 검색 결과입니다.</p>
      ) : null}

      {shouldShowAttentionSummary ? (
        <p className="text-xs text-muted-foreground">
          “확인 필요” 금액은 총액에 더하는 별도 금액이 아닙니다. 같은 진행 발주 중에서 주문번호나 대량결제 잔금 확인이 필요한 항목만 따로 보여줍니다.
        </p>
      ) : null}
    </section>
  )
}

function PurchaseFlowTotalLink({
  summary,
  active,
  search,
  pageSize,
  sort,
  order,
}: {
  summary: PurchaseCostSummary
  active: boolean
  search: string
  pageSize: number
  sort: PurchasePaymentFlowSort | null
  order: 'asc' | 'desc'
}) {
  const params = new URLSearchParams({ view: 'total' })
  if (search) params.set('search', search)
  if (pageSize !== 50) params.set('pageSize', String(pageSize))
  if (sort) {
    params.set('sort', sort)
    params.set('order', order)
  }
  const hasMissingCost = summary.missingYuanCostCount > 0 || summary.missingKrwCostCount > 0

  return (
    <PaymentFlowPendingLink
      href={`/purchasing/payment-flow?${params.toString()}`}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-col gap-2 rounded-md border px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:flex-row sm:items-center sm:justify-between ${
        active ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary/20' : 'border-border bg-muted/20'
      }`}
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">진행 중 발주 합계</span>
          {active ? <span className="rounded-sm bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">선택됨</span> : null}
          <span className="text-xs text-muted-foreground">{summary.itemCount.toLocaleString('ko-KR')}건</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          현재 진행 중인 발주 전체{hasMissingCost ? ` · 원가 누락 ${Math.max(summary.missingYuanCostCount, summary.missingKrwCostCount).toLocaleString('ko-KR')}건` : ''}
        </p>
      </div>
      <div className="shrink-0 sm:text-right">
        <p className="text-xl font-semibold tabular-nums">₩ {formatCost(summary.totalCostKrw, 0)}</p>
        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">元 {formatCost(summary.totalCostYuan, 2)}</p>
      </div>
    </PaymentFlowPendingLink>
  )
}

function PurchaseFlowCard({
  label,
  view,
  summary,
  description,
  tone = 'default',
  active = false,
  search,
  pageSize,
  sort,
  order,
}: {
  label: string
  view: PurchasePaymentFlowView
  summary: PurchaseCostSummary
  description: string
  tone?: 'default' | 'warning'
  active?: boolean
  search: string
  pageSize: number
  sort: PurchasePaymentFlowSort | null
  order: 'asc' | 'desc'
}) {
  const hasMissingCost = summary.missingYuanCostCount > 0 || summary.missingKrwCostCount > 0
  const params = new URLSearchParams({ view })
  if (search) params.set('search', search)
  if (pageSize !== 50) params.set('pageSize', String(pageSize))
  if (sort) {
    params.set('sort', sort)
    params.set('order', order)
  }

  return (
    <PaymentFlowPendingLink
      href={`/purchasing/payment-flow?${params.toString()}`}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md border px-3 py-2 text-left transition-colors hover:border-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
        active
          ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary/20'
          : tone === 'warning'
            ? 'border-amber-200 bg-amber-50/60 hover:border-amber-300'
            : 'border-border bg-muted/20'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          {active ? <span className="rounded-sm bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">선택됨</span> : null}
          <span className="text-xs text-muted-foreground">{summary.itemCount.toLocaleString('ko-KR')}건</span>
        </div>
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums">
        ₩ {formatCost(summary.totalCostKrw, 0)}
      </div>
      <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">元 {formatCost(summary.totalCostYuan, 2)}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {description}
        {hasMissingCost
          ? ` · 원가 누락 ${Math.max(summary.missingYuanCostCount, summary.missingKrwCostCount).toLocaleString('ko-KR')}건`
          : ''}
      </p>
    </PaymentFlowPendingLink>
  )
}

function formatCost(value: number | null, maximumFractionDigits: number) {
  if (value === null) return '-'

  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })
}
