import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATABASE_IDLE_SECONDS, keepDatabaseAliveUntilIdle } from './connection-lifecycle'

const { after } = vi.hoisted(() => ({ after: vi.fn() }))
vi.mock('next/server', () => ({ after }))
beforeEach(() => { after.mockReset(); vi.useFakeTimers() })
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('serverless DB connection lifecycle', () => {
  it('starts the idle grace period after the response, even for a slow request', async () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_REGION', 'bom1')
    keepDatabaseAliveUntilIdle()
    expect(after).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    const finished = vi.fn()
    const cleanup = after.mock.calls[0][0]() as Promise<void>
    void cleanup.then(finished)
    await vi.advanceTimersByTimeAsync(DATABASE_IDLE_SECONDS * 1000)
    expect(finished).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    await cleanup
    expect(finished).toHaveBeenCalledOnce()
  })

  it('registers independently for concurrent invocations', () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_REGION', 'bom1')
    keepDatabaseAliveUntilIdle()
    keepDatabaseAliveUntilIdle()
    expect(after).toHaveBeenCalledTimes(2)
  })

  it('does not schedule Next request hooks in local workers or builds', () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_REGION', '')
    keepDatabaseAliveUntilIdle()
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('VERCEL_REGION', 'bom1')
    keepDatabaseAliveUntilIdle()
    expect(after).not.toHaveBeenCalled()
  })
})
