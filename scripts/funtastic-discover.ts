import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProductOpportunitySource } from '../src/lib/opportunities/types'

type Snapshot = {
  metadata?: Record<string, unknown>
  products: ProductOpportunitySource[]
}

type PublicProduct = {
  id: string
  code?: string
  name: string
  imageUrl?: string
  price?: number
  category?: { name?: string } | string
  options?: unknown[]
  description?: string
  [key: string]: unknown
}

type Options = {
  sku: string
  snapshot: string
  output: string
  refresh: boolean
}

const B2B_BASE = 'https://www.funtasticb2b.com'

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const snapshotPath = path.resolve(options.snapshot)
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot
  const product = snapshot.products.find((candidate) => candidate.sku === options.sku)
  if (!product) throw new Error(`SKU ${options.sku} was not found in ${snapshotPath}.`)

  const root = path.resolve(options.output, options.sku)
  await createDirectories(root)

  const publicProduct = await findPublicProduct(product.productName).catch((error: unknown) => {
    console.warn(`WARN: B2B search failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  })
  const publicDetail = publicProduct
    ? await fetchPublicDetail(publicProduct.id).catch(() => null)
    : null
  const external = publicDetail ?? publicProduct

  await writeJson(path.join(root, 'source/internal-product-data.json'), {
    capturedAt: new Date().toISOString(),
    snapshot: snapshot.metadata ?? {},
    product,
  })
  await writeFile(path.join(root, 'source/sales-data.csv'), salesCsv(product))
  await writeJson(path.join(root, 'source/b2b-product-data.json'), external ?? {
    status: 'not-found',
    note: 'No matching Funtastic B2B product was found automatically.',
  })

  const imageFiles = external
    ? await downloadImages(root, external, options.refresh).catch((error: unknown) => {
        console.warn(`WARN: Source image download failed: ${error instanceof Error ? error.message : String(error)}`)
        return []
      })
    : []
  await writeFile(path.join(root, 'source/source-links.md'), sourceLinks(product, external, imageFiles))
  await writeTemplates(root, product, external)

  console.log(`Discovery package: ${root}`)
  console.log(`Internal source: ${snapshotPath}`)
  console.log(`B2B match: ${external ? `${external.name} (${external.id})` : 'not found'}`)
  console.log(`Source images: ${imageFiles.length}`)
}

async function createDirectories(root: string) {
  const directories = [
    'source/source-images',
    'discovery',
    'strategy',
    'concepts',
    'manufacturing',
    'review',
    'council',
    'cad',
    'step',
    'stl',
    '3mf',
    'render',
    'renders/concept-board',
    'renders/installed-scenes',
    'renders/color-comparison',
    'renders/scale-comparison',
    'renders/competitor-comparison',
    'renders/premium-context',
    'cmf',
    'test',
    'prototype',
    'dfam',
    'docs',
    'bom',
    'images',
    'packaging',
  ]
  await Promise.all(directories.map((directory) => mkdir(path.join(root, directory), { recursive: true })))
}

async function findPublicProduct(productName: string): Promise<PublicProduct | null> {
  const queries = buildSearchQueries(productName)
  for (const query of queries) {
    const url = new URL('/api/products', B2B_BASE)
    url.searchParams.set('search', query)
    url.searchParams.set('limit', '100')
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) continue
    const payload = await response.json() as { products?: PublicProduct[] }
    const products = payload.products ?? []
    const exact = products.find((candidate) => normalizeName(candidate.name) === normalizeName(productName))
    if (exact) return exact
    if (products.length === 1) return products[0]
  }
  return null
}

async function fetchPublicDetail(id: string): Promise<PublicProduct | null> {
  const response = await fetch(`${B2B_BASE}/api/products/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) return null
  return await response.json() as PublicProduct
}

function buildSearchQueries(productName: string) {
  const clean = productName
    .replace(/_?펀타스틱/gi, '')
    .replace(/\([^)]*\)/g, '')
    .trim()
  const tokens = clean.split(/\s+/).filter((token) => token.length >= 2)
  return [...new Set([clean, tokens.slice(-2).join(' '), tokens.at(-1) ?? ''].filter(Boolean))]
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/펀타스틱/g, '').replace(/[^0-9a-z가-힣]/g, '')
}

async function downloadImages(root: string, product: PublicProduct, refresh: boolean) {
  const urls = collectImageUrls(product)
  const files: string[] = []
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index]
    const extension = imageExtension(url)
    const relative = `source/source-images/b2b-${String(index + 1).padStart(2, '0')}.${extension}`
    const target = path.join(root, relative)
    if (!refresh && await exists(target)) {
      files.push(relative)
      continue
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) continue
    await writeFile(target, Buffer.from(await response.arrayBuffer()))
    files.push(relative)
  }
  return files
}

function collectImageUrls(product: PublicProduct) {
  const urls = new Set<string>()
  if (typeof product.imageUrl === 'string') urls.add(product.imageUrl)
  for (const key of ['thumbnailImages', 'detailImages'] as const) {
    const values = product[key]
    if (Array.isArray(values)) {
      for (const value of values) if (typeof value === 'string') urls.add(value)
    }
  }
  const html = typeof product.description === 'string' ? product.description : ''
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    if (/^https?:\/\//.test(match[1])) urls.add(match[1])
  }
  return [...urls].slice(0, 30)
}

function imageExtension(url: string) {
  const match = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)
  const extension = match?.[1]?.toLowerCase()
  return extension && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension) ? extension : 'jpg'
}

function salesCsv(product: ProductOpportunitySource) {
  const header = 'month,quantity,order_count,sales,final_profit,return_order_count'
  const rows = product.monthly.map((month) => [
    month.month,
    month.quantity,
    month.orderCount,
    month.sales,
    month.finalProfit,
    month.returnOrderCount,
  ].join(','))
  return `${[header, ...rows].join('\n')}\n`
}

function sourceLinks(product: ProductOpportunitySource, external: PublicProduct | null, images: string[]) {
  const lines = [
    `# ${product.productName} Source Register`,
    '',
    `- Internal SKU: ${product.sku}`,
    '- Internal source: `opportunities/current/source_snapshot.json`',
    `- Captured: ${new Date().toISOString()}`,
    `- Funtastic B2B match: ${external ? `[${external.name}](${B2B_BASE}/products/${external.id})` : 'not found; verification required'}`,
    '- Customer reviews/VOC: not provided',
    '- Return reasons: not provided',
    '- Search inflow terms: not provided',
    '',
    '## Evidence Rules',
    '',
    '- The internal snapshot confirms company sales, not the final use case.',
    '- The B2B page is seller-authored evidence, not customer behavior evidence.',
    '- Similar-product reviews must never be reported as reviews of this SKU.',
    '',
    '## Downloaded Source Images',
    '',
    ...(images.length > 0 ? images.map((image) => `- \`${image}\``) : ['- None']),
    '',
  ]
  return lines.join('\n')
}

async function writeTemplates(root: string, product: ProductOpportunitySource, external: PublicProduct | null) {
  const title = `${product.productName} (${product.sku})`
  const files: Record<string, string> = {
    'README.md': `# ${title}\n\nCreated by \`funtastic discover\`. Evidence first; CAD begins only after product approval.\n`,
    'discovery/domestic-market.md': researchTemplate(title, 'Domestic Market'),
    'discovery/international-market.md': researchTemplate(title, 'International Market'),
    'discovery/voc-analysis.md': researchTemplate(title, 'VOC Analysis'),
    'discovery/premium-brand-benchmark.md': researchTemplate(title, 'Premium Brand Benchmark'),
    'discovery/design-principles.md': researchTemplate(title, 'Design Principles'),
    'discovery/source-list.md': `# ${title} Source List\n\n- Official B2B: ${external ? `${B2B_BASE}/products/${external.id}` : 'verification required'}\n`,
    'discovery/competitor-table.csv': 'market,brand,product,url,price,evidence_type,strengths,complaints,notes\n',
    'discovery/review-evidence.csv': 'source,url,checked_at,rating,review_text,use_case,evidence_level,notes\n',
    'strategy/product-strategy.md': researchTemplate(title, 'Product Strategy'),
    'strategy/customer-problem.md': researchTemplate(title, 'Customer Problem'),
    'strategy/opportunity-map.md': researchTemplate(title, 'Opportunity Map'),
    'strategy/positioning.md': researchTemplate(title, 'Positioning'),
    'strategy/price-strategy.md': researchTemplate(title, 'Price Strategy'),
    'strategy/value-proposition.md': researchTemplate(title, 'Value Proposition'),
    'strategy/sku-strategy.md': researchTemplate(title, 'SKU Strategy'),
    'concepts/concept-brief.md': researchTemplate(title, 'Concept Brief'),
    'manufacturing/manufacturing-report.md': researchTemplate(title, 'Manufacturing Review'),
    'manufacturing/printability.md': researchTemplate(title, 'Printability'),
    'manufacturing/dfam.md': researchTemplate(title, 'DFAM'),
    'manufacturing/preliminary-bom.md': researchTemplate(title, 'Preliminary BOM'),
    'manufacturing/cost-estimate.md': researchTemplate(title, 'Cost Estimate'),
    'manufacturing/production-risk.md': researchTemplate(title, 'Production Risk'),
    'manufacturing/injection-molding-expansion.md': researchTemplate(title, 'Injection Molding Expansion'),
    'cmf/color-strategy.md': researchTemplate(title, 'Color Strategy'),
    'cmf/material-strategy.md': researchTemplate(title, 'Material Strategy'),
    'cmf/finish-strategy.md': researchTemplate(title, 'Finish Strategy'),
    'cmf/color-standards.csv': 'color_name,standard,code,target_use,status,notes\n',
    'cmf/filament-candidates.csv': 'brand,material,color,product_code,price,status,notes\n',
    'review/opportunity-report.md': researchTemplate(title, 'Opportunity Review'),
    'review/executive-summary.md': researchTemplate(title, 'Executive Summary'),
    'review/next-cad-requirements.md': researchTemplate(title, 'Next CAD Requirements'),
    'council/council-report.md': researchTemplate(title, 'Council Review'),
    'docs/next-cad-requirements.md': researchTemplate(title, 'Next CAD Requirements'),
  }
  for (const [relative, content] of Object.entries(files)) {
    await writeIfMissing(path.join(root, relative), content)
  }
}

function researchTemplate(title: string, section: string) {
  return `# ${title} - ${section}\n\nStatus: unverified\n\n## Confirmed Evidence\n\n- None yet.\n\n## Signals and Inferences\n\n- None yet.\n\n## Contradicting Evidence\n\n- None yet.\n\n## Missing Evidence\n\n- Customer reviews/VOC\n- Physical dimensions and material\n\n## Sources\n\n- Add URL and checked date.\n`
}

async function writeJson(target: string, value: unknown) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeIfMissing(target: string, content: string) {
  if (!await exists(target)) await writeFile(target, content)
}

async function exists(target: string) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function parseOptions(args: string[]): Options {
  if (args[0] === '-h' || args[0] === '--help') {
    usage()
    process.exit(0)
  }
  const sku = args[0]
  if (!sku || sku.startsWith('-')) {
    usage()
    throw new Error('A SKU is required.')
  }
  const options: Options = {
    sku,
    snapshot: 'opportunities/current/source_snapshot.json',
    output: 'products',
    refresh: false,
  }
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--snapshot') options.snapshot = requiredValue(args, ++index, arg)
    else if (arg === '--output') options.output = requiredValue(args, ++index, arg)
    else if (arg === '--refresh') options.refresh = true
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
  console.log(`Usage:\n  funtastic discover SKU [--snapshot PATH] [--output PATH] [--refresh]\n`)
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
