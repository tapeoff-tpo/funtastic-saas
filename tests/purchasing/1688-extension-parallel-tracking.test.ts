import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(join(process.cwd(), 'tools/browser-extensions/funtastic-1688-url-collector/background.js'), 'utf8')
const statePrefix = 'funtastic1688TrackingLookupRun:'
const alarmPrefix = 'funtastic-1688-tracking-lookup-timeout:'
type Run = { runId: string; sourceTabId: number; collectorTabId: number; orderNumber: string; batchId?: string; collecting?: boolean; legacyState?: boolean; status: string }
type Tab = { id: number; status: string; url?: string }

function loadBackground() {
  const state: Record<string, unknown> = {}
  const tabs = new Map<number, Tab>([[1, { id: 1, status: 'complete', url: 'https://funtastic-saas-vercel.vercel.app/purchasing/orders/1688-tracking-run' }]])
  const alarms = new Set<string>()
  const event = () => ({ addListener: vi.fn() })
  let nextTabId = 10
  const chrome = {
    runtime: { onMessage: event() },
    alarms: { onAlarm: event(), clear: vi.fn(async (name: string) => alarms.delete(name)),
      create: vi.fn(async (name: string) => { alarms.add(name) }) },
    tabs: { onCreated: event(), onUpdated: event(), onRemoved: event(),
      create: vi.fn(async () => { const tab = { id: ++nextTabId, status: 'loading' }; tabs.set(tab.id, tab); return tab }),
      get: vi.fn(async (id: number) => { const tab = tabs.get(id); if (!tab) throw new Error('tab closed'); return tab }),
      remove: vi.fn(async (id: number) => { tabs.delete(id) }),
      update: vi.fn(), sendMessage: vi.fn<(id: number, payload: unknown) => Promise<Record<string, never>>>(async () => ({})),
    },
    scripting: { executeScript: vi.fn() },
    storage: { session: {
      get: vi.fn(async (keys: string | string[] | null) => keys === null ? { ...state }
        : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in state).map((key) => [key, state[key]]))),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(state, values) }),
      remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key] }),
    } },
  }
  const api = vm.runInNewContext(source + '\n({ handleMessage, getTrackingLookupRuns, completeTrackingLookupRun, handleTrackingLookupTimeout, handle1688TabRemoved, collectTrackingLookupFromTab })', {
    chrome, window, document, ShadowRoot, Date, URL, setTimeout, clearTimeout,
  }) as {
    handleMessage: (message: unknown, sender: unknown) => Promise<{ ok: boolean; error?: string }>
    getTrackingLookupRuns: () => Promise<Run[]>
    completeTrackingLookupRun: (run: Run, numbers: string[]) => Promise<void>
    handleTrackingLookupTimeout: (alarmName: string) => Promise<void>
    handle1688TabRemoved: (tabId: number) => Promise<void>
    collectTrackingLookupFromTab: (tabId: number) => Promise<void>
  }
  const start = (index: number, batchId = 'batch', sourceId = 1) => api.handleMessage({
    type: 'FUNTASTIC_1688_TRACKING_START', runId: `run-${index}`, orderNumber: `331715964003901876${index}`,
    batchId, parallelVersion: 1, background: true,
  }, { tab: { id: sourceId, url: 'https://funtastic-saas-vercel.vercel.app/purchasing/orders/1688-tracking-run' } })
  return { api, chrome, state, tabs, alarms, start }
}

describe('parallel extension tracking lifecycle', () => {
  it('serializes concurrent admission, opens at most three inactive tabs, and rejects another source or batch', async () => {
    const { api, chrome, start, alarms } = loadBackground()
    const admitted = await Promise.all([start(1), start(2), start(3), start(4)])
    expect(admitted.map((result) => result.ok)).toEqual([true, true, true, false])
    expect((await start(5, 'different-batch')).ok).toBe(false)
    expect((await start(6, 'batch', 2)).ok).toBe(false)
    expect(await api.getTrackingLookupRuns()).toHaveLength(3)
    expect(alarms.size).toBe(3)
    expect(chrome.tabs.create).toHaveBeenCalledTimes(3)
    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'FUNTASTIC_1688_TRACKING_ACK', parallelVersion: 1, maxConcurrency: 3 }))
    expect(chrome.tabs.update).not.toHaveBeenCalled()
  })

  it('completes orders out of order without mixing numbers or removing sibling state and deadlines', async () => {
    const { api, chrome, start, alarms } = loadBackground()
    await Promise.all([start(1), start(2), start(3)])
    const runs = await api.getTrackingLookupRuns()
    await api.completeTrackingLookupRun(runs[1], ['SECOND-123'])
    expect((await api.getTrackingLookupRuns()).map((run) => run.runId)).toEqual(['run-1', 'run-3'])
    expect(alarms).toEqual(new Set([`${alarmPrefix}run-1`, `${alarmPrefix}run-3`]))
    await api.completeTrackingLookupRun(runs[0], ['FIRST-123'])
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ runId: 'run-2', orderNumber: runs[1].orderNumber, trackingNumbers: ['SECOND-123'] }))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ runId: 'run-1', orderNumber: runs[0].orderNumber, trackingNumbers: ['FIRST-123'] }))
    expect((await api.getTrackingLookupRuns()).map((run) => run.runId)).toEqual(['run-3'])
    expect((await start(4)).ok).toBe(true)
  })

  it('times out or closes only the affected collector tab', async () => {
    const { api, chrome, start, alarms } = loadBackground()
    await Promise.all([start(1), start(2), start(3)])
    const runs = await api.getTrackingLookupRuns()
    await api.handleTrackingLookupTimeout(`${alarmPrefix}run-2`)
    await api.handle1688TabRemoved(runs[0].collectorTabId)
    expect((await api.getTrackingLookupRuns()).map((run) => run.runId)).toEqual(['run-3'])
    expect(alarms).toEqual(new Set([`${alarmPrefix}run-3`]))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ runId: 'run-2', type: 'FUNTASTIC_1688_TRACKING_ERROR' }))
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ runId: 'run-1', type: 'FUNTASTIC_1688_TRACKING_ERROR' }))
  })

  it('cleans all runs owned by a closed progress popup while leaving another owner untouched', async () => {
    const { api, chrome, start, state, alarms } = loadBackground()
    await Promise.all([start(1), start(2), start(3)])
    const ownRuns = await api.getTrackingLookupRuns()
    state[`${statePrefix}other`] = { ...ownRuns[0], runId: 'other', sourceTabId: 99, collectorTabId: 199 }
    alarms.add(`${alarmPrefix}other`)
    await api.handle1688TabRemoved(1)
    expect((await api.getTrackingLookupRuns()).map((run) => run.runId)).toEqual(['other'])
    expect(alarms).toEqual(new Set([`${alarmPrefix}other`]))
    expect(chrome.tabs.remove.mock.calls.map(([id]) => id)).toEqual(ownRuns.map((run) => run.collectorTabId))
  })

  it('rolls back a collector created after its source popup has already closed', async () => {
    const { api, chrome, start, tabs, alarms } = loadBackground()
    let finishCreate!: (tab: Tab) => void
    chrome.tabs.create.mockImplementationOnce(() => new Promise<Tab>((resolve) => { finishCreate = resolve }))
    const pending = start(1)
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce())
    tabs.delete(1)
    await api.handle1688TabRemoved(1)
    finishCreate({ id: 55, status: 'loading' })
    await expect(pending).rejects.toThrow('작업 창이 닫혔습니다')
    expect(await api.getTrackingLookupRuns()).toHaveLength(0)
    expect(alarms.size).toBe(0)
    expect(chrome.tabs.remove).toHaveBeenCalledWith(55)
  })

  it('claims a single terminal outcome when a result races its timeout', async () => {
    const { api, chrome, start } = loadBackground()
    await start(1)
    const [run] = await api.getTrackingLookupRuns()
    let finishSend!: () => void
    chrome.tabs.sendMessage.mockImplementationOnce(async () => new Promise<Record<string, never>>((resolve) => { finishSend = () => resolve({}) }))
    const completing = api.completeTrackingLookupRun(run, ['FIRST-123'])
    await vi.waitFor(() => expect(finishSend).toBeTypeOf('function'))
    await api.handleTrackingLookupTimeout(`${alarmPrefix}run-1`)
    finishSend()
    await completing
    expect(chrome.tabs.sendMessage.mock.calls.filter(([, message]) => (message as { type?: string }).type === 'FUNTASTIC_1688_TRACKING_RESULT')).toHaveLength(1)
    expect(chrome.tabs.sendMessage.mock.calls.filter(([, message]) => (message as { type?: string }).type === 'FUNTASTIC_1688_TRACKING_ERROR')).toHaveLength(0)
  })

  it('ignores late outcomes from an older collector with a reused run id', async () => {
    const { api, chrome, start, state } = loadBackground()
    await start(1)
    const [oldRun] = await api.getTrackingLookupRuns()
    state[`${statePrefix}run-1`] = { ...oldRun, collectorTabId: 999 }
    await api.completeTrackingLookupRun(oldRun, ['STALE-123'])
    expect((await api.getTrackingLookupRuns())[0].collectorTabId).toBe(999)
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(chrome.tabs.sendMessage.mock.calls.filter(([, message]) => (message as { type?: string }).type === 'FUNTASTIC_1688_TRACKING_RESULT')).toHaveLength(0)
  })

  it('resumes scanning after a worker restart even if stored collecting is true', async () => {
    const { api, chrome, start, state } = loadBackground()
    await start(1)
    const [run] = await api.getTrackingLookupRuns()
    state[`${statePrefix}run-1`] = { ...run, collecting: true }
    chrome.scripting.executeScript.mockResolvedValue([{ frameId: 0, result: { trackingNumbers: ['RESUMED-123'] } }])
    await api.collectTrackingLookupFromTab(run.collectorTabId)
    expect(await api.getTrackingLookupRuns()).toHaveLength(0)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ trackingNumbers: ['RESUMED-123'] }))
  })

  it('keeps URL verification admission exclusive while a tracking tab is being created', async () => {
    const { api, chrome, start } = loadBackground()
    let finishCreate!: (tab: Tab) => void
    chrome.tabs.create.mockImplementationOnce(() => new Promise<Tab>((resolve) => { finishCreate = resolve }))
    const tracking = start(1)
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce())
    const verification = api.handleMessage({ type: 'FUNTASTIC_1688_VERIFY_START' }, { tab: { id: 1, url: 'https://funtastic-saas-vercel.vercel.app/purchasing/orders' } })
    finishCreate({ id: 55, status: 'loading' })
    expect((await tracking).ok).toBe(true)
    expect((await verification).ok).toBe(false)
    expect(chrome.tabs.create).toHaveBeenCalledOnce()
  })
})
