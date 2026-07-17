import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildResearchBundle,
  loadResearchInputs,
  writeResearchRun,
  type DiscoveryEvidence,
} from '../src/lib/research/evidence'

type Options = { sku: string; products: string }

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const productRoot = path.resolve(options.products, options.sku)
  const discoveryRoot = path.join(productRoot, 'discovery/current')
  const researchRoot = path.join(productRoot, 'research')
  const discovery = await loadDiscoveryEvidence(discoveryRoot, options.sku)
  const inputs = await loadResearchInputs(researchRoot)
  const bundle = buildResearchBundle({ sku: options.sku, discovery, inputs, researchRoot })
  const result = await writeResearchRun({ researchRoot, bundle })

  console.log(`Research run: ${result.runRoot}`)
  console.log(`Current evidence: ${result.currentRoot}`)
  console.log(`SKU: ${options.sku}`)
  console.log(`Reviews: ${bundle.marketEvidence.inputSummary.uniqueReviewCount}`)
  console.log(`Competitors: ${bundle.competitors.items.length}`)
  console.log(`Rejected URLs: ${bundle.marketEvidence.inputSummary.invalidUrlCount}`)
  console.log(`Research status: ${bundle.researchStatus.status}`)
}

async function loadDiscoveryEvidence(root: string, sku: string): Promise<DiscoveryEvidence> {
  const readJson = async (name: string) => {
    const target = path.join(root, name)
    try {
      return JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Required discovery input is unavailable: ${target} (${detail})`)
    }
  }
  const evidence = {
    internalProduct: await readJson('internal-product.json'),
    officialProduct: await readJson('official-product.json'),
    physicalEvidence: await readJson('physical-evidence.json'),
    discoveryStatus: await readJson('discovery-status.json'),
    sourceRoot: root,
  }
  if (String(evidence.internalProduct.sku ?? '') !== sku) {
    throw new Error(`Discovery SKU does not match requested SKU ${sku}.`)
  }
  return evidence
}

function parseOptions(args: string[]): Options {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage:\n  funtastic research SKU [--products PATH]\n')
    process.exit(0)
  }
  const sku = args[0]
  if (!sku || sku.startsWith('-')) throw new Error('Usage: funtastic research SKU [--products PATH]')
  const options: Options = { sku, products: 'products' }
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--products') options.products = requiredValue(args, ++index, argument)
    else throw new Error(`Unknown option: ${argument}`)
  }
  return options
}

function requiredValue(args: string[], index: number, option: string) {
  const value = args[index]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`)
  return value
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
