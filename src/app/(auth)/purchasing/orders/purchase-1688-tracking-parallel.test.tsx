import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Purchase1688TrackingProgressWindow, purchase1688TrackingPopupStorageKey } from './purchase-request-actions'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/purchasing/orders', useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const batchId = 'parallel-batch'
const order = (index: number) => (BigInt('3317159640039018761') + BigInt(index)).toString()
const id = (index: number) => `parallel-item-${index}`
const runId = (index: number, attempt = 1) => `${batchId}-${index}-${attempt}`
type Start = { type: string; runId: string; batchId: string; orderNumber: string; parallelVersion: number }
type PostSpy = { mock: { calls: unknown[][] } }

function message(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin,
    data: { source: 'funtastic-1688-extension', ...data } }))
}
function ack(index: number, attempt = 1, parallel = true) {
  message({ type: 'FUNTASTIC_1688_TRACKING_ACK', runId: runId(index, attempt), orderNumber: order(index),
    ...(parallel ? { parallelVersion: 1, maxConcurrency: 3 } : {}) })
}
function result(index: number, attempt = 1, orderNumber = order(index)) {
  message({ type: 'FUNTASTIC_1688_TRACKING_RESULT', runId: runId(index, attempt), orderNumber,
    trackingNumbers: [`WAYBILL-${index}`], trackingSource: 'waybill_number', trackingEvidence: { label: '运单号码', extractionVersion: 2 } })
}
function fail(index: number, reason: string, attempt = 1) {
  message({ type: 'FUNTASTIC_1688_TRACKING_ERROR', runId: runId(index, attempt), orderNumber: order(index), message: reason })
}
function starts(post: PostSpy): Start[] {
  return post.mock.calls.map(([data]) => data as Start).filter((data) => data.type === 'FUNTASTIC_1688_TRACKING_START')
}
async function advance(ms = 150) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}
async function send(callback: () => void) {
  await act(async () => { callback(); await vi.advanceTimersByTimeAsync(0) })
}
async function setup(count = 5) {
  const post = vi.spyOn(window, 'postMessage')
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ trackingCount: 1 }) } as Response)
  window.localStorage.setItem(purchase1688TrackingPopupStorageKey(batchId), JSON.stringify({ createdAt: Date.now(), mode: 'initial',
    candidates: Array.from({ length: count }, (_, index) => ({ id: id(index), sku: `SKU-${index}`, productName: `병렬 상품 ${index}`,
      optionName: null, supplierOrderNumber: order(index), trackingNumber: null })) }))
  render(<Purchase1688TrackingProgressWindow runId={batchId} />)
  await advance(0)
  await advance()
  return { post, fetcher }
}
function row(index: number) {
  return screen.getByText(`병렬 상품 ${index}`).parentElement!.parentElement!
}

describe('1688 tracking parallel worker pool', () => {
  beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('negotiates three slots, saves an out-of-order completion against its own row, and immediately fills the free slot', async () => {
    const { post, fetcher } = await setup()
    expect(starts(post).map((data) => data.orderNumber)).toEqual([order(0)])
    expect(starts(post)[0]).toMatchObject({ batchId, parallelVersion: 1 })
    await send(() => ack(0))
    await advance()
    expect(starts(post).map((data) => data.orderNumber)).toEqual([order(0), order(1), order(2)])
    await send(() => { ack(1); ack(2); result(2) })
    await advance()
    expect(fetcher).toHaveBeenCalledWith(`/api/purchasing/purchase-requests/${id(2)}/1688-tracking`, expect.objectContaining({
      body: JSON.stringify({ orderNumber: order(2), trackingNumbers: ['WAYBILL-2'], trackingSource: 'waybill_number',
        trackingEvidence: { label: '运单号码', extractionVersion: 2 }, replaceUninspectedInspection: false }),
    }))
    expect(within(row(2)).getByText('성공')).toBeInTheDocument()
    expect(within(row(0)).getByText('조회 중')).toBeInTheDocument()
    expect(starts(post).map((data) => data.orderNumber)).toEqual([order(0), order(1), order(2), order(3)])
    expect(starts(post).some((data) => data.orderNumber === order(4))).toBe(false)
  })

  it('ignores a cross-order result and duplicate or stale terminal messages without consuming another slot', async () => {
    const { post, fetcher } = await setup()
    await send(() => ack(0))
    await advance()
    await send(() => { ack(1); ack(2); result(1, 1, order(0)) })
    expect(fetcher).not.toHaveBeenCalled()
    await send(() => { result(1); result(1); fail(1, '이미 완료한 주문의 늦은 오류') })
    await advance()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(within(row(1)).getByText('성공')).toBeInTheDocument()
    expect(screen.queryByText('이미 완료한 주문의 늦은 오류')).not.toBeInTheDocument()
    expect(starts(post)).toHaveLength(4)
  })

  it('drains all active jobs after stop without launching queued orders', async () => {
    const { post } = await setup()
    await send(() => ack(0))
    await advance()
    await send(() => { ack(1); ack(2) })
    fireEvent.click(screen.getByRole('button', { name: /^중지/ }))
    await send(() => { result(2); result(0) })
    await advance()
    expect(starts(post)).toHaveLength(3)
    expect(within(row(1)).getByText('조회 중')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '닫기' })).not.toBeInTheDocument()
    await send(() => result(1))
    await advance()
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument()
    expect(screen.getByText('성공 3건')).toBeInTheDocument()
    expect(within(row(3)).getByText('건너뜀')).toBeInTheDocument()
    expect(within(row(4)).getByText('건너뜀')).toBeInTheDocument()
    expect(starts(post)).toHaveLength(3)
  })

  it('stops dispatch on a security challenge while preserving successful results from the other active jobs', async () => {
    const { post } = await setup()
    await send(() => ack(0))
    await advance()
    await send(() => { ack(1); ack(2); fail(1, '1688 보안 확인이 필요합니다. 화면에서 확인을 마친 뒤 다시 조회해주세요.') })
    await send(() => { result(0); result(2) })
    await advance()
    expect(starts(post)).toHaveLength(3)
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument()
    expect(screen.getByText('성공 2건')).toBeInTheDocument()
    expect(screen.getByText('미처리 1건')).toBeInTheDocument()
    expect(within(row(3)).getByText('건너뜀')).toBeInTheDocument()
  })

  it('keeps older extensions sequential until they advertise parallel support', async () => {
    const { post } = await setup()
    await send(() => ack(0, 1, false))
    await advance()
    expect(starts(post)).toHaveLength(1)
    await send(() => result(0))
    await advance()
    expect(starts(post).map((data) => data.orderNumber)).toEqual([order(0), order(1)])
  })

  it('accepts a capability ACK that arrives after the first order result', async () => {
    const { post } = await setup()
    await send(() => result(0))
    await advance()
    expect(starts(post)).toHaveLength(2)
    await send(() => ack(0))
    await advance()
    expect(starts(post).map((data) => data.orderNumber)).toEqual([order(0), order(1), order(2), order(3)])
  })

  it('holds a saving slot without blocking independent lookup completions', async () => {
    const { post, fetcher } = await setup(6)
    let finishFirst: ((response: Response) => void) | undefined
    fetcher.mockImplementation((url) => String(url).includes(`/${id(0)}/`)
      ? new Promise<Response>((resolve) => { finishFirst = resolve })
      : Promise.resolve({ ok: true, json: async () => ({ trackingCount: 1 }) } as Response))
    await send(() => ack(0))
    await advance()
    await send(() => { ack(1); ack(2); result(0); result(2) })
    await advance()
    expect(within(row(0)).getByText('저장 중')).toBeInTheDocument()
    expect(within(row(2)).getByText('성공')).toBeInTheDocument()
    expect(starts(post)).toHaveLength(4)
    await send(() => finishFirst?.({ ok: true, json: async () => ({ trackingCount: 1 }) } as Response))
    await advance()
    expect(within(row(0)).getByText('성공')).toBeInTheDocument()
    expect(starts(post)).toHaveLength(5)
  })

  it('retries a busy job in its own slot and ignores the previous attempt result', async () => {
    const { post, fetcher } = await setup()
    await send(() => ack(0))
    await advance()
    await send(() => { ack(1); ack(2); fail(1, '다른 1688 작업이 진행 중입니다. 완료된 뒤 다시 조회해주세요.') })
    await advance(800)
    expect(starts(post).filter((data) => data.orderNumber === order(1)).map((data) => data.runId)).toEqual([runId(1), runId(1, 2)])
    expect(starts(post).some((data) => data.orderNumber === order(3))).toBe(false)
    await send(() => { result(1); ack(1, 2); result(1, 2) })
    await advance()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(within(row(1)).getByText('성공')).toBeInTheDocument()
    expect(starts(post).some((data) => data.orderNumber === order(3))).toBe(true)
  })
})
