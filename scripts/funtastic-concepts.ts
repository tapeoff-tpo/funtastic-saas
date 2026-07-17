import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

type Concept = {
  name: string
  customerValue: string
  targetCustomer: string
  useContext: string
  problem: string
  experience: string
  formLanguage: string
  cmf: string
  manufacturing: string
  priceRationale: string
  assumptions: string[]
  risks: string[]
  scores: Record<string, number>
}

type ConceptInput = {
  productName: string
  sku: string
  stage: string
  evidenceDate: string
  concepts: Concept[]
}

async function main() {
  const [sku, ...args] = process.argv.slice(2)
  if (sku === '-h' || sku === '--help') {
    console.log('Usage:\n  funtastic concepts SKU [--products PATH]\n')
    return
  }
  if (!sku || sku.startsWith('-')) throw new Error('Usage: funtastic concepts SKU [--products PATH]')
  const productsRoot = option(args, '--products') ?? 'products'
  const root = path.resolve(productsRoot, sku)
  const inputPath = path.join(root, 'concepts/concepts-input.json')
  const input = JSON.parse(await readFile(inputPath, 'utf8')) as ConceptInput
  validate(input, sku)

  for (const [index, concept] of input.concepts.entries()) {
    const directory = path.join(root, 'concepts', `concept-${String(index + 1).padStart(2, '0')}`)
    await mkdir(path.join(directory, 'renders'), { recursive: true })
    await writeFile(path.join(directory, 'concept.md'), conceptMarkdown(input, concept, index))
    await writeFile(path.join(directory, 'assumptions.md'), listDocument('Assumptions', concept.assumptions))
    await writeFile(path.join(directory, 'risks.md'), listDocument('Risks', concept.risks))
  }

  await writeFile(path.join(root, 'concepts/concept-scorecard.csv'), scorecard(input.concepts))
  await writeFile(path.join(root, 'concepts/concept-comparison.md'), comparison(input))
  console.log(`Generated ${input.concepts.length} concept packages: ${path.join(root, 'concepts')}`)
  console.log('CAD/Blender output: not generated; concept approval is required first.')
}

function validate(input: ConceptInput, sku: string) {
  if (input.sku !== sku) throw new Error(`Input SKU ${input.sku} does not match requested SKU ${sku}.`)
  if (input.stage !== 'exploration') throw new Error('Concept input must use stage="exploration" before CAD approval.')
  if (input.concepts.length < 5) throw new Error('At least five concepts are required.')
  const values = new Set(input.concepts.map((concept) => normalize(concept.customerValue)))
  if (values.size !== input.concepts.length) throw new Error('Each concept must be based on a distinct customer value.')
  for (const concept of input.concepts) {
    if (concept.assumptions.length === 0 || concept.risks.length === 0) {
      throw new Error(`${concept.name} must state assumptions and risks.`)
    }
    for (const [criterion, score] of Object.entries(concept.scores)) {
      if (!Number.isFinite(score) || score < 1 || score > 5) {
        throw new Error(`${concept.name} score ${criterion} must be between 1 and 5.`)
      }
    }
  }
}

function conceptMarkdown(input: ConceptInput, concept: Concept, index: number) {
  return `# Concept ${index + 1}: ${concept.name}

- Product: ${input.productName} (${input.sku})
- Stage: exploration; dimensions and CAD are not approved
- Evidence cutoff: ${input.evidenceDate}

## Distinct Customer Value

${concept.customerValue}

## Target and Context

- Target customer: ${concept.targetCustomer}
- Use context: ${concept.useContext}
- Problem: ${concept.problem}

## Product Direction

- Experience: ${concept.experience}
- Form language: ${concept.formLanguage}
- CMF: ${concept.cmf}
- Manufacturing hypothesis: ${concept.manufacturing}
- Premium price rationale: ${concept.priceRationale}

## Evidence Boundary

This is a hypothesis for comparison, not an approved product specification. It contains no fixed dimensions, CAD, STL, or performance claim.
`
}

function listDocument(title: string, items: string[]) {
  return `# ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}\n`
}

function scorecard(concepts: Concept[]) {
  const criteria = [...new Set(concepts.flatMap((concept) => Object.keys(concept.scores)))]
  const header = ['concept', ...criteria, 'average']
  const rows = concepts.map((concept) => {
    const values = criteria.map((criterion) => concept.scores[criterion] ?? '')
    const numeric = values.filter((value): value is number => typeof value === 'number')
    const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length
    return [csv(concept.name), ...values, average.toFixed(2)].join(',')
  })
  return `${[header.join(','), ...rows].join('\n')}\n`
}

function comparison(input: ConceptInput) {
  const ranked = [...input.concepts].sort((a, b) => average(b.scores) - average(a.scores))
  const rows = ranked.map((concept, index) => `| ${index + 1} | ${concept.name} | ${average(concept.scores).toFixed(2)} | ${concept.customerValue} |`)
  return `# ${input.productName} Concept Comparison

Generated from structured exploration input. Scores are hypotheses, not test results.

| Rank | Concept | Average / 5 | Distinct customer value |
|---:|---|---:|---|
${rows.join('\n')}

## Gate

No concept may enter CAD until the internal product identity, physical sample, mounting context, and customer-use evidence are reviewed.
`
}

function average(scores: Record<string, number>) {
  const values = Object.values(scores)
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function option(args: string[], name: string) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, '')
}

function csv(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
