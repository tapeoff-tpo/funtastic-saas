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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="발주금액 분류">
        <PurchaseFlowCard label="발주금액 총액" view="total" summary={summary.total} description="현재 진행 중 발주" active={activeView === 'total'} search={search} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="발주요청" view="purchase_before" summary={summary.purchaseBefore} description="구매 전 단계의 발주요청 건" active={activeView === 'purchase_before'} search={search} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="결제 대기 (미결제 잔액)" view="outstanding" summary={summary.outstanding} description="대량결제대기를 제외한 주문서번호 미등록 건" active={activeView === 'outstanding'} search={search} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="구매 완료" view="purchase_completed" summary={summary.purchaseCompleted} description="주문서번호 등록 완료" active={activeView === 'purchase_completed'} search={search} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="대량결제대기 잔금" view="bulk_pending" summary={summary.bulkPending} description="누적 선금을 제외한 남은 결제액" active={activeView === 'bulk_pending'} search={search} pageSize={pageSize} sort={sort} order={order} />
      </div>

      {search ? (
        <p className="text-xs text-muted-foreground">카드 금액·건수는 전체 현황이고, 바로 아래 목록만 “{search}” 검색 결과입니다.</p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        결제 대기와 대량결제대기는 서로 겹치지 않습니다. 발주요청과 구매 완료는 진행 단계 기준이라 결제 구분과는 별도로 확인하며, 장부의 누적 차감액과도 집계 범위가 다릅니다.
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
