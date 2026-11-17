import ExcelJS from 'exceljs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ where: vi.fn(), set: vi.fn(), updateWhere: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {
  select: () => ({ from: () => ({ where: mocks.where }) }),
  update: () => ({ set: mocks.set }),
} }))

import { importPurchasingItems, previewPurchasingItemsImport, purchasingItemData } from './items'

async function excel(hsCode: string) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('품목')
  sheet.addRow(['품목코드', 'HS CODE', '품목명', 'works 신규 원가'])
  sheet.addRow(['SKU-A', hsCode, '업로드의 다른 이름', '999'])
  return await workbook.xlsx.writeBuffer() as ArrayBuffer
}

describe('selected item columns import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.set.mockReturnValue({ where: mocks.updateWhere })
    mocks.updateWhere.mockResolvedValue([])
  })

  it.each([
    {},
    { '품목코드': 'LEGACY-SKU', '품목명': '기존 메타데이터 이름' },
  ])('updates only HS CODE when legacy identity metadata is %j', async (identity) => {
    const esa009m = { ...identity, 'HS CODE': '3926', 'works 신규 원가': '500' }
    mocks.where.mockResolvedValue([{
      id: 'item-one', internalSku: 'SKU-A', name: '기존 상품',
      metadata: { esa009m, other: { untouched: true } },
    }])
    const input = {
      userId: 'workspace-owner', fileBuffer: await excel('0392.10-0000'),
      options: { mode: 'selected' as const, selectedHeaders: ['HS CODE' as const], createMissing: false },
    }
    const preview = await previewPurchasingItemsImport(input)
    expect(preview.fieldChanges).toEqual({ 'HS CODE': 1 })
    expect(preview.sampleChanges[0].changedHeaders).toEqual(['HS CODE'])
    expect(mocks.set).not.toHaveBeenCalled()
    const result = await importPurchasingItems(input)
    expect(result.updated).toBe(1)
    expect(result.fieldChanges).toEqual(preview.fieldChanges)
    const saved = mocks.set.mock.calls[0][0]
    expect(Object.keys(saved).sort()).toEqual(['metadata', 'updatedAt'])
    expect(purchasingItemData(saved.metadata)).toEqual({ ...purchasingItemData({ esa009m }), 'HS CODE': '0392.10-0000' })
    expect(saved.metadata.other).toEqual({ untouched: true })
  })

  it.each([[''], ['3926']])('keeps legacy identity untouched when HS CODE %j causes no change', async (hsCode) => {
    mocks.where.mockResolvedValue([{
      id: 'item-one', internalSku: 'SKU-A', name: '기존 상품',
      metadata: { esa009m: { 'HS CODE': '3926' } },
    }])
    const input = {
      userId: 'workspace-owner', fileBuffer: await excel(hsCode),
      options: { mode: 'selected' as const, selectedHeaders: ['HS CODE' as const], createMissing: false },
    }
    const preview = await previewPurchasingItemsImport(input)
    expect(preview.changedItems).toBe(0)
    expect(preview.unchangedItems).toBe(1)
    expect((await importPurchasingItems(input)).updated).toBe(0)
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
