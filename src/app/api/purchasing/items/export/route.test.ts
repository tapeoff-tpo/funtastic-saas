import ExcelJS from 'exceljs'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAll: vi.fn(), owner: vi.fn() }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'staff' } } }) } }) }))
vi.mock('@/lib/purchasing/items', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/purchasing/items')>(), getAllPurchasingItems: mocks.getAll }))
import { GET } from './route'

describe('Chinese-name item exports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.owner.mockResolvedValue('workspace-owner')
    mocks.getAll.mockResolvedValue([{
      data: { '품목코드': 'SKU-A', '중국어 상품명': '多孔衣架' },
      purchaseUrlVerification: null, purchaseUrlVerificationStatus: null,
      outgoingMetrics: {}, updatedAt: new Date('2026-10-30T00:00:00Z'),
    }])
  })

  it('exports current Chinese names and a blank, explicit delete column with the required SKU', async () => {
    const params = new URLSearchParams({ headers: '중국어 상품명', extraHeaders: 'none' })
    const response = await GET(new NextRequest(`http://localhost/items/export?${params}`))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer())
    const sheet = workbook.getWorksheet('품목')!
    expect(sheet.getRow(1).values).toEqual([undefined, '품목코드', '중국어 상품명', '중국어 상품명 삭제'])
    expect(sheet.getCell('A2').value).toBe('SKU-A')
    expect(sheet.getCell('B2').value).toBe('多孔衣架')
    expect(sheet.getCell('C2').value ?? '').toBe('')
    expect(sheet.getCell('C2').dataValidation).toMatchObject({ type: 'list', allowBlank: true })
    expect(sheet.rowCount).toBe(2)
    expect(mocks.getAll).toHaveBeenCalledWith('workspace-owner', { includeOutgoingMetrics: false })
  })

  it('includes both Chinese-name fields in an upload template without loading operational rows', async () => {
    const params = new URLSearchParams({ headers: '품목코드,중국어 상품명', template: '1' })
    const response = await GET(new NextRequest(`http://localhost/items/export?${params}`))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer())
    const sheet = workbook.getWorksheet('업로드양식')!
    expect(sheet.getCell('B1').value).toBe('중국어 상품명')
    expect(sheet.getCell('C1').value).toBe('중국어 상품명 삭제')
    expect(sheet.rowCount).toBe(2)
    expect(mocks.getAll).not.toHaveBeenCalled()
  })
})
