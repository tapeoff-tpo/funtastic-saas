import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { calculateAppliedPurchaseExchangeRateKrw } from '@/lib/purchasing/purchase-costs'
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
    <section className="space-y-4" aria-label="발주 결제 금액 흐름">
      <div className="flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">발주·결제 금액 현황</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            기준 환율 {formatCost(exchangeRateReference.rate, 2)}원/元
            {exchangeRateReference.date ? ` (${exchangeRateReference.date})` : ''}
            {' '}× 1.05 = 적용 {formatCost(appliedExchangeRate, 2)}원/元
          </p>
          <p className="mt-1 text-xs text-muted-foreground">원가: 특가(元) 우선, 신규원가(元) 보조</p>
        </div>
        <Link
          href="/purchasing/orders?status=purchase_completed"
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium whitespace-nowrap hover:bg-muted"
        >
          <ClipboardList className="size-4" />
          발주에서 결제 상태 변경
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="발주금액 분류">
        <PurchaseFlowCard label="발주금액 총액" view="total" summary={summary.total} description="현재 진행 중 발주" active={activeView === 'total'} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="구매 전" view="purchase_before" summary={summary.purchaseBefore} description="발주요청 단계" active={activeView === 'purchase_before'} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="구매 완료" view="purchase_completed" summary={summary.purchaseCompleted} description="구매완료 이후 단계" active={activeView === 'purchase_completed'} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="미결제 잔액" view="outstanding" summary={summary.outstanding} description="결제 완료를 제외한 금액" emphasized active={activeView === 'outstanding'} pageSize={pageSize} sort={sort} order={order} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3" aria-label="결제 상태 분류">
        <PurchaseFlowCard label="결제 대기" view="payment_pending" summary={summary.paymentPending} description="구매 완료 후 미결제" compact active={activeView === 'payment_pending'} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="결제 완료" view="payment_paid" summary={summary.paymentPaid} description="결제 완료로 기록된 금액" compact active={activeView === 'payment_paid'} pageSize={pageSize} sort={sort} order={order} />
        <PurchaseFlowCard label="출고 전 결제" view="before_outbound" summary={summary.beforeOutbound} description="대량 주문 등 출고 직전 결제" compact active={activeView === 'before_outbound'} pageSize={pageSize} sort={sort} order={order} />
      </div>

      <p className="text-xs text-muted-foreground">
        금액 항목을 누르면 선택 상태와 아래 주문 건 목록이 갱신됩니다. 중국출고완료 건은 현재 금액 흐름에서 제외됩니다.
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
  compact = false,
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
  compact?: boolean
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
    <Link
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
      <div className={`${compact ? 'mt-1 text-lg' : 'mt-2 text-xl'} font-semibold tabular-nums`}>
        ₩ {formatCost(summary.totalCostKrw, 0)}
      </div>
      <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">元 {formatCost(summary.totalCostYuan, 2)}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {description}
        {hasMissingCost
          ? ` · 원가 누락 ${Math.max(summary.missingYuanCostCount, summary.missingKrwCostCount).toLocaleString('ko-KR')}건`
          : ''}
      </p>
    </Link>
  )
}

function formatCost(value: number | null, maximumFractionDigits: number) {
  if (value === null) return '-'

  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })
}
