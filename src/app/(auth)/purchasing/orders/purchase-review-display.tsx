import { getDomesticStockoutDays, getPurchaseReviewReason } from '@/lib/purchasing/recommendation-basis'
import type { PurchaseReviewHistory } from '@/lib/purchasing/purchase-requests'

export function PurchaseReviewHistorySummary({ history }: { history: PurchaseReviewHistory | null }) {
  if (!history) return <span className="text-xs text-muted-foreground">구매 이력 없음</span>

  const date = history.lastPurchaseDate.replaceAll('-', '.')
  return (
    <div className="space-y-0.5 text-xs tabular-nums">
      <div className="whitespace-nowrap font-medium text-foreground">
        최근 구매일 <time dateTime={history.lastPurchaseDate}>{date}</time>
      </div>
      <div className="text-muted-foreground">구매 {history.lastPurchaseQuantity.toLocaleString('ko-KR')}개</div>
    </div>
  )
}

export function PurchaseReviewSalesHistory({
  threeMonthAverage, effectiveMonthlyOutgoing,
}: {
  threeMonthAverage: number | null
  effectiveMonthlyOutgoing: unknown
}) {
  const formatQuantity = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}개`
    : '–'

  return (
    <div className="space-y-0.5 whitespace-nowrap text-xs tabular-nums">
      <div className="font-medium text-foreground">3개월 평균 {formatQuantity(threeMonthAverage)}</div>
      <div className="text-muted-foreground" title="최근 추천 계산에 적용된 월평균 출고량">
        적용 월평균 {formatQuantity(effectiveMonthlyOutgoing)}
      </div>
    </div>
  )
}

export function PurchaseReviewAmount({
  totalCostKrw, unitCostKrw, unitCostYuan,
}: {
  totalCostKrw: number | null
  unitCostKrw: number | null
  unitCostYuan: number | null
}) {
  const unitPrices = [
    unitCostKrw !== null ? `₩${unitCostKrw.toLocaleString('ko-KR')}` : null,
    unitCostYuan !== null ? `${unitCostYuan.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}元` : null,
  ].filter(Boolean)

  return (
    <div className="text-right tabular-nums">
      <div className="font-semibold text-foreground">
        {totalCostKrw === null ? '–' : `₩${totalCostKrw.toLocaleString('ko-KR')}`}
      </div>
      {unitPrices.length > 0 && (
        <div className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">개당 {unitPrices.join(' · ')}</div>
      )}
    </div>
  )
}

export function PurchaseReviewPriority({ rank, rawData }: { rank: number; rawData: Record<string, unknown> }) {
  const days = getDomesticStockoutDays(rawData)
  return (
    <div className="mt-1 text-xs font-medium">
      {rank}순위
      {days !== null && (
        <div className="mt-0.5 whitespace-nowrap text-amber-800">
          재고 예상 판매일수 : {days}일
        </div>
      )}
    </div>
  )
}

export function PurchaseReviewReason({
  rawData, requestedQuantity,
}: {
  rawData: Record<string, unknown>
  requestedQuantity: number
}) {
  const reason = getPurchaseReviewReason(rawData, requestedQuantity)
  if (!reason) return <span>–</span>

  return (
    <div className="max-w-sm text-left leading-relaxed">
      <div className="font-medium text-foreground">{reason.main}</div>
      {reason.detail && <div className="mt-0.5 text-muted-foreground">{reason.detail}</div>}
    </div>
  )
}
