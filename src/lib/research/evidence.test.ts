import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildResearchBundle,
  loadResearchInputs,
  writeResearchRun,
  type DiscoveryEvidence,
} from './evidence'

const discovery: DiscoveryEvidence = {
  internalProduct: { sku: 'SKU-1', productName: 'Test Product' },
  officialProduct: { loaded: true, productName: 'Official Product' },
  physicalEvidence: { loaded: false },
  discoveryStatus: { status: 'official-loaded' },
  sourceRoot: '/evidence/discovery/current',
}

describe('market research evidence builder', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'funtastic-research-'))
  })

  async function bundle() {
    const inputs = await loadResearchInputs(root)
    return buildResearchBundle({
      sku: 'SKU-1',
      discovery,
      inputs,
      researchRoot: root,
      generatedAt: '2026-07-17T00:00:00.000Z',
    })
  }

  it('returns empty and creates no customer claims when reviews are absent', async () => {
    const result = await bundle()
    expect(result.researchStatus.status).toBe('empty')
    expect(result.marketEvidence.productEvidence.internal).toMatchObject({ sku: 'SKU-1', productName: 'Test Product' })
    expect(result.customerProblems.items).toEqual([])
    expect(result.customerUseCases.items).toEqual([])
  })

  it('loads reviews and aggregates only explicit problem and use-case fields', async () => {
    await writeFile(path.join(root, 'reviews.csv'), [
      'review_id,review,problem,use_case,rating',
      'r1,"The hook fell","Falls from wall","Curtain tieback",2',
      'r2,"Used every day","Falls from wall","Curtain tieback",4',
    ].join('\n'))
    const result = await bundle()
    expect(result.researchStatus.status).toBe('reviews-loaded')
    expect(result.customerProblems.items).toMatchObject([{ problem: 'Falls from wall', occurrenceCount: 2 }])
    expect(result.customerUseCases.items).toMatchObject([{ useCase: 'Curtain tieback', occurrenceCount: 2 }])
  })

  it('does not infer a problem from review text alone', async () => {
    await writeFile(path.join(root, 'reviews.csv'), 'review_id,review\nr1,"It fell from the wall"\n')
    const result = await bundle()
    expect(result.marketEvidence.reviews).toHaveLength(1)
    expect(result.customerProblems.items).toEqual([])
  })

  it('returns reviews-loaded when competitor inputs are absent', async () => {
    await writeFile(path.join(root, 'reviews.csv'), 'review_id,review\nr1,"Good"\n')
    const result = await bundle()
    expect(result.researchStatus.status).toBe('reviews-loaded')
    expect(result.competitors.items).toEqual([])
  })

  it('loads valid competitors without inventing missing fields', async () => {
    await writeFile(path.join(root, 'competitor-urls.csv'), [
      'url,brand,product_name,price,material,mounting_method',
      'https://example.com/hook,Acme,Hook,12000,ABS,adhesive',
    ].join('\n'))
    const result = await bundle()
    expect(result.researchStatus.status).toBe('competitors-loaded')
    expect(result.competitors.items).toMatchObject([{
      brand: 'Acme',
      productName: 'Hook',
      price: 12000,
      material: 'ABS',
      mountingMethod: 'adhesive',
      country: null,
    }])
  })

  it('deduplicates reviews deterministically', async () => {
    await writeFile(path.join(root, 'reviews.csv'), [
      'review_id,review,problem',
      'r1,"Same review","Too small"',
      'r1,"Same review","Too small"',
    ].join('\n'))
    const result = await bundle()
    expect(result.marketEvidence.inputSummary).toMatchObject({ rawReviewCount: 2, uniqueReviewCount: 1, duplicateReviewCount: 1 })
    expect(result.customerProblems.items).toMatchObject([{ occurrenceCount: 1 }])
  })

  it('rejects malformed and non-http competitor URLs', async () => {
    await writeFile(path.join(root, 'competitor-urls.csv'), [
      'url,brand',
      'not-a-url,Acme',
      'ftp://example.com/hook,Other',
    ].join('\n'))
    const result = await bundle()
    expect(result.competitors.items).toEqual([])
    expect(result.marketEvidence.rejectedEvidence).toHaveLength(2)
    expect(result.researchStatus.status).toBe('empty')
  })

  it('uses market-evidence-ready only when reviews and valid competitors exist', async () => {
    await writeFile(path.join(root, 'reviews.csv'), 'review_id,review\nr1,"Good"\n')
    await writeFile(path.join(root, 'amazon-links.csv'), 'url,brand\nhttps://amazon.example/item,Acme\n')
    const result = await bundle()
    expect(result.researchStatus.status).toBe('market-evidence-ready')
  })

  it('preserves prior runs and writes exactly seven current outputs', async () => {
    const result = await bundle()
    const first = await writeResearchRun({ researchRoot: root, bundle: result, now: new Date('2026-07-17T00:00:00Z') })
    const second = await writeResearchRun({ researchRoot: root, bundle: result, now: new Date('2026-07-17T00:00:00Z') })
    const runs = await readdir(path.join(root, 'runs'))
    const current = await readdir(path.join(root, 'current'))
    expect(first.runId).not.toBe(second.runId)
    expect(runs).toHaveLength(2)
    expect(current.sort()).toEqual([
      'competitors.json',
      'customer-problems.json',
      'customer-use-cases.json',
      'market-evidence.json',
      'premium-brands.json',
      'research-report.md',
      'research-status.json',
    ])
    expect(JSON.parse(await readFile(path.join(root, 'current/research-status.json'), 'utf8')).status).toBe('empty')
  })
})
