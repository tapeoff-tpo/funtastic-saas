// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute } }))

import { listSheetMappings, saveSheetMapping } from '@/lib/coupang-registration/sheet-mappings'

const workspace = 'f75713ac-1529-4ec2-9e76-950054467dfd'
const mapping = { sourceCode: '123', sourceCategoryName: '선반', sourceCategoryPath: '가구>수납가구>선반', targetSheetName: 'QF_2379_가구_선반', updatedAt: '2026-11-25T10:00:00Z' }
const statement = (index = 2) => new PgDialect().sqlToQuery(mocks.execute.mock.calls[index][0] as SQL)

beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockResolvedValue([]) })

describe('workspace worksheet mapping store', () => {
  it('creates only an additive table and enables RLS before listing this workspace', async () => {
    mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([mapping, { ...mapping, sourceCode: 'bad-code' }])
    expect(await listSheetMappings(workspace)).toEqual([mapping])
    expect(statement(0).sql).toContain('CREATE TABLE IF NOT EXISTS')
    expect(statement(0).sql).toContain('PRIMARY KEY (user_id, source_code)')
    expect(statement(1).sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(statement().params).toEqual([workspace])
    expect(statement().sql).not.toContain('file')
    expect(mocks.execute.mock.calls.map((_, index) => statement(index).sql).join(' ')).not.toMatch(/DELETE|DROP|TRUNCATE|DISABLE/i)
  })

  it('filters a product by both the owner and stable B2B code', async () => {
    mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce({ rows: [mapping] })
    expect(await listSheetMappings(workspace, '123')).toEqual([mapping])
    expect(statement().params).toEqual([workspace, '123'])
    await expect(listSheetMappings(workspace, '../another')).rejects.toThrow()
    expect(mocks.execute).toHaveBeenCalledTimes(3)
  })

  it('updates only this explicit product choice without replacing draft or product data', async () => {
    mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([mapping])
    const { updatedAt: _updatedAt, ...input } = mapping
    void _updatedAt
    expect(await saveSheetMapping(workspace, input)).toEqual(mapping)
    expect(statement().params).toEqual([workspace, '123', mapping.sourceCategoryName, mapping.sourceCategoryPath, mapping.targetSheetName])
    expect(statement().sql).toContain('ON CONFLICT (user_id, source_code) DO UPDATE')
    expect(statement().sql).not.toMatch(/coupang_registration_drafts|orders|products|mapping_codes/)
    expect(statement().sql).not.toContain('created_at =')
  })

  it('validates the stored target and source before any database access', async () => {
    await expect(saveSheetMapping(workspace, { sourceCode: '123', sourceCategoryName: '', sourceCategoryPath: '', targetSheetName: 'unverified-sheet' })).rejects.toThrow()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
