import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const directory = path.resolve('tools/browser-extensions/funtastic-coupang-registration')
const shared = readFileSync(path.join(directory, 'shared.js'), 'utf8')
const workerSource = readFileSync(path.join(directory, 'background.js'), 'utf8')
const channel = 'funtastic-coupang-registration'
const sender = { tab: { id: 1 }, url: 'https://funtastic-saas-vercel.vercel.app/operations/coupang-registration' }
const hubTab = { id: 19, url: 'https://supplier.coupang.com/qvt/registration', status: 'complete' }
type Listener = (message: unknown, sender: unknown, respond: (value: unknown) => void) => void
function worker(options: { tabs?: object[]; get?: () => Promise<object>; content?: (id: number, message: object) => Promise<unknown> } = {}) {
  let listener: Listener = () => {}
  const chrome = {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn() } },
    tabs: {
      query: vi.fn(async () => options.tabs ?? [hubTab]), create: vi.fn(async () => ({ id: 19 })),
      get: vi.fn(options.get ?? (async () => hubTab)), update: vi.fn(),
      sendMessage: vi.fn(options.content ?? (async () => ({ ok: true, categories: [] }))), onUpdated: { addListener: vi.fn() },
    },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    runtime: { getManifest: () => ({ version: '1.1.0' }), onMessage: { addListener: (value: Listener) => { listener = value } } },
  }
  const sandbox = { chrome, URL, setTimeout, clearTimeout, Date, importScripts: () => {} }
  vm.runInNewContext(shared, sandbox)
  vm.runInNewContext(workerSource, sandbox)
  return { chrome, send: (message: object, origin: object = sender) => new Promise<unknown>(resolve => listener({ channel, ...message }, origin, resolve)) }
}
afterEach(() => vi.useRealTimers())

describe('Supplier category worker routing', () => {
  it('uses the authenticated registration tab and passes only bounded category arguments', async () => {
    const instance = worker()
    expect(await instance.send({ type: 'CATEGORY_SEARCH', queries: [' 행거 ', '행거', '옷걸이'], url: 'https://evil.test', job: { token: 'unused' } })).toEqual({ ok: true, categories: [] })
    expect(instance.chrome.tabs.sendMessage).toHaveBeenCalledWith(19, { channel, type: 'CATEGORY_SEARCH', queries: ['행거', '옷걸이'] })
    expect(instance.chrome.tabs.create).not.toHaveBeenCalled()
    expect(instance.chrome.tabs.update).not.toHaveBeenCalled()
    expect(instance.chrome.storage.local.get).not.toHaveBeenCalled()
    expect(await instance.send({ type: 'PING' })).toEqual({ ok: true, version: '1.1.0', supportsCategories: true })
  })
  it('rejects foreign origins and invalid category input before opening any tab', async () => {
    const instance = worker()
    expect(await instance.send({ type: 'CATEGORY_SEARCH', queries: ['행거'] }, { ...sender, url: 'https://evil.test/' })).toMatchObject({ ok: false })
    for (const queries of [[], Array(7).fill('행거'), [''], ['x'.repeat(201)], [42]]) expect(await instance.send({ type: 'CATEGORY_SEARCH', queries })).toMatchObject({ ok: false })
    for (const categoryId of ['../login', '1&url=https://evil.test', '0', '-2', '9007199254740992']) expect(await instance.send({ type: 'CATEGORY_TEMPLATE', categoryId })).toMatchObject({ ok: false })
    expect(instance.chrome.tabs.query).not.toHaveBeenCalled()
  })
  it('opens only the fixed inactive Hub page and handles login and tab readiness limits', async () => {
    const instance = worker({ tabs: [] })
    await instance.send({ type: 'CATEGORY_TEMPLATE', categoryId: 1899 })
    expect(instance.chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://supplier.coupang.com/qvt/registration', active: false })
    expect(instance.chrome.tabs.sendMessage).toHaveBeenCalledWith(19, { channel, type: 'CATEGORY_TEMPLATE', categoryId: '1899' })
    const login = worker({ get: async () => ({ ...hubTab, url: 'https://supplier.coupang.com/qvt/sso/login' }) })
    expect(await login.send({ type: 'CATEGORY_SEARCH', queries: ['행거'] })).toMatchObject({ ok: false, error: expect.stringContaining('로그인') })
    expect(login.chrome.tabs.sendMessage).not.toHaveBeenCalled()
    vi.useFakeTimers()
    const loading = worker({ get: async () => ({ ...hubTab, status: 'loading' }) })
    const result = loading.send({ type: 'CATEGORY_SEARCH', queries: ['행거'] })
    await vi.advanceTimersByTimeAsync(15100)
    expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('시간이 초과') })
  })
  it('keeps category requests independent of a stalled registration job and bounds content waiting', async () => {
    const instance = worker()
    instance.chrome.storage.local.get.mockImplementation(() => new Promise(() => {}))
    void instance.send({ type: 'START', job: { jobId: 'job', token: '0123456789abcdef', rows: [{ id: 'r', name: '상품' }], files: [{ name: 'job.xlsx', data: 'UEs=', kind: 'workbook' }] } })
    expect(await instance.send({ type: 'PING' })).toEqual({ ok: true, version: '1.1.0', supportsCategories: true })
    expect(await instance.send({ type: 'CATEGORY_SEARCH', queries: ['행거'] })).toEqual({ ok: true, categories: [] })
    vi.useFakeTimers()
    const stalled = worker({ content: () => new Promise(() => {}) })
    const pending = stalled.send({ type: 'CATEGORY_SEARCH', queries: ['행거'] })
    await vi.advanceTimersByTimeAsync(70001)
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('시간이 초과') })
  })
})

describe('Supplier category SaaS content bridge', () => {
  it('requires same-page messages and strips arbitrary URLs and jobs from category commands', () => {
    let pageListener: (event: object) => void = () => {}
    const page = { addEventListener: (_type: string, listener: typeof pageListener) => { pageListener = listener }, postMessage: vi.fn() }
    const chrome = { runtime: { sendMessage: vi.fn((_message, respond) => respond({ ok: true, categories: [] })), onMessage: { addListener: vi.fn() } } }
    const origin = 'https://funtastic-saas-vercel.vercel.app'
    vm.runInNewContext(readFileSync(path.join(directory, 'saas-bridge.js'), 'utf8'), { window: page, location: { origin, pathname: '/operations/coupang-registration' }, chrome })
    const data = { source: channel, type: 'CATEGORY_SEARCH', requestId: 'search', queries: ['행거'], url: 'https://evil.test', job: { token: 'unused' } }
    pageListener({ source: page, origin: 'https://evil.test', data })
    pageListener({ source: {}, origin, data })
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
    pageListener({ source: page, origin, data })
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ channel, type: 'CATEGORY_SEARCH', queries: ['행거'] }, expect.any(Function))
    expect(page.postMessage).toHaveBeenCalledWith({ source: 'funtastic-coupang-registration-extension', type: 'RESPONSE', requestId: 'search', ok: true, categories: [] }, origin)
  })
})
