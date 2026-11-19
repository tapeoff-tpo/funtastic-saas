import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), schemaExecute: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { transaction: mocks.transaction, execute: mocks.execute } }))

const dialect = new PgDialect()
const rawData = { headers: ['상품코드', '주문자명'], rows: [{ rowNumber: 2, cells: ['A-01', '가상 주문자'], excludedReason: null }] }
const items = [{ sku: 'A-01', productName: '상품', optionName: '옵션', quantity: 3 }]

describe('short meeting upload persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mocks.schemaExecute.mockResolvedValue([])
    mocks.execute.mockResolvedValue([])
    mocks.transaction.mockImplementation(async (callback) => callback({ execute: mocks.schemaExecute }))
  })

  it('upgrades existing tables with a nullable original-data column under a lock and keeps RLS enabled', async () => {
    const { ensureShortMeetingUploadSchema } = await import('./short-meeting-uploads')
    await Promise.all([ensureShortMeetingUploadSchema(), ensureShortMeetingUploadSchema()])
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    const statements = mocks.schemaExecute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement as SQL).sql)
    expect(statements[0]).toContain('pg_advisory_xact_lock')
    expect(statements).toContain('ALTER TABLE short_meeting_uploads ADD COLUMN IF NOT EXISTS raw_data jsonb')
    expect(statements).toContain('ALTER TABLE short_meeting_uploads ENABLE ROW LEVEL SECURITY')
  })

  it('retries initialization after a failed schema change', async () => {
    mocks.schemaExecute.mockRejectedValueOnce(new Error('temporary database failure'))
    const { ensureShortMeetingUploadSchema } = await import('./short-meeting-uploads')
    await expect(ensureShortMeetingUploadSchema()).rejects.toThrow('temporary database failure')
    await expect(ensureShortMeetingUploadSchema()).resolves.toBeUndefined()
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
  })

  it('inserts original rows and SKU totals in the same workspace snapshot', async () => {
    const { saveShortMeetingUpload } = await import('./short-meeting-uploads')
    await saveShortMeetingUpload({
      userId: 'workspace', actorId: 'actor', meetingDate: '2026-11-17', fileName: 'orders.xlsx',
      buffer: Buffer.from('example'), rowCount: 1, items, rawData,
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[0][0] as SQL)
    expect(query.sql).toContain('INSERT INTO short_meeting_uploads')
    expect(query.sql).toContain('row_count, items, raw_data')
    expect(query.params).toContain('workspace')
    expect(query.params).toContain('actor')
    expect(query.params).toContain('2026-11-17')
    expect(query.params).toContain(JSON.stringify(items))
    expect(query.params).toContain(JSON.stringify(rawData))
  })

  it('retrieves the latest date-scoped snapshot including original rows or a legacy null', async () => {
    const latest = { fileName: 'new.xlsx', meetingDate: '2026-11-17', appliedAt: '2026-11-17T01:00:00Z', rowCount: 1, items, rawData }
    const legacy = { ...latest, fileName: 'old.xlsx', meetingDate: '2026-11-16', rawData: null }
    mocks.execute.mockResolvedValueOnce([latest]).mockResolvedValueOnce([legacy]).mockResolvedValueOnce([])
    const { getLatestShortMeetingUpload } = await import('./short-meeting-uploads')
    expect(await getLatestShortMeetingUpload('workspace', '2026-11-17', { includeRaw: true })).toEqual(latest)
    expect(await getLatestShortMeetingUpload('workspace', '2026-11-16')).toEqual(legacy)
    expect(await getLatestShortMeetingUpload('workspace', '2026-11-15')).toBeNull()
    const queries = mocks.execute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement as SQL))
    for (const [index, date] of ['2026-11-17', '2026-11-16', '2026-11-15'].entries()) {
      expect(queries[index].sql).toMatch(/ORDER BY applied_at DESC, id DESC LIMIT 1/)
      expect(queries[index].sql).toContain(index === 0 ? 'items, raw_data AS "rawData"' : 'items, NULL::jsonb AS "rawData"')
      expect(queries[index].sql).toContain('(raw_data IS NOT NULL) AS "rawAvailable"')
      expect(queries[index].params).toEqual(['workspace', date])
    }
  })
})
