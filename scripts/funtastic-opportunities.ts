import { readFile } from 'node:fs/promises'
import path from 'node:path'
import scoringConfig from '../config/opportunity-scoring.json'
import { analyzeOpportunities } from '../src/lib/opportunities/analysis'
import { writeOpportunityReport } from '../src/lib/opportunities/report'
import { loadOpportunitySource } from '../src/lib/opportunities/source'
import type {
  OpportunityScoringConfig,
  ProductOpportunitySource,
} from '../src/lib/opportunities/types'

type Options = {
  userId?: string
  asOf?: string
  includeCurrentMonth: boolean
  top: number
  output: string
  input?: string
  config?: string
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const config = options.config
    ? JSON.parse(await readFile(path.resolve(options.config), 'utf8')) as OpportunityScoringConfig
    : scoringConfig as OpportunityScoringConfig
  const asOfDate = options.asOf ? parseDate(options.asOf) : new Date()

  let products: ProductOpportunitySource[]
  let userId: string
  let effectiveAsOf: Date
  const notes: string[] = []
  if (options.input) {
    const fixture = JSON.parse(await readFile(path.resolve(options.input), 'utf8')) as {
      userId?: string
      asOfDate?: string
      products: ProductOpportunitySource[]
    }
    products = fixture.products
    userId = options.userId ?? fixture.userId ?? 'fixture'
    effectiveAsOf = fixture.asOfDate ? parseDate(fixture.asOfDate) : asOfDate
    notes.push('Input loaded from a local JSON snapshot.')
  } else {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set. Add .env.local, export DATABASE_URL, or pass --input SNAPSHOT.json.')
    }
    const source = await loadOpportunitySource({
      userId: options.userId,
      asOfDate,
      includeCurrentMonth: options.includeCurrentMonth,
    })
    products = source.products
    userId = source.userId
    effectiveAsOf = source.asOfDate
    notes.push(...source.warnings)
  }

  const run = analyzeOpportunities({
    products,
    config,
    userId,
    asOfDate: effectiveAsOf,
    source: options.input ? `local snapshot: ${path.resolve(options.input)}` : 'funtastic-saas PostgreSQL',
    dataVersion: effectiveAsOf.toISOString(),
  })
  run.metadata.notes.push(...notes)

  const result = await writeOpportunityReport({
    run,
    source: products,
    outputRoot: path.resolve(options.output),
    top: options.top,
  })

  const eligible = run.products.filter((product) => !product.excluded)
  console.log(`Analyzed products: ${run.products.length}`)
  console.log(`Eligible products: ${eligible.length}`)
  console.log(`Excluded products: ${run.products.length - eligible.length}`)
  console.log(`Current report: ${path.join(result.currentDir, 'top10.md')}`)
  console.log('')
  for (const product of eligible.slice(0, options.top)) {
    console.log(`${product.rank}. ${product.productName} (${product.sku}) - ${product.weightedScore}`)
  }
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    includeCurrentMonth: false,
    top: 10,
    output: 'opportunities',
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--user-id') options.userId = requiredValue(args, ++index, arg)
    else if (arg === '--as-of') options.asOf = requiredValue(args, ++index, arg)
    else if (arg === '--top') options.top = positiveInteger(requiredValue(args, ++index, arg), arg)
    else if (arg === '--output') options.output = requiredValue(args, ++index, arg)
    else if (arg === '--input') options.input = requiredValue(args, ++index, arg)
    else if (arg === '--config') options.config = requiredValue(args, ++index, arg)
    else if (arg === '--include-current-month') options.includeCurrentMonth = true
    else if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return options
}

function requiredValue(args: string[], index: number, option: string) {
  const value = args[index]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`)
  return value
}

function positiveInteger(value: string, option: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer.`)
  return parsed
}

function parseDate(value: string) {
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00+09:00`)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`)
  return date
}

function usage() {
  console.log(`Usage:
  funtastic opportunities [options]

Options:
  --user-id UUID             Workspace owner override
  --as-of YYYY-MM-DD         Analysis reference date
  --include-current-month    Include the partial current month
  --top N                    Number of ranked candidates (default: 10)
  --output PATH              Report root (default: opportunities)
  --input SNAPSHOT.json      Analyze a local source snapshot instead of PostgreSQL
  --config CONFIG.json       Override scoring configuration
`)
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
