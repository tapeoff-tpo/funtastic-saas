// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'

const memory = vi.hoisted(() => ({
  client: null as unknown as import('@electric-sql/pglite').PGlite,
  failNextSchema: false,
  schemaAttempts: 0,
  readParamCounts: [] as number[],
}))
vi.mock('@/lib/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { PgDialect } = await import('drizzle-orm/pg-core')
  memory.client = new PGlite()
  const database = drizzle(memory.client)
  const dialect = new PgDialect()
  type Connection = Pick<typeof database, 'execute'>
  const expose = (connection: Connection) => ({
    execute: async (query: SQL) => {
      const statement = dialect.sqlToQuery(query)
      if (statement.sql.includes('CREATE TABLE IF NOT EXISTS')) {
        memory.schemaAttempts += 1
        if (memory.failNextSchema) {
          memory.failNextSchema = false
          throw new Error('temporary schema connection failure')
        }
      }
      if (statement.sql.includes('SELECT url, status')) memory.readParamCounts.push(statement.params.length)
      return (await connection.execute(query)).rows
    },
  })
  return { db: { ...expose(database), transaction: (fn: (tx: ReturnType<typeof expose>) => Promise<unknown>) => database.transaction(tx => fn(expose(tx))) } }
})

import {
  ensurePurchaseUrlVerificationHistory,
  getPurchaseUrlVerificationHistory,
  savePurchaseUrlVerificationHistory,
} from './purchase-url-verification-history'

const OWNER = '00000000-0000-4000-8000-000000900001'
const OTHER = '00000000-0000-4000-8000-000000900002'
const offer = (number: number) => `https://detail.1688.com/offer/${100_000_000_000 + number}.html`

beforeAll(async () => {
  memory.failNextSchema = true
  await expect(ensurePurchaseUrlVerificationHistory()).rejects.toThrow('temporary schema connection failure')
  await Promise.all([ensurePurchaseUrlVerificationHistory(), ensurePurchaseUrlVerificationHistory()])
}, 30_000)
beforeEach(async () => {
  memory.readParamCounts = []
  const exists = await memory.client.query<{ exists: boolean }>("SELECT to_regclass('purchasing_url_verification_history') IS NOT NULL AS exists")
  if (exists.rows[0].exists) await memory.client.exec('TRUNCATE purchasing_url_verification_history')
})
afterAll(async () => { await memory.client.close() })

describe('workspace purchase URL verification history in PostgreSQL', () => {
  it('retries a failed initialization, shares successful initialization and enables RLS without public policies', async () => {
    expect(memory.schemaAttempts).toBe(2)
    await ensurePurchaseUrlVerificationHistory()
    expect(memory.schemaAttempts).toBe(2)
    const table = await memory.client.query<{ enabled: boolean }>("SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='purchasing_url_verification_history'::regclass")
    expect(table.rows).toEqual([{ enabled: true }])
    const policies = await memory.client.query('SELECT policyname FROM pg_policies WHERE tablename=$1', ['purchasing_url_verification_history'])
    expect(policies.rows).toEqual([])
  })

  it('stores one canonical URL shared across options and uses the server timestamp', async () => {
    const startedAt = Date.now()
    await savePurchaseUrlVerificationHistory({ userId: OWNER, url: `${offer(1)}?spm=order#sku`, status: 'open' })
    const history = await getPurchaseUrlVerificationHistory(OWNER, [offer(1), `${offer(1)}?sku=red`, offer(2)])
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ url: offer(1), status: 'open' })
    expect(new Date(history[0].checkedAt).getTime()).toBeGreaterThanOrEqual(startedAt - 1_000)
    expect(new Date(history[0].checkedAt).getTime()).toBeLessThanOrEqual(Date.now() + 1_000)
  })

  it('keeps results isolated by canonical workspace even when URLs are identical', async () => {
    await savePurchaseUrlVerificationHistory({ userId: OWNER, url: offer(1), status: 'open' })
    await savePurchaseUrlVerificationHistory({ userId: OTHER, url: offer(1), status: 'unavailable', reason: '판매 종료' })
    expect(await getPurchaseUrlVerificationHistory(OWNER, [offer(1)])).toEqual([
      expect.objectContaining({ url: offer(1), status: 'open' }),
    ])
    expect(await getPurchaseUrlVerificationHistory(OTHER, [offer(1)])).toEqual([
      expect.objectContaining({ url: offer(1), status: 'unavailable' }),
    ])
  })

  it('atomically replaces a prior problem result with a newer normal result and clears its old reason', async () => {
    await savePurchaseUrlVerificationHistory({ userId: OWNER, url: offer(1), status: 'unknown', reason: '  시간 초과  ' })
    await memory.client.query("UPDATE purchasing_url_verification_history SET checked_at='2026-01-01T00:00:00Z' WHERE user_id=$1 AND url=$2", [OWNER, offer(1)])
    await savePurchaseUrlVerificationHistory({ userId: OWNER, url: offer(1), status: 'open' })
    const rows = await memory.client.query<{ status: string; reason: string | null; checkedAt: Date }>(
      'SELECT status, reason, checked_at AS "checkedAt" FROM purchasing_url_verification_history WHERE user_id=$1 AND url=$2', [OWNER, offer(1)],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({ status: 'open', reason: null })
    expect(rows.rows[0].checkedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime())
  })

  it('reads more than two thousand URLs in bounded batches without losing or duplicating history', async () => {
    const urls = Array.from({ length: 3_641 }, (_, index) => offer(index))
    await memory.client.query(`INSERT INTO purchasing_url_verification_history (user_id,url,status)
      SELECT $1::uuid, value, 'open' FROM jsonb_array_elements_text($2::jsonb)`, [OWNER, JSON.stringify(urls)])
    const history = await getPurchaseUrlVerificationHistory(OWNER, [...urls, urls[0], `${urls[1]}?spm=copy`])
    expect(history).toHaveLength(3_641)
    expect(new Set(history.map(row => row.url)).size).toBe(3_641)
    expect(memory.readParamCounts).toHaveLength(8)
    expect(Math.max(...memory.readParamCounts)).toBeLessThanOrEqual(501)
  })

  it('does not record order, cart, foreign or malformed URLs and rejects an unsupported status', async () => {
    for (const url of ['https://trade.1688.com/order?orderId=1234567890123', 'https://cart.1688.com/', 'https://example.com/offer/123456789012.html', 'javascript:alert(1)']) {
      await expect(savePurchaseUrlVerificationHistory({ userId: OWNER, url, status: 'open' })).rejects.toThrow('1688 상품 주소')
    }
    await expect(savePurchaseUrlVerificationHistory({ userId: OWNER, url: offer(1), status: 'bad' as 'open' })).rejects.toThrow('검증 상태')
    expect(await getPurchaseUrlVerificationHistory(OWNER, ['https://cart.1688.com/', ''])).toEqual([])
    const count = await memory.client.query<{ count: number }>('SELECT count(*)::int AS count FROM purchasing_url_verification_history')
    expect(count.rows[0].count).toBe(0)
  })
})
