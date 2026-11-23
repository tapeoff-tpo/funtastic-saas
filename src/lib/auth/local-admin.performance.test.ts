import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalAdmin } from './local-admin'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/db', () => ({ client: mocks.query }))
vi.mock('@/lib/db/connection-lifecycle', () => ({ keepDatabaseAliveUntilIdle: vi.fn() }))

describe('local administrator list loading', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads every account in a single paginated query instead of one lookup per account', async () => {
    mocks.query.mockResolvedValue([
      { id: 'owner', email: 'owner@example.com', role: 'super_admin', display_name: 'Owner' },
      { id: 'staff', email: 'staff@example.com', role: 'admin', display_name: null },
    ])
    const result = await createLocalAdmin().auth.admin.listUsers({ page: 2, perPage: 50 })
    expect(result).toEqual({ data: { users: [
      { id: 'owner', email: 'owner@example.com', app_metadata: { role: 'super_admin' }, user_metadata: { full_name: 'Owner' } },
      { id: 'staff', email: 'staff@example.com', app_metadata: { role: 'admin' }, user_metadata: { full_name: null } },
    ] }, error: null })
    expect(mocks.query).toHaveBeenCalledOnce()
    expect(mocks.query.mock.calls[0].slice(1)).toEqual([50, 50])
  })
})
