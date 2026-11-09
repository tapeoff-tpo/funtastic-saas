import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { marketplaceConnections, orders, products, userProfiles } from '@/lib/db/schema'
const mocks = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
import { getWorkspaceUserId } from './queries'

let canonical: string | null
let connection: string | null
let orderOwner: string | null
let productOwner: string | null
const tables: unknown[] = []
beforeEach(() => {
  vi.clearAllMocks(); tables.length = 0
  canonical = 'admin123-owner'; connection = 'connection'; orderOwner = 'order'; productOwner = 'product'
  mocks.select.mockImplementation(() => ({ from: (table: unknown) => {
    tables.push(table)
    let clause: SQL | undefined
    const chain = { where: (value: SQL) => { clause = value; return chain }, orderBy: () => chain, limit: async () => {
      if (table === userProfiles) {
        const query = clause && new PgDialect().sqlToQuery(clause)
        if (query?.sql.includes('ilike')) return canonical ? [{ id: canonical }] : []
        return [{ id: 'staff', role: 'admin', createdBy: 'creator' }]
      }
      const id = table === marketplaceConnections ? connection : table === orders ? orderOwner : table === products ? productOwner : null
      return id ? [{ id }] : []
    } }
    return chain
  } }))
})
describe('shared workspace owner resolution', () => {
  it('reads only canonical ownership without scanning operational tables', async () => {
    expect(await getWorkspaceUserId('staff')).toBe('admin123-owner')
    expect(tables).toEqual([userProfiles])
  })
  it('preserves connection, order, product, and creator fallback precedence', async () => {
    canonical = null
    expect(await getWorkspaceUserId('staff')).toBe('connection')
    connection = null
    expect(await getWorkspaceUserId('staff')).toBe('order')
    orderOwner = null
    expect(await getWorkspaceUserId('staff')).toBe('product')
    productOwner = null
    expect(await getWorkspaceUserId('staff')).toBe('creator')
  })
})
