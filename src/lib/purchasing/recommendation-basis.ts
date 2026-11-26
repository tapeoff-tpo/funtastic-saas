import type { PurchaseReviewOperationalMetrics } from './purchase-requests'
import { getPurchaseStockCoverageMonths } from './purchase-urgency'

type Note = { label: string; className: string }

export function getDomesticStockoutDays(rawData: Record<string, unknown>): number | null {
  const days = rawData.domesticStockoutDays
  return typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 7 ? days : null
}

export function getDomesticStockoutLabel(rawData: Record<string, unknown>): string | null {
  const days = getDomesticStockoutDays(rawData)
  if (days === null) return null
  const date = rawData.domesticStockoutCalculatedOn
  const forecast = days === 0 ? '당일 소진 예상' : `${days}일 후 소진 예상`
  const gap = rawData.domesticStockoutGapDays
  const inbound = typeof gap === 'number' && gap > 0 ? `국내 입고까지 ${gap}일 공백` : '국내 입고일 확인 필요'
  return `국내 재고 ${forecast} · ${inbound}${typeof date === 'string' ? ` (${date} 계산)` : ''}`
}

export function getPurchaseReviewReason(rawData: Record<string, unknown>, requestedQuantity: number) {
  if (rawData.source !== 'auto_purchase_recommendation') {
    return requestedQuantity > 0 ? { main: '수동 등록' } : null
  }

  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const moq = rawData.moqStockReview as { deferred?: boolean; availableStockPercent?: number; reorderStockPercent?: number } | undefined
  if (moq?.deferred) {
    return {
      main: '최소발주수량 적용 보류',
      detail: `목표 재고 ${formatNumber(moq.availableStockPercent)}% 확보 · ${formatNumber(moq.reorderStockPercent)}% 이하에서 발주`,
    }
  }
  const set = rawData.fixedSetPurchase as { incomplete?: boolean; recommendedSets?: number } | undefined
  if (set?.incomplete) return { main: '세트 발주 보류', detail: '구성품 확인 필요' }
  if (rawData.nearTargetDeferred === true || rawData.recommendationState === 'near_target_deferred') {
    return { main: '목표 재고에 근접해 보류' }
  }

  const target = number(rawData.targetStockQuantity)
  const stock = number(rawData.availableStockWithPipeline)
  const shortage = number(rawData.baseRecommendedQuantity)
    ?? (target !== null && stock !== null ? Math.max(0, target - stock) : null)
  const unbudgetedQuantity = number(rawData.purchaseMinimumAdjustedQuantity)
  const allocated = number(rawData.allocatedQuantity)
  const budgetAdjusted = number(rawData.budgetKrw) !== null && unbudgetedQuantity !== null
    && allocated !== null && allocated < unbudgetedQuantity
  const targetReason = target !== null && stock !== null
    ? `목표 ${formatNumber(target)}개 · 확보 ${formatNumber(stock)}개`
    : undefined

  if (requestedQuantity <= 0) {
    if (budgetAdjusted) return { main: '예산 기준으로 보류', detail: targetReason }
    if (rawData.recommendationState === 'new_product_first_sale') return { main: '신규상품 첫 판매 · 추이 관찰' }
    if (target !== null && target > 0 && stock !== null && stock >= target) {
      return { main: '목표 재고 확보', detail: targetReason }
    }
    return { main: '현재 발주 보류', detail: targetReason }
  }

  return {
    main: typeof set?.recommendedSets === 'number' && set.recommendedSets > 0
      ? `세트 발주 · ${formatNumber(set.recommendedSets)}세트`
      : shortage !== null && shortage > 0 ? `목표 재고까지 ${formatNumber(shortage)}개 부족`
      : rawData.siblingOptionBundleGroupName ? '동일 상품 옵션과 함께 발주' : '재고 보충 추천',
    detail: budgetAdjusted ? `예산 반영 · ${formatNumber(unbudgetedQuantity)}개에서 ${formatNumber(allocated)}개로 조정`
      : rawData.moqProductGroupName ? `최소발주수량 ${formatNumber(rawData.moqMinimumOrderQuantity)}개 적용`
      : rawData.newProductFirstSaleDetected === true ? '신규상품 첫 판매 반영'
      : rawData.salesAnomalyDetected === true ? '일회성 출고 급증 제외'
      : shortage !== null && unbudgetedQuantity !== null && unbudgetedQuantity > shortage
        ? `발주 단위 적용 · ${formatNumber(shortage)}개에서 ${formatNumber(unbudgetedQuantity)}개로 조정`
      : targetReason,
  }
}

// Shared by the review screen and its Excel download so both show the same basis.
export function getRecommendationBasis(rawData: Record<string, unknown>, metrics: PurchaseReviewOperationalMetrics | null | undefined) {
  if (rawData.source !== 'auto_purchase_recommendation' && !metrics) return null
  const value = (key: string) => {
    const number = Number(rawData[key])
    return Number.isFinite(number) && number >= 0 ? number : null
  }
  const coverage = getPurchaseStockCoverageMonths(rawData)
  const items = [
    { label: '최근 발주수량', value: formatNumber(metrics?.lastPurchaseQuantity) },
    { label: '진행 구매수량', value: formatNumber(metrics?.purchaseInProgressQuantity) },
    { label: '중국출고 예정수량', value: formatNumber(metrics?.chinaOutboundScheduledQuantity) },
    { label: '국내재고', value: formatNumber(metrics?.domesticCurrentStock ?? value('domesticAvailableStock')) },
    { label: '중국재고', value: formatNumber(metrics?.chinaCurrentStock ?? value('chinaAvailableStock')) },
    { label: '총 현재고', value: formatNumber(metrics?.currentStock ?? value('availableStock')) },
    { label: '당월 출고', value: formatNumber(metrics?.currentMonthOutgoing ?? value('currentMonthOutgoing')) },
    { label: '3개월평균', value: formatNumber(metrics?.threeMonthAverageOutgoing ?? value('averageMonthlyOutgoing')) },
    { label: '목표수량', value: formatNumber(value('targetStockQuantity') ?? metrics?.targetStockQuantity) },
    { label: '재고 보유개월', value: coverage == null ? '-' : `${formatNumber(coverage)}개월` },
  ]
  const notes: Note[] = []
  const fixedSetPurchase = rawData.fixedSetPurchase && typeof rawData.fixedSetPurchase === 'object'
    ? rawData.fixedSetPurchase as Record<string, unknown> : null
  const recommendedSets = fixedSetPurchase?.recommendedSets
  const unitsPerSet = fixedSetPurchase?.unitsPerSet
  const fixedSetQuantity = typeof recommendedSets === 'number' && typeof unitsPerSet === 'number'
    ? recommendedSets * unitsPerSet : null
  if (fixedSetPurchase?.incomplete === true) {
    notes.push({ label: '세트 발주 보류 · 구성품 확인 필요', className: 'text-amber-700' })
  } else if (fixedSetPurchase && fixedSetQuantity !== null) {
    notes.push({ label: `세트 발주 · 3개월 실출고 평균 ${formatNumber(fixedSetPurchase.averageMonthlyOutgoingSets)}세트 · 확보 ${formatNumber(fixedSetPurchase.availableSets)}세트 / 목표 ${formatNumber(fixedSetPurchase.targetSets)}세트 · 추천 ${formatNumber(recommendedSets)}세트 × ${formatNumber(unitsPerSet)}개`, className: 'text-cyan-700' })
  }
  const stockReview = rawData.moqStockReview && typeof rawData.moqStockReview === 'object'
    ? rawData.moqStockReview as Record<string, unknown> : null
  const moqDeferred = stockReview?.deferred === true
  const trend = recommendationTrend(rawData.salesTrend, rawData.effectiveMonthlyOutgoing)
  if (trend) notes.push(trend)
  const state = moqDeferred
    ? `MOQ 발주 보류 · 목표재고의 ${formatNumber(stockReview.availableStockPercent)}% 확보 · ${formatNumber(stockReview.reorderStockPercent)}% 이하에서 발주검토`
    : rawData.recommendationState === 'new_product_first_sale' ? '신규상품 첫 판매 감지'
    : rawData.recommendationState === 'near_target_deferred' ? '목표 재고 근접 · 이번 회차 보류'
      : rawData.recommendationState === 'monitoring' ? '현재 발주 보류 · 계속 관찰' : null
  if (state) notes.push({ label: state, className: moqDeferred ? 'text-amber-700' : 'text-emerald-700' })
  const incoming = stockReview?.pipelineQuantity
  if (stockReview?.domesticOutOfStock === true && typeof incoming === 'number' && incoming > 0) {
    notes.push({ label: `국내재고 부족 · 진행 중 ${formatNumber(incoming)}개 국내 입고 예정일 확인`, className: 'text-amber-700' })
  }
  const pipeline = Number(rawData.pipelineQuantity)
  if (!metrics && Number.isFinite(pipeline) && pipeline > 0) notes.push({ label: `진행 중 발주 ${formatNumber(pipeline)}`, className: 'text-slate-700' })
  const adjusted = fixedSetQuantity ?? Number(rawData.moqAdjustedQuantity ?? rawData.baseRecommendedQuantity)
  if (!moqDeferred && typeof rawData.moqProductGroupName === 'string') notes.push({ label: `MOQ 제품 · 최소 ${formatNumber(rawData.moqMinimumOrderQuantity)}개 · 보정 ${formatNumber(rawData.baseRecommendedQuantity)} → ${formatNumber(adjusted)}`, className: 'text-violet-700' })
  const bundle = Number(rawData.siblingOptionBundleQuantity)
  if (!fixedSetPurchase && typeof rawData.siblingOptionBundleGroupName === 'string' && rawData.siblingOptionBundleGroupName.trim() && Number.isFinite(bundle) && bundle > 0) notes.push({ label: `동일상품 옵션 동시 발주 · ${formatNumber(bundle)}개`, className: 'text-cyan-700' })
  if (rawData.salesAnomalyDetected === true) notes.push({ label: rawData.oneOffCurrentMonthSpikeDetected === true
    ? `단일 주문 급증 ${formatNumber(Number(rawData.currentMonthLargestOrderQuantity))}개 / ${formatNumber(Number(rawData.currentMonthOrderCount))}건 · 평균 제외`
    : `급증 제외 적용평균 ${formatNumber(rawData.effectiveMonthlyOutgoing)}`, className: 'text-amber-700' })
  const season = Number(rawData.seasonalDemandMultiplier)
  if (Number.isFinite(season) && season !== 1) notes.push({ label: season < 1 ? `여름 시즌 감산 ${formatNumber(season * 100)}%` : `겨울 시즌 증산 +${formatNumber((season - 1) * 100)}%`, className: season < 1 ? 'text-sky-700' : 'text-rose-700' })
  const bulk = specialBulkOutgoingText(rawData.specialBulkOutgoingAdjustment)
  if (bulk) notes.push({ label: bulk, className: 'text-fuchsia-700' })
  if (!moqDeferred && fixedSetPurchase?.incomplete !== true && adjusted > Number(rawData.allocatedQuantity)) notes.push({ label: `예산 조정 ${formatNumber(adjusted)} → ${formatNumber(rawData.allocatedQuantity)}`, className: 'text-blue-700' })
  return { items, notes }
}

function formatNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '-'
}

function recommendationTrend(value: unknown, effectiveMonthlyOutgoing: unknown): Note | null {
  if (value === 'sustained_increase') return { label: `판매 증가 3개월 지속 · 당월 기준 (${formatNumber(effectiveMonthlyOutgoing)})`, className: 'text-emerald-700' }
  if (value === 'capped_increase') return { label: `판매 급증 · 평균 2배 상한 (${formatNumber(effectiveMonthlyOutgoing)})`, className: 'text-amber-700' }
  if (value === 'increasing') return { label: `판매 증가 · 평균 50% + 당월 50% (${formatNumber(effectiveMonthlyOutgoing)})`, className: 'text-blue-700' }
  if (value === 'decreasing') return { label: '판매 감소 · 3개월 평균 유지', className: 'text-amber-700' }
  if (value === 'new_product') return { label: '신규상품 판매 발생', className: 'text-emerald-700' }
  return value === 'steady' ? { label: '판매 유지', className: 'text-slate-700' } : null
}

function specialBulkOutgoingText(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const adjustment = value as Record<string, unknown>
  const mall = typeof adjustment.specialMall === 'string' ? adjustment.specialMall.trim() : ''
  const quantity = Number(adjustment.specialBulkQuantity)
  const months = Number(adjustment.specialBulkMonthCount)
  const included = Number(adjustment.specialBulkIncludedQuantity)
  if (!mall || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(months) || !Number.isFinite(included)) return null
  return included <= 0
    ? `${mall} ${formatNumber(quantity)}개 · ${formatNumber(months)}개월성 → 평균 제외`
    : `${mall} ${formatNumber(quantity)}개 · ${formatNumber(months)}개월 반복 → ${formatNumber(included)}개 반영`
}
