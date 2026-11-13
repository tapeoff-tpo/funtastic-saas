import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Purchase1688TrackingProgressWindow,
  purchase1688TrackingPopupStorageKey,
  type Purchase1688TrackingLookupCandidate,
} from './purchase-request-actions'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }), usePathname: () => '/purchasing/orders',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const runId = 'resilient-run'
const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const firstOrder = '3317159640039018761'
const secondOrder = '3317159640039018762'
const candidate = (id: string, order: string, productName: string): Purchase1688TrackingLookupCandidate => ({
  id, sku: id.slice(0, 8), productName, optionName: null, supplierOrderNumber: order, trackingNumber: null,
})

function extensionMessage(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', {
    source: window, origin: window.location.origin, data: { source: 'funtastic-1688-extension', ...data },
  }))
}

function ack() {
  extensionMessage({ type: 'FUNTASTIC_1688_TRACKING_ACK', runId: `${runId}-0-1` })
}

function result() {
  extensionMessage({
    type: 'FUNTASTIC_1688_TRACKING_RESULT', runId: `${runId}-0-1`, orderNumber: firstOrder,
    trackingNumbers: ['S71268668516'], trackingSource: 'waybill_number',
    trackingEvidence: { label: '运单号码', extractionVersion: 2 },
  })
}

async function renderRunner(sameOrder = false) {
  window.localStorage.setItem(purchase1688TrackingPopupStorageKey(runId), JSON.stringify({
    createdAt: Date.now(), mode: 'initial',
    candidates: [candidate(firstId, firstOrder, '첫 상품'), candidate(secondId, sameOrder ? firstOrder : secondOrder, '다음 상품')],
  }))
  render(<Purchase1688TrackingProgressWindow runId={runId} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  await act(async () => { await vi.advanceTimersByTimeAsync(150) })
}

function pendingUntilAbort(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')), { once: true })
  })
}

describe('1688 tracking runner resilience', () => {
  beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear(); vi.clearAllMocks() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('stops safely when an acknowledged extension run never returns its terminal result', async () => {
    const post = vi.spyOn(window, 'postMessage')
    await renderRunner()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ runId: `${runId}-0-1`, orderNumber: firstOrder }), window.location.origin)
    await act(async () => { ack(); await vi.advanceTimersByTimeAsync(120_001) })
    expect(screen.getAllByText(/조회 시간이 초과/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument()
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ orderNumber: secondOrder }), window.location.origin)
  })

  it('bounds a hanging save request and then continues with the next independent order', async () => {
    const post = vi.spyOn(window, 'postMessage')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => pendingUntilAbort(init?.signal))
    await renderRunner()
    await act(async () => { ack(); result(); await Promise.resolve() })
    expect(fetcher).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001) })
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(screen.getByText('미처리')).toBeInTheDocument()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: secondOrder, runId: `${runId}-1-1` }), window.location.origin)
  })

  it('shows a saved sibling item immediately while the remaining rows of its order are still saving', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => String(url).includes(firstId)
      ? Promise.resolve({ ok: true, json: async () => ({ id: firstId, trackingCount: 1 }) } as Response)
      : pendingUntilAbort(init?.signal))
    await renderRunner(true)
    await act(async () => { ack(); result(); await Promise.resolve(); await Promise.resolve() })
    const row = screen.getByText('첫 상품').parentElement?.parentElement
    expect(row).toBeTruthy()
    expect(within(row!).getByText('성공')).toBeInTheDocument()
    expect(screen.getByText('저장 중')).toBeInTheDocument()
  })

  it('ignores duplicate lookup results and late lookup errors once a validated result is saving', async () => {
    const post = vi.spyOn(window, 'postMessage')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => pendingUntilAbort(init?.signal))
    await renderRunner()
    await act(async () => {
      ack(); result(); result()
      extensionMessage({ type: 'FUNTASTIC_1688_TRACKING_ERROR', runId: `${runId}-0-1`, message: '뒤늦게 도착한 이전 조회 오류' })
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ orderNumber: secondOrder }), window.location.origin)
    expect(screen.queryByText('뒤늦게 도착한 이전 조회 오류')).not.toBeInTheDocument()
    expect(screen.getAllByText('저장 중').length).toBeGreaterThan(0)
  })
})
