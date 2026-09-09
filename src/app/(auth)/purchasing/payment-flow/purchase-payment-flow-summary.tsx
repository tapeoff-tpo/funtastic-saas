import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { calculateAppliedPurchaseExchangeRateKrw } from '@/lib/purchasing/purchase-costs'
import type {
  PurchaseCostSummary,
  PurchasePaymentFlowSummary,
} from '@/lib/purchasing/purchase-requests'

type ExchangeRateReference = {
  rate: number
  date: string | null
}

export function PurchasePaymentFlowSummaryPanel({
  summary,
  exchangeRateReference,
}: {
  summary: PurchasePaymentFlowSummary
  exchangeRateReference: ExchangeRateReference
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PurchaseFlowCard label="발주금액 총액" summary={summary.total} description="현재 진행 중 발주" />
        <PurchaseFlowCard label="구매 전" summary={summary.purchaseBefore} description="발주요청 단계" />
        <PurchaseFlowCard label="구매 완료" summary={summary.purchaseCompleted} description="구매완료 이후 단계" />
        <PurchaseFlowCard label="미결제 잔액" summary={summary.outstanding} description="결제 완료를 제외한 금액" emphasized />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <PurchaseFlowCard label="결제 대기" summary={summary.paymentPending} description="구매 완료 후 미결제" compact />
        <PurchaseFlowCard label="결제 완료" summary={summary.paymentPaid} description="결제 완료로 기록된 금액" compact />
        <PurchaseFlowCard label="출고 전 결제" summary={summary.beforeOutbound} description="대량 주문 등 출고 직전 결제" compact />
      </div>

      <p className="text-xs text-muted-foreground">
        중국출고완료 건은 현재 금액 흐름에서 제외됩니다. 결제 상태는 발주 탭에서 변경할 수 있습니다.
      </p>
    </section>
  )
}

function PurchaseFlowCard({
  label,
  summary,
  description,
  emphasized = false,
  compact = false,
}: {
  label: string
  summary: PurchaseCostSummary
  description: string
  emphasized?: boolean
  compact?: boolean
}) {
  const hasMissingCost = summary.missingYuanCostCount > 0 || summary.missingKrwCostCount > 0

  return (
    <div className={`rounded-md border px-3 py-2 ${emphasized ? 'border-foreground bg-background' : 'bg-muted/20'}`}>
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
    </div>
  )
}

function formatCost(value: number | null, maximumFractionDigits: number) {
  if (value === null) return '-'

  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })
}
