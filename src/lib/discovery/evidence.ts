import { createHash } from 'node:crypto'
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as XLSX from 'xlsx'
import type { ProductOpportunitySource } from '@/lib/opportunities/types'

export const DISCOVERY_VERSION = '2.0.0'
export const DEFAULT_BUILD_VOLUME_MM = { x: 256, y: 256, z: 256 }

export type DiscoveryStatus =
  | 'insufficient-input'
  | 'internal-only'
  | 'official-loaded'
  | 'physical-loaded'
  | 'ready-for-market-research'
  | 'ready-for-concept-generation'

export type EvidenceLevel = 'measured' | 'human-provided' | 'official' | 'keyword-only' | 'unknown'

export type EvidenceValue<T> = {
  value: T | null
  evidenceLevel: EvidenceLevel
  sources: string[]
  reason: string | null
}

export type OfficialProductSource = {
  id: string
  code?: string
  name: string
  description?: string
  tags?: string
  imageUrl?: string
  thumbnailImages?: unknown
  detailImages?: unknown
  price?: number
  retailPrice?: number
  options?: unknown[]
  category?: { name?: string } | string
  productInfoNotice?: Array<{ label?: string; value?: string }>
  [key: string]: unknown
}

export type MeasurementsInput = {
  dimensionsMm?: { x?: number; y?: number; z?: number; width?: number; depth?: number; height?: number }
  widthMm?: number
  depthMm?: number
  heightMm?: number
  material?: string
  loadKg?: number
  mountingMethod?: string
  estimatedPrintTimeMinutes?: number
  estimatedFilamentGrams?: number
  measuredAt?: string
  notes?: string
  [key: string]: unknown
}

type Dimensions = { x: number; y: number; z: number }

export type HumanInputs = {
  measurements: MeasurementsInput | null
  reviews: Array<Record<string, unknown>>
  competitors: Array<Record<string, unknown>>
  notes: string | null
  productImages: Array<{
    fileName: string
    relativePath: string
    bytes: number
    sha256: string
  }>
  warnings: string[]
}

export type DiscoveryBundle = {
  manifest: Record<string, unknown>
  internalProduct: Record<string, unknown>
  officialProduct: Record<string, unknown>
  physicalEvidence: Record<string, unknown>
  printability: Record<string, unknown>
  evidenceGaps: Record<string, unknown>
  discoveryStatus: Record<string, unknown>
  report: string
}

export function findInternalProduct(products: ProductOpportunitySource[], sku: string) {
  const product = products.find((candidate) => candidate.sku === sku)
  if (!product) throw new Error(`SKU ${sku} was not found in the internal snapshot.`)
  return product
}

export async function loadHumanInputs(inputsRoot: string): Promise<HumanInputs> {
  const warnings: string[] = []
  const measurements = await optionalJson<MeasurementsInput>(
    path.join(inputsRoot, 'measurements.json'),
    warnings,
  )
  const reviews = await optionalTable(path.join(inputsRoot, 'reviews.csv'), warnings)
  const competitors = await optionalTable(path.join(inputsRoot, 'competitor-urls.csv'), warnings)
  const notes = await optionalText(path.join(inputsRoot, 'notes.md'), warnings)
  const productImages = await loadProductImages(path.join(inputsRoot, 'product-images'), inputsRoot, warnings)
  return { measurements, reviews, competitors, notes, productImages, warnings }
}

export function buildDiscoveryBundle(input: {
  product: ProductOpportunitySource
  snapshotMetadata?: Record<string, unknown>
  snapshotPath: string
  official: OfficialProductSource | null
  officialSourceUrl: string | null
  officialWarnings?: string[]
  human: HumanInputs
  inputsRoot: string
  buildVolumeMm?: Dimensions
  generatedAt?: string
}): DiscoveryBundle {
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const internal = normalizeInternalProduct(input.product)
  const official = normalizeOfficialProduct(input.official, input.officialSourceUrl)
  const physical = normalizePhysicalEvidence(input.human, input.inputsRoot)
  const printability = evaluatePrintability({
    productName: input.product.productName,
    official,
    measurements: input.human.measurements,
    buildVolumeMm: input.buildVolumeMm ?? DEFAULT_BUILD_VOLUME_MM,
  })
  const status = determineDiscoveryStatus({ internal, official, physical, printability, human: input.human })
  const gaps = buildEvidenceGaps({ internal, official, physical, printability, human: input.human, status })
  const warnings = [...(input.officialWarnings ?? []), ...input.human.warnings]

  const manifest = {
    schemaVersion: DISCOVERY_VERSION,
    generatedAt,
    sku: input.product.sku,
    productName: input.product.productName,
    status,
    sources: {
      internalSnapshot: input.snapshotPath,
      internalDataVersion: input.snapshotMetadata?.dataVersion ?? input.snapshotMetadata?.asOfDate ?? null,
      officialProduct: input.officialSourceUrl,
      humanInputsRoot: input.inputsRoot,
    },
    inputSummary: {
      officialLoaded: Boolean(input.official),
      measurementsLoaded: Boolean(input.human.measurements),
      productImageCount: input.human.productImages.length,
      reviewCount: input.human.reviews.length,
      competitorUrlCount: input.human.competitors.length,
      notesLoaded: Boolean(input.human.notes),
    },
    warnings,
    tool: { name: 'funtastic discover', version: DISCOVERY_VERSION },
  }

  const discoveryStatus = {
    status,
    generatedAt,
    gates: statusGates({ internal, official, physical, printability, human: input.human }),
    downstream: {
      marketResearch: 'not-performed',
      vocAnalysis: input.human.reviews.length > 0 ? 'input-loaded-not-analyzed' : 'not-performed',
      competitorResearch: input.human.competitors.length > 0 ? 'urls-loaded-not-researched' : 'not-performed',
      conceptGeneration: 'not-performed',
    },
  }

  return {
    manifest,
    internalProduct: internal,
    officialProduct: official,
    physicalEvidence: physical,
    printability,
    evidenceGaps: { status, gaps },
    discoveryStatus,
    report: discoveryReport({ internal, official, physical, printability, gaps, status, generatedAt }),
  }
}

export async function writeDiscoveryRun(input: {
  productRoot: string
  bundle: DiscoveryBundle
  now?: Date
}) {
  const discoveryRoot = path.join(input.productRoot, 'discovery')
  const runsRoot = path.join(discoveryRoot, 'runs')
  const currentRoot = path.join(discoveryRoot, 'current')
  const runId = await uniqueRunId(runsRoot, input.now ?? new Date())
  const runRoot = path.join(runsRoot, runId)
  await mkdir(runRoot, { recursive: false })

  const outputs: Array<[string, unknown, 'json' | 'text']> = [
    ['manifest.json', input.bundle.manifest, 'json'],
    ['internal-product.json', input.bundle.internalProduct, 'json'],
    ['official-product.json', input.bundle.officialProduct, 'json'],
    ['physical-evidence.json', input.bundle.physicalEvidence, 'json'],
    ['printability.json', input.bundle.printability, 'json'],
    ['evidence-gaps.json', input.bundle.evidenceGaps, 'json'],
    ['discovery-status.json', input.bundle.discoveryStatus, 'json'],
    ['discovery-report.md', input.bundle.report, 'text'],
  ]
  for (const [name, value, kind] of outputs) {
    const content = kind === 'json' ? `${JSON.stringify(value, null, 2)}\n` : String(value)
    await writeFile(path.join(runRoot, name), content)
  }

  await rm(currentRoot, { recursive: true, force: true })
  await cp(runRoot, currentRoot, { recursive: true })
  return { runId, runRoot, currentRoot }
}

function normalizeInternalProduct(product: ProductOpportunitySource) {
  const monthly = [...product.monthly].sort((a, b) => a.month.localeCompare(b.month))
  const latest3 = aggregate(monthly.slice(-3))
  const previous3 = aggregate(monthly.slice(-6, -3))
  const observed = aggregate(monthly)
  const trend = previous3.quantity > 0
    ? (latest3.quantity - previous3.quantity) / previous3.quantity
    : null
  return {
    evidenceLevel: 'internal-record',
    sku: product.sku,
    productName: product.productName,
    options: product.optionNames,
    categoryId: product.categoryId,
    basePrice: product.basePrice,
    costPrice: product.costPrice,
    currentStock: product.currentStock,
    stockoutEventCount: product.stockoutEventCount,
    repeatBuyerRate: product.repeatBuyerRate,
    recent: {
      latest3Months: latest3,
      previous3Months: previous3,
      observedPeriod: observed,
      latest3VsPrevious3QuantityGrowth: trend,
    },
    monthly,
    missing: [
      product.currentStock == null ? 'currentStock' : null,
      product.stockoutEventCount == null ? 'stockoutEventCount' : null,
      product.repeatBuyerRate == null ? 'repeatBuyerRate' : null,
    ].filter(Boolean),
  }
}

function normalizeOfficialProduct(source: OfficialProductSource | null, sourceUrl: string | null) {
  if (!source) {
    return {
      loaded: false,
      evidenceLevel: 'unknown',
      sourceUrl,
      productName: null,
      descriptionHtml: null,
      descriptionText: null,
      options: [],
      composition: unknown('No official product match was found.'),
      price: unknown('No official product match was found.'),
      images: [],
      dimensions: unknown('No official structured dimensions were found.'),
      material: unknown('No official structured material was found.'),
      mountingMethod: unknown('No official mounting statement was found.'),
    }
  }
  const notices = Array.isArray(source.productInfoNotice) ? source.productInfoNotice : []
  const descriptionText = htmlToText(source.description ?? '')
  const searchable = `${descriptionText} ${source.tags ?? ''}`
  const dimensionNotice = findNotice(notices, ['규격', '크기', '치수', '사이즈'])
  const materialNotice = findNotice(notices, ['소재', '재질'])
  const compositionNotice = findNotice(notices, ['구성', '수량', '구성품'])
  const optionNames = (Array.isArray(source.options) ? source.options : [])
    .map((option) => option && typeof option === 'object' && 'optionName' in option ? String(option.optionName ?? '') : '')
    .filter(Boolean)
  const mounting = explicitMountingMethod(searchable)
  const parsedOfficialDimensions = dimensionNotice?.value
    ? parseDimensionsFromText(dimensionNotice.value)
    : null
  return {
    loaded: true,
    evidenceLevel: 'official',
    sourceUrl,
    id: source.id,
    code: source.code ?? null,
    productName: source.name,
    category: typeof source.category === 'string' ? source.category : source.category?.name ?? null,
    descriptionHtml: source.description ?? null,
    descriptionText: descriptionText || null,
    options: Array.isArray(source.options) ? source.options : [],
    composition: compositionNotice
      ? known(compositionNotice.value, 'official', [sourceUrl], `Structured field: ${compositionNotice.label}`)
      : optionNames.length > 0
        ? known(optionNames, 'official', [sourceUrl], 'Composition-preserving option names from the official product record.')
        : unknown('No official structured composition field was found.'),
    price: known(source.price ?? source.retailPrice ?? null, 'official', [sourceUrl], null),
    images: officialImageUrls(source),
    dimensions: parsedOfficialDimensions
      ? known(parsedOfficialDimensions, 'official', [sourceUrl], `Structured field: ${dimensionNotice?.label}`)
      : unknown(dimensionNotice ? 'An official dimension field exists but could not be parsed into X/Y/Z.' : 'No official structured dimensions were found.'),
    material: materialNotice
      ? known(materialNotice.value, 'official', [sourceUrl], `Structured field: ${materialNotice.label}`)
      : unknown('No official structured material was found.'),
    mountingMethod: mounting
      ? known(mounting, 'official', [sourceUrl], 'Explicit term in official seller description or tags.')
      : unknown('No explicit official mounting statement was found.'),
    productInfoNotice: notices,
  }
}

function normalizePhysicalEvidence(human: HumanInputs, inputsRoot: string) {
  const measurementsSource = path.join(inputsRoot, 'measurements.json')
  return {
    loaded: Boolean(human.measurements) || human.productImages.length > 0,
    measurements: human.measurements ?? null,
    dimensionsMm: measuredDimensions(human.measurements),
    material: human.measurements?.material
      ? known(human.measurements.material, 'measured', [measurementsSource], null)
      : unknown('Material was not supplied in measurements.json.'),
    loadKg: finiteOrNull(human.measurements?.loadKg) != null
      ? known(Number(human.measurements?.loadKg), 'measured', [measurementsSource], null)
      : unknown('Load was not supplied in measurements.json.'),
    mountingMethod: human.measurements?.mountingMethod
      ? known(human.measurements.mountingMethod, 'measured', [measurementsSource], null)
      : unknown('Mounting method was not supplied in measurements.json.'),
    productImages: human.productImages,
    reviews: {
      loaded: human.reviews.length > 0,
      count: human.reviews.length,
      rows: human.reviews,
      evidenceLevel: human.reviews.length > 0 ? 'human-provided' : 'unknown',
    },
    competitorUrls: {
      loaded: human.competitors.length > 0,
      count: human.competitors.length,
      rows: human.competitors,
      evidenceLevel: human.competitors.length > 0 ? 'human-provided' : 'unknown',
    },
    notes: human.notes,
  }
}

function evaluatePrintability(input: {
  productName: string
  official: Record<string, unknown>
  measurements: MeasurementsInput | null
  buildVolumeMm: Dimensions
}) {
  const measured = measuredDimensions(input.measurements)
  const officialDimensions = evidenceValue<Dimensions>(input.official.dimensions)
  const dimensions = measured.value
    ? measured
    : officialDimensions.value
      ? officialDimensions
      : unknown<Dimensions>('No complete measured or official dimensions are available.')
  const measuredMaterial = input.measurements?.material
    ? known(input.measurements.material, 'measured', ['inputs/measurements.json'], null)
    : null
  const officialMaterial = evidenceValue<string>(input.official.material)
  const material = measuredMaterial ?? (officialMaterial.value ? officialMaterial : keywordMaterial(input.productName))
  const measuredMounting = input.measurements?.mountingMethod
    ? known(input.measurements.mountingMethod, 'measured', ['inputs/measurements.json'], null)
    : null
  const officialMounting = evidenceValue<string>(input.official.mountingMethod)
  const mounting = measuredMounting ?? (officialMounting.value ? officialMounting : unknown<string>('Mounting method is unknown.'))
  const load = finiteOrNull(input.measurements?.loadKg) != null
    ? known(Number(input.measurements?.loadKg), 'measured', ['inputs/measurements.json'], null)
    : unknown<number>('No measured or rated load is available.')

  const fits = dimensions.value ? fitsBuildVolume(dimensions.value, input.buildVolumeMm) : null
  const splitRequired = fits == null ? null : !fits
  const printTime = finiteOrNull(input.measurements?.estimatedPrintTimeMinutes) != null
    ? known(Number(input.measurements?.estimatedPrintTimeMinutes), 'human-provided', ['inputs/measurements.json'], 'User-supplied estimate; not independently sliced.')
    : unknown<number>('Mesh and slicer result are required for a defensible print-time estimate.')
  const filament = finiteOrNull(input.measurements?.estimatedFilamentGrams) != null
    ? known(Number(input.measurements?.estimatedFilamentGrams), 'human-provided', ['inputs/measurements.json'], 'User-supplied estimate; not independently sliced.')
    : unknown<number>('Mesh and slicer result are required for a defensible filament estimate.')
  const overallEvidence = dimensions.value ? dimensions.evidenceLevel : 'keyword-only'
  return {
    printerProfile: {
      printer: 'Bambu Lab P2S',
      buildVolumeMm: input.buildVolumeMm,
      source: 'https://blog.bambulab.com/the-icon-redefined-meet-the-p2s-a-completely-reengineered-version-of-the-ultra-productive-p1-series/',
      checkedAt: '2026-07-17',
    },
    expectedSizeMm: dimensions,
    expectedMaterial: material,
    expectedLoadKg: load,
    fasteningMethod: mounting,
    buildVolumeFit: {
      value: fits,
      evidenceLevel: fits == null ? 'unknown' : dimensions.evidenceLevel,
      reason: fits == null ? 'Complete dimensions are required.' : fits ? 'All dimensions fit after orientation.' : 'At least one oriented dimension exceeds the build volume.',
    },
    splitPrintRequired: {
      value: splitRequired,
      evidenceLevel: splitRequired == null ? 'unknown' : dimensions.evidenceLevel,
      reason: splitRequired == null ? 'Complete dimensions are required.' : splitRequired ? 'Build-volume fit failed.' : 'Bounding dimensions fit the configured build volume.',
    },
    estimatedPrintTimeMinutes: printTime,
    estimatedFilamentGrams: filament,
    overall: {
      verdict: fits == null ? 'unknown' : fits ? 'build-volume-fit' : 'build-volume-exceeded',
      evidenceLevel: overallEvidence,
      reason: fits == null
        ? `Only the product identity/name (${input.productName}) is available for structural screening; no numeric print claim is made.`
        : 'Verdict covers bounding-box fit only, not strength, support, bridge, tolerance, or material suitability.',
    },
  }
}

function determineDiscoveryStatus(input: {
  internal: Record<string, unknown>
  official: Record<string, unknown>
  physical: Record<string, unknown>
  printability: Record<string, unknown>
  human: HumanInputs
}): DiscoveryStatus {
  if (!input.internal.sku || !input.internal.productName) return 'insufficient-input'
  const officialLoaded = input.official.loaded === true
  const physicalLoaded = input.physical.loaded === true
  // Raw reviews and competitor URLs are inputs, not completed market research.
  // This sprint deliberately cannot promote a product to concept generation.
  if (officialLoaded && physicalLoaded) return 'ready-for-market-research'
  if (physicalLoaded) return 'physical-loaded'
  if (officialLoaded) return 'official-loaded'
  return 'internal-only'
}

function isDirectEvidence<T>(evidence: EvidenceValue<T>) {
  return evidence.value != null && ['measured', 'human-provided', 'official'].includes(evidence.evidenceLevel)
}

function statusGates(input: {
  internal: Record<string, unknown>
  official: Record<string, unknown>
  physical: Record<string, unknown>
  printability: Record<string, unknown>
  human: HumanInputs
}) {
  const dimensions = evidenceValue<Dimensions>(input.printability.expectedSizeMm)
  const material = evidenceValue<string>(input.printability.expectedMaterial)
  const mounting = evidenceValue<string>(input.printability.fasteningMethod)
  return {
    internalProductLoaded: Boolean(input.internal.sku && input.internal.productName),
    officialProductLoaded: input.official.loaded === true,
    physicalEvidenceLoaded: input.physical.loaded === true,
    completeDimensionsKnown: Boolean(dimensions.value),
    dimensionsDirectEvidence: isDirectEvidence(dimensions),
    materialKnown: Boolean(material.value),
    materialDirectEvidence: isDirectEvidence(material),
    mountingMethodKnown: Boolean(mounting.value),
    mountingDirectEvidence: isDirectEvidence(mounting),
    reviewsLoaded: input.human.reviews.length > 0,
    competitorUrlsLoaded: input.human.competitors.length > 0,
    marketResearchCompleted: false,
    conceptGenerationGateOpen: false,
  }
}

function buildEvidenceGaps(input: {
  internal: Record<string, unknown>
  official: Record<string, unknown>
  physical: Record<string, unknown>
  printability: Record<string, unknown>
  human: HumanInputs
  status: DiscoveryStatus
}) {
  const gaps: Array<{ field: string; severity: 'critical' | 'important'; reason: string; requiredFor: string }> = []
  const add = (field: string, severity: 'critical' | 'important', reason: string, requiredFor: string) => gaps.push({ field, severity, reason, requiredFor })
  if (input.official.loaded !== true) add('officialProduct', 'important', 'No official product match was loaded.', 'official-loaded')
  if (!evidenceValue<Dimensions>(input.printability.expectedSizeMm).value) add('dimensions', 'critical', 'Complete X/Y/Z dimensions are unknown.', 'printability and concept generation')
  if (!evidenceValue<string>(input.printability.expectedMaterial).value) add('material', 'critical', 'Material is unknown.', 'material suitability')
  if (!evidenceValue<number>(input.printability.expectedLoadKg).value) add('load', 'important', 'Rated or measured load is unknown.', 'structural review')
  if (!evidenceValue<string>(input.printability.fasteningMethod).value) add('mountingMethod', 'critical', 'Mounting or fastening method is unknown.', 'use and failure analysis')
  if (input.human.productImages.length === 0) add('physicalImages', 'important', 'No human-supplied physical product images were loaded.', 'identity and construction verification')
  if (input.human.reviews.length === 0) add('reviews', 'important', 'No human-supplied customer reviews were loaded.', 'VOC evidence')
  if (input.human.competitors.length === 0) add('competitorUrls', 'important', 'No competitor URLs were loaded.', 'market research')
  if (!evidenceValue<number>(input.printability.estimatedPrintTimeMinutes).value) add('printTime', 'important', 'No mesh/slicer evidence or user estimate exists.', 'production estimate')
  if (!evidenceValue<number>(input.printability.estimatedFilamentGrams).value) add('filamentUsage', 'important', 'No mesh/slicer evidence or user estimate exists.', 'production estimate')
  return gaps
}

function discoveryReport(input: {
  internal: Record<string, unknown>
  official: Record<string, unknown>
  physical: Record<string, unknown>
  printability: Record<string, unknown>
  gaps: Array<{ field: string; severity: string; reason: string; requiredFor: string }>
  status: DiscoveryStatus
  generatedAt: string
}) {
  const recent = input.internal.recent as Record<string, unknown>
  const latest = recent.latest3Months as Record<string, number>
  const observed = recent.observedPeriod as Record<string, number>
  const fit = input.printability.buildVolumeFit as Record<string, unknown>
  const size = evidenceValue<Dimensions>(input.printability.expectedSizeMm)
  const material = evidenceValue<string>(input.printability.expectedMaterial)
  const mounting = evidenceValue<string>(input.printability.fasteningMethod)
  return `# Discovery Evidence Report

- Generated: ${input.generatedAt}
- SKU: ${input.internal.sku}
- Product: ${input.internal.productName}
- Discovery status: **${input.status}**

## Internal Evidence

- Latest 3-month quantity: ${latest.quantity}
- Observed quantity / sales / final profit: ${observed.quantity} / ${observed.sales} / ${observed.finalProfit}
- Current stock: ${formatUnknown(input.internal.currentStock)}
- Repeat buyer rate: ${formatUnknown(input.internal.repeatBuyerRate)}
- Stockout events: ${formatUnknown(input.internal.stockoutEventCount)}

## Official Evidence

- Loaded: ${input.official.loaded}
- Official product: ${formatUnknown(input.official.productName)}
- Official source: ${formatUnknown(input.official.sourceUrl)}
- Official images: ${Array.isArray(input.official.images) ? input.official.images.length : 0}

## Physical Evidence

- Loaded: ${input.physical.loaded}
- Human product images: ${Array.isArray(input.physical.productImages) ? input.physical.productImages.length : 0}
- Reviews loaded: ${(input.physical.reviews as Record<string, unknown>).count}
- Competitor URLs loaded: ${(input.physical.competitorUrls as Record<string, unknown>).count}

## Printability Evidence

- Expected size: ${size.value ? `${size.value.x} x ${size.value.y} x ${size.value.z} mm` : 'unknown'} (${size.evidenceLevel})
- Expected material: ${formatUnknown(material.value)} (${material.evidenceLevel})
- Mounting method: ${formatUnknown(mounting.value)} (${mounting.evidenceLevel})
- Build-volume fit: ${formatUnknown(fit.value)} (${fit.evidenceLevel})
- Print time: unknown unless supplied by slicer/user evidence
- Filament usage: unknown unless supplied by slicer/user evidence

## Evidence Gaps

${input.gaps.length > 0 ? input.gaps.map((gap) => `- [${gap.severity}] ${gap.field}: ${gap.reason}`).join('\n') : '- None'}

## Work Not Performed

- Market research
- VOC interpretation
- Competitor page research
- Concept generation
`
}

function aggregate(rows: ProductOpportunitySource['monthly']) {
  return rows.reduce((sum, row) => ({
    months: sum.months + 1,
    quantity: sum.quantity + row.quantity,
    orderCount: sum.orderCount + row.orderCount,
    sales: sum.sales + row.sales,
    finalProfit: sum.finalProfit + row.finalProfit,
    returnOrderCount: sum.returnOrderCount + row.returnOrderCount,
  }), { months: 0, quantity: 0, orderCount: 0, sales: 0, finalProfit: 0, returnOrderCount: 0 })
}

function measuredDimensions(input: MeasurementsInput | null): EvidenceValue<Dimensions> {
  const nested = input?.dimensionsMm
  const x = finiteOrNull(nested?.x ?? nested?.width ?? input?.widthMm)
  const y = finiteOrNull(nested?.y ?? nested?.depth ?? input?.depthMm)
  const z = finiteOrNull(nested?.z ?? nested?.height ?? input?.heightMm)
  if (x == null || y == null || z == null) return unknown('Complete dimensions were not supplied in measurements.json.')
  return known({ x, y, z }, 'measured', ['inputs/measurements.json'], null)
}

function fitsBuildVolume(part: Dimensions, build: Dimensions) {
  const partDimensions = [part.x, part.y, part.z].sort((a, b) => a - b)
  const buildDimensions = [build.x, build.y, build.z].sort((a, b) => a - b)
  return partDimensions.every((dimension, index) => dimension <= buildDimensions[index])
}

function keywordMaterial(productName: string): EvidenceValue<string> {
  const keywords = ['철제', '스테인리스', '알루미늄', '유리', '실리콘', '목재', '나무']
  const matched = keywords.find((keyword) => productName.includes(keyword))
  return matched
    ? known(matched, 'keyword-only', ['internal product name'], 'Material-like term appears only in the product name; verification is required.')
    : unknown('No material evidence is available.')
}

function parseDimensionsFromText(value: string): Dimensions | null {
  const normalized = value.replace(/,/g, '.').toLowerCase()
  const unit = normalized.includes('cm') ? 10 : 1
  const numbers = [...normalized.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]) * unit)
  if (numbers.length < 3) return null
  return { x: numbers[0], y: numbers[1], z: numbers[2] }
}

function explicitMountingMethod(text: string) {
  const methods: Array<[RegExp, string]> = [
    [/양면\s*테이프|접착|부착식/, 'adhesive'],
    [/자석|마그넷/, 'magnetic'],
    [/흡착|석션/, 'suction'],
    [/나사|피스|스크[류루]/, 'screw'],
    [/클램프|집게/, 'clamp'],
  ]
  return methods.find(([pattern]) => pattern.test(text))?.[1] ?? null
}

function officialImageUrls(source: OfficialProductSource) {
  const urls = new Set<string>()
  if (typeof source.imageUrl === 'string') urls.add(source.imageUrl)
  for (const values of [source.thumbnailImages, source.detailImages]) {
    if (Array.isArray(values)) for (const value of values) if (typeof value === 'string') urls.add(value)
  }
  for (const match of (source.description ?? '').matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    if (/^https?:\/\//.test(match[1])) urls.add(match[1])
  }
  return [...urls]
}

function findNotice(notices: Array<{ label?: string; value?: string }>, terms: string[]) {
  return notices.find((notice) => terms.some((term) => notice.label?.includes(term)) && notice.value)
}

function htmlToText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function evidenceValue<T>(value: unknown): EvidenceValue<T> {
  if (value && typeof value === 'object' && 'evidenceLevel' in value && 'value' in value) return value as EvidenceValue<T>
  return unknown('Evidence value is absent or malformed.')
}

function known<T>(value: T, evidenceLevel: EvidenceLevel, sources: Array<string | null>, reason: string | null): EvidenceValue<T> {
  return { value, evidenceLevel, sources: sources.filter((source): source is string => Boolean(source)), reason }
}

function unknown<T>(reason: string): EvidenceValue<T> {
  return { value: null, evidenceLevel: 'unknown', sources: [], reason }
}

function finiteOrNull(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function formatUnknown(value: unknown) {
  return value == null || value === '' ? 'unknown' : String(value)
}

async function optionalJson<T>(target: string, warnings: string[]): Promise<T | null> {
  if (!await exists(target)) return null
  try {
    return JSON.parse(await readFile(target, 'utf8')) as T
  } catch (error) {
    warnings.push(`${target}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function optionalTable(target: string, warnings: string[]) {
  if (!await exists(target)) return []
  try {
    const workbook = XLSX.read(await readFile(target), { type: 'buffer', raw: false })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return []
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' })
  } catch (error) {
    warnings.push(`${target}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

async function optionalText(target: string, warnings: string[]) {
  if (!await exists(target)) return null
  try {
    return await readFile(target, 'utf8')
  } catch (error) {
    warnings.push(`${target}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function loadProductImages(directory: string, inputsRoot: string, warnings: string[]) {
  if (!await exists(directory)) return []
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const images = []
    for (const entry of entries.filter((candidate) => candidate.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!/\.(jpe?g|png|webp|gif|heic)$/i.test(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      const [buffer, details] = await Promise.all([readFile(absolute), stat(absolute)])
      images.push({
        fileName: entry.name,
        relativePath: path.relative(inputsRoot, absolute),
        bytes: details.size,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      })
    }
    return images
  } catch (error) {
    warnings.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

async function uniqueRunId(runsRoot: string, now: Date) {
  await mkdir(runsRoot, { recursive: true })
  const base = now.toISOString().replace(/[:.]/g, '-')
  let candidate = base
  let suffix = 1
  while (await exists(path.join(runsRoot, candidate))) candidate = `${base}-${suffix++}`
  return candidate
}

async function exists(target: string) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}
