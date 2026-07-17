import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

type InternalSource = {
  capturedAt?: string
  snapshot?: Record<string, unknown>
  product: {
    sku: string
    productName: string
    monthly: Array<{ month: string; quantity: number; sales: number; finalProfit: number }>
  }
}

type ConceptInput = {
  concepts: Array<{
    name: string
    customerValue: string
    manufacturing: string
    risks: string[]
    scores: Record<string, number>
  }>
}

async function main() {
  const [sku, ...args] = process.argv.slice(2)
  if (sku === '-h' || sku === '--help') {
    console.log('Usage:\n  funtastic council SKU [--products PATH]\n')
    return
  }
  if (!sku || sku.startsWith('-')) throw new Error('Usage: funtastic council SKU [--products PATH]')
  const root = path.resolve(option(args, '--products') ?? 'products', sku)
  const councilDir = path.join(root, 'council')
  await mkdir(councilDir, { recursive: true })

  const internal = await readJson<InternalSource>(path.join(root, 'source/internal-product-data.json'))
  const concepts = await readJson<ConceptInput>(path.join(root, 'concepts/concepts-input.json'))
  const b2b = await readJson<Record<string, unknown>>(path.join(root, 'source/b2b-product-data.json'))
  const directVocCount = await dataRowCount(path.join(root, 'discovery/review-evidence.csv'))
  const sourceUrlCount = await countSourceUrls(path.join(root, 'discovery'))
  const conceptCount = concepts.concepts.length
  const totals = internal.product.monthly.reduce((sum, row) => ({
    quantity: sum.quantity + row.quantity,
    sales: sum.sales + row.sales,
    finalProfit: sum.finalProfit + row.finalProfit,
  }), { quantity: 0, sales: 0, finalProfit: 0 })
  const latest = internal.product.monthly.slice(-3).reduce((sum, row) => sum + row.quantity, 0)
  const previous = internal.product.monthly.slice(-6, -3).reduce((sum, row) => sum + row.quantity, 0)
  const publicMatch = b2b.status !== 'not-found' && typeof b2b.id === 'string'

  const context = {
    sku,
    productName: internal.product.productName,
    capturedAt: internal.capturedAt ?? 'unknown',
    quantity: totals.quantity,
    sales: totals.sales,
    finalProfit: totals.finalProfit,
    latest,
    previous,
    publicMatch,
    directVocCount,
    sourceUrlCount,
    conceptCount,
    concepts: concepts.concepts,
  }

  const reports: Array<[string, string]> = [
    ['sales-analyst.md', salesAnalyst(context)],
    ['discoverer.md', discoverer(context)],
    ['strategist.md', strategist(context)],
    ['industrial-designer.md', industrialDesigner(context)],
    ['cmf-designer.md', cmfDesigner(context)],
    ['manufacturing.md', manufacturing(context)],
    ['merchandising.md', merchandising(context)],
    ['critic.md', critic(context)],
    ['devils-advocate.md', devilsAdvocate(context)],
  ]
  for (const [name, content] of reports) await writeFile(path.join(councilDir, name), content)

  const decision = gateDecision(context)
  await writeFile(path.join(councilDir, 'gate-decision.md'), decision)
  await writeFile(path.join(councilDir, 'council-report.md'), consolidated(context, reports, decision))
  console.log(`Council report: ${path.join(councilDir, 'council-report.md')}`)
  console.log('Decision: PASS WITH REVISION')
  console.log('CAD allowed: NO')
}

type Context = {
  sku: string
  productName: string
  capturedAt: string
  quantity: number
  sales: number
  finalProfit: number
  latest: number
  previous: number
  publicMatch: boolean
  directVocCount: number
  sourceUrlCount: number
  conceptCount: number
  concepts: ConceptInput['concepts']
}

function header(role: string, context: Context) {
  return `# ${role}\n\n- Product: ${context.productName} (${context.sku})\n- Review date: ${new Date().toISOString()}\n- Evidence boundary: missing data remains unverified\n`
}

function salesAnalyst(context: Context) {
  const growth = context.previous > 0 ? `${(((context.latest - context.previous) / context.previous) * 100).toFixed(1)}%` : 'not comparable'
  return `${header('Sales Analyst', context)}
## Findings

- Six observed months quantity: ${context.quantity.toLocaleString()}
- Latest three months versus previous three months: ${context.latest} versus ${context.previous} (${growth})
- Recorded sales: KRW ${context.sales.toLocaleString()}
- Calculated final profit: KRW ${context.finalProfit.toLocaleString()}
- The April quantity-to-sales relationship is anomalous and must be audited before price or margin decisions.
- A separate combined SKU is not consolidated because physical-unit accounting is unresolved.

Boundary: sales confirms company demand, not customer purpose or willingness to pay a premium.
`
}

function discoverer(context: Context) {
  return `${header('Discoverer', context)}
## Findings

- Traceable URLs found in discovery documents: ${context.sourceUrlCount}
- Direct internal review/VOC evidence rows: ${context.directVocCount}
- Exact official B2B product match: ${context.publicMatch ? 'found' : 'not found'}
- International premium and substitute evidence exists, but it belongs to similar products.

## Evidence Gaps

- Internal sample identity, image, dimensions, material, and mounting method
- Customer reviews, image reviews, inquiries, returns, and search terms
- Patent and design-right clearance for mounting archetypes
`
}

function strategist(context: Context) {
  return `${header('Strategist', context)}
## Findings

- ${context.conceptCount} distinct customer-value hypotheses are available.
- The strongest current proposition is drying plus tidiness plus cleanability, not color or feature count.
- No target price, validated willingness-to-pay evidence, or approved positioning is available.

## Boundary

The opportunity may proceed to evidence collection, but no concept is commercially selected.
`
}

function industrialDesigner(context: Context) {
  const ranked = [...context.concepts].sort((a, b) => average(b.scores) - average(a.scores))
  return `${header('Industrial Designer', context)}
## Findings

- Highest hypothesis score: ${ranked[0]?.name ?? 'none'} (${ranked[0] ? average(ranked[0].scores).toFixed(2) : 'n/a'}/5)
- No blockout, installed render, scale comparison, ergonomic test, or physical sample comparison exists.
- Concept scores are design hypotheses and must not be read as user preference.

## Direction

Preserve one-hand use, visual quietness, cleaning access, and a single-image explanation. Do not fix proportions or dimensions before sample inspection.
`
}

function cmfDesigner(context: Context) {
  return `${header('CMF Designer', context)}
## Findings

- Low-gloss neutrals can support kitchen integration, but no color demand has been measured.
- PLA may support form prototypes; a saleable wet-kitchen material is unverified.
- Surface texture must not trap residue or exaggerate layer lines.

## Missing Tests

- Wet cleaning, detergent, staining, heat, UV, and color-lot consistency
- White versus neutral versus pastel purchase-behavior test
`
}

function manufacturing(context: Context) {
  return `${header('Manufacturing Engineer', context)}
## Findings

- No dimensions, material specification, print orientation, slicing result, BOM, or physical test exists for the concepts.
- Multi-part docks, pivots, flexures, weights, magnets, or grip inserts introduce purchased-part and tolerance risk.
- Wet loading creates creep and hygiene requirements beyond a normal desktop prototype.

## CAD Gate

Detailed CAD is not allowed. Only non-dimensional blockouts may be considered after the internal sample is identified.
`
}

function merchandising(context: Context) {
  return `${header('Brand and Merchandising Reviewer', context)}
## Findings

- The category can support premium pricing when the first image proves a cleaner, drier, tidier sink area.
- The internal product's current retail presentation and customer-facing price are not linked.
- A pastel assortment is not a value proposition and would increase SKU complexity without demand evidence.

## Required Proof

- One-frame before/after communication
- Named competitor price ladder
- Initial one or two color strategy with a neutral control
`
}

function critic(context: Context) {
  const issues = [
    'Exact internal product identity is unconfirmed.',
    'No direct internal customer review or VOC is available.',
    'The real mounting method is unknown.',
    'The primary customer use case is unverified.',
    'Bundle quantity may double-count physical units.',
    'April revenue and profit are anomalous relative to quantity.',
    'Premium willingness to pay is inferred from other brands.',
    'No concept has been tested against the current product.',
    'No wet-environment material has been validated.',
    'No patent or design-right clearance has been completed.',
    'No fully loaded production cost or target price exists.',
    'No installation compatibility matrix exists.',
  ]
  return `${header('Product Critic', context)}
## Problems

${issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')}

Approval is not justified by internal volume and attractive benchmark products alone.
`
}

function devilsAdvocate(context: Context) {
  const failures = [
    'Customers bought the original only because it was cheap, so premium demand does not transfer.',
    'The new mount fits too few sinks or surfaces.',
    'A wet cloth pulls the holder down or causes creep.',
    'The holder becomes a grime trap and receives hygiene complaints.',
    'The product occupies more space than simply draping the cloth over the tap.',
    'Customers choose an inexpensive suction rack or freestanding hanger.',
    'A copied mounting idea creates patent or design-right risk.',
    'FDM layer texture makes the product look cheaper than molded competitors.',
    'Color variants fragment demand and create slow inventory.',
    'The product solves a visible annoyance but not one customers pay extra to solve.',
  ]
  return `${header("Devil's Advocate", context)}
## Failure Scenarios

${failures.map((failure, index) => `${index + 1}. ${failure}`).join('\n')}
`
}

function gateDecision(context: Context) {
  return `${header('Gate Review Board', context)}
## Decision

**PASS WITH REVISION**

This is permission to continue evidence collection and physical comparison only. It is not concept approval and does not permit detailed CAD, STL, or print production.

## Strongest Opportunity

Confirmed internal company demand intersects with an externally demonstrated premium customer outcome: a dry, tidy, visually controlled sink area.

## Largest Failure Risk

The exact internal product and its customer behavior are unknown. The team could optimize the wrong use case or mounting system.

## Mandatory Revisions

1. Identify and measure the internal sample, including mounting method and material.
2. Resolve base-versus-bundle quantity accounting and the April financial anomaly.
3. Collect direct review/VOC or observed-use evidence and compare the top two concepts with the current product.

## CAD Permission

**NO.** Re-review after the three mandatory revisions have traceable evidence.
`
}

function consolidated(context: Context, reports: Array<[string, string]>, decision: string) {
  return `# FUN-TASTIC Agent Council Report

- Product: ${context.productName} (${context.sku})
- Generated: ${new Date().toISOString()}
- Internal source captured: ${context.capturedAt}

${reports.map(([name, content]) => `## ${name.replace('.md', '')}\n\n${content.replace(/^# .*\n\n/, '')}`).join('\n\n')}

## Gate Review Board

${decision.replace(/^# .*\n\n/, '')}
`
}

async function readJson<T>(target: string) {
  return JSON.parse(await readFile(target, 'utf8')) as T
}

async function dataRowCount(target: string) {
  const rows = (await readFile(target, 'utf8')).trim().split(/\r?\n/)
  return Math.max(0, rows.length - 1)
}

async function countSourceUrls(directory: string) {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.md'))
  let count = 0
  for (const file of files) {
    const content = await readFile(path.join(directory, file), 'utf8')
    count += [...content.matchAll(/https?:\/\/[^\s)>]+/g)].length
  }
  return count
}

function average(scores: Record<string, number>) {
  const values = Object.values(scores)
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function option(args: string[], name: string) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
