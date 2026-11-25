// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), context: vi.fn(), list: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { execute: vi.fn() } }))
vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
vi.mock('@/lib/coupang-registration/category-context', () => ({ getCategoryContext: mocks.context }))
vi.mock('@/lib/coupang-registration/sheet-mappings', async (original) => ({ ...await original<object>(), listSheetMappings: mocks.list, saveSheetMapping: mocks.save }))

import { GET, POST } from '@/app/api/operations/coupang-registration/sheet-mappings/route'

const owner = 'f75713ac-1529-4ec2-9e76-950054467dfd'
const targetSheetName = 'QF_2379_가구_선반'
let file: { name: string; data: string }
const currentCategory = { sourceCode: '123', productName: '선반', categoryName: '선반', categoryPath: '가구>수납가구>선반', keywords: [], queries: [] }
const mapping = { sourceCode: '123', sourceCategoryName: '선반', sourceCategoryPath: currentCategory.categoryPath, targetSheetName, updatedAt: '2026-11-25T10:00:00Z' }
const request = (body: unknown) => new NextRequest('http://test/api/operations/coupang-registration/sheet-mappings', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeAll(async () => {
  const workbook = new ExcelJS.Workbook()
  for (const name of [targetSheetName, 'QF_998_생활_옷걸이']) {
    const sheet = workbook.addWorksheet(name)
    sheet.getRow(5).values = ['상품명', '공급가', '브랜드']
    sheet.getRow(6).values = ['필수', '필수', '필수']
  }
  file = { name: '공식다중시트원본.xlsx', data: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64') }
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.workspace.mockResolvedValue(owner)
  mocks.context.mockResolvedValue(currentCategory)
  mocks.list.mockResolvedValue([mapping])
  mocks.save.mockImplementation(async (_workspace, input) => ({ ...input, updatedAt: mapping.updatedAt }))
})

describe('manual worksheet choice routes', () => {
  it('requires workspace menu authorization before reading files, categories or stored choices', async () => {
    mocks.workspace.mockResolvedValue(null)
    expect((await GET(new NextRequest('http://test/api/sheet-mappings'))).status).toBe(403)
    expect((await POST(request({ sourceCode: '123', targetSheetName, file }))).status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('lists canonical owner mappings with private caching and an optional exact product code', async () => {
    const response = await GET(new NextRequest('http://test/api/sheet-mappings?code=123'))
    expect(await response.json()).toEqual({ mappings: [mapping] })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.list).toHaveBeenCalledWith(owner, '123')
    expect((await GET(new NextRequest('http://test/api/sheet-mappings?code=other-owner'))).status).toBe(400)
    expect(mocks.list).toHaveBeenCalledTimes(1)
  })

  it('verifies a real original sheet and saves only the fresh server-side B2B category', async () => {
    const response = await POST(request({ sourceCode: '123', targetSheetName, file }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ mapping })
    expect(mocks.context).toHaveBeenCalledWith('123')
    expect(mocks.save).toHaveBeenCalledWith(owner, {
      sourceCode: '123', sourceCategoryName: currentCategory.categoryName, sourceCategoryPath: currentCategory.categoryPath, targetSheetName,
    })
  })

  it('rejects an invented worksheet even if it has a valid-looking QF name', async () => {
    expect((await POST(request({ sourceCode: '123', targetSheetName: 'QF_999_없는시트', file }))).status).toBe(400)
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rejects malformed sources, untrusted metadata, invalid base64 and oversized requests', async () => {
    const invalid = [
      { sourceCode: '', targetSheetName, file },
      { sourceCode: '123', sourceCategoryName: '조작된 분류', targetSheetName, file },
      { sourceCode: '123', sourceCodes: ['123'], targetSheetName, file },
      { sourceCodes: [], targetSheetName, file },
      { sourceCodes: Array.from({ length: 31 }, (_, index) => String(index)), targetSheetName, file },
      { sourceCode: '123', targetSheetName, file: { name: 'bad.xlsx', data: 'AAAAA' } },
      { sourceCode: '123', targetSheetName, file: { name: '../original.xlsx', data: file.data } },
      { sourceCode: '123', targetSheetName, file: { name: 'oversized.xlsx', data: 'A'.repeat(4_000_000) } },
    ]
    for (const body of invalid) expect((await POST(request(body))).status).toBe(400)
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('does not persist a guessed category when the B2B source cannot be verified', async () => {
    mocks.context.mockRejectedValue(new Error('B2B unavailable'))
    expect((await POST(request({ sourceCode: '123', targetSheetName, file }))).status).toBe(502)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('stores batch successes under the owner, deduplicates codes and reports per-product failures', async () => {
    mocks.context.mockImplementation(async code => {
      if (code === '456') throw new Error('unavailable')
      return { ...currentCategory, sourceCode: code }
    })
    const response = await POST(request({ sourceCodes: ['123', '456', '123', '789'], targetSheetName, file }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.mappings.map((item: { sourceCode: string }) => item.sourceCode)).toEqual(['123', '789'])
    expect(body.failures).toEqual([{ sourceCode: '456', error: expect.any(String) }])
    expect(mocks.context).toHaveBeenCalledTimes(3)
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save.mock.calls.every(([workspace]) => workspace === owner)).toBe(true)
  })

  it('never has more than four B2B category lookups in flight in a batch', async () => {
    let concurrent = 0
    let maximum = 0
    mocks.context.mockImplementation(async code => {
      concurrent++
      maximum = Math.max(maximum, concurrent)
      await new Promise(resolve => setTimeout(resolve, 1))
      concurrent--
      return { ...currentCategory, sourceCode: code }
    })
    const response = await POST(request({ sourceCodes: Array.from({ length: 10 }, (_, index) => String(index + 1)), targetSheetName, file }))
    expect(response.status).toBe(200)
    expect((await response.json()).mappings).toHaveLength(10)
    expect(maximum).toBe(4)
  })
})
