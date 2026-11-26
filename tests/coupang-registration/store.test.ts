// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { blankDraft } from '@/lib/coupang-registration/model'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute } }))

const workspace = 'f75713ac-1529-4ec2-9e76-950054467dfd'
const draftId = '41c680b7-6a11-4ba9-b511-09be9b869fd9'
const statement = (index: number) => new PgDialect().sqlToQuery(mocks.execute.mock.calls[index][0] as SQL)
const ddlCalls = () => mocks.execute.mock.calls.map((_, index) => statement(index).sql).filter(sql => /CREATE TABLE|CREATE INDEX|ALTER TABLE/.test(sql))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.execute.mockResolvedValue([])
})

describe('Coupang draft store initialization', () => {
  it('shares initialization across concurrent operations and blocks data access until RLS is enabled', async () => {
    const store = await import('@/lib/coupang-registration/store')
    let enableRls!: () => void
    const rls = new Promise<unknown[]>(resolve => { enableRls = () => resolve([]) })
    mocks.execute.mockImplementation(async (query: SQL) => {
      const { sql } = new PgDialect().sqlToQuery(query)
      return sql.includes('ENABLE ROW LEVEL SECURITY') ? rls : []
    })

    const pending = Promise.all([
      store.listDrafts(workspace),
      store.loadDraft(workspace, draftId),
      store.saveDraft(workspace, blankDraft(), draftId, 7),
    ])
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(3))
    expect(statement(0).sql).toContain('CREATE TABLE IF NOT EXISTS coupang_registration_drafts')
    expect(statement(1).sql).toContain('CREATE INDEX IF NOT EXISTS coupang_registration_drafts_workspace')
    expect(statement(2).sql).toContain('ENABLE ROW LEVEL SECURITY')
    enableRls()
    await pending
    expect(mocks.execute).toHaveBeenCalledTimes(6)
    expect(ddlCalls()).toHaveLength(3)

    await store.listDrafts(workspace)
    await store.loadDraft(workspace, draftId)
    await store.saveDraft(workspace, blankDraft(), draftId, 8)
    expect(mocks.execute).toHaveBeenCalledTimes(9)
    expect(ddlCalls()).toHaveLength(3)
  })

  it('retries every initialization step after failure and never reads data before a successful RLS step', async () => {
    const store = await import('@/lib/coupang-registration/store')
    mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('RLS unavailable'))
    const result = await Promise.allSettled([store.listDrafts(workspace), store.loadDraft(workspace, draftId)])
    expect(result.every(item => item.status === 'rejected')).toBe(true)
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    expect(ddlCalls()).toHaveLength(3)

    await store.listDrafts(workspace)
    expect(mocks.execute).toHaveBeenCalledTimes(7)
    expect(statement(3).sql).toContain('CREATE TABLE IF NOT EXISTS')
    expect(statement(4).sql).toContain('CREATE INDEX IF NOT EXISTS')
    expect(statement(5).sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(statement(6).sql).toContain('SELECT id, name, revision')
    expect(statement(6).params).toEqual([workspace])
  })

  it('retains workspace scoping, returned values and revision compare-and-swap after initialization', async () => {
    const store = await import('@/lib/coupang-registration/store')
    await store.ensureCoupangDrafts()
    const draft = blankDraft()
    const summary = { id: draftId, name: draft.name, revision: 7, updatedAt: '2026-11-26T10:00:00Z' }
    const saved = { id: draftId, revision: 8 }
    mocks.execute.mockResolvedValueOnce({ rows: [summary] })
      .mockResolvedValueOnce([{ ...summary, payload: draft }])
      .mockResolvedValueOnce([saved])
      .mockResolvedValueOnce([])

    expect(await store.listDrafts(workspace)).toEqual([summary])
    expect(await store.loadDraft(workspace, draftId)).toEqual({ ...summary, payload: draft })
    expect(await store.saveDraft(workspace, draft, draftId, 7)).toEqual(saved)
    expect(await store.saveDraft(workspace, draft, draftId, 7)).toBeNull()
    expect(statement(3).params).toEqual([workspace])
    expect(statement(4).params).toEqual([workspace, draftId])
    expect(statement(5).params).toEqual([draft.name, JSON.stringify(draft), workspace, draftId, 7])
    expect(statement(5).sql).toMatch(/WHERE user_id = .* AND id = .* AND revision =/)
    expect(statement(5).sql).toContain('revision = revision + 1')
    expect(ddlCalls()).toHaveLength(3)
  })

  it('keeps initialization cached after an ordinary query failure while allowing that query to retry', async () => {
    const store = await import('@/lib/coupang-registration/store')
    await store.ensureCoupangDrafts()
    mocks.execute.mockRejectedValueOnce(new Error('temporary read failure'))
    await expect(store.listDrafts(workspace)).rejects.toThrow('temporary read failure')
    expect(await store.listDrafts(workspace)).toEqual([])
    expect(mocks.execute).toHaveBeenCalledTimes(5)
    expect(ddlCalls()).toHaveLength(3)
  })
})
