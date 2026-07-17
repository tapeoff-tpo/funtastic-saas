import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildDiscoveryBundle,
  findInternalProduct,
  loadHumanInputs,
  writeDiscoveryRun,
  type OfficialProductSource,
} from '../src/lib/discovery/evidence'
import type { ProductOpportunitySource } from '../src/lib/opportunities/types'

type Snapshot = {
  metadata?: Record<string, unknown>
  products: ProductOpportunitySource[]
}

type Options = { sku: string; snapshot: string; output: string }

const B2B_BASE = 'https://www.funtasticb2b.com'

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const snapshotPath = path.resolve(options.snapshot)
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot
  if (!Array.isArray(snapshot.products)) throw new Error(`Invalid snapshot: products[] is missing in ${snapshotPath}.`)
  const product = findInternalProduct(snapshot.products, options.sku)

  const productRoot = path.resolve(options.output, options.sku)
  const inputsRoot = path.join(productRoot, 'inputs')
  await mkdir(path.join(inputsRoot, 'product-images'), { recursive: true })
  const human = await loadHumanInputs(inputsRoot)
  const officialWarnings: string[] = []
  const official = await findPublicProduct(product.productName).catch((error: unknown) => {
    officialWarnings.push(`Official B2B lookup failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  })
  const officialSourceUrl = official ? `${B2B_BASE}/products/${official.id}` : null
  const bundle = buildDiscoveryBundle({
    product,
    snapshotMetadata: snapshot.metadata,
    snapshotPath,
    official,
    officialSourceUrl,
    officialWarnings,
    human,
    inputsRoot,
  })
  const result = await writeDiscoveryRun({ productRoot, bundle })
  const status = (bundle.discoveryStatus as { status: string }).status

  console.log(`Discovery run: ${result.runRoot}`)
  console.log(`Current evidence: ${result.currentRoot}`)
  console.log(`Internal SKU: ${product.sku}`)
  console.log(`Official product: ${official ? `${official.name} (${official.id})` : 'not found'}`)
  console.log(`Human inputs: measurements=${Boolean(human.measurements)}, images=${human.productImages.length}, reviews=${human.reviews.length}, competitors=${human.competitors.length}`)
  console.log(`Discovery status: ${status}`)
}

async function findPublicProduct(productName: string): Promise<OfficialProductSource | null> {
  for (const query of buildSearchQueries(productName)) {
    const url = new URL('/api/products', B2B_BASE)
    url.searchParams.set('search', query)
    url.searchParams.set('limit', '100')
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) continue
    const payload = await response.json() as { products?: OfficialProductSource[] }
    const products = payload.products ?? []
    const exact = products.find((candidate) => normalizeName(candidate.name) === normalizeName(productName))
    const candidate = exact ?? (products.length === 1 ? products[0] : null)
    if (!candidate) continue
    const detail = await fetch(`${B2B_BASE}/api/products/${encodeURIComponent(candidate.id)}`, {
      signal: AbortSignal.timeout(15_000),
    })
    return detail.ok ? await detail.json() as OfficialProductSource : candidate
  }
  return null
}

function buildSearchQueries(productName: string) {
  const clean = productName.replace(/_?펀타스틱/gi, '').replace(/\([^)]*\)/g, '').trim()
  const tokens = clean.split(/\s+/).filter((token) => token.length >= 2)
  return [...new Set([clean, tokens.slice(-2).join(' '), tokens.at(-1) ?? ''].filter(Boolean))]
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/펀타스틱/g, '').replace(/[^0-9a-z가-힣]/g, '')
}

function parseOptions(args: string[]): Options {
  if (args[0] === '-h' || args[0] === '--help') {
    usage()
    process.exit(0)
  }
  const sku = args[0]
  if (!sku || sku.startsWith('-')) throw new Error('A SKU is required. Use --help for usage.')
  const options: Options = { sku, snapshot: 'opportunities/current/source_snapshot.json', output: 'products' }
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--snapshot') options.snapshot = requiredValue(args, ++index, arg)
    else if (arg === '--output') options.output = requiredValue(args, ++index, arg)
    else if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    } else throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

function requiredValue(args: string[], index: number, option: string) {
  const value = args[index]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`)
  return value
}

function usage() {
  console.log('Usage:\n  funtastic discover SKU [--snapshot PATH] [--output PATH]\n')
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
