import ExcelJS from 'exceljs'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ where: vi.fn(), set: vi.fn(), updateWhere: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {
  select: () => ({ from: () => ({ where: mocks.where }) }),
  update: () => ({ set: mocks.set }),
} }))

import {
  CHINESE_PRODUCT_NAME_HEADER as NAME,
  CHINESE_PRODUCT_NAME_DELETE_HEADER as DELETE,
  importPurchasingItems,
  previewPurchasingItemsImport,
  purchasingItemData,
  metadataWithPurchasingItemData,
} from './items'

const dialect = new PgDialect()
const original = {
  id: 'item-one', internalSku: 'SKU-A', name: '원래 상품',
  metadata: {
    chineseProductName: '旧名称', chineseProductNameSource: { files: ['original.xlsx'] },
    esa009m: { '품목코드': 'SKU-A', '품목명': '원래 상품', '한국창고기준 위치': 'A-01', 'works 신규 원가': '500' },
    other: { untouched: true },
  },
}

async function excel(headers: string[], rows: Array<Array<string | null>>) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('품목')
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)
  return await workbook.xlsx.writeBuffer() as ArrayBuffer
}

describe('Chinese item names in the existing item workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.where.mockResolvedValue([original])
    mocks.set.mockReturnValue({ where: mocks.updateWhere })
    mocks.updateWhere.mockResolvedValue([])
  })

  it('shows imported root names and keeps an explicit deletion from restoring an old nested name', () => {
    expect(purchasingItemData(original.metadata)[NAME]).toBe('旧名称')
    expect(purchasingItemData({ chineseProductName: null, esa009m: { [NAME]: '过期名称' } })[NAME]).toBeNull()
    expect(purchasingItemData({ esa009m: { [NAME]: '旧格式' } })[NAME]).toBe('旧格式')
  })

  it('previews and applies only Chinese names by exact SKU without changing cost, location or identity', async () => {
    const fileBuffer = await excel(['품목코드', NAME, '품목명', 'works 신규 원가'], [['SKU-A', '新名称', '다른 이름', '999']])
    const input = { userId: 'workspace-owner', fileBuffer, options: { mode: 'chinese-names' as const } }
    const preview = await previewPurchasingItemsImport(input)
    expect(preview.changedItems).toBe(1)
    expect(preview.sampleChanges[0].changedHeaders).toEqual([NAME])
    expect(mocks.set).not.toHaveBeenCalled()
    expect((await importPurchasingItems(input)).updated).toBe(1)
    const saved = mocks.set.mock.calls[0][0]
    expect(saved).not.toHaveProperty('costPrice')
    expect(saved).not.toHaveProperty('warehouseLocation')
    expect(saved).not.toHaveProperty('name')
    expect(saved.metadata.chineseProductName).toBe('新名称')
    expect(saved.metadata.other).toEqual(original.metadata.other)
    expect(saved.metadata.esa009m).toMatchObject(original.metadata.esa009m)
    const query = dialect.sqlToQuery(mocks.updateWhere.mock.calls[0][0] as SQL)
    expect(query.params).toEqual(['workspace-owner', 'SKU-A'])
  })

  it('preserves existing names when uploaded cells are blank', async () => {
    const fileBuffer = await excel(['품목코드', NAME], [['SKU-A', '']])
    const result = await importPurchasingItems({ userId: 'workspace-owner', fileBuffer, options: { mode: 'chinese-names' } })
    expect(result.unchangedItems).toBe(1)
    expect(result.updated).toBe(0)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('supports an explicit Y deletion even in a code-and-delete-only file', async () => {
    const fileBuffer = await excel(['품목코드', DELETE], [['SKU-A', 'Y']])
    const input = { userId: 'workspace-owner', fileBuffer, options: { mode: 'chinese-names' as const } }
    const preview = await previewPurchasingItemsImport(input)
    expect(preview.sampleChanges[0].changedHeaders).toEqual([NAME])
    expect(preview.chineseNameDeletions).toBe(1)
    expect((await importPurchasingItems(input)).updated).toBe(1)
    const saved = mocks.set.mock.calls[0][0].metadata
    expect(saved.chineseProductName).toBeNull()
    expect(saved.esa009m).not.toHaveProperty(NAME)
    expect(saved.other).toEqual(original.metadata.other)
  })

  it('ignores deletion markers when Chinese names were not selected for update', async () => {
    const fileBuffer = await excel(['품목코드', DELETE], [['SKU-A', 'Y']])
    await importPurchasingItems({ userId: 'workspace-owner', fileBuffer, options: { mode: 'selected', selectedHeaders: ['works 신규 원가'] } })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('rejects conflicting name/deletion rows before any updates are applied', async () => {
    const fileBuffer = await excel(['품목코드', NAME, DELETE], [['SKU-A', '新名称', ''], ['SKU-B', '其他名称', 'Y']])
    await expect(importPurchasingItems({ userId: 'workspace-owner', fileBuffer, options: { mode: 'chinese-names' } })).rejects.toThrow('동시에')
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('reports unknown SKUs without creating products in Chinese-name-only mode', async () => {
    const fileBuffer = await excel(['품목코드', NAME], [['UNKNOWN', '新名称']])
    const result = await importPurchasingItems({ userId: 'workspace-owner', fileBuffer, options: { mode: 'chinese-names', createMissing: true } })
    expect(result.unmatchedItems).toBe(1)
    expect(result.inserted).toBe(0)
    expect(result.updated).toBe(0)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('stores manual additions and deletions in the same canonical field used by labels', () => {
    const data = purchasingItemData(original.metadata)
    const changed = metadataWithPurchasingItemData(original.metadata, { ...data, [NAME]: ' 手工名称 ' })
    expect(purchasingItemData(changed)[NAME]).toBe('手工名称')
    const cleared = metadataWithPurchasingItemData(changed, { ...data, [NAME]: '' })
    expect(purchasingItemData(cleared)[NAME]).toBeNull()
    expect(cleared.other).toEqual(original.metadata.other)
    expect(cleared.esa009m).toMatchObject(original.metadata.esa009m)
  })
})
