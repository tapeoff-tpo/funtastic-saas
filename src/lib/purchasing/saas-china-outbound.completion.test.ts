import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  chinaOutboundBoxItems,
  chinaOutboundBoxes,
  chinaOutboundPallets,
  chinaOutboundShipmentItems,
  chinaOutboundShipments,
  saasChinaInventory,
  saasChinaInventoryMovements,
  saasChinaShipmentPurchaseAllocations,
} from '@/lib/db/schema'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))

import {
  mergeChinaOutboundBoxes,
  saveChinaOutboundPackageWeight,
  saveChinaOutboundItemChineseName,
  assignChinaOutboundBoxesToPallets,
  dispatchChinaOutboundShipment,
  markChinaOutboundShipmentReady,
  saveChinaOutboundBoxCompletionStatuses,
  saveChinaOutboundBoxDimensions,
  saveChinaOutboundItemBoxSplits,
  saveChinaOutboundPalletCompletionStatuses,
} from './saas-china-outbound'

type Row = { id: string; userId: string; [key: string]: unknown }
const dialect = new PgDialect()
const userId = 'workspace-a'
const shipmentId = 'shipment-a'
let shipments: Row[]
let items: Row[]
let boxes: Row[]
let boxItems: Row[]
let pallets: Row[]
let inventory: Row[]
let movements: Row[]
let insertedSequence: number

function matchingRows(rows: Row[], condition: SQL) {
  const query = dialect.sqlToQuery(condition)
  const fields: Array<[string, string]> = [
    ['user_id', 'userId'], ['shipment_id', 'shipmentId'], ['shipment_item_id', 'shipmentItemId'], ['pallet_id', 'palletId'], ['box_id', 'boxId'], ['id', 'id'],
  ]
  return rows.filter((row) => fields.every(([column, field]) => (
    !new RegExp(`"${column}"\\s+(?:in|=)`, 'i').test(query.sql) || query.params.includes(row[field])
  )))
}

function makeTransaction() {
  function rowsFor(table: unknown) {
    if (table === chinaOutboundShipments) return shipments
    if (table === chinaOutboundShipmentItems) return items
    if (table === chinaOutboundBoxes) return boxes
    if (table === chinaOutboundBoxItems) return boxItems
    if (table === chinaOutboundPallets) return pallets
    if (table === saasChinaInventory) return inventory
    if (table === saasChinaInventoryMovements) return movements
    if (table === saasChinaShipmentPurchaseAllocations) return []
    throw new Error('Unexpected table')
  }
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockImplementation(() => ({
      from: (table: unknown) => ({
        where: (condition: SQL) => {
          const result = Promise.resolve(matchingRows(rowsFor(table), condition).map((row) => ({ ...row })))
          return Object.assign(result, {
            orderBy: () => result,
            limit: async (count: number) => (await result).slice(0, count),
          })
        },
      }),
    })),
    update: vi.fn().mockImplementation((table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: SQL) => {
          const matches = matchingRows(rowsFor(table), condition)
          for (const row of matches) Object.assign(row, values)
          const result = Promise.resolve(matches.map((row) => ({ ...row })))
          return Object.assign(result, { returning: async () => result })
        },
      }),
    })),
    delete: vi.fn().mockImplementation((table: unknown) => ({
      where: async (condition: SQL) => {
        const rows = rowsFor(table)
        const matches = new Set(matchingRows(rows, condition))
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (matches.has(rows[index]!)) rows.splice(index, 1)
        }
      },
    })),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: (values: Omit<Row, 'id'>) => {
        const row = { ...values, id: `new-${++insertedSequence}` } as Row
        rowsFor(table).push(row)
        return { returning: async () => [row] }
      },
    })),
  }
}

describe('China outbound box and pallet completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue(undefined)
    insertedSequence = 0
    mocks.transaction.mockImplementation((callback) => callback(makeTransaction()))
    shipments = [{ id: shipmentId, userId, status: 'packing' }]
    items = [{ id: 'item-1', userId, shipmentId, inventoryId: 'inventory-1', sku: 'SKU-1', reservedQuantity: 10, packedQuantity: 10, boxSplitStatus: 'completed' }]
    inventory = [{ id: 'inventory-1', userId, onHandQuantity: 20, reservedQuantity: 10, availableQuantity: 10 }]
    movements = []
    pallets = [
      { id: 'pallet-1', userId, shipmentId, palletNo: 'P1', completionStatus: 'completed' },
      { id: 'pallet-2', userId, shipmentId, palletNo: 'P2', completionStatus: 'completed' },
    ]
    boxes = [
      { id: 'box-1', userId, shipmentId, boxNo: '1', palletId: 'pallet-1', status: 'open', completionStatus: 'completed', lengthCm: '10', widthCm: '20', heightCm: '30' },
      { id: 'box-2', userId, shipmentId, boxNo: '2', palletId: 'pallet-2', status: 'open', completionStatus: 'completed', lengthCm: null, widthCm: null, heightCm: null },
      { id: 'empty', userId, shipmentId, boxNo: '3', palletId: null, status: 'open', completionStatus: 'in_progress', lengthCm: null, widthCm: null, heightCm: null },
    ]
    boxItems = [
      { id: 'allocation-1', userId, shipmentId, boxId: 'box-1', shipmentItemId: 'item-1', quantity: 5 },
      { id: 'allocation-2', userId, shipmentId, boxId: 'box-2', shipmentItemId: 'item-1', quantity: 5 },
    ]
  })

  it('merges mixed contents into the real largest box without changing stock or per-item totals', async () => {
    boxes[1] = { ...boxes[1]!, lengthCm: '50', widthCm: '40', heightCm: '30', grossWeightKg: '7' }
    boxes[0]!.grossWeightKg = '3'
    items.push({ ...items[0]!, id: 'item-2', sku: 'SKU-2', reservedQuantity: 2, packedQuantity: 2 })
    boxItems.push({ id: 'extra', userId, shipmentId, boxId: 'box-1', shipmentItemId: 'item-2', quantity: 2 })
    const balances = JSON.stringify(inventory)
    const target = await mergeChinaOutboundBoxes({ userId, shipmentId, boxIds: ['box-1', 'box-2'] })
    expect(target.id).toBe('box-2')
    expect(boxItems.map((row) => [row.boxId, row.shipmentItemId, row.quantity])).toEqual([['box-2', 'item-1', 10], ['box-2', 'item-2', 2]])
    expect(boxes[1]).toMatchObject({ lengthCm: '50', widthCm: '40', heightCm: '30', grossWeightKg: null })
    expect(boxes[0]).toMatchObject({ palletId: null, grossWeightKg: null })
    expect(JSON.stringify(inventory)).toBe(balances); expect(items.map((item) => item.packedQuantity)).toEqual([10, 2])
    await mergeChinaOutboundBoxes({ userId, shipmentId, boxIds: ['box-1', 'box-2'] })
    expect(boxItems).toHaveLength(2); expect(movements).toHaveLength(0)
  })

  it('rejects sealed, foreign, and closed box merges before moving any allocation', async () => {
    const original = JSON.stringify(boxItems)
    boxes[0]!.status = 'sealed'
    await expect(mergeChinaOutboundBoxes({ userId, shipmentId, boxIds: ['box-1', 'box-2'] })).rejects.toThrow('수정 가능한')
    boxes[0]!.status = 'open'
    await expect(mergeChinaOutboundBoxes({ userId, shipmentId, boxIds: ['box-1', 'foreign'] })).rejects.toThrow('수정 가능한')
    shipments[0]!.status = 'dispatched'
    await expect(mergeChinaOutboundBoxes({ userId, shipmentId, boxIds: ['box-1', 'box-2'] })).rejects.toThrow('초안 또는 포장중')
    expect(JSON.stringify(boxItems)).toBe(original)
  })

  it('keeps the larger physical dimensions when another SKU enters a shared box', async () => {
    items.push({ ...items[0]!, id: 'item-2', sku: 'SKU-2', reservedQuantity: 2, packedQuantity: 0 })
    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-2', allocations: [{ boxNo: '1', quantity: 2, lengthCm: 5, widthCm: 5, heightCm: 5 }] })
    expect(boxes[0]).toMatchObject({ lengthCm: '10', widthCm: '20', heightCm: '30' })
    expect(boxItems.filter((row) => row.boxId === 'box-1').map((row) => row.quantity)).toEqual([5, 2])
  })

  it.each(['box', 'pallet'] as const)('saves %s gross weight without touching quantities and guards other workspaces', async (kind) => {
    const packageId = kind === 'box' ? 'box-1' : 'pallet-1'
    const original = JSON.stringify(inventory)
    await saveChinaOutboundPackageWeight({ userId, shipmentId, packageId, kind, grossWeightKg: 12.345 })
    expect((kind === 'box' ? boxes : pallets)[0]!.grossWeightKg).toBe('12.345')
    expect(JSON.stringify(inventory)).toBe(original)
    await expect(saveChinaOutboundPackageWeight({ userId: 'foreign', shipmentId, packageId, kind, grossWeightKg: 3 })).rejects.toThrow('찾을 수 없습니다')
    await expect(saveChinaOutboundPackageWeight({ userId, shipmentId, packageId, kind, grossWeightKg: -1 })).rejects.toThrow('0보다')
  })

  it('stores a Chinese name only on the requested outbound item', async () => {
    await saveChinaOutboundItemChineseName({ userId, shipmentId, shipmentItemId: 'item-1', chineseProductName: '水杯' })
    expect(items[0]!.chineseProductName).toBe('水杯')
    await expect(saveChinaOutboundItemChineseName({ userId: 'foreign', shipmentId, shipmentItemId: 'item-1', chineseProductName: '别的' })).rejects.toThrow('찾을 수 없습니다')
    expect(items[0]!.chineseProductName).toBe('水杯')
  })

  it.each([false, true])('dispatches loose boxes with mixed pallet loading = %s and deducts once', async (mixed) => {
    boxes[0]!.palletId = null
    if (!mixed) boxes[1]!.palletId = null
    await dispatchChinaOutboundShipment({ userId, shipmentId, createdBy: 'admin' })
    expect(inventory[0]).toMatchObject({ onHandQuantity: 10, reservedQuantity: 0 })
    expect(movements).toHaveLength(1)
    await expect(dispatchChinaOutboundShipment({ userId, shipmentId, createdBy: 'admin' })).rejects.toThrow('이미 출고완료')
    expect(movements).toHaveLength(1)
  })

  it('changes only selected boxes and reopens their assigned pallets', async () => {
    await saveChinaOutboundBoxCompletionStatuses({ userId, shipmentId, updates: [{ boxId: 'box-1', status: 'in_progress' }] })
    expect(boxes[0]).toMatchObject({ completionStatus: 'in_progress' })
    expect(boxes[1]).toMatchObject({ completionStatus: 'completed' })
    expect(pallets[0]).toMatchObject({ completionStatus: 'in_progress' })
    expect(pallets[1]).toMatchObject({ completionStatus: 'completed' })
  })

  it('validates an entire box batch before changing any status', async () => {
    await expect(saveChinaOutboundBoxCompletionStatuses({
      userId, shipmentId,
      updates: [{ boxId: 'box-1', status: 'in_progress' }, { boxId: 'empty', status: 'completed' }],
    })).rejects.toThrow(/상품이 없어/)
    expect(boxes[0]).toMatchObject({ completionStatus: 'completed' })
    expect(pallets[0]).toMatchObject({ completionStatus: 'completed' })
  })

  it('rejects a box from a different workspace or shipment', async () => {
    boxes.push({ id: 'foreign', userId: 'workspace-b', shipmentId: 'shipment-b', boxNo: '9', palletId: null, status: 'open', completionStatus: 'in_progress' })
    await expect(saveChinaOutboundBoxCompletionStatuses({ userId, shipmentId, updates: [{ boxId: 'foreign', status: 'completed' }] })).rejects.toThrow(/박스를 찾을 수 없습니다/)
    expect(boxes.at(-1)).toMatchObject({ completionStatus: 'in_progress' })
  })

  it('allows recording a used pallet without legacy box completion flags', async () => {
    pallets[0]!.completionStatus = 'in_progress'
    boxes[0]!.completionStatus = 'in_progress'
    await saveChinaOutboundPalletCompletionStatuses({ userId, shipmentId, updates: [{ palletId: 'pallet-1', status: 'completed' }] })
    expect(pallets[0]).toMatchObject({ completionStatus: 'completed' })
  })

  it('rejects completion of an empty pallet without changing another selected pallet', async () => {
    pallets.push({ id: 'unused-pallet', userId, shipmentId, palletNo: 'P3', completionStatus: 'in_progress' })
    await expect(saveChinaOutboundPalletCompletionStatuses({
      userId, shipmentId,
      updates: [{ palletId: 'pallet-1', status: 'in_progress' }, { palletId: 'unused-pallet', status: 'completed' }],
    })).rejects.toThrow(/적재된 박스가 없어/)
    expect(pallets[0]).toMatchObject({ completionStatus: 'completed' })
  })

  it('allows legacy null statuses and ignores empty entities when marking ready', async () => {
    boxes[0]!.completionStatus = null
    boxes[1]!.completionStatus = null
    pallets[0]!.completionStatus = null
    pallets[1]!.completionStatus = null
    pallets.push({ id: 'unused-pallet', userId, shipmentId, palletNo: 'P3', completionStatus: 'in_progress' })
    await markChinaOutboundShipmentReady({ userId, shipmentId })
    expect(shipments[0]).toMatchObject({ status: 'ready' })
  })

  it('checks actual allocations rather than legacy completion flags', async () => {
    boxes[0]!.completionStatus = 'in_progress'
    pallets[0]!.completionStatus = 'in_progress'
    items[0]!.boxSplitStatus = 'in_progress'
    await markChinaOutboundShipmentReady({ userId, shipmentId })
    expect(shipments[0]).toMatchObject({ status: 'ready' })
    shipments[0]!.status = 'packing'
    boxItems[0]!.quantity = 4
    await expect(markChinaOutboundShipmentReady({ userId, shipmentId })).rejects.toThrow(/실제 박스 수량/)
  })

  it('reopens a box and its pallet only when its physical dimensions change', async () => {
    await saveChinaOutboundBoxDimensions({ userId, shipmentId, boxId: 'box-1', lengthCm: 10, widthCm: 20, heightCm: 30 })
    expect(boxes[0]).toMatchObject({ completionStatus: 'completed' })
    expect(pallets[0]).toMatchObject({ completionStatus: 'completed' })
    await saveChinaOutboundBoxDimensions({ userId, shipmentId, boxId: 'box-1', lengthCm: 11, widthCm: 20, heightCm: 30 })
    expect(boxes[0]).toMatchObject({ completionStatus: 'in_progress' })
    expect(pallets[0]).toMatchObject({ completionStatus: 'in_progress' })
  })

  it('dispatches directly from packing once and validates physical quantities before deducting stock', async () => {
    boxes[0]!.completionStatus = 'in_progress'
    items[0]!.boxSplitStatus = 'in_progress'
    boxItems[0]!.quantity = 4
    await expect(dispatchChinaOutboundShipment({ userId, shipmentId, createdBy: 'admin' })).rejects.toThrow(/실제 박스 수량/)
    expect(inventory[0]).toMatchObject({ onHandQuantity: 20, reservedQuantity: 10 })
    expect(movements).toHaveLength(0)
    boxItems[0]!.quantity = 5
    await dispatchChinaOutboundShipment({ userId, shipmentId, createdBy: 'admin' })
    expect(shipments[0]).toMatchObject({ status: 'dispatched' })
    expect(inventory[0]).toMatchObject({ onHandQuantity: 10, reservedQuantity: 0, availableQuantity: 10 })
    expect(movements).toHaveLength(1)
    await expect(dispatchChinaOutboundShipment({ userId, shipmentId, createdBy: 'admin' })).rejects.toThrow(/이미 출고완료/)
    expect(movements).toHaveLength(1)
  })

  it('reopens only affected boxes and pallets when a product split quantity changes', async () => {
    await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1', boxSplitStatus: 'in_progress',
      allocations: [{ boxNo: '1', quantity: 4 }, { boxNo: '2', quantity: 5 }],
    })
    expect(boxItems.map(({ boxId, quantity }) => ({ boxId, quantity }))).toEqual([
      { boxId: 'box-1', quantity: 4 }, { boxId: 'box-2', quantity: 5 },
    ])
    expect(boxes[0]).toMatchObject({ completionStatus: 'in_progress' })
    expect(pallets[0]).toMatchObject({ completionStatus: 'in_progress' })
    expect(boxes[1]).toMatchObject({ completionStatus: 'completed' })
    expect(pallets[1]).toMatchObject({ completionStatus: 'completed' })
  })

  it('preserves completed boxes and pallets when only the product status changes', async () => {
    await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1', boxSplitStatus: 'in_progress',
      allocations: [{ boxNo: '1', quantity: 5 }, { boxNo: '2', quantity: 5 }],
    })
    expect(items[0]).toMatchObject({ boxSplitStatus: 'in_progress', packedQuantity: 10 })
    expect(boxes.slice(0, 2).map((box) => box.completionStatus)).toEqual(['completed', 'completed'])
    expect(pallets.map((pallet) => pallet.completionStatus)).toEqual(['completed', 'completed'])
  })

  it('renumbers an exclusive box without losing its measurements or pallet', async () => {
    Object.assign(boxes[0]!, { grossWeightKg: '8.5', note: 'SF001' })
    await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1',
      allocations: [{ existingBoxId: 'box-1', boxNo: 'CUSTOM-7', quantity: 5 }, { boxNo: '2', quantity: 5 }],
    })
    expect(boxes[0]).toMatchObject({ id: 'box-1', boxNo: 'CUSTOM-7', palletId: 'pallet-1', lengthCm: '10', widthCm: '20', heightCm: '30', grossWeightKg: '8.5', note: 'SF001' })
    expect(boxItems.find((row) => row.boxId === 'box-1')).toMatchObject({ quantity: 5 })
  })

  it('rejects an automatic number occupied by another product instead of merging boxes', async () => {
    boxItems.push({ id: 'other-allocation', userId, shipmentId, boxId: 'empty', shipmentItemId: 'other-item', quantity: 2 })
    await expect(saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '3', quantity: 10, autoNumber: true }],
    })).rejects.toThrow(/자동/)
    expect(boxItems.find((row) => row.id === 'other-allocation')).toMatchObject({ quantity: 2 })
  })

  it('rejects renaming a shared box or another item’s box', async () => {
    boxItems.push({ id: 'other-allocation', userId, shipmentId, boxId: 'box-1', shipmentItemId: 'other-item', quantity: 2 })
    await expect(saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ existingBoxId: 'box-1', boxNo: 'CUSTOM', quantity: 10 }],
    })).rejects.toThrow(/혼합박스/)
    await expect(saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ existingBoxId: 'empty', boxNo: 'CUSTOM', quantity: 10 }],
    })).rejects.toThrow()
    expect(boxes[0]).toMatchObject({ boxNo: '1' })
  })

  it('reopens both old and new pallets when a box is reassigned', async () => {
    await assignChinaOutboundBoxesToPallets({ userId, shipmentId, assignments: [{ boxNo: '1', palletNo: 'P2' }] })
    expect(boxes[0]).toMatchObject({ palletId: 'pallet-2' })
    expect(pallets[0]).toMatchObject({ completionStatus: 'in_progress' })
    expect(pallets[1]).toMatchObject({ completionStatus: 'in_progress' })
  })
})
