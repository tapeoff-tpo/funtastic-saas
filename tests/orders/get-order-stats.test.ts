import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OrderStats } from '@/lib/orders/types'

/**
 * Phase 8 — getOrderStats GREEN tests.
 *
 * The query in queries.ts kicks off 5 parallel db.select(...) chains:
 *   [statusRows, claimRows, cancelTabRows, totalRow, heldRow]
 * The mock cycles canned responses in that exact order — see queueIndex.
 */

const statusRows = [
  { status: 'new', value: 3 },
  { status: 'confirmed', value: 2 },
  { status: 'preparing', value: 5 },
  { status: 'shipped', value: 1 },
  { status: 'delivering', value: 4 },
  { status: 'delivered', value: 7 },
  { status: 'cancelled', value: 6 },
]
const claimRows = [
  { claimType: 'cancel', value: 2 },
  { claimType: 'exchange', value: 1 },
  { claimType: 'return', value: 3 },
]
const cancelTabRows = [{ value: 8 }]
const totalRows = [{ value: 28 }]
const heldRows = [{ value: 1 }]

let queueIndex = 0
const queues: Array<unknown[]> = [
  statusRows,
  claimRows,
  cancelTabRows,
  totalRows,
  heldRows,
]

function makeChain(rows: unknown[]) {
  // A thenable chain that resolves to `rows` whenever awaited / .then'd / chained
  // through any drizzle builder method we use (.from / .where / .innerJoin / .leftJoin
  // / .groupBy / .limit / .offset).
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const m of [
    'from',
    'where',
    'innerJoin',
    'leftJoin',
    'rightJoin',
    'fullJoin',
    'orderBy',
    'limit',
    'offset',
  ]) {
    chain[m] = passthrough
  }
  // Terminal methods that should resolve
  chain.groupBy = () => Promise.resolve(rows)
  // .then makes the whole chain awaitable for the no-groupBy queries (totalRow, heldRow, cancelTabRows)
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)
  return chain
}

vi.mock('@/lib/db', () => ({
  db: {
    select: () => {
      const rows = queues[Math.min(queueIndex, queues.length - 1)] ?? []
      queueIndex++
      return makeChain(rows)
    },
  },
}))

beforeEach(() => {
  queueIndex = 0
})

describe('getOrderStats — 9탭 카운트 (B-5 automated coverage)', () => {
  it('returns OrderStats with 7 status counts + 3 claim counts + cancelTabCount', async () => {
    const { getOrderStats } = await import('@/lib/orders/queries')
    const stats = await getOrderStats('test-user-id')

    // Status counts mapped from groupBy(orders.status)
    expect(stats.new).toBe(3)
    expect(stats.confirmed).toBe(2)
    expect(stats.preparing).toBe(5)
    expect(stats.shipped).toBe(1)
    expect(stats.delivering).toBe(4)
    expect(stats.delivered).toBe(7)
    expect(stats.cancelled).toBe(6)

    // Claim counts mapped from groupBy(claims.claim_type) with countDistinct(orderId)
    expect(stats.claimCancel).toBe(2)
    expect(stats.claimExchange).toBe(1)
    expect(stats.claimReturn).toBe(3)

    // cancelTabCount from the dedicated DISTINCT OR query (B-3)
    expect(stats.cancelTabCount).toBe(8)
  })

  it('exposes the full OrderStats shape (type-level guard)', () => {
    const sample: OrderStats = {
      new: 0,
      confirmed: 0,
      preparing: 0,
      shipped: 0,
      delivering: 0,
      delivered: 0,
      cancelled: 0,
      claimCancel: 0,
      claimExchange: 0,
      claimReturn: 0,
      cancelTabCount: 0,
    }
    // Spot-check required keys exist
    expect(sample.cancelled).toBe(0)
    expect(sample.claimCancel).toBe(0)
    expect(sample.claimExchange).toBe(0)
    expect(sample.claimReturn).toBe(0)
    expect(sample.cancelTabCount).toBe(0)
  })
})
