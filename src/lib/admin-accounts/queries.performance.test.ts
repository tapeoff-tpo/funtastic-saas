import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
const mocks = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
import { getWorkspaceUserId } from './queries'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.execute.mockResolvedValue([{ id: 'operational-owner' }])
  mocks.select.mockImplementation(() => {
    const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => [{ id: 'staff', role: 'admin', createdBy: 'creator' }] }
    return chain
  })
})
describe('shared workspace owner resolution', () => {
  it('resolves all accounts with one short-circuiting query and preserves owner precedence', async () => {
    expect(await getWorkspaceUserId('staff')).toBe('operational-owner')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.select).not.toHaveBeenCalled()
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0] as SQL)
    expect(query.sql).toContain('COALESCE')
    expect(query.params).toEqual(['admin123%', 'admin123%'])
    const sources = ['FROM "user_profiles"', 'FROM "marketplace_connections"', 'FROM "orders"', 'FROM "products"']
    const positions = sources.map((source) => query.sql.indexOf(source))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(query.sql.match(/LIMIT 1/g)).toHaveLength(4)
  })
  it('retains staff creator fallback when no operational owner exists', async () => {
    mocks.execute.mockResolvedValue([{ id: null }])
    expect(await getWorkspaceUserId('staff')).toBe('creator')
  })
})
