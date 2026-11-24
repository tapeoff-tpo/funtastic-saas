import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchasingUrlCollector } from './purchasing-url-collector'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('sonner', () => ({ toast: mocks }))
function message(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin,
    data: { source: 'funtastic-1688-extension', ...data } }))
}
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response
const SESSION_KEY = 'funtastic1688VerificationSessionV1'
type Link = { url: string; items: Array<{ sku: string; productName: string }> }
type Start = { type: string; runId: string; links: Link[] }
const links = (count: number): Link[] => Array.from({ length: count }, (_, index) => ({
  url: `https://detail.1688.com/offer/${String(index + 100000000000)}.html`,
  items: [{ sku: `123456-${String(index).padStart(4, '0')}`, productName: `상품 ${index}` }],
}))
let now = 1_000_000
beforeEach(() => {
  vi.clearAllMocks(); window.sessionStorage.clear(); now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function setupQueue(all: Link[]) {
  const saved: Array<Record<string, unknown>> = [], requested: URL[] = []
  let resultResponse: Response | Promise<Response> = response({ updated: 0, replaced: 0, updatedWorkflow: 0 })
  let pageGate: Promise<Response> | null = null
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(String(options.body))
      if (body.action === 'sync') return response({ updatedProducts: 0, updatedWorkflow: 0 })
      saved.push(body)
      return resultResponse
    }
    const query = new URL(String(input), window.location.origin)
    requested.push(query)
    const limit = Number(query.searchParams.get('limit')) || 200, cursor = query.searchParams.get('cursor')
    const after = cursor ? all.filter(link => link.url > cursor) : all, page = after.slice(0, limit)
    if (limit > 1 && pageGate) return pageGate
    return response({ links: page, totalItems: page.length, skippedInvalid: 0,
      totalLinks: cursor ? after.length : all.length, counts: { due: after.length, issues: 0, all: all.length },
      hasMore: after.length > page.length, nextCursor: page.at(-1)?.url ?? null })
  })
  const post = vi.spyOn(window, 'postMessage')
  return { fetcher, post, saved, requested,
    starts: () => post.mock.calls.map(([value]) => value as Start).filter(value => value.type === 'FUNTASTIC_1688_VERIFY_START'),
    acknowledgements: () => post.mock.calls.map(([value]) => value as Record<string, unknown>).filter(value => value.type === 'FUNTASTIC_1688_VERIFY_RESULT_SAVED'),
    setResultResponse: (value: Response | Promise<Response>) => { resultResponse = value },
    setPageGate: (value: Promise<Response> | null) => { pageGate = value },
  }
}
async function startNeeded() {
  act(() => message({ type: 'FUNTASTIC_1688_PONG', running: false }))
  fireEvent.click(screen.getByRole('button', { name: /^필요한 URL 검증/ }))
  await act(async () => {})
}
async function idleTwice() {
  now += 5_000
  act(() => message({ type: 'FUNTASTIC_1688_PONG', running: false }))
  now += 5_000
  await act(async () => message({ type: 'FUNTASTIC_1688_PONG', running: false }))
}
function finish(start: Start) {
  message({ type: 'FUNTASTIC_1688_VERIFY_ACK', runId: start.runId, total: start.links.length })
  message({ type: 'FUNTASTIC_1688_VERIFY_COMPLETE', runId: start.runId,
    summary: { processed: start.links.length, open: start.links.length, unavailable: 0, unknown: 0 } })
}

describe('incremental URL verification batch lifecycle', () => {
  it.each(['open', 'unavailable', 'unknown'])('saves %s before acknowledging it and deduplicates parallel results', async status => {
    const queue = setupQueue(links(1)), gate = deferred<Response>()
    queue.setResultResponse(gate.promise)
    render(<PurchasingUrlCollector />)
    await startNeeded()
    const start = queue.starts()[0]
    const result = { type: 'FUNTASTIC_1688_VERIFY_RESULT', runId: start.runId,
      url: start.links[0].url, status, items: start.links[0].items }
    act(() => { message(result); message(result) })
    await waitFor(() => expect(queue.saved).toHaveLength(1))
    expect(queue.saved[0]).toMatchObject({ url: start.links[0].url, status, skus: ['123456-0000'] })
    expect(queue.acknowledgements()).toHaveLength(0)
    await act(async () => gate.resolve(response({ updated: status === 'open' ? 0 : 1, replaced: 0 })))
    expect(queue.acknowledgements()).toHaveLength(1)
    act(() => message(result))
    expect(queue.saved).toHaveLength(1)
    expect(queue.acknowledgements()).toHaveLength(1)
  })

  it('withholds ACKs on history save failure and retries without advancing progress', async () => {
    const queue = setupQueue(links(1))
    queue.setResultResponse(response({ error: '저장 실패' }, false))
    render(<PurchasingUrlCollector />)
    await startNeeded()
    const start = queue.starts()[0]
    const result = { type: 'FUNTASTIC_1688_VERIFY_RESULT', runId: start.runId,
      url: start.links[0].url, status: 'open', items: start.links[0].items }
    await act(async () => message(result))
    expect(queue.acknowledgements()).toHaveLength(0)
    expect(screen.getByRole('button', { name: '0/1 검증 중' })).toBeInTheDocument()
    queue.setResultResponse(response({ updated: 0 }))
    await act(async () => message(result))
    expect(queue.acknowledgements()).toHaveLength(1)
    expect(screen.getByRole('button', { name: '1/1 검증 중' })).toBeInTheDocument()
  })

  it('checks 2101 URLs in automatic batches and keeps the original overall total', async () => {
    const all = links(2_101), queue = setupQueue(all)
    render(<PurchasingUrlCollector />)
    await startNeeded()
    expect(screen.getByRole('button', { name: '0/2101 검증 중' })).toBeInTheDocument()
    let completed = 0
    for (let index = 0; index < 11; index += 1) {
      await waitFor(() => expect(queue.starts()).toHaveLength(index + 1))
      const start = queue.starts()[index]
      expect(start.links.length).toBeLessThanOrEqual(200)
      completed += start.links.length
      act(() => finish(start))
      if (index < 10) {
        expect(screen.getByRole('button', { name: `${completed}/2101 검증 중` })).toBeInTheDocument()
        expect(queue.starts()).toHaveLength(index + 1)
        await idleTwice()
      }
    }
    expect(queue.starts().flatMap(start => start.links.map(link => link.url))).toEqual(all.map(link => link.url))
    expect(mocks.success).toHaveBeenCalledWith('1688 구매 URL 검증을 완료했습니다.')
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('cancels while the next page is loading and ignores its late response', async () => {
    const all = links(201), queue = setupQueue(all), gate = deferred<Response>()
    render(<PurchasingUrlCollector />)
    await startNeeded()
    act(() => finish(queue.starts()[0]))
    queue.setPageGate(gate.promise)
    await idleTwice()
    fireEvent.click(screen.getByRole('button', { name: '구매 URL 검증 중단' }))
    await act(async () => gate.resolve(response({ links: all.slice(200), totalLinks: 1, totalItems: 1,
      skippedInvalid: 0, hasMore: false, nextCursor: all[200].url })))
    expect(queue.starts()).toHaveLength(1)
    expect(screen.getByRole('button', { name: '중단한 검증 이어서' })).toBeInTheDocument()
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? '{}').phase).toBe('paused')
  })

  it('restores the current batch after reload and ACKs a saved result without counting twice', async () => {
    const queue = setupQueue(links(201)), first = render(<PurchasingUrlCollector />)
    await startNeeded()
    const start = queue.starts()[0]
    const result = { type: 'FUNTASTIC_1688_VERIFY_RESULT', runId: start.runId,
      url: start.links[0].url, status: 'open', items: start.links[0].items }
    await act(async () => message(result))
    expect(queue.saved).toHaveLength(1)
    first.unmount()
    render(<PurchasingUrlCollector />)
    act(() => message({ type: 'FUNTASTIC_1688_PONG', mode: 'verification', running: true,
      runId: start.runId, total: 200, index: 1, summary: { processed: 1, open: 1 } }))
    expect(screen.getByRole('button', { name: '1/201 검증 중' })).toBeInTheDocument()
    now += 5_000
    await act(async () => message(result))
    expect(queue.saved).toHaveLength(1)
    expect(queue.acknowledgements()).toHaveLength(2)
    expect(screen.getByRole('button', { name: '1/201 검증 중' })).toBeInTheDocument()
    expect(queue.starts()).toHaveLength(1)
  })

  it('restores the cursor when reloaded between batches and ignores duplicate COMPLETE', async () => {
    const all = links(201), queue = setupQueue(all), first = render(<PurchasingUrlCollector />)
    await startNeeded()
    const start = queue.starts()[0]
    act(() => {
      finish(start)
      finish(start)
      message({ type: 'FUNTASTIC_1688_PONG', mode: 'verification', running: true,
        runId: start.runId, total: 200, summary: { processed: 200, open: 200 } })
    })
    expect(screen.queryByRole('button', { name: '중단한 검증 이어서' })).not.toBeInTheDocument()
    first.unmount()
    render(<PurchasingUrlCollector />)
    await idleTwice()
    await waitFor(() => expect(queue.starts()).toHaveLength(2))
    expect(queue.starts()[1].links).toEqual([all[200]])
    expect(screen.getByRole('button', { name: '200/201 검증 중' })).toBeInTheDocument()
    expect(queue.requested.find(query => query.searchParams.has('cursor'))?.searchParams.get('cursor')).toBe(all[199].url)
  })

  it('labels a legacy run clearly without treating it as an incremental session', async () => {
    const queue = setupQueue(links(3))
    render(<PurchasingUrlCollector />)
    act(() => message({ type: 'FUNTASTIC_1688_PONG', mode: 'verification', running: true,
      runId: 'old-run', total: 2_000, index: 12, summary: { processed: 12, open: 11, unknown: 1 } }))
    expect(screen.getByRole('button', { name: '기존 검증 12/2000 검증 중' })).toBeInTheDocument()
    expect(screen.getByText(/이전 방식의 검증이 실행 중/)).toBeInTheDocument()
    expect(queue.starts()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '구매 URL 검증 중단' }))
    expect(screen.getByRole('button', { name: /^필요한 URL 검증/ })).toBeInTheDocument()
  })

  it('handles a START rejection reported through the legacy generic ERROR', async () => {
    const queue = setupQueue(links(3))
    render(<PurchasingUrlCollector />)
    await startNeeded()
    act(() => message({ type: 'FUNTASTIC_1688_ERROR', runId: queue.starts()[0].runId, message: '기존 작업이 실행 중입니다.' }))
    expect(screen.getByRole('button', { name: '중단한 검증 이어서' })).toBeInTheDocument()
    expect(mocks.error).toHaveBeenCalledWith('기존 작업이 실행 중입니다.')
  })

  it('waits for cancellation cleanup before replacing a legacy run with a new run', async () => {
    const queue = setupQueue(links(3))
    render(<PurchasingUrlCollector />)
    act(() => message({ type: 'FUNTASTIC_1688_PONG', mode: 'verification', running: true,
      runId: 'old-run', total: 2_000, index: 12 }))
    fireEvent.click(screen.getByRole('button', { name: '구매 URL 검증 중단' }))
    fireEvent.click(screen.getByRole('button', { name: /^필요한 URL 검증/ }))
    await act(async () => {})
    act(() => message({ type: 'FUNTASTIC_1688_PONG', mode: 'verification', running: true, runId: 'old-run', total: 2_000 }))
    expect(queue.starts()).toHaveLength(0)
    await idleTwice()
    await waitFor(() => expect(queue.starts()).toHaveLength(1))
    expect(queue.starts()[0].links).toHaveLength(3)
  })

  it('selects explicit problem/full modes and shows counts without polling the server on every extension ping', async () => {
    const queue = setupQueue(links(3))
    render(<PurchasingUrlCollector />)
    act(() => message({ type: 'FUNTASTIC_1688_PONG', running: false }))
    await waitFor(() => expect(screen.getByRole('button', { name: '전체 URL 검증 3개' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '문제 URL 재검증 0개' }))
    await waitFor(() => expect(queue.starts()).toHaveLength(1))
    expect(queue.requested.some(query => query.searchParams.get('mode') === 'issues')).toBe(true)
    const requests = queue.requested.length
    act(() => message({ type: 'FUNTASTIC_1688_PONG', mode: 'verification', running: true,
      runId: queue.starts()[0].runId, total: 3 }))
    expect(queue.requested).toHaveLength(requests)
  })

  it('rejects an empty result item list without acknowledging it', async () => {
    const queue = setupQueue(links(1))
    render(<PurchasingUrlCollector />)
    await startNeeded()
    await act(async () => message({ type: 'FUNTASTIC_1688_VERIFY_RESULT', runId: queue.starts()[0].runId,
      url: queue.starts()[0].links[0].url, status: 'open', items: [] }))
    expect(queue.saved).toHaveLength(0)
    expect(queue.acknowledgements()).toHaveLength(0)
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('품목 정보'))
  })

  it('does not report cleared failure flags as a purchase URL replacement after a normal check', async () => {
    const queue = setupQueue(links(1))
    queue.setResultResponse(response({ updated: 0, updatedWorkflow: 1, replaced: 0 }))
    render(<PurchasingUrlCollector />)
    await startNeeded()
    const start = queue.starts()[0]
    await act(async () => message({ type: 'FUNTASTIC_1688_VERIFY_RESULT', runId: start.runId,
      url: start.links[0].url, status: 'open', items: start.links[0].items }))
    expect(screen.queryByText(/발주 URL로 갱신/)).not.toBeInTheDocument()
    act(() => finish(start))
    expect(mocks.refresh).toHaveBeenCalled()
  })
})
