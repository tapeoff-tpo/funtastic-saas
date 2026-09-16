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
  return (
    <section className="space-y-3 border-t pt-4" aria-label="발주금액 흐름">
      <div>
        <h3 className="text-sm font-semibold">발주금액 현황</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          금액 카드를 누르면 바로 아래 목록이 바뀝니다. 현재 진행 중인 발주 기준이며, 원가는 특가(元)를 우선하고 없으면 신규원가(元)를 사용합니다.
        </p>
      </div>

      <div className="space-y-2" aria-label="발주 단계별 금액">
        <p className="text-xs font-medium text-muted-foreground">발주 단계별 금액 · 발주 화면과 같은 상태 기준</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <PurchaseFlowCard label="발주금액 총액" view="total" summary={summary.total} description="현재 진행 중 발주 전체" active={activeView === 'total'} search={search} pageSize={pageSize} sort={sort} order={order} />
          <PurchaseFlowCard label="발주요청" view="purchase_before" summary={summary.purchaseBefore} description="발주 화면의 발주요청과 동일" active={activeView === 'purchase_before'} search={search} pageSize={pageSize} sort={sort} order={order} />
          <PurchaseFlowCard label="구매완료" view="purchase_completed" summary={summary.purchaseCompleted} description="발주 화면의 구매완료와 동일" active={activeView === 'purchase_completed'} search={search} pageSize={pageSize} sort={sort} order={order} />
          <PurchaseFlowCard label="중국창고도착" view="china_arrived" summary={summary.chinaArrived} description="발주 화면의 중국창고도착과 동일" active={activeView === 'china_arrived'} search={search} pageSize={pageSize} sort={sort} order={order} />
          <PurchaseFlowCard label="중국출고요청" view="outbound_requested" summary={summary.outboundRequested} description="발주 화면의 중국출고요청과 동일" active={activeView === 'outbound_requested'} search={search} pageSize={pageSize} sort={sort} order={order} />
        </div>
      </div>

      <div className="space-y-2" aria-label="주문번호 및 대량결제 확인">
        <p className="text-xs font-medium text-muted-foreground">주문번호·대량결제 확인 · 발주 단계와 별도</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <PurchaseFlowCard label="주문서번호 등록" view="order_number_registered" summary={summary.orderNumberRegistered} description="자동 발주 차감 대상 · 단계와 별도" active={activeView === 'order_number_registered'} search={search} pageSize={pageSize} sort={sort} order={order} />
          <PurchaseFlowCard label="주문서번호 미등록" view="outstanding" summary={summary.outstanding} description="대량결제대기를 제외한 주문번호 확인 필요 건" active={activeView === 'outstanding'} search={search} pageSize={pageSize} sort={sort} order={order} />
          <PurchaseFlowCard label="대량결제대기 잔금" view="bulk_pending" summary={summary.bulkPending} description="누적 선금을 제외한 남은 결제액" active={activeView === 'bulk_pending'} search={search} pageSize={pageSize} sort={sort} order={order} />
        </div>
      </div>

      {search ? (
        <p className="text-xs text-muted-foreground">카드 금액·건수는 전체 현황이고, 바로 아래 목록만 “{search}” 검색 결과입니다.</p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        주문서번호 미등록과 대량결제대기는 서로 겹치지 않습니다. 주문서번호 미등록은 결제 상태가 아니라 번호 입력 여부를 확인하는 목록이며, 장부의 누적 차감액과도 집계 범위가 다릅니다.
      </p>
    </section>
  )
}

function PurchaseFlowCard({
  label,
  view,
  summary,
  description,
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
      className={`rounded-md border px-3 py-2 text-left transition-colors hover:border-primary hover:bg-muted ${
        active
          ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary/20'
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
