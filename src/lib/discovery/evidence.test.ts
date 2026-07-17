import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDiscoveryBundle,
  findInternalProduct,
  loadHumanInputs,
  writeDiscoveryRun,
  type HumanInputs,
  type MeasurementsInput,
  type OfficialProductSource,
} from './evidence'
import type { ProductOpportunitySource } from '@/lib/opportunities/types'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('discovery evidence builder', () => {
  it('loads an existing SKU from the internal source', () => {
    expect(findInternalProduct([product()], '101518-0001').productName).toBe('홀딩 후크')
  })

  it('rejects a missing SKU', () => {
    expect(() => findInternalProduct([product()], 'MISSING')).toThrow('SKU MISSING was not found')
  })

  it('keeps size and build-volume fit unknown without dimensions', () => {
    const bundle = bundleFor({})
    expect(value(bundle.printability, 'expectedSizeMm')).toBeNull()
    expect(value(bundle.printability, 'buildVolumeFit')).toBeNull()
    expect((bundle.printability.overall as { evidenceLevel: string }).evidenceLevel).toBe('keyword-only')
  })

  it('detects build-volume overflow and requires split printing', () => {
    const bundle = bundleFor({ measurements: { dimensionsMm: { x: 300, y: 80, z: 40 } } })
    expect(value(bundle.printability, 'buildVolumeFit')).toBe(false)
    expect(value(bundle.printability, 'splitPrintRequired')).toBe(true)
  })

  it('loads measurements and reaches physical-loaded without an official match', () => {
    const bundle = bundleFor({
      measurements: {
        dimensionsMm: { x: 40, y: 30, z: 20 },
        material: 'PETG',
        mountingMethod: 'adhesive',
      },
    })
    expect((bundle.discoveryStatus as { status: string }).status).toBe('physical-loaded')
    expect(value(bundle.printability, 'buildVolumeFit')).toBe(true)
  })

  it('loads reviews.csv when a human supplies it', async () => {
    const root = await tempRoot()
    await writeFile(path.join(root, 'reviews.csv'), 'source,rating,review_text\nshop,2,falls off\n')
    const human = await loadHumanInputs(root)
    expect(human.reviews).toHaveLength(1)
    expect(human.reviews[0].review_text).toBe('falls off')
  })

  it('writes only the eight evidence outputs and no blank research templates', async () => {
    const root = await tempRoot()
    const result = await writeDiscoveryRun({ productRoot: root, bundle: bundleFor({}) })
    const files = (await readdir(result.currentRoot)).sort()
    expect(files).toEqual([
      'discovery-report.md',
      'discovery-status.json',
      'evidence-gaps.json',
      'internal-product.json',
      'manifest.json',
      'official-product.json',
      'physical-evidence.json',
      'printability.json',
    ])
    expect(files).not.toContain('domestic-market.md')
  })

  it('preserves prior runs when discover is executed again', async () => {
    const root = await tempRoot()
    const bundle = bundleFor({})
    const first = await writeDiscoveryRun({ productRoot: root, bundle, now: new Date('2026-07-17T00:00:00.000Z') })
    const second = await writeDiscoveryRun({ productRoot: root, bundle, now: new Date('2026-07-17T00:00:00.000Z') })
    const runs = await readdir(path.join(root, 'discovery/runs'))
    expect(runs).toHaveLength(2)
    expect(first.runId).not.toBe(second.runId)
    expect(JSON.parse(await readFile(path.join(first.runRoot, 'manifest.json'), 'utf8'))).toBeTruthy()
  })

  it('does not promote raw reviews and competitor URLs to completed market research', () => {
    const bundle = bundleFor({
      official: officialProduct(),
      measurements: {
        dimensionsMm: { x: 40, y: 30, z: 20 },
        material: 'PETG',
        mountingMethod: 'adhesive',
      },
      reviews: [{ review_text: 'verified input' }],
      competitors: [{ url: 'https://example.com/product' }],
    })
    expect((bundle.discoveryStatus as { status: string }).status).toBe('ready-for-market-research')
    const gates = (bundle.discoveryStatus as { gates: Record<string, boolean> }).gates
    expect(gates.conceptGenerationGateOpen).toBe(false)
  })
})

function bundleFor(input: {
  measurements?: MeasurementsInput
  official?: OfficialProductSource
  reviews?: Array<Record<string, unknown>>
  competitors?: Array<Record<string, unknown>>
} = {}) {
  const human: HumanInputs = {
    measurements: input.measurements ?? null,
    reviews: input.reviews ?? [],
    competitors: input.competitors ?? [],
    notes: null,
    productImages: [],
    warnings: [],
  }
  return buildDiscoveryBundle({
    product: product(),
    snapshotMetadata: { dataVersion: '2026-06-30' },
    snapshotPath: '/private/source.json',
    official: input.official ?? null,
    officialSourceUrl: input.official ? 'https://example.com/official' : null,
    human,
    inputsRoot: '/private/products/101518-0001/inputs',
    generatedAt: '2026-07-17T00:00:00.000Z',
  })
}

function product(): ProductOpportunitySource {
  return {
    sku: '101518-0001',
    productName: '홀딩 후크',
    optionNames: ['화이트 2개입'],
    categoryId: 'curtain',
    basePrice: 3900,
    costPrice: 900,
    currentStock: 10,
    images: [],
    metadata: {},
    stockoutEventCount: 1,
    repeatBuyerRate: 0.1,
    monthly: Array.from({ length: 6 }, (_, index) => ({
      month: `2026-0${index + 1}`,
      quantity: 10 + index,
      orderCount: 5,
      sales: 10000,
      productCost: 3000,
      marketplaceFee: 1000,
      paidShippingFee: 0,
      actualShippingFee: 0,
      boxCost: 0,
      finalProfit: 6000,
      returnOrderCount: index === 0 ? 1 : 0,
    })),
  }
}

function officialProduct(): OfficialProductSource {
  return {
    id: 'official-1',
    name: '홀딩 후크',
    description: '<p>접착식 커튼 고리</p>',
    price: 3900,
    productInfoNotice: [{ label: '재질', value: '플라스틱' }],
  }
}

function value(object: Record<string, unknown>, key: string) {
  return (object[key] as { value: unknown }).value
}

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'funtastic-discovery-test-'))
  temporaryRoots.push(root)
  await mkdir(root, { recursive: true })
  return root
}
