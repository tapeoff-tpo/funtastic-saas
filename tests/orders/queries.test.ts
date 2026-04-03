import { describe, it, expect, vi } from 'vitest'

// Mock the db module
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    query: {},
  },
}))

import { buildOrderWhereClause } from '@/lib/orders/queries'
import type { OrderFilters } from '@/lib/orders/types'

describe('buildOrderWhereClause', () => {
  it('returns empty array for no filters', () => {
    const conditions = buildOrderWhereClause({})
    expect(conditions).toEqual([])
  })

  it('adds status condition when status filter is set', () => {
    const conditions = buildOrderWhereClause({ status: 'new' })
    expect(conditions).toHaveLength(1)
  })

  it('adds marketplace condition when marketplace filter is set', () => {
    const conditions = buildOrderWhereClause({ marketplace: 'coupang' })
    expect(conditions).toHaveLength(1)
  })

  it('adds date conditions for dateFrom and dateTo', () => {
    const conditions = buildOrderWhereClause({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    })
    expect(conditions).toHaveLength(2)
  })

  it('combines multiple filters', () => {
    const conditions = buildOrderWhereClause({
      status: 'new',
      marketplace: 'coupang',
      dateFrom: '2026-01-01',
    })
    expect(conditions).toHaveLength(3)
  })

  it('adds search condition when search is set', () => {
    const conditions = buildOrderWhereClause({ search: 'test' })
    expect(conditions).toHaveLength(1)
  })
})
