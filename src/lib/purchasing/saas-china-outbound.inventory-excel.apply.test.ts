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

function inventory(overrides: Partial<Row> = {}): Row {
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
    archivedAt: null,
    ...overrides,
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

  it('validates every partial-update row before mutating any inventory row', async () => {
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

  it('revalidates a partial update exported inventory identity before any mutation', async () => {
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

  it('retires every former active row and creates fresh rows for every full-snapshot identity', async () => {
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
    const staleInventory = {
      ...inventory(),
      id: 'inventory-c',
      warehouseCode: '기존창고',
      sku: 'STALE-SKU',
      productName: '파일에 없는 기존 재고',
      onHandQuantity: 5,
      reservedQuantity: 0,
      availableQuantity: 5,
    }
    const tx = transaction([chinaInventory, bulkInventory, staleInventory])
    const updateValues: Array<Record<string, unknown>> = []
    const inventoryInsertValues: Array<Record<string, unknown>> = []
    const movementValues = vi.fn().mockResolvedValue(undefined)
    const freshInventories = [
      { id: 'fresh-china' },
      { id: 'fresh-bulk' },
    ]
    let insertedInventoryIndex = 0
    tx.update.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => {
        updateValues.push(values)
        return {
          where: () => ({
            returning: async () => [chinaInventory, bulkInventory, staleInventory].map(({ id }) => ({ id })),
          }),
        }
      },
    }))
    tx.insert.mockImplementation((table: unknown) => {
      if (table === saasChinaInventory) {
        return {
          values: (values: Record<string, unknown>) => {
            inventoryInsertValues.push(values)
            const created = freshInventories[insertedInventoryIndex++]
            return { returning: async () => [created] }
          },
        }
      }
      if (table === saasChinaInventoryMovements) return { values: movementValues }
      throw new Error('unexpected insert')
    })
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await expect(applySaasChinaInventoryWorkbook({
      userId: workspaceUserId,
      createdBy: 'operator-a',
      rows: [
        excelRow({ rowNumber: 2, warehouseCode: '중국창고', productName: '상품 A', itemCategory: '[상품]', onHandQuantity: 12 }),
        excelRow({ rowNumber: 2, warehouseCode: '대량', productName: '대량 상품', itemCategory: '[상품]', onHandQuantity: 4 }),
      ],
      sourceLabel: '재고현황.xlsx',
      fullSnapshot: true,
    })).resolves.toEqual({ createdCount: 2, updatedCount: 0, archivedCount: 3, unchangedCount: 0 })

    expect(updateValues).toEqual([expect.objectContaining({
      archivedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })])
    expect(inventoryInsertValues).toEqual([
      expect.objectContaining({
        warehouseCode: '중국창고',
        sku: 'SKU-A',
        productName: '상품 A',
        itemCategory: '[상품]',
        onHandQuantity: 12,
        reservedQuantity: 0,
        availableQuantity: 12,
      }),
      expect.objectContaining({
        warehouseCode: '대량',
        sku: 'SKU-A',
        productName: '대량 상품',
        itemCategory: '[상품]',
        onHandQuantity: 4,
        reservedQuantity: 0,
        availableQuantity: 4,
      }),
    ])
    expect(movementValues).toHaveBeenCalledTimes(2)
    expect(movementValues.mock.calls.map(([movement]) => movement.inventoryId)).toEqual(['fresh-china', 'fresh-bulk'])
    expect(movementValues.mock.calls.map(([movement]) => movement.movementType)).toEqual(['opening_balance', 'opening_balance'])
    const sourceKeys = movementValues.mock.calls.map(([movement]) => movement.sourceKey)
    expect(new Set(sourceKeys).size).toBe(2)
  })

  it.each([
    [
      'outbound reservation',
      inventory({ id: 'reserved-row', sku: 'SKU-B', productName: '상품 B', onHandQuantity: 5, reservedQuantity: 2, availableQuantity: 3 }),
      [] as Row[],
      '출고 예약 2개',
    ],
    [
      'purchase-linked quantity',
      inventory({ id: 'linked-row', sku: 'SKU-B', productName: '상품 B', onHandQuantity: 5, reservedQuantity: 0, availableQuantity: 5 }),
      [{ id: 'purchase-link', inventoryId: 'linked-row', linkedOnHand: 3 }],
      '발주 연동 재고 3개',
    ],
  ])('does not retire or replace any active rows when a full snapshot has an active %s', async (_kind, protectedInventory, linkedBalances, expectedMessage) => {
    const tx = transaction([protectedInventory], linkedBalances)
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await expect(applySaasChinaInventoryWorkbook({
      userId: workspaceUserId,
      createdBy: 'operator-a',
      rows: [excelRow({ sku: 'SKU-B', productName: '상품 B', onHandQuantity: 5 })],
      sourceLabel: '재고현황.xlsx',
      fullSnapshot: true,
    })).rejects.toThrow(expectedMessage)

    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('keeps a partial workbook update as an in-place adjustment', async () => {
    const existing = { ...inventory(), reservedQuantity: 0, availableQuantity: 10 }
    const tx = transaction([existing])
    const updateValues: Array<Record<string, unknown>> = []
    const movementValues = vi.fn().mockResolvedValue(undefined)
    tx.update.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => {
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
      throw new Error('partial update must not create a replacement inventory row')
    })
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await expect(applySaasChinaInventoryWorkbook({
      userId: workspaceUserId,
      createdBy: 'operator-a',
      rows: [excelRow({ onHandQuantity: 12 })],
      sourceLabel: '현재목록.xlsx',
    })).resolves.toEqual({ createdCount: 0, updatedCount: 1, archivedCount: 0, unchangedCount: 0 })

    expect(updateValues).toEqual([expect.objectContaining({
      onHandQuantity: 12,
      availableQuantity: 12,
      archivedAt: null,
    })])
    expect(movementValues).toHaveBeenCalledWith(expect.objectContaining({
      inventoryId,
      movementType: 'manual_adjustment',
      onHandDelta: 2,
      onHandAfter: 12,
    }))
  })
})
