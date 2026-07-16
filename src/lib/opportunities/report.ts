import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { OpportunityRun, ProductOpportunity, ProductOpportunitySource } from './types'

export async function writeOpportunityReport(input: {
  run: OpportunityRun
  source: ProductOpportunitySource[]
  outputRoot: string
  top: number
}) {
  const runId = input.run.metadata.generatedAt.replace(/[:.]/g, '-')
  const runsRoot = path.join(input.outputRoot, 'runs')
  const runDir = path.join(runsRoot, runId)
  const currentDir = path.join(input.outputRoot, 'current')
  await mkdir(runDir, { recursive: true })
  await rm(currentDir, { recursive: true, force: true })
  await mkdir(currentDir, { recursive: true })

  const files = buildFiles(input.run, input.source, input.top)
  await Promise.all([...files.entries()].flatMap(([name, content]) => [
    writeFile(path.join(runDir, name), content),
    writeFile(path.join(currentDir, name), content),
  ]))
  return { runDir, currentDir }
}

function buildFiles(run: OpportunityRun, source: ProductOpportunitySource[], top: number) {
  const ranked = run.products.filter((product) => !product.excluded)
  const excluded = run.products.filter((product) => product.excluded)
  return new Map<string, string>([
    ['run.json', pretty(run)],
    ['source_snapshot.json', pretty({
      metadata: run.metadata,
      products: source,
    })],
    ['rankings.csv', opportunityCsv(ranked)],
    ['excluded.csv', opportunityCsv(excluded)],
    ['top10.md', topReport(run, ranked.slice(0, top))],
    ['missing_data.md', missingReport(run)],
    ['evidence.csv', evidenceCsv(run.products)],
  ])
}

function topReport(run: OpportunityRun, products: ProductOpportunity[]) {
  const rows = products.map((product) => [
    product.rank,
    product.sku,
    product.productName,
    round(product.periods['3'].quantity),
    round(product.periods['12'].quantity),
    won(product.periods['12'].sales),
    won(product.periods['12'].finalProfit),
    score(product.scores.printability.score),
    score(product.scores.upgradePotential.score),
    score(product.scores.premiumPotential.score),
    score(product.scores.safetyAndLegal.score),
    product.weightedScore,
    `${product.confidence}%`,
  ])
  return `# FUN-TASTIC Opportunity Ranking

- Generated: ${run.metadata.generatedAt}
- Sales data through: ${run.metadata.asOfDate}
- Source: ${run.metadata.source}
- Scoring version: ${run.metadata.scoringVersion}
- Important: structural scores marked as rule-based are screening hypotheses, not verified engineering facts.

## Top Candidates

| Rank | SKU | Product | 3M Qty | 12M Qty | 12M Sales | 12M Profit | Print | Upgrade | Premium | Safety | Total | Confidence |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows.map((row) => `| ${row.join(' | ')} |`).join('\n')}

## Candidate Notes

${products.map(candidateDetail).join('\n\n')}

## Interpretation Rules

- Sales and calculated profit are internal evidence.
- Keyword-based structure scores require product image, dimensions, material, and physical inspection.
- A high rank means "research first", not "start CAD".
- Excluded products are listed separately in \`excluded.csv\`.
`
}

function candidateDetail(product: ProductOpportunity) {
  return `### ${product.rank}. ${product.productName} (${product.sku})

- 3/6/12-month quantity: ${round(product.periods['3'].quantity)} / ${round(product.periods['6'].quantity)} / ${round(product.periods['12'].quantity)}
- 12-month sales / calculated final profit: ${won(product.periods['12'].sales)} / ${won(product.periods['12'].finalProfit)}
- Latest 3M vs previous 3M: ${percent(product.latestThreeVsPreviousThreeGrowth)}
- Printability: ${score(product.scores.printability.score)} — ${product.scores.printability.reason}
- Upgrade potential: ${score(product.scores.upgradePotential.score)} — ${product.scores.upgradePotential.reason}
- Premium potential: ${score(product.scores.premiumPotential.score)} — ${product.scores.premiumPotential.reason}
- Safety/legal: ${score(product.scores.safetyAndLegal.score)} — ${product.scores.safetyAndLegal.reason}
- Missing evidence: ${product.missingFields.length ? product.missingFields.join(', ') : 'none recorded'}
`
}

function missingReport(run: OpportunityRun) {
  const missingCounts = new Map<string, number>()
  for (const product of run.products) {
    for (const field of product.missingFields) {
      missingCounts.set(field, (missingCounts.get(field) ?? 0) + 1)
    }
  }
  return `# Opportunity Data Audit

## Available

${bullets(run.dataAudit.available)}

## Partial

${bullets(run.dataAudit.partial)}

## Unavailable

${bullets(run.dataAudit.unavailable)}

## Missing Field Counts

${[...missingCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([field, count]) => `- ${field}: ${count}/${run.products.length}`)
    .join('\n') || '- None'}
`
}

function opportunityCsv(products: ProductOpportunity[]) {
  const headers = [
    'rank', 'sku', 'product_name', 'category_id', 'quantity_3m', 'quantity_6m', 'quantity_12m',
    'sales_12m', 'final_profit_12m', 'profit_rate_12m', 'growth_latest3_vs_previous3',
    'return_order_rate_12m', 'current_stock', 'weighted_score', 'confidence',
    'printability_score', 'upgrade_score', 'premium_score', 'safety_legal_score',
    'excluded', 'exclusion_reasons', 'missing_fields',
  ]
  const rows = products.map((product) => [
    product.rank,
    product.sku,
    product.productName,
    product.categoryId ?? '',
    product.periods['3'].quantity,
    product.periods['6'].quantity,
    product.periods['12'].quantity,
    product.periods['12'].sales,
    product.periods['12'].finalProfit,
    product.periods['12'].profitRate ?? '',
    product.latestThreeVsPreviousThreeGrowth ?? '',
    product.periods['12'].returnOrderRate ?? '',
    product.currentStock ?? '',
    product.weightedScore,
    product.confidence,
    product.scores.printability.score ?? '',
    product.scores.upgradePotential.score ?? '',
    product.scores.premiumPotential.score ?? '',
    product.scores.safetyAndLegal.score ?? '',
    product.excluded,
    product.exclusionReasons.join(' | '),
    product.missingFields.join(' | '),
  ])
  return csv(headers, rows)
}

function evidenceCsv(products: ProductOpportunity[]) {
  const headers = ['sku', 'product_name', 'criterion', 'score', 'evidence_level', 'source', 'reason']
  const rows = products.flatMap((product) => Object.entries(product.scores).map(([criterion, item]) => [
    product.sku,
    product.productName,
    criterion,
    item.score ?? '',
    item.evidenceLevel,
    item.source,
    item.reason,
  ]))
  return csv(headers, rows)
}

function csv(headers: string[], rows: Array<Array<string | number | boolean>>) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
}

function csvCell(value: string | number | boolean) {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function bullets(values: string[]) {
  return values.map((value) => `- ${value}`).join('\n')
}

function score(value: number | null) {
  return value == null ? '미검증' : `${value}/5`
}

function percent(value: number | null) {
  return value == null ? '비교 불가' : `${round(value * 100)}%`
}

function won(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function pretty(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}
