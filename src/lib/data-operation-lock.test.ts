import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { withWorkspaceDataOperationLock, WorkspaceDataOperationInProgressError } from './data-operation-lock'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  applicationTransaction: vi.fn(),
  locks: new Set<string>(),
  closed: [] as Array<ReturnType<typeof vi.fn>>,
}))

vi.mock('postgres', () => ({ default: mocks.createClient }))
vi.mock('@/lib/db', () => ({ db: { transaction: mocks.applicationTransaction } }))

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://test.invalid/database')
  vi.clearAllMocks()
  mocks.locks.clear()
  mocks.closed = []
  mocks.createClient.mockImplementation(() => {
    let acquiredKey: string | undefined
    const query = vi.fn(async (_sql: string, [key]: string[]) => {
      if (mocks.locks.has(key)) return [{ acquired: false }]
      mocks.locks.add(key)
      acquiredKey = key
      return [{ acquired: true }]
    })
    const end = vi.fn(async () => {})
    mocks.closed.push(end)
    return {
      begin: async (operation: (sql: { unsafe: typeof query }) => Promise<unknown>) => {
        try { return await operation({ unsafe: query }) }
        finally { if (acquiredKey) mocks.locks.delete(acquiredKey) }
      },
      end,
    }
  })
})

afterEach(() => vi.unstubAllEnvs())

it('leaves the application connection free while the import runs and preserves its return value', async () => {
  const expected = [{ id: 'one' }, { id: 'two' }]
  const result = await withWorkspaceDataOperationLock('owner', async () => {
    expect(mocks.applicationTransaction).not.toHaveBeenCalled()
    expect(mocks.locks.has('funtastic-heavy-data-operation:owner')).toBe(true)
    return expected
  })
  expect(result).toBe(expected)
  expect(mocks.createClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    max: 1,
    connection: expect.objectContaining({ idle_in_transaction_session_timeout: 330_000 }),
  }))
  expect(mocks.closed[0]).toHaveBeenCalledExactlyOnceWith({ timeout: 5 })
  expect(mocks.locks.size).toBe(0)
})

it('rejects a duplicate operation immediately while allowing another workspace and a later retry', async () => {
  let release!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve })
  const running = withWorkspaceDataOperationLock('owner', () => waiting)
  await vi.waitFor(() => expect(mocks.locks.has('funtastic-heavy-data-operation:owner')).toBe(true))
  const duplicate = vi.fn()
  await expect(withWorkspaceDataOperationLock('owner', duplicate)).rejects.toBeInstanceOf(WorkspaceDataOperationInProgressError)
  expect(duplicate).not.toHaveBeenCalled()
  await expect(withWorkspaceDataOperationLock('another-owner', async () => 'other')).resolves.toBe('other')
  release()
  await running
  await expect(withWorkspaceDataOperationLock('owner', async () => 'retry')).resolves.toBe('retry')
  expect(mocks.closed.every((end) => end.mock.calls.length === 1)).toBe(true)
})

it('releases the lock and connection when processing fails and propagates the original error', async () => {
  const failure = new Error('검증 실패')
  await expect(withWorkspaceDataOperationLock('owner', async () => { throw failure })).rejects.toBe(failure)
  expect(mocks.locks.size).toBe(0)
  expect(mocks.closed[0]).toHaveBeenCalledOnce()
  await expect(withWorkspaceDataOperationLock('owner', async () => 'recovered')).resolves.toBe('recovered')
})
