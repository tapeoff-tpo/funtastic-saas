import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkSupplierRegistration, getSupplierCategoryTemplate, inspectSupplierRegistration, pingSupplierExtension, searchSupplierCategories, startSupplierRegistration, subscribeSupplierRegistration, type SupplierRegistrationJob } from '@/lib/coupang-registration/supplier-bridge'

const extension = 'funtastic-coupang-registration-extension'
const job: SupplierRegistrationJob = { jobId: 'bridge-job', token: '0123456789abcdef', files: [{ name: 'bridge-job.xlsx', data: 'UEs=', kind: 'workbook' }], rows: [{ id: 'r1', name: '상품 옵션' }] }
function response(data: Record<string, unknown>, origin = location.origin, source: Window | null = window) {
  window.dispatchEvent(new MessageEvent('message', { source, origin, data: { source: extension, ...data } }))
}
beforeEach(async () => {
  const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
  const ping = pingSupplierExtension()
  response({ type: 'RESPONSE', requestId: post.mock.calls[0][0].requestId, ok: true, version: '1.1.0', supportsCategories: true })
  await ping
  post.mockRestore()
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('Supplier registration page bridge', () => {
  it('distinguishes an absent job from an unreachable or outdated extension', async () => {
    vi.useFakeTimers()
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const reference = { jobId: job.jobId, token: job.token }
    const missing = inspectSupplierRegistration(reference)
    response({ type: 'RESPONSE', requestId: post.mock.calls.at(-1)![0].requestId, ok: true, found: false })
    expect(await missing).toEqual({ found: false })
    const found = inspectSupplierRegistration(reference)
    response({ type: 'RESPONSE', requestId: post.mock.calls.at(-1)![0].requestId, ok: true, found: true, mode: 'individual', status: 'running' })
    expect(await found).toEqual({ found: true, mode: 'individual', status: 'running' })
    const malformed = inspectSupplierRegistration(reference)
    response({ type: 'RESPONSE', requestId: post.mock.calls.at(-1)![0].requestId, ok: true })
    await expect(malformed).rejects.toThrow('최신 버전')
    const unavailable = inspectSupplierRegistration(reference)
    const rejected = expect(unavailable).rejects.toThrow('연결하지 못했습니다')
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
    expect(post.mock.calls.every(([message]) => message.type === 'INSPECT_JOB')).toBe(true)
  })
  it('correlates a ping only to its own page origin and request id', async () => {
    vi.useFakeTimers()
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const ping = pingSupplierExtension()
    const sent = post.mock.calls[0][0]
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true, version: 'wrong' }, 'https://evil.test')
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true, version: 'wrong' }, location.origin, null)
    response({ type: 'RESPONSE', requestId: 'wrong', ok: true, version: 'wrong' })
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true, version: '1.0.0' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await ping).toEqual({ connected: true, version: '1.0.0' })
  })
  it('prefers a working category extension over an older or invalidated bridge response', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const ping = pingSupplierExtension()
    const sent = post.mock.calls[0][0]
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: false, error: 'Extension context invalidated' })
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true, version: '1.0.0' })
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true, version: '1.1.1', supportsCategories: true, extensionId: 'working-extension' })
    expect(await ping).toEqual({ connected: true, version: '1.1.1', supportsCategories: true })
    const search = searchSupplierCategories(['선반'])
    const requested = post.mock.calls.at(-1)![0]
    expect(requested).toMatchObject({ type: 'CATEGORY_SEARCH', extensionId: 'working-extension' })
    response({ type: 'RESPONSE', requestId: requested.requestId, ok: false, error: 'stale', extensionId: 'old-extension' })
    response({ type: 'RESPONSE', requestId: requested.requestId, ok: true, categories: [], extensionId: 'working-extension' })
    expect(await search).toEqual([])
  })
  it('does not consider an empty worker response a connected extension', async () => {
    vi.useFakeTimers()
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const ping = pingSupplierExtension()
    response({ type: 'RESPONSE', requestId: post.mock.calls[0][0].requestId })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await ping).toMatchObject({ connected: false })
  })
  it('accepts progress only for an explicitly started job token and unsubscribes', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const received = vi.fn()
    const unsubscribe = subscribeSupplierRegistration(received)
    response({ type: 'PROGRESS', progress: { ...job, status: 'running', message: 'not started' } })
    expect(received).not.toHaveBeenCalled()
    const start = startSupplierRegistration(job)
    const sent = post.mock.calls[0][0]
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true })
    expect(await start).toEqual({ started: true })
    response({ type: 'PROGRESS', progress: { jobId: job.jobId, token: 'bad', status: 'succeeded', message: 'bad' } })
    expect(received).not.toHaveBeenCalled()
    const progress = { jobId: job.jobId, token: job.token, status: 'running', message: '검수중' }
    response({ type: 'PROGRESS', progress })
    expect(received).toHaveBeenCalledWith(progress)
    unsubscribe()
    response({ type: 'PROGRESS', progress })
    expect(received).toHaveBeenCalledTimes(1)
  })
  it('checks the same immutable job and propagates extension errors', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const check = checkSupplierRegistration({ ...job, jobId: 'check-job' })
    const sent = post.mock.calls[0][0]
    expect(sent.type).toBe('CHECK')
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: false, error: '원래 Chrome에서 확인해주세요.' })
    await expect(check).rejects.toThrow('원래 Chrome에서 확인해주세요.')
  })
  it('requests official categories using only bounded source queries and correlates the result', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const search = searchSupplierCategories(['행거', '바지걸이', '행거'])
    const sent = post.mock.calls[0][0]
    expect(sent).toMatchObject({ type: 'CATEGORY_SEARCH', queries: ['행거', '바지걸이'] })
    const category = { id: '1899', name: '행거', path: '가구 > 행거', matchedQueries: ['행거'] }
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true, categories: [category, { id: '../invalid' }] })
    expect(await search).toEqual([category])
    await expect(searchSupplierCategories(['x'.repeat(201)])).rejects.toThrow('검색어')
  })
  it('downloads only a selected numeric category and validates the returned file', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const download = getSupplierCategoryTemplate('1899')
    const sent = post.mock.calls[0][0]
    expect(sent).toMatchObject({ type: 'CATEGORY_TEMPLATE', categoryId: '1899' })
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true, file: { name: 'official.zip', data: 'UEs=' } })
    expect(await download).toEqual({ name: 'official.zip', data: 'UEs=' })
    await expect(getSupplierCategoryTemplate('https://evil.test')).rejects.toThrow('카테고리')
  })
})
