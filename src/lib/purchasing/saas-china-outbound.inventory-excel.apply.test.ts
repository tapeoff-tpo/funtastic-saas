import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saasChinaInventory, saasChinaInventoryMovements, saasChinaPurchaseLinks } from '@/lib/db/schema'

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
    itemCategory: null,
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
    itemCategory: null,
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

  it('applies distinct warehouse identities from one physical report row with separate movement keys', async () => {
    const chinaInventory = { ...inventory(), reservedQuantity: 0, availableQuantity: 10 }
    const bulkInventory = {
      ...inventory(),
      id: 'inventory-b',
      warehouseCode: '대량',
      productName: '대량 상품',
      onHandQuantity: 2,
      reservedQuantity: 0,
      availableQuantity: 2,
    }
    const tx = transaction([chinaInventory, bulkInventory])
    const updateValues: Array<Record<string, unknown>> = []
    const movementValues = vi.fn().mockResolvedValue(undefined)
    let updateIndex = 0
    tx.update.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => {
        const existing = [chinaInventory, bulkInventory][updateIndex++]!
        updateValues.push(values)
        return {
          where: () => ({
            returning: async () => [{ ...existing, ...values }],
          }),
        }
      },
    }))
    tx.insert.mockImplementation((table: unknown) => {
      if (table === saasChinaInventoryMovements) return { values: movementValues }
      throw new Error('unexpected insert')
    })
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await expect(applySaasChinaInventoryWorkbook({
      userId: workspaceUserId,
      createdBy: 'operator-a',
      rows: [
        excelRow({ rowNumber: 2, warehouseCode: '중국창고', itemCategory: '[상품]', onHandQuantity: 12 }),
        excelRow({ rowNumber: 2, warehouseCode: '대량', itemCategory: '[상품]', onHandQuantity: 4 }),
      ],
      sourceLabel: '재고현황.xlsx',
      fullSnapshot: true,
    })).resolves.toEqual({ createdCount: 0, updatedCount: 2, archivedCount: 0, unchangedCount: 0 })

    expect(updateValues).toEqual([
      expect.objectContaining({ onHandQuantity: 12, availableQuantity: 12, itemCategory: '[상품]' }),
      expect.objectContaining({ onHandQuantity: 4, availableQuantity: 4, itemCategory: '[상품]' }),
    ])
    expect(movementValues).toHaveBeenCalledTimes(2)
    expect(movementValues.mock.calls.map(([movement]) => movement.inventoryId)).toEqual([inventoryId, 'inventory-b'])
    const sourceKeys = movementValues.mock.calls.map(([movement]) => movement.sourceKey)
    expect(new Set(sourceKeys).size).toBe(2)
  })

  it('does not mutate listed rows when an omitted snapshot identity is protected', async () => {
    const tx = transaction([
      { ...inventory(), reservedQuantity: 0, availableQuantity: 10 },
      { ...inventory(), id: 'inventory-b', sku: 'SKU-B', productName: '상품 B', onHandQuantity: 5, reservedQuantity: 2, availableQuantity: 3 },
    ])
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await expect(applySaasChinaInventoryWorkbook({
      userId: workspaceUserId,
      createdBy: 'operator-a',
      rows: [excelRow({ onHandQuantity: 12 })],
      sourceLabel: '재고현황.xlsx',
      fullSnapshot: true,
      snapshotWarehouseCodes: ['중국창고'],
    })).rejects.toThrow('재고현황 파일에 없어 제거할 수 없습니다. 출고 예약 2개를 먼저 처리해주세요.')

    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('archives a safe omitted snapshot identity and writes its quantity adjustment to the ledger', async () => {
    const omitted = {
      ...inventory(),
      id: 'inventory-b',
      sku: 'SKU-B',
      productName: '상품 B',
      onHandQuantity: 5,
      reservedQuantity: 0,
      availableQuantity: 5,
    }
    const tx = transaction([
      { ...inventory(), reservedQuantity: 0, availableQuantity: 10 },
      omitted,
    ])
    const updateValues: Array<Record<string, unknown>> = []
    const movementValues = vi.fn().mockResolvedValue(undefined)
    tx.update.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => {
        updateValues.push(values)
        return {
          where: () => ({
            returning: async () => [{ ...omitted, ...values }],
          }),
        }
      },
    }))
    tx.insert.mockImplementation((table: unknown) => {
      if (table === saasChinaInventoryMovements) return { values: movementValues }
      throw new Error('unexpected insert')
    })
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await expect(applySaasChinaInventoryWorkbook({
      userId: workspaceUserId,
      createdBy: 'operator-a',
      rows: [excelRow({ onHandQuantity: 10 })],
      sourceLabel: '재고현황.xlsx',
      fullSnapshot: true,
      snapshotWarehouseCodes: ['중국창고'],
    })).resolves.toEqual({ createdCount: 0, updatedCount: 0, archivedCount: 1, unchangedCount: 1 })

    expect(updateValues).toEqual([expect.objectContaining({
      onHandQuantity: 0,
      availableQuantity: 0,
      archivedAt: expect.any(Date),
    })])
    expect(movementValues).toHaveBeenCalledWith(expect.objectContaining({
      inventoryId: 'inventory-b',
      movementType: 'manual_adjustment',
      onHandDelta: -5,
      onHandAfter: 0,
      reservedAfter: 0,
    }))
  })
})
