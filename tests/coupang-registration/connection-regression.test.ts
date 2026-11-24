import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const directory = path.resolve('tools/browser-extensions/funtastic-coupang-registration')
const source = readFileSync(path.join(directory, 'saas-bridge.js'), 'utf8')
const origin = 'https://funtastic-saas-vercel.vercel.app'
const channel = 'funtastic-coupang-registration'
type Listener = (event: Record<string, unknown>) => void

function bridge(pathname = '/dashboard', response?: unknown) {
  const workerResponse = arguments.length > 1 ? response : { ok: true, version: '1.1.1', supportsCategories: true }
  let pageListener: Listener = () => {}
  let runtimeListener: Listener = () => {}
  const location = { origin, pathname }
  const page = { addEventListener: (_type: string, listener: Listener) => { pageListener = listener }, postMessage: vi.fn() }
  const chrome = { runtime: {
    id: 'registration-extension',
    sendMessage: vi.fn((_message, respond) => respond(workerResponse)),
    onMessage: { addListener: (listener: Listener) => { runtimeListener = listener } },
  } }
  vm.runInNewContext(source, { window: page, location, chrome })
  return {
    location, page, chrome,
    send: (data: object, sender = page, eventOrigin = origin) => pageListener({ source: sender, origin: eventOrigin, data: { source: channel, requestId: 'request-1', ...data } }),
    progress: (progress: object) => runtimeListener({ channel: channel + '-extension', type: 'PROGRESS', progress }),
  }
}

describe('Supplier bridge SPA connection regression', () => {
  it('loads on the SaaS entry document and starts working after client navigation to registration', () => {
    const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
    const matches = manifest.content_scripts.find((script: { js: string[] }) => script.js.includes('saas-bridge.js')).matches
    expect(matches).toContain(origin + '/*')
    expect(manifest.version).toBe('1.1.1')
    const instance = bridge()
    instance.send({ type: 'PING' })
    expect(instance.chrome.runtime.sendMessage).not.toHaveBeenCalled()
    instance.location.pathname = '/operations/coupang-registration'
    instance.send({ type: 'PING' })
    expect(instance.chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({ channel, type: 'PING', job: undefined }, expect.any(Function))
    expect(instance.page.postMessage).toHaveBeenCalledWith(expect.objectContaining({ ok: true, supportsCategories: true, extensionId: 'registration-extension' }), origin)
  })

  it('keeps other SaaS pages, foreign senders, and commands targeted to another extension isolated', () => {
    const instance = bridge('/operations/coupang-registration')
    instance.send({ type: 'CATEGORY_SEARCH', queries: ['선반'] }, {}, origin)
    instance.send({ type: 'CATEGORY_SEARCH', queries: ['선반'] }, undefined, 'https://evil.test')
    instance.send({ type: 'CATEGORY_SEARCH', queries: ['선반'], extensionId: 'other-extension' })
    expect(instance.chrome.runtime.sendMessage).not.toHaveBeenCalled()
    instance.location.pathname = '/orders'
    instance.send({ type: 'CATEGORY_SEARCH', queries: ['선반'] })
    expect(instance.chrome.runtime.sendMessage).not.toHaveBeenCalled()
    instance.location.pathname = '/operations/coupang-registration'
    instance.send({ type: 'CATEGORY_SEARCH', queries: ['선반'], extensionId: 'registration-extension' })
    expect(instance.chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({ channel, type: 'CATEGORY_SEARCH', queries: ['선반'] }, expect.any(Function))
  })

  it('reports an absent or malformed worker response as a disconnected bridge instead of success', () => {
    for (const response of [undefined, null, {}, { version: '1.1.1' }]) {
      const instance = bridge('/operations/coupang-registration', response)
      instance.send({ type: 'PING' })
      expect(instance.page.postMessage).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: '쿠팡 등록 확장을 새로고침해주세요.', extensionId: 'registration-extension' }), origin)
    }
  })

  it('retains per-job tokens and stops emitting progress after leaving registration', () => {
    const instance = bridge('/operations/coupang-registration')
    const job = { jobId: 'one-job', token: 'one-token' }
    instance.send({ type: 'START', job })
    instance.page.postMessage.mockClear()
    instance.progress({ ...job, token: 'different-token', status: 'running' })
    expect(instance.page.postMessage).not.toHaveBeenCalled()
    instance.progress({ ...job, status: 'running' })
    expect(instance.page.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'PROGRESS', progress: { ...job, status: 'running' } }), origin)
    instance.page.postMessage.mockClear()
    instance.location.pathname = '/orders'
    instance.progress({ ...job, status: 'running' })
    expect(instance.page.postMessage).not.toHaveBeenCalled()
  })
})
