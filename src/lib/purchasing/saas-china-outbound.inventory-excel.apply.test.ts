import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saasChinaInventory, saasChinaPurchaseLinks } from '@/lib/db/schema'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mocks }))

import { applySaasChinaInventoryWorkbook } from './saas-china-outbound'
import type { SaasChinaInventoryExcelRow } from './saas-china-inventory-excel'

type Row = { id: string; [key: string]: unknown }
const workspaceUserId = 'workspace-a'
const inventoryId = '11111111-1111-4111-8111-111111111111'

function excelRow(overrides: Partial<SaasChinaInventoryExcelRow> = {}): SaasChinaInventoryExcelRow {
  return {
    rowNumber: 2,
    inventoryId: null,
    warehouseCode: '중국창고',
    sku: 'SKU-A',
    productName: null,
    optionName: null,
    optionKey: '',
    onHandQuantity: 12,
    note: null,
    errors: [],
    ...overrides,
  }
}

function inventory(): Row {
  return {
    id: inventoryId,
    userId: workspaceUserId,
    warehouseCode: '중국창고',
    sku: 'SKU-A',
    productName: '상품 A',
    optionKey: '',
    optionName: null,
    onHandQuantity: 10,
    reservedQuantity: 4,
    availableQuantity: 6,
  }
}

function transaction(inventories: Row[], linkedBalances: Row[] = []) {
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = table === saasChinaInventory ? inventories : table === saasChinaPurchaseLinks ? linkedBalances : []
          const result = Promise.resolve(rows)
          return Object.assign(result, { groupBy: async () => rows })
        },
      }),
    })),
    insert: vi.fn(),
    update: vi.fn(),
  }
  return tx
}

describe('applySaasChinaInventoryWorkbook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue(undefined)
  })

  it('validates every row before mutating any inventory row', async () => {
    const tx = transaction([
      inventory(),
      { ...inventory(), id: 'inventory-b', sku: 'SKU-B', productName: '상품 B' },
    ])
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await expect(applySaasChinaInventoryWorkbook({
      userId: workspaceUserId,
      createdBy: 'operator-a',
      rows: [
        excelRow({ rowNumber: 2, onHandQuantity: 12 }),
        excelRow({ rowNumber: 3, sku: 'SKU-B', onHandQuantity: 3 }),
      ],
      sourceLabel: '현재목록.xlsx',
    })).rejects.toThrow('출고 예약 4개보다 적게 줄일 수 없습니다.')

    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('revalidates the exported inventory identity before any mutation', async () => {
    const tx = transaction([inventory()])
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await expect(applySaasChinaInventoryWorkbook({
      userId: workspaceUserId,
      createdBy: 'operator-a',
      rows: [excelRow({ inventoryId, sku: 'EDITED-SKU', onHandQuantity: 12 })],
      sourceLabel: '현재목록.xlsx',
    })).rejects.toThrow('현재 목록에서 내려받은 중국창고·품목코드·옵션명은 변경할 수 없습니다.')

    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })
})
