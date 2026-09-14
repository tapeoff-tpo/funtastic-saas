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
        <PurchaseFlowCard label="발주요청" view="purchase_before" summary={summary.purchaseBefore} description="결제 대기 금액에 포함되는 구매요청 단계" active={activeView === 'purchase_before'} search={search} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="결제 대기 (미결제 잔액)" view="outstanding" summary={summary.outstanding} description="주문서번호가 아직 없는 전체 건" emphasized active={activeView === 'outstanding'} search={search} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="구매 완료" view="purchase_completed" summary={summary.purchaseCompleted} description="주문서번호 등록 완료" active={activeView === 'purchase_completed'} search={search} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="대량결제대기" view="bulk_pending" summary={summary.bulkPending} description="수동 지정한 날짜형 대량 주문" active={activeView === 'bulk_pending'} search={search} pageSize={pageSize} sort={sort} order={order} />
      </div>

      {search ? (
        <p className="text-xs text-muted-foreground">카드 금액·건수는 전체 현황이고, 바로 아래 목록만 “{search}” 검색 결과입니다.</p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        주문서번호가 없으면 결제 대기(미결제 잔액), 있으면 구매 완료입니다. 발주요청은 결제 대기의 일부이고, 수동 지정한 대량결제대기는 다른 분류와 겹칠 수 있어 카드 금액을 서로 더하면 안 됩니다. 장부의 누적 차감액과도 집계 범위가 다릅니다.
      </p>
    </section>
  )
}

function PurchaseFlowCard({
  label,
  view,
  summary,
  description,
  emphasized = false,
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
  emphasized?: boolean
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
      className={`rounded-md border px-3 py-2 text-left transition-colors hover:border-foreground hover:bg-muted ${
        active || emphasized ? 'border-foreground bg-background' : 'bg-muted/20'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">{summary.itemCount.toLocaleString('ko-KR')}건</span>
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
