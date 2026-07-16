import type {
  MonthlyProductMetrics,
  OpportunityRun,
  OpportunityScores,
  OpportunityScoringConfig,
  PeriodMetrics,
  ProductOpportunity,
  ProductOpportunitySource,
  ScreeningScore,
} from './types'

const PERIODS = [3, 6, 12] as const

export function analyzeOpportunities(input: {
  products: ProductOpportunitySource[]
  config: OpportunityScoringConfig
  userId: string
  asOfDate: Date
  source?: string
  dataVersion?: string
}): OpportunityRun {
  const candidates = input.products.map((product) => buildCandidate(product, input.config))
  assignBusinessScores(candidates)

  for (const candidate of candidates) {
    candidate.weightedScore = weightedScore(candidate.scores, input.config)
    candidate.confidence = scoreConfidence(candidate.scores)
    candidate.exclusionReasons = exclusionReasons(candidate, input.config)
    candidate.excluded = candidate.exclusionReasons.length > 0
  }

  candidates.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1
    return b.weightedScore - a.weightedScore
      || b.periods['12'].finalProfit - a.periods['12'].finalProfit
      || b.periods['12'].quantity - a.periods['12'].quantity
      || a.sku.localeCompare(b.sku)
  })
  candidates.forEach((candidate, index) => {
    candidate.rank = index + 1
  })

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      asOfDate: input.asOfDate.toISOString(),
      periods: [...PERIODS],
      source: input.source ?? 'funtastic-saas PostgreSQL',
      dataVersion: input.dataVersion ?? input.asOfDate.toISOString(),
      scoringVersion: input.config.version,
      userId: input.userId,
      timezone: 'Asia/Seoul',
      notes: [
        'Sales and profit figures reuse the SaaS product-profit calculation.',
        'Printability, upgrade, premium, and safety scores are preliminary rule-based screening unless marked manual.',
        'Missing evidence is never converted into a confirmed fact.',
      ],
    },
    dataAudit: {
      available: [
        'SKU and product name',
        '3/6/12-month quantity, order count, sales, and calculated final profit',
        'Marketplace fee, product cost, shipping cost, and box cost when configured',
        'Product options, category, images, current stock, and product metadata when registered',
        'Return-order count derived from non-rejected return claims',
      ],
      partial: [
        'Product cost and final profit depend on purchasing cost metadata completeness',
        'Stockout event count does not represent total stockout duration',
        'Repeat buyer rate is an order-identity aggregate and does not prove end-user repurchase',
        'Product dimensions, material, package, and usage are available only when product metadata contains them',
      ],
      unavailable: [
        'Verified final use case',
        'Customer reviews, image reviews, and VOC linked to every SKU',
        'B2B/B2C classification without an explicit marketplace mapping',
        'Verified seasonality beyond the available 12-month observation window',
        'Legal clearance, patent clearance, and regulatory certification',
      ],
    },
    products: candidates,
  }
}

function buildCandidate(
  product: ProductOpportunitySource,
  config: OpportunityScoringConfig,
): ProductOpportunity {
  const periods = Object.fromEntries(
    PERIODS.map((period) => [String(period), aggregatePeriod(product.monthly, period)]),
  ) as ProductOpportunity['periods']
  const latestThree = periods['3'].quantity
  const previousThree = aggregateSlice(product.monthly, 3, 6).quantity
  const growth = previousThree > 0 ? (latestThree - previousThree) / previousThree : null
  const coefficient = coefficientOfVariation(product.monthly.slice(-12).map((row) => row.quantity))
  const text = normalizeText([
    product.productName,
    product.categoryId,
    ...product.optionNames,
    JSON.stringify(product.metadata),
  ].filter(Boolean).join(' '))

  const scores: OpportunityScores = {
    demand: unverifiedScore('Assigned after portfolio percentile comparison.'),
    profitability: unverifiedScore('Assigned after portfolio percentile comparison.'),
    growth: growthScore(growth),
    stability: stabilityScore(coefficient),
    printability: keywordScore(text, {
      positive: config.keywords.printableObjects,
      negative: config.keywords.hardToPrintOrSubstitute,
      positiveReason: 'Product wording matches small passive object categories often suitable for FDM screening.',
      negativeReason: 'Product wording indicates a material or mechanism that PLA/FDM may not realistically substitute.',
    }),
    upgradePotential: keywordScore(text, {
      positive: config.keywords.upgradeFriendly,
      negative: config.keywords.lowUpgradePotential,
      positiveReason: 'Product wording indicates a form or usability problem that can be redesigned.',
      negativeReason: 'Product wording indicates a commodity or consumable with limited structural upgrade value.',
    }),
    premiumPotential: keywordScore(text, {
      positive: config.keywords.premiumFriendly,
      negative: [],
      positiveReason: 'Product wording indicates a visible home or desk object where CMF and form can affect purchase value.',
      negativeReason: '',
    }),
    safetyAndLegal: safetyScore(text, config.keywords.regulatedOrSafetyCritical),
    dataQuality: dataQualityScore(product),
  }

  const missingFields = [
    product.categoryId ? null : 'categoryId',
    product.basePrice == null ? 'basePrice' : null,
    product.costPrice == null ? 'costPrice' : null,
    product.images.length === 0 ? 'images' : null,
    hasMetadataField(product.metadata, ['dimensions', 'size', '치수']) ? null : 'dimensions',
    hasMetadataField(product.metadata, ['material', '소재', '재질']) ? null : 'material',
    product.repeatBuyerRate == null ? 'repeatBuyerRate' : null,
    periods['12'].quantity > 0 && periods['12'].productCost <= 0 ? 'profitCostBasis' : null,
  ].filter((value): value is string => Boolean(value))

  return {
    rank: 0,
    sku: product.sku,
    productName: product.productName,
    categoryId: product.categoryId,
    optionNames: product.optionNames,
    currentStock: product.currentStock,
    periods,
    latestThreeVsPreviousThreeGrowth: growth,
    monthlyCoefficientOfVariation: coefficient,
    scores,
    weightedScore: 0,
    confidence: 0,
    excluded: false,
    exclusionReasons: [],
    missingFields,
  }
}

function aggregatePeriod(rows: MonthlyProductMetrics[], months: number): PeriodMetrics {
  return aggregateRows(rows.slice(-months), months)
}

function aggregateSlice(rows: MonthlyProductMetrics[], startFromEnd: number, endFromEnd: number): PeriodMetrics {
  return aggregateRows(rows.slice(-endFromEnd, -startFromEnd), endFromEnd - startFromEnd)
}

function aggregateRows(rows: MonthlyProductMetrics[], months: number): PeriodMetrics {
  const total = rows.reduce((acc, row) => {
    acc.quantity += row.quantity
    acc.orderCount += row.orderCount
    acc.sales += row.sales
    acc.productCost += row.productCost
    acc.marketplaceFee += row.marketplaceFee
    acc.paidShippingFee += row.paidShippingFee
    acc.actualShippingFee += row.actualShippingFee
    acc.boxCost += row.boxCost
    acc.finalProfit += row.finalProfit
    acc.returnOrderCount += row.returnOrderCount
    return acc
  }, {
    quantity: 0,
    orderCount: 0,
    sales: 0,
    productCost: 0,
    marketplaceFee: 0,
    paidShippingFee: 0,
    actualShippingFee: 0,
    boxCost: 0,
    finalProfit: 0,
    returnOrderCount: 0,
  })

  return {
    months,
    ...total,
    profitRate: total.sales > 0 ? total.finalProfit / total.sales : null,
    returnOrderRate: total.orderCount > 0 ? total.returnOrderCount / total.orderCount : null,
    averageOrderQuantity: total.orderCount > 0 ? total.quantity / total.orderCount : null,
  }
}

function assignBusinessScores(candidates: ProductOpportunity[]) {
  assignPercentile(candidates, 'demand', (row) => row.periods['12'].quantity, '12-month sales quantity percentile')
  const profitEligible = candidates.filter((candidate) => !candidate.missingFields.includes('profitCostBasis'))
  assignPercentile(profitEligible, 'profitability', (row) => row.periods['12'].finalProfit, '12-month final profit percentile')
}

function assignPercentile(
  candidates: ProductOpportunity[],
  key: 'demand' | 'profitability',
  value: (candidate: ProductOpportunity) => number,
  reason: string,
) {
  const sorted = candidates.map(value).sort((a, b) => a - b)
  for (const candidate of candidates) {
    const raw = value(candidate)
    const belowOrEqual = sorted.filter((item) => item <= raw).length
    const percentile = sorted.length > 0 ? belowOrEqual / sorted.length : 0
    candidate.scores[key] = {
      score: clampScore(Math.ceil(percentile * 5)),
      reason: `${reason}; raw=${round(raw)}, percentile=${round(percentile * 100)}%.`,
      evidenceLevel: 'confirmed',
      source: 'metadata',
    }
  }
}

function growthScore(growth: number | null): ScreeningScore {
  if (growth == null) return unverifiedScore('Previous three-month quantity is zero; growth rate is not comparable.')
  const score = growth >= 0.5 ? 5 : growth >= 0.15 ? 4 : growth > -0.15 ? 3 : growth > -0.4 ? 2 : 1
  return {
    score,
    reason: `Latest 3 months versus previous 3 months quantity growth: ${round(growth * 100)}%.`,
    evidenceLevel: 'confirmed',
    source: 'metadata',
  }
}

function stabilityScore(coefficient: number | null): ScreeningScore {
  if (coefficient == null) return unverifiedScore('Monthly demand is absent or insufficient for variation scoring.')
  const score = coefficient <= 0.25 ? 5 : coefficient <= 0.5 ? 4 : coefficient <= 0.8 ? 3 : coefficient <= 1.2 ? 2 : 1
  return {
    score,
    reason: `12-month monthly quantity coefficient of variation: ${round(coefficient)}.`,
    evidenceLevel: 'confirmed',
    source: 'metadata',
  }
}

function keywordScore(
  text: string,
  rules: { positive: string[]; negative: string[]; positiveReason: string; negativeReason: string },
): ScreeningScore {
  const negative = rules.negative.find((keyword) => text.includes(normalizeText(keyword)))
  if (negative) {
    return {
      score: 1,
      reason: `${rules.negativeReason} Matched keyword: ${negative}. Physical verification is required.`,
      evidenceLevel: 'weak-signal',
      source: 'rule',
    }
  }
  const positive = rules.positive.find((keyword) => text.includes(normalizeText(keyword)))
  if (positive) {
    return {
      score: 4,
      reason: `${rules.positiveReason} Matched keyword: ${positive}. Physical verification is required.`,
      evidenceLevel: 'weak-signal',
      source: 'rule',
    }
  }
  return unverifiedScore('No reliable product-structure evidence was found in the registered text or metadata.')
}

function safetyScore(text: string, riskyKeywords: string[]): ScreeningScore {
  const matched = riskyKeywords.find((keyword) => text.includes(normalizeText(keyword)))
  if (matched) {
    return {
      score: 1,
      reason: `Potential safety, certification, food-contact, child-use, electrical, or load-bearing risk. Matched keyword: ${matched}.`,
      evidenceLevel: 'weak-signal',
      source: 'rule',
    }
  }
  return {
    score: 3,
    reason: 'No regulated or safety-critical keyword was detected, but legal and safety clearance has not been performed.',
    evidenceLevel: 'unverified',
    source: 'unverified',
  }
}

function dataQualityScore(product: ProductOpportunitySource): ScreeningScore {
  const checks = [
    Boolean(product.categoryId),
    product.basePrice != null,
    product.costPrice != null,
    product.images.length > 0,
    Object.keys(product.metadata).length > 0,
    product.currentStock != null,
    product.repeatBuyerRate != null,
  ]
  const ratio = checks.filter(Boolean).length / checks.length
  return {
    score: clampScore(Math.ceil(ratio * 5)),
    reason: `${checks.filter(Boolean).length}/${checks.length} core product and behavior fields are available.`,
    evidenceLevel: 'confirmed',
    source: 'metadata',
  }
}

function weightedScore(scores: OpportunityScores, config: OpportunityScoringConfig): number {
  let total = 0
  let weight = 0
  for (const key of Object.keys(config.weights) as Array<keyof OpportunityScores>) {
    const score = scores[key].score
    if (score == null) continue
    total += score * config.weights[key]
    weight += config.weights[key]
  }
  return weight > 0 ? round((total / weight) * 20) : 0
}

function scoreConfidence(scores: OpportunityScores): number {
  const entries = Object.values(scores)
  const confirmed = entries.filter((entry) => entry.evidenceLevel === 'confirmed').length
  const strong = entries.filter((entry) => entry.evidenceLevel === 'strong-signal').length
  const weak = entries.filter((entry) => entry.evidenceLevel === 'weak-signal').length
  return round(((confirmed + strong * 0.75 + weak * 0.35) / entries.length) * 100)
}

function exclusionReasons(candidate: ProductOpportunity, config: OpportunityScoringConfig): string[] {
  const reasons: string[] = []
  const printability = candidate.scores.printability.score
  const safety = candidate.scores.safetyAndLegal.score
  if (printability != null && printability < config.exclusion.minimumPrintability) {
    reasons.push(`Printability screening score ${printability} is below ${config.exclusion.minimumPrintability}.`)
  }
  if (safety != null && safety < config.exclusion.minimumSafetyAndLegal) {
    reasons.push(`Safety/legal screening score ${safety} is below ${config.exclusion.minimumSafetyAndLegal}.`)
  }
  if (candidate.periods['12'].quantity <= 0) reasons.push('No positive 12-month sales quantity.')
  return reasons
}

function unverifiedScore(reason: string): ScreeningScore {
  return { score: null, reason, evidenceLevel: 'unverified', source: 'unverified' }
}

function coefficientOfVariation(values: number[]): number | null {
  if (values.length === 0) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean <= 0) return null
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length
  return Math.sqrt(variance) / mean
}

function hasMetadataField(metadata: Record<string, unknown>, keys: string[]) {
  const text = normalizeText(JSON.stringify(metadata))
  return keys.some((key) => text.includes(normalizeText(key)))
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '')
}

function clampScore(value: number) {
  return Math.max(1, Math.min(5, value))
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
