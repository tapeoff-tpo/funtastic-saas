import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkSupplierRegistration, pingSupplierExtension, startSupplierRegistration, subscribeSupplierRegistration, type SupplierRegistrationJob } from '@/lib/coupang-registration/supplier-bridge'

const extension = 'funtastic-coupang-registration-extension'
const job: SupplierRegistrationJob = { jobId: 'bridge-job', token: '0123456789abcdef', files: [{ name: 'bridge-job.xlsx', data: 'UEs=', kind: 'workbook' }], rows: [{ id: 'r1', name: '상품 옵션' }] }
function response(data: Record<string, unknown>, origin = location.origin, source: Window | null = window) {
  window.dispatchEvent(new MessageEvent('message', { source, origin, data: { source: extension, ...data } }))
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('Supplier registration page bridge', () => {
  it('correlates a ping only to its own page origin and request id', async () => {
    vi.useFakeTimers()
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const ping = pingSupplierExtension()
    const sent = post.mock.calls[0][0]
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true, version: 'wrong' }, 'https://evil.test')
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true, version: 'wrong' }, location.origin, null)
    response({ type: 'RESPONSE', requestId: 'wrong', ok: true, version: 'wrong' })
    response({ type: 'RESPONSE', requestId: sent.requestId, ok: true, version: '1.0.0' })
    expect(await ping).toEqual({ connected: true, version: '1.0.0' })
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
})
