export type EvidenceLevel = 'confirmed' | 'strong-signal' | 'weak-signal' | 'unverified'

export type MonthlyProductMetrics = {
  month: string
  quantity: number
  orderCount: number
  sales: number
  productCost: number
  marketplaceFee: number
  paidShippingFee: number
  actualShippingFee: number
  boxCost: number
  finalProfit: number
  returnOrderCount: number
}

export type ProductMasterData = {
  sku: string
  productName: string
  optionNames: string[]
  categoryId: string | null
  basePrice: number | null
  costPrice: number | null
  currentStock: number | null
  images: Array<{ url: string; sortOrder: number }>
  metadata: Record<string, unknown>
  stockoutEventCount: number | null
  repeatBuyerRate: number | null
}

export type ProductOpportunitySource = ProductMasterData & {
  monthly: MonthlyProductMetrics[]
}

export type PeriodMetrics = {
  months: number
  quantity: number
  orderCount: number
  sales: number
  productCost: number
  marketplaceFee: number
  paidShippingFee: number
  actualShippingFee: number
  boxCost: number
  finalProfit: number
  profitRate: number | null
  returnOrderCount: number
  returnOrderRate: number | null
  averageOrderQuantity: number | null
}

export type ScreeningScore = {
  score: number | null
  reason: string
  evidenceLevel: EvidenceLevel
  source: 'rule' | 'metadata' | 'manual' | 'unverified'
}

export type OpportunityScores = {
  demand: ScreeningScore
  profitability: ScreeningScore
  growth: ScreeningScore
  stability: ScreeningScore
  printability: ScreeningScore
  upgradePotential: ScreeningScore
  premiumPotential: ScreeningScore
  safetyAndLegal: ScreeningScore
  dataQuality: ScreeningScore
}

export type ProductOpportunity = {
  rank: number
  sku: string
  productName: string
  categoryId: string | null
  optionNames: string[]
  currentStock: number | null
  periods: Record<'3' | '6' | '12', PeriodMetrics>
  latestThreeVsPreviousThreeGrowth: number | null
  monthlyCoefficientOfVariation: number | null
  scores: OpportunityScores
  weightedScore: number
  confidence: number
  excluded: boolean
  exclusionReasons: string[]
  missingFields: string[]
}

export type OpportunityRun = {
  metadata: {
    generatedAt: string
    asOfDate: string
    periods: number[]
    source: string
    dataVersion: string
    scoringVersion: string
    userId: string
    timezone: string
    notes: string[]
  }
  dataAudit: {
    available: string[]
    partial: string[]
    unavailable: string[]
  }
  products: ProductOpportunity[]
}

export type OpportunityScoringConfig = {
  version: string
  weights: Record<keyof OpportunityScores, number>
  exclusion: {
    minimumPrintability: number
    minimumSafetyAndLegal: number
  }
  keywords: {
    printableObjects: string[]
    hardToPrintOrSubstitute: string[]
    upgradeFriendly: string[]
    lowUpgradePotential: string[]
    premiumFriendly: string[]
    regulatedOrSafetyCritical: string[]
  }
}
