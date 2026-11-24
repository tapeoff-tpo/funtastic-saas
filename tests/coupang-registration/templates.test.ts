// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
const mocks = vi.hoisted(() => ({ execute: vi.fn(), ensure: vi.fn(), workspace: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute } }))
vi.mock('@/lib/coupang-registration/store', () => ({ ensureCoupangDrafts: mocks.ensure }))
vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
import { listRegistrationTemplates, loadRegistrationTemplate } from '@/lib/coupang-registration/templates'
import { GET } from '@/app/api/operations/coupang-registration/templates/route'
import { NextRequest } from 'next/server'
const workspace = 'f75713ac-1529-4ec2-9e76-950054467dfd'
const id = 'a'.repeat(64)
const summary = { id, name: '옷걸이.xlsx', sheets: [{ name: 'QF_1_옷걸이' }] }
beforeEach(() => { vi.clearAllMocks(); mocks.workspace.mockResolvedValue(workspace) })

describe('workspace category template library', () => {
  it('returns only category summaries from this workspace, not file data or saved products', async () => {
    mocks.execute.mockResolvedValue([summary, { id: 'invalid', name: 'bad', sheets: [] }])
    expect(await listRegistrationTemplates(workspace)).toEqual([summary])
    const statement = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0] as SQL)
    expect(statement.params).toEqual([workspace])
    expect(statement.sql).toContain('DISTINCT ON')
    expect(statement.sql).not.toContain("template->'file'")
  })
  it('re-reads the official workbook and returns only its template when another draft reuses it', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('QF_1_옷걸이')
    sheet.getRow(5).values = ['상품명', '공급가', '브랜드']
    sheet.getRow(6).values = ['필수', '필수', '필수']
    sheet.getRow(9).values = ['다른 작업의 기존 상품', 1000, '생활살림']
    const data = Buffer.from(await workbook.xlsx.writeBuffer())
    const hash = createHash('sha256').update(data).digest('hex')
    mocks.execute.mockResolvedValue([{ template: { file: { name: summary.name, data: data.toString('base64') }, sheets: [{ name: '조작된 카테고리' }] } }])
    const result = await loadRegistrationTemplate(workspace, hash)
    expect(result?.sheets[0].name).toBe('QF_1_옷걸이')
    expect(result).not.toHaveProperty('rows')
    expect(new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0] as SQL).params).toEqual([workspace, hash])
    await expect(loadRegistrationTemplate(workspace, id)).rejects.toThrow('변경')
  })
  it('requires workspace authorization and rejects malformed template identifiers', async () => {
    mocks.workspace.mockResolvedValue(null)
    expect((await GET(new NextRequest('https://app.test/api/templates'))).status).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
    mocks.workspace.mockResolvedValue(workspace)
    expect((await GET(new NextRequest('https://app.test/api/templates?id=other-workspace'))).status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('does not expose templates from another workspace and prevents caching responses', async () => {
    mocks.execute.mockResolvedValue([])
    const missing = await GET(new NextRequest(`https://app.test/api/templates?id=${id}`))
    expect(missing.status).toBe(404)
    const response = await GET(new NextRequest('https://app.test/api/templates'))
    expect(await response.json()).toEqual({ templates: [] })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
