// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const directory = path.resolve('tools/browser-extensions/funtastic-coupang-registration')
const source = (name: string) => readFileSync(path.join(directory, name), 'utf8')
const channel = 'funtastic-coupang-registration'
const saas = { tab: { id: 1 }, url: 'https://funtastic-saas-vercel.vercel.app/operations/coupang-registration' }
const supplier = { tab: { id: 19 }, url: 'https://supplier.coupang.com/sr/registration/step/productPage' }
const product = {
  id: 'p1', name: '상품 빨강', sourceCode: '123', modelName: '상품', brand: '생활살림', color: '빨강', quantity: '1개', barcode: '',
  manufacturer: '공장', importer: '수입자', tradeType: '기타 도소매업자', taxType: '과세', importType: '수입상품', size: '10cm', alternativeText: '상품',
  supplyPrice: 3000, sellingPrice: 5000, coupangBarcode: true, primaryImageUrl: 'https://images.example.com/a.jpg', additionalImageUrls: [],
  detailHtml: '<img src="https://images.example.com/a.jpg">', tags: ['상품'], category: { sourcePath: '상품', sourceName: '상품', searchTerms: ['상품'] },
  labelFiles: [{ name: 'label.jpg', data: '/9j/' }], labelImageUrls: [], certifications: {}, notices: {},
  logistics: { boxQuantity: 1, shelfLifeDays: 0, handlingReason: '해당사항없음', weightGrams: 100, dimensionsMm: [100, 100, 100] },
}
const job = { mode: 'individual', jobId: 'job-1', token: '0123456789abcdef', products: [product] }

function worker() {
  let listener: (message: unknown, sender: unknown, respond: (value: unknown) => void) => void = () => {}
  let store: Record<string, unknown> = {}
  const chrome = {
    storage: { local: { get: vi.fn(async () => structuredClone(store)), set: vi.fn(async value => { store = structuredClone(value) }) } },
    tabs: { create: vi.fn(async () => ({ id: 19, url: supplier.url, status: 'complete' })), get: vi.fn(async () => ({ id: 19, url: supplier.url, status: 'complete' })), update: vi.fn(async () => ({})), sendMessage: vi.fn(async () => ({})), onUpdated: { addListener: vi.fn() } },
    alarms: { create: vi.fn(async () => {}), onAlarm: { addListener: vi.fn() } },
    runtime: { getManifest: () => ({ version: '1.2.0' }), onMessage: { addListener: (value: typeof listener) => { listener = value } } },
  }
  const sandbox = vm.createContext({ chrome, URL, console, setTimeout, clearTimeout, importScripts: (...names: string[]) => { for (const name of names) vm.runInContext(source(name), sandbox) } })
  vm.runInContext(source('background.js'), sandbox)
  return { chrome, data: () => store, send: (message: object, sender: object = saas) => new Promise<unknown>(resolve => listener({ channel, ...message }, sender, resolve)) }
}

describe('Individual registration extension routing', () => {
  it('distinguishes a missing local job from an existing one without starting or altering it', async () => {
    const first = worker()
    const other = worker()
    const reference = { jobId: job.jobId, token: job.token }
    expect(await first.send({ type: 'INSPECT_JOB', job: reference })).toEqual({ ok: true, found: false })
    expect(first.chrome.tabs.create).not.toHaveBeenCalled()
    await first.send({ type: 'START', job })
    const before = structuredClone(first.data())
    expect(await first.send({ type: 'INSPECT_JOB', job: reference })).toMatchObject({ ok: true, found: true, mode: 'individual', status: 'running' })
    expect(first.data()).toEqual(before)
    expect(await other.send({ type: 'INSPECT_JOB', job: reference })).toEqual({ ok: true, found: false })
    expect(await first.send({ type: 'INSPECT_JOB', job: { ...reference, token: 'bad-bad-bad-bad-bad' } })).toEqual({ ok: true, found: false })
    expect(await first.send({ type: 'INSPECT_JOB', job: reference }, { ...saas, url: 'https://evil.test/' })).toMatchObject({ ok: false })
    expect(other.chrome.tabs.create).not.toHaveBeenCalled()
  })
  it('advertises support and routes validated jobs to the fixed inactive Hub page', async () => {
    const instance = worker()
    expect(await instance.send({ type: 'PING' })).toMatchObject({ supportsCategories: true, supportsIndividual: true })
    expect(await instance.send({ type: 'START', job })).toMatchObject({ ok: true })
    expect(instance.chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://supplier.coupang.com/sr/registration', active: false })
    expect(instance.chrome.tabs.sendMessage).toHaveBeenCalledWith(19, expect.objectContaining({ type: 'INDIVIDUAL_PREPARE', productIndex: 0 }))
    expect(await instance.send({ type: 'START', job: { ...job, jobId: 'job-2' } }, { ...saas, url: 'https://evil.test' })).toMatchObject({ ok: false })
  })

  it('persists confirmed draft evidence, rejects a foreign callback, and supports stop', async () => {
    const instance = worker()
    await instance.send({ type: 'START', job })
    const phase = { type: 'INDIVIDUAL_PHASE', jobId: job.jobId, token: job.token, productId: 'p1', phase: 'running', step: 'product', message: 'saved', stepStatus: 'saved', draftName: product.name, draftSavedAt: '2026.11.26 17:01', assets: { primary: true } }
    expect(await instance.send(phase, { ...supplier, url: 'https://supplier.coupang.com.evil.test/' })).toMatchObject({ ok: false })
    expect(await instance.send(phase, supplier)).toEqual({ ok: true })
    const stored = instance.data()['supplier-registration-jobs-v1'] as Record<string, { products: Array<{ checkpoint: Record<string, unknown> }> }>
    expect(stored[job.jobId].products[0].checkpoint).toMatchObject({ draftName: product.name, draftSavedAt: '2026.11.26 17:01', assets: { primary: true } })
    expect(await instance.send({ type: 'STOP_JOB', job: { jobId: job.jobId, token: job.token } })).toEqual({ ok: true, started: true })
    expect(instance.chrome.tabs.sendMessage).toHaveBeenCalledWith(19, expect.objectContaining({ type: 'INDIVIDUAL_STOP', productId: 'p1' }))
  })

  it('includes both individual scripts in the downloadable extension manifest', () => {
    const manifest = JSON.parse(source('manifest.json'))
    expect(manifest.content_scripts.find((item: { matches: string[] }) => item.matches.includes('https://supplier.coupang.com/*')).js).toContain('individual-content.js')
    expect(source('background.js')).toContain("'individual-worker.js'")
    expect(readFileSync(path.resolve('src/app/api/operations/coupang-registration/extension/route.ts'), 'utf8')).toContain("'individual-worker.js'")
    expect(readFileSync(path.resolve('src/app/api/operations/coupang-registration/extension/route.ts'), 'utf8')).toContain("'individual-content.js'")
  })
})
