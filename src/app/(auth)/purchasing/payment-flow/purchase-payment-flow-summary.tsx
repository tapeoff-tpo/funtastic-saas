import { calculateAppliedPurchaseExchangeRateKrw } from '@/lib/purchasing/purchase-costs'
import { PaymentFlowPendingLink } from './payment-flow-pending-link'
import type {
  PurchaseCostSummary,
  PurchasePaymentFlowSummary,
  PurchasePaymentFlowSort,
  PurchasePaymentFlowView,
} from '@/lib/purchasing/purchase-requests'

type ExchangeRateReference = {
  rate: number
  date: string | null
}

export function PurchasePaymentFlowSummaryPanel({
  summary,
  exchangeRateReference,
  activeView,
  pageSize,
  sort,
  order,
}: {
  summary: PurchasePaymentFlowSummary
  exchangeRateReference: ExchangeRateReference
  activeView: PurchasePaymentFlowView
  pageSize: number
  sort: PurchasePaymentFlowSort | null
  order: 'asc' | 'desc'
}) {
  const appliedExchangeRate = calculateAppliedPurchaseExchangeRateKrw(exchangeRateReference.rate)

  return (
    <section className="space-y-4" aria-label="발주금액 흐름">
      <div className="border-b pb-3">
        <h2 className="text-lg font-semibold">발주금액 현황</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          기준 환율 {formatCost(exchangeRateReference.rate, 2)}원/元
          {exchangeRateReference.date ? ` (${exchangeRateReference.date})` : ''}
          {' '}× 1.05 = 적용 {formatCost(appliedExchangeRate, 2)}원/元
        </p>
        <p className="mt-1 text-xs text-muted-foreground">원가: 특가(元) 우선, 신규원가(元) 보조</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="발주금액 분류">
        <PurchaseFlowCard label="발주금액 총액" view="total" summary={summary.total} description="현재 진행 중 발주" active={activeView === 'total'} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="발주요청" view="purchase_before" summary={summary.purchaseBefore} description="결제 대기 금액에 포함되는 구매요청 단계" active={activeView === 'purchase_before'} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="결제 대기 (미결제 잔액)" view="outstanding" summary={summary.outstanding} description="주문서번호가 아직 없는 전체 건" emphasized active={activeView === 'outstanding'} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="구매 완료" view="purchase_completed" summary={summary.purchaseCompleted} description="주문서번호 등록 완료" active={activeView === 'purchase_completed'} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="대량결제대기" view="bulk_pending" summary={summary.bulkPending} description="수동 지정한 날짜형 대량 주문" active={activeView === 'bulk_pending'} pageSize={pageSize} sort={sort} order={order} />
      </div>

      <p className="text-xs text-muted-foreground">
        결제 대기와 미결제 잔액은 같은 금액입니다. 주문서번호가 없으면 결제 대기, 있으면 구매 완료로 계산합니다. 대량결제대기는 두 구분과 별도로 수동 지정하며 2개월 자동삭제에서 제외됩니다.
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
  pageSize: number
  sort: PurchasePaymentFlowSort | null
  order: 'asc' | 'desc'
}) {
  const hasMissingCost = summary.missingYuanCostCount > 0 || summary.missingKrwCostCount > 0
  const params = new URLSearchParams({ view })
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
