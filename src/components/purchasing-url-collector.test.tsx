import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchasingUrlCollector } from './purchasing-url-collector'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error, info: vi.fn() } }))
function message(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { source: 'funtastic-1688-extension', ...data } }))
}
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('purchase URL verification and history synchronization', () => {
  it('syncs saved purchase URLs without requiring another extension collection run', async () => {
    const changed = vi.fn()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ updatedProducts: 2, updatedWorkflow: 3 }))
    render(<PurchasingUrlCollector onUrlsChanged={changed} />)
    fireEvent.click(screen.getByRole('button', { name: '발주 URL 연동' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(fetcher).toHaveBeenCalledWith('/api/purchasing/purchase-url-verification', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'sync' }) }))
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it.each(['unavailable', 'unknown'])('sends %s results to recover failed links for item master and workflow records', async status => {
    const url = 'https://detail.1688.com/offer/111111111111.html'
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => options?.method === 'POST'
      ? response(JSON.parse(String(options.body)).action === 'sync' ? { updatedProducts: 0, updatedWorkflow: 0 } : { updated: 1, replaced: 1, updatedWorkflow: 1 })
      : response({ links: [{ url, items: [{ sku: 'new-product:12345678-1234-1234-1234-123456789012', productName: '신상품' }] }], totalItems: 1, skippedInvalid: 0, hasMore: false }))
    const post = vi.spyOn(window, 'postMessage')
    render(<PurchasingUrlCollector />)
    act(() => message({ type: 'FUNTASTIC_1688_PONG' }))
    fireEvent.click(screen.getByRole('button', { name: 'URL 검증' }))
    await waitFor(() => expect(post.mock.calls.some(([value]) => value.type === 'FUNTASTIC_1688_VERIFY_START')).toBe(true))
    const start = post.mock.calls.map(([value]) => value).find(value => value.type === 'FUNTASTIC_1688_VERIFY_START')
    await act(async () => message({ type: 'FUNTASTIC_1688_VERIFY_RESULT', runId: start.runId, url, status, items: start.links[0].items }))
    await waitFor(() => expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2))
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).skus).toEqual(['new-product:12345678-1234-1234-1234-123456789012'])
  })
})
