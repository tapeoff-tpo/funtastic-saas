import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync(join(process.cwd(), 'tools/browser-extensions/funtastic-1688-url-collector/background.js'), 'utf8')
type Snapshot = { trackingNumbers: string[]; orderState?: string; error?: string; sawLogisticsTab?: boolean }

function loadBackground() {
  const key = 'funtastic1688TrackingLookupRun'
  const state: Record<string, unknown> = { [key]: { runId: 'run', status: 'running', collecting: false, sourceTabId: 1, collectorTabId: 2, background: true } }
  const event = () => ({ addListener: vi.fn() })
  const chrome = {
    runtime: { onMessage: event() }, alarms: { onAlarm: event(), clear: vi.fn(async () => true), create: vi.fn() },
    tabs: { onCreated: event(), onUpdated: event(), onRemoved: event(),
      sendMessage: vi.fn(async () => ({})), remove: vi.fn(async () => {}), update: vi.fn(), get: vi.fn(async () => ({ status: 'complete' })) },
    scripting: { executeScript: vi.fn() },
    storage: { session: {
      get: vi.fn(async () => ({ ...state })), set: vi.fn(async (values) => { Object.assign(state, values) }),
      remove: vi.fn(async (name: string) => { delete state[name] }),
    } },
  }
  const api = vm.runInNewContext(source + '\n({ collect1688TrackingInPage, collectTrackingLookupFromTab })', {
    chrome, window, document, ShadowRoot, Date, URL, setTimeout, clearTimeout,
  }) as {
    collect1688TrackingInPage: (options?: { singlePass?: boolean; activateLogistics?: boolean }) => Promise<Snapshot>
    collectTrackingLookupFromTab: (tabId: number) => Promise<void>
  }
  return { api, chrome }
}

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers() })

describe('1688 extension tracking snapshots', () => {
  it('extracts only the exact waybill field, including an input value, without the neighbouring logistics id', async () => {
    document.body.innerHTML = '<div>物流编号: LP00850611544129</div><label>运单号码:</label><input value="9823528519765" />'
    const { api } = loadBackground()
    const result = await api.collect1688TrackingInPage({ singlePass: true })
    expect(Array.from(result.trackingNumbers)).toEqual(['9823528519765'])
  })

  it('finishes on the first successful frame snapshot instead of waiting on empty frames', async () => {
    const { api, chrome } = loadBackground()
    chrome.scripting.executeScript.mockResolvedValue([
      { frameId: 0, result: { trackingNumbers: ['S71268668516'] } },
      { frameId: 1, result: { trackingNumbers: [] } },
    ])
    await api.collectTrackingLookupFromTab(2)
    expect(chrome.scripting.executeScript).toHaveBeenCalledOnce()
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ args: [expect.objectContaining({ singlePass: true })] }))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'FUNTASTIC_1688_TRACKING_RESULT', trackingSource: 'waybill_number' }))
    expect(chrome.tabs.update).not.toHaveBeenCalled()
  })

  it('does not fail an order because an unrelated frame shows an unavailable-order message', async () => {
    vi.useFakeTimers()
    const { api, chrome } = loadBackground()
    const unrelated = { frameId: 9, result: { trackingNumbers: [], orderState: 'unavailable', error: 'unrelated frame' } }
    chrome.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, result: { trackingNumbers: [] } }, unrelated])
      .mockResolvedValue([{ frameId: 0, result: { trackingNumbers: ['S71268668516'] } }, unrelated])
    const pending = api.collectTrackingLookupFromTab(2)
    await vi.advanceTimersByTimeAsync(300)
    await pending
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'FUNTASTIC_1688_TRACKING_RESULT' }))
  })

  it('can activate a logistics tab again when its first click did not render data', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<button role="tab">物流信息(1)</button><div id="data"></div>'
    let clicks = 0
    document.querySelector('button')!.onclick = () => {
      if (++clicks === 2) document.getElementById('data')!.innerHTML = '<label>运单号码:</label><span>S71268668516</span>'
    }
    const { api } = loadBackground()
    const pending = api.collect1688TrackingInPage()
    await vi.advanceTimersByTimeAsync(1_400)
    expect(Array.from((await pending).trackingNumbers)).toEqual(['S71268668516'])
    expect(clicks).toBe(2)
  })

  it('waits for logistics despite a historical awaiting-shipment stage in the order timeline', async () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    const { api, chrome } = loadBackground()
    chrome.scripting.executeScript.mockImplementation(async () => [{ frameId: 0, result: Date.now() - startedAt < 2_500
      ? { trackingNumbers: [], orderState: 'not_shipped', error: 'timeline waiting for shipment' }
      : { trackingNumbers: ['S71268668516'] } }])
    const pending = api.collectTrackingLookupFromTab(2)
    await vi.advanceTimersByTimeAsync(3_000)
    await pending
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'FUNTASTIC_1688_TRACKING_RESULT' }))
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(1, expect.objectContaining({ type: 'FUNTASTIC_1688_TRACKING_ERROR' }))
  })
})
