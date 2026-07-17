import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as XLSX from 'xlsx'

export const RESEARCH_VERSION = '1.0.0'

export type ResearchStatus = 'empty' | 'reviews-loaded' | 'competitors-loaded' | 'market-evidence-ready'

export type DiscoveryEvidence = {
  internalProduct: Record<string, unknown>
  officialProduct: Record<string, unknown>
  physicalEvidence: Record<string, unknown>
  discoveryStatus: Record<string, unknown>
  sourceRoot: string
}

type SourceRow = { file: string; row: number; values: Record<string, unknown> }

export type ResearchInputs = {
  reviews: SourceRow[]
  competitorRows: SourceRow[]
  reddit: string | null
  notes: string | null
  warnings: string[]
  loadedFiles: string[]
}

type NormalizedReview = {
  reviewId: string | null
  reviewText: string | null
  rating: number | null
  date: string | null
  channel: string | null
  url: string | null
  problem: string | null
  useCase: string | null
  source: { file: string; row: number }
}

type Competitor = {
  brand: string | null
  productName: string | null
  price: number | null
  currency: string | null
  country: string | null
  mountingMethod: string | null
  material: string | null
  features: string[]
  differentiation: string | null
  url: string
  marketplace: string | null
  source: { file: string; row: number }
}

export type ResearchBundle = {
  marketEvidence: {
    schemaVersion: string
    generatedAt: string
    sku: string
    productName: string | null
    discovery: Record<string, unknown>
    productEvidence: {
      internal: Record<string, unknown>
      official: Record<string, unknown>
      physical: Record<string, unknown>
    }
    inputSources: { researchRoot: string; files: string[] }
    inputSummary: Record<string, number | boolean>
    reviews: NormalizedReview[]
    unstructuredEvidence: Array<{ type: string; source: string; content: string }>
    rejectedEvidence: Array<{ source: string; row: number; reason: string; value: string | null }>
    warnings: string[]
  }
  competitors: { items: Competitor[] }
  customerProblems: { items: Array<Record<string, unknown>>; derivationRule: string }
  customerUseCases: { items: Array<Record<string, unknown>>; derivationRule: string }
  premiumBrands: { items: Array<Record<string, unknown>>; derivationRule: string }
  researchStatus: Record<string, unknown> & { status: ResearchStatus }
  report: string
}

export async function loadResearchInputs(researchRoot: string): Promise<ResearchInputs> {
  const warnings: string[] = []
  const loadedFiles: string[] = []
  const reviews = await optionalTable(path.join(researchRoot, 'reviews.csv'), warnings, loadedFiles)
  const competitorRows = (
    await Promise.all([
      optionalTable(path.join(researchRoot, 'competitor-urls.csv'), warnings, loadedFiles),
      optionalTable(path.join(researchRoot, 'amazon-links.csv'), warnings, loadedFiles),
      optionalTable(path.join(researchRoot, 'taobao-links.csv'), warnings, loadedFiles),
    ])
  ).flat()
  const reddit = await optionalText(path.join(researchRoot, 'reddit.md'), warnings, loadedFiles)
  const notes = await optionalText(path.join(researchRoot, 'notes.md'), warnings, loadedFiles)
  return { reviews, competitorRows, reddit, notes, warnings, loadedFiles }
}

export function buildResearchBundle(input: {
  sku: string
  discovery: DiscoveryEvidence
  inputs: ResearchInputs
  researchRoot: string
  generatedAt?: string
}): ResearchBundle {
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const reviews = deduplicateReviews(input.inputs.reviews.map(normalizeReview))
  const { items: competitors, rejected } = normalizeCompetitors(input.inputs.competitorRows)
  const customerProblems = aggregateExplicitEvidence(reviews, 'problem')
  const customerUseCases = aggregateExplicitEvidence(reviews, 'useCase')
  const premiumBrands = normalizePremiumBrands(input.inputs.competitorRows, competitors)
  const status = determineStatus(reviews.length, competitors.length)
  const unstructuredEvidence = [
    input.inputs.reddit ? { type: 'reddit-notes', source: 'reddit.md', content: input.inputs.reddit } : null,
    input.inputs.notes ? { type: 'research-notes', source: 'notes.md', content: input.inputs.notes } : null,
  ].filter((value): value is { type: string; source: string; content: string } => Boolean(value))
  const duplicateReviewCount = input.inputs.reviews.length - reviews.length
  const discoveryStatus = stringValue(input.discovery.discoveryStatus.status)
  const productName = stringValue(input.discovery.internalProduct.productName)

  const marketEvidence: ResearchBundle['marketEvidence'] = {
    schemaVersion: RESEARCH_VERSION,
    generatedAt,
    sku: input.sku,
    productName,
    discovery: {
      sourceRoot: input.discovery.sourceRoot,
      status: discoveryStatus,
      officialLoaded: input.discovery.officialProduct.loaded === true,
      physicalLoaded: input.discovery.physicalEvidence.loaded === true,
    },
    productEvidence: {
      internal: input.discovery.internalProduct,
      official: input.discovery.officialProduct,
      physical: input.discovery.physicalEvidence,
    },
    inputSources: {
      researchRoot: input.researchRoot,
      files: [...input.inputs.loadedFiles].sort(),
    },
    inputSummary: {
      rawReviewCount: input.inputs.reviews.length,
      uniqueReviewCount: reviews.length,
      duplicateReviewCount,
      rawCompetitorRowCount: input.inputs.competitorRows.length,
      validCompetitorCount: competitors.length,
      invalidUrlCount: rejected.length,
      redditLoaded: Boolean(input.inputs.reddit),
      notesLoaded: Boolean(input.inputs.notes),
    },
    reviews,
    unstructuredEvidence,
    rejectedEvidence: rejected,
    warnings: input.inputs.warnings,
  }

  const researchStatus = {
    status,
    generatedAt,
    gates: {
      discoveryLoaded: true,
      reviewsLoaded: reviews.length > 0,
      competitorsLoaded: competitors.length > 0,
      explicitCustomerProblemsFound: customerProblems.length > 0,
      explicitUseCasesFound: customerUseCases.length > 0,
    },
    marketResearch: status === 'market-evidence-ready' ? 'evidence-normalized' : 'insufficient-evidence',
    conceptGeneration: 'not-performed',
  }

  return {
    marketEvidence,
    competitors: { items: competitors },
    customerProblems: {
      items: customerProblems,
      derivationRule: 'Only non-empty problem/customer_problem fields explicitly supplied in reviews.csv are counted.',
    },
    customerUseCases: {
      items: customerUseCases,
      derivationRule: 'Only non-empty use_case/usage/purpose fields explicitly supplied in reviews.csv are counted.',
    },
    premiumBrands: {
      items: premiumBrands,
      derivationRule: 'A brand is included only when the source row explicitly marks it premium or supplies premium_brand.',
    },
    researchStatus,
    report: researchReport({
      sku: input.sku,
      productName,
      status,
      reviews,
      competitors,
      customerProblems,
      customerUseCases,
      premiumBrands,
      rejected,
      unstructuredEvidence,
      generatedAt,
    }),
  }
}

export async function writeResearchRun(input: { researchRoot: string; bundle: ResearchBundle; now?: Date }) {
  const runsRoot = path.join(input.researchRoot, 'runs')
  const currentRoot = path.join(input.researchRoot, 'current')
  const runId = await uniqueRunId(runsRoot, input.now ?? new Date())
  const runRoot = path.join(runsRoot, runId)
  await mkdir(runRoot, { recursive: false })
  const outputs: Array<[string, unknown, boolean]> = [
    ['market-evidence.json', input.bundle.marketEvidence, true],
    ['competitors.json', input.bundle.competitors, true],
    ['customer-problems.json', input.bundle.customerProblems, true],
    ['customer-use-cases.json', input.bundle.customerUseCases, true],
    ['premium-brands.json', input.bundle.premiumBrands, true],
    ['research-status.json', input.bundle.researchStatus, true],
    ['research-report.md', input.bundle.report, false],
  ]
  for (const [name, value, json] of outputs) {
    await writeFile(path.join(runRoot, name), json ? `${JSON.stringify(value, null, 2)}\n` : String(value))
  }
  await rm(currentRoot, { recursive: true, force: true })
  await cp(runRoot, currentRoot, { recursive: true })
  return { runId, runRoot, currentRoot }
}

function normalizeReview(row: SourceRow): NormalizedReview {
  const values = normalizedKeys(row.values)
  const rawRating = numberValue(pick(values, ['rating', 'score', 'stars', '별점']))
  return {
    reviewId: stringValue(pick(values, ['review_id', 'reviewid', 'id', '리뷰id'])),
    reviewText: stringValue(pick(values, ['review', 'review_text', 'text', 'content', '리뷰', '후기'])),
    rating: rawRating,
    date: stringValue(pick(values, ['date', 'review_date', 'created_at', '작성일'])),
    channel: stringValue(pick(values, ['channel', 'marketplace', 'source', '채널', '판매처'])),
    url: validUrlOrNull(stringValue(pick(values, ['url', 'review_url', 'link']))),
    problem: stringValue(pick(values, ['problem', 'customer_problem', 'pain_point', '고객문제', '불편'])),
    useCase: stringValue(pick(values, ['use_case', 'usecase', 'usage', 'purpose', '사용목적', '용도'])),
    source: { file: row.file, row: row.row },
  }
}

function deduplicateReviews(reviews: NormalizedReview[]) {
  const seen = new Set<string>()
  return reviews.filter((review) => {
    const key = review.reviewId
      ? `id:${normalizeText(review.reviewId)}`
      : `content:${[review.channel, review.url, review.reviewText, review.date, review.rating].map((value) => normalizeText(String(value ?? ''))).join('|')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeCompetitors(rows: SourceRow[]) {
  const rejected: Array<{ source: string; row: number; reason: string; value: string | null }> = []
  const byUrl = new Map<string, Competitor>()
  for (const row of rows) {
    const values = normalizedKeys(row.values)
    const rawUrl = stringValue(pick(values, ['url', 'product_url', 'link', '상품url', '링크']))
    const url = validUrlOrNull(rawUrl)
    if (!url) {
      rejected.push({ source: row.file, row: row.row, reason: 'missing-or-invalid-http-url', value: rawUrl })
      continue
    }
    if (byUrl.has(url)) continue
    byUrl.set(url, {
      brand: stringValue(pick(values, ['brand', '브랜드'])),
      productName: stringValue(pick(values, ['product_name', 'product', 'name', '상품명'])),
      price: numberValue(pick(values, ['price', '가격'])),
      currency: stringValue(pick(values, ['currency', '통화'])),
      country: stringValue(pick(values, ['country', '국가'])),
      mountingMethod: stringValue(pick(values, ['mounting_method', 'mounting', 'installation', '장착방식', '설치방식'])),
      material: stringValue(pick(values, ['material', '소재', '재질'])),
      features: listValue(pick(values, ['features', 'feature', '특징'])),
      differentiation: stringValue(pick(values, ['differentiation', 'difference', '차별점'])),
      url,
      marketplace: stringValue(pick(values, ['marketplace', 'channel', '판매처'])),
      source: { file: row.file, row: row.row },
    })
  }
  return { items: [...byUrl.values()], rejected }
}

function normalizePremiumBrands(rows: SourceRow[], competitors: Competitor[]) {
  const competitorByUrl = new Map(competitors.map((item) => [item.url, item]))
  const brands = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const values = normalizedKeys(row.values)
    const premiumBrand = stringValue(pick(values, ['premium_brand', 'premiumbrand', '프리미엄브랜드']))
    const explicitlyPremium = booleanValue(pick(values, ['is_premium', 'premium', '프리미엄']))
    if (!premiumBrand && !explicitlyPremium) continue
    const url = validUrlOrNull(stringValue(pick(values, ['url', 'product_url', 'link', '상품url', '링크'])))
    if (!url) continue
    const competitor = competitorByUrl.get(url)
    if (!competitor) continue
    const brand = premiumBrand ?? competitor?.brand ?? stringValue(pick(values, ['brand', '브랜드']))
    if (!brand) continue
    const key = normalizeText(brand)
    if (brands.has(key)) continue
    brands.set(key, {
      brand,
      designCharacteristics: listValue(pick(values, ['design_characteristics', 'design_features', '디자인특징'])),
      cmfCharacteristics: listValue(pick(values, ['cmf_characteristics', 'cmf', 'cmf특징'])),
      material: competitor?.material ?? stringValue(pick(values, ['material', '소재', '재질'])),
      form: stringValue(pick(values, ['form', 'shape', '형태'])),
      evidence: { source: row.file, row: row.row, url },
    })
  }
  return [...brands.values()]
}

function aggregateExplicitEvidence(reviews: NormalizedReview[], field: 'problem' | 'useCase') {
  const groups = new Map<string, { label: string; evidence: Array<Record<string, unknown>> }>()
  for (const review of reviews) {
    const label = review[field]
    if (!label) continue
    const key = normalizeText(label)
    const group = groups.get(key) ?? { label, evidence: [] }
    group.evidence.push({
      reviewId: review.reviewId,
      reviewText: review.reviewText,
      source: review.source,
    })
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({
    [field === 'problem' ? 'problem' : 'useCase']: group.label,
    occurrenceCount: group.evidence.length,
    evidence: group.evidence,
    evidenceLevel: 'human-provided-explicit-field',
  }))
}

function determineStatus(reviewCount: number, competitorCount: number): ResearchStatus {
  if (reviewCount > 0 && competitorCount > 0) return 'market-evidence-ready'
  if (reviewCount > 0) return 'reviews-loaded'
  if (competitorCount > 0) return 'competitors-loaded'
  return 'empty'
}

function researchReport(input: {
  sku: string
  productName: string | null
  status: ResearchStatus
  reviews: NormalizedReview[]
  competitors: Competitor[]
  customerProblems: Array<Record<string, unknown>>
  customerUseCases: Array<Record<string, unknown>>
  premiumBrands: Array<Record<string, unknown>>
  rejected: Array<Record<string, unknown>>
  unstructuredEvidence: Array<Record<string, unknown>>
  generatedAt: string
}) {
  const list = (items: Array<Record<string, unknown>>, field: string) => items.length
    ? items.map((item) => `- ${String(item[field])} (${String(item.occurrenceCount ?? 'explicit evidence')})`).join('\n')
    : '- unknown: no explicit evidence was supplied.'
  return `# Market Evidence Report\n\n- SKU: ${input.sku}\n- Product: ${input.productName ?? 'unknown'}\n- Generated: ${input.generatedAt}\n- Status: ${input.status}\n\n## Evidence Summary\n\n- Unique reviews: ${input.reviews.length}\n- Valid competitors: ${input.competitors.length}\n- Explicit premium brands: ${input.premiumBrands.length}\n- Invalid competitor URLs: ${input.rejected.length}\n- Unstructured evidence files: ${input.unstructuredEvidence.length}\n\n## Customer Problems\n\n${list(input.customerProblems, 'problem')}\n\n## Customer Use Cases\n\n${list(input.customerUseCases, 'useCase')}\n\n## Guardrails\n\nReview text is preserved but not interpreted into problems or use cases. Only explicit input fields are aggregated. Competitors and premium brands are never invented.\n`
}

async function optionalTable(target: string, warnings: string[], loadedFiles: string[]): Promise<SourceRow[]> {
  try {
    const workbook = XLSX.read(await readFile(target), { type: 'buffer', raw: false })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    if (!sheet) return []
    loadedFiles.push(path.basename(target))
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null }).map((values, index) => ({
      file: path.basename(target),
      row: index + 2,
      values,
    }))
  } catch (error) {
    if (isMissing(error)) return []
    warnings.push(`${path.basename(target)} could not be read: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

async function optionalText(target: string, warnings: string[], loadedFiles: string[]) {
  try {
    const value = await readFile(target, 'utf8')
    loadedFiles.push(path.basename(target))
    return value.trim() || null
  } catch (error) {
    if (isMissing(error)) return null
    warnings.push(`${path.basename(target)} could not be read: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function normalizedKeys(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [normalizeHeader(key), value]))
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function pick(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (record[key] != null && record[key] !== '') return record[key]
  return null
}

function stringValue(value: unknown) {
  if (value == null) return null
  const result = String(value).trim()
  return result || null
}

function numberValue(value: unknown) {
  if (value == null || value === '') return null
  const result = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(result) ? result : null
}

function booleanValue(value: unknown) {
  if (value === true) return true
  if (value == null) return false
  return ['true', 'yes', 'y', '1', 'premium', '예', '프리미엄'].includes(normalizeText(String(value)))
}

function listValue(value: unknown) {
  const text = stringValue(value)
  return text ? text.split(/[|;,]/).map((item) => item.trim()).filter(Boolean) : []
}

function validUrlOrNull(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isMissing(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function uniqueRunId(runsRoot: string, now: Date) {
  await mkdir(runsRoot, { recursive: true })
  const base = now.toISOString().replace(/[:.]/g, '-')
  let candidate = base
  let suffix = 1
  while (true) {
    try {
      await mkdir(path.join(runsRoot, candidate), { recursive: false })
      await rm(path.join(runsRoot, candidate), { recursive: true, force: true })
      return candidate
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      candidate = `${base}-${suffix++}`
    }
  }
}

function isAlreadyExists(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
