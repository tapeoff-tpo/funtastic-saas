import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SQL } from 'drizzle-orm'
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
  applyChinaOutboundWorkbook,
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
let reverseInsertResults: boolean
let reverseUpdateResults: boolean

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
  const updateStatements: Array<{ table: unknown; values: Record<string, unknown>; condition: SQL }> = []
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
    updateStatements,
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
          updateStatements.push({ table, values, condition })
          const matches = matchingRows(rowsFor(table), condition)
          const changes = Object.entries(values).map(([field, value]) => {
            if (!(value instanceof SQL)) return [field, () => value] as const
            const query = dialect.sqlToQuery(value)
            const column = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
            // Evaluate the actual CASE bindings for each row, including the
            // ELSE branch, rather than assigning an opaque SQL object.
            expect(query.sql).toMatch(new RegExp(`^CASE "china_outbound_boxes"\\."id" (?:WHEN \\$\\d+ THEN \\$\\d+::numeric ?)+ ELSE "china_outbound_boxes"\\."${column}" END$`))
            expect(query.params.length % 2).toBe(0)
            const cases = new Map<string, unknown>()
            for (let index = 0; index < query.params.length; index += 2) {
              expect(typeof query.params[index]).toBe('string')
              expect(query.params[index + 1] === null || typeof query.params[index + 1] === 'string').toBe(true)
              cases.set(query.params[index] as string, query.params[index + 1])
            }
            return [field, (row: Row) => cases.has(row.id) ? cases.get(row.id) : row[field]] as const
          })
          for (const row of matches) for (const [field, value] of changes) row[field] = value(row)
          const saved = matches.map((row) => ({ ...row }))
          const result = Promise.resolve(reverseUpdateResults ? saved.reverse() : saved)
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
      values: (values: Omit<Row, 'id'> | Array<Omit<Row, 'id'>>) => {
        const rows = (Array.isArray(values) ? values : [values]).map((value) => ({ ...value, id: `new-${++insertedSequence}` } as Row))
        rowsFor(table).push(...rows)
        return { returning: async () => reverseInsertResults ? [...rows].reverse() : rows }
      },
    })),
  }
}

describe('China outbound box and pallet completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue(undefined)
    insertedSequence = 0
    reverseInsertResults = false
    reverseUpdateResults = false
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

  it.each([0, -1, 0.0001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1_000_000_000, '12'])('rejects invalid split weight %s before changing any allocations', async (weight) => {
    const original = JSON.stringify({ boxes, boxItems, items, inventory })
    await expect(saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1',
      allocations: [{ boxNo: '1', quantity: 5, grossWeightKg: 3 }, { boxNo: '2', quantity: 5, grossWeightKg: weight as number }],
    })).rejects.toThrow('총중량')
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(JSON.stringify({ boxes, boxItems, items, inventory })).toBe(original)
  })

  it('creates split boxes with optional measured weight in the allocation transaction', async () => {
    boxes = []
    boxItems = []
    const original = JSON.stringify(inventory)
    await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1',
      allocations: [{ boxNo: '1', quantity: 3, grossWeightKg: 12.345 }, { boxNo: '2', quantity: 3 }, { boxNo: '3', quantity: 3, grossWeightKg: null }, { boxNo: '4', quantity: 1, grossWeightKg: 0.001 }],
    })
    expect(boxes.map((box) => [box.boxNo, box.grossWeightKg])).toEqual([['1', '12.345'], ['2', null], ['3', null], ['4', '0.001']])
    expect(boxItems.map((allocation) => allocation.quantity)).toEqual([3, 3, 3, 1])
    expect(items[0]!.packedQuantity).toBe(10)
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(JSON.stringify(inventory)).toBe(original)
  })

  it('updates and explicitly clears weight while retaining box identity and measurements', async () => {
    Object.assign(boxes[0]!, { grossWeightKg: '8.5', note: 'SF001' })
    await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1',
      allocations: [{ existingBoxId: 'box-1', boxNo: 'CUSTOM', quantity: 5, grossWeightKg: 999_999_999 }, { boxNo: '2', quantity: 5 }],
    })
    expect(boxes[0]).toMatchObject({ id: 'box-1', boxNo: 'CUSTOM', grossWeightKg: '999999999', palletId: 'pallet-1', lengthCm: '10', widthCm: '20', heightCm: '30', note: 'SF001' })
    await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1',
      allocations: [{ boxNo: 'CUSTOM', quantity: 5, grossWeightKg: null }, { boxNo: '2', quantity: 5 }],
    })
    expect(boxes[0]).toMatchObject({ id: 'box-1', boxNo: 'CUSTOM', grossWeightKg: null, palletId: 'pallet-1', note: 'SF001' })
  })

  it('preserves shared weights when omitted even if quantity changes, and accepts an explicit measurement', async () => {
    boxes[0]!.grossWeightKg = '8.5'
    items.push({ ...items[0]!, id: 'item-2', sku: 'SKU-2', reservedQuantity: 2, packedQuantity: 2 })
    boxItems.push({ id: 'other', userId, shipmentId, boxId: 'box-1', shipmentItemId: 'item-2', quantity: 2 })
    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 4 }, { boxNo: '2', quantity: 5 }] })
    expect(boxes[0]).toMatchObject({ grossWeightKg: '8.5', completionStatus: 'in_progress' })
    expect(boxItems.find((allocation) => allocation.id === 'other')).toMatchObject({ quantity: 2 })
    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 4, grossWeightKg: 9.25 }, { boxNo: '2', quantity: 5 }] })
    expect(boxes[0]!.grossWeightKg).toBe('9.25')
    expect(boxItems.find((allocation) => allocation.id === 'other')).toMatchObject({ quantity: 2 })
  })

  it('keeps completion when only weight changes and skips identical stored weight updates', async () => {
    boxes[0]!.grossWeightKg = '8.500'
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((callback) => callback(tx))
    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 5, grossWeightKg: 8.5 }, { boxNo: '2', quantity: 5 }] })
    expect(tx.update).not.toHaveBeenCalledWith(chinaOutboundBoxes)
    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 5, grossWeightKg: 9 }, { boxNo: '2', quantity: 5 }] })
    expect(boxes[0]).toMatchObject({ grossWeightKg: '9', completionStatus: 'completed' })
    expect(pallets[0]!.completionStatus).toBe('completed')
  })

  it.each([[3, 4], [null, 4], [3, null]] as const)('rejects duplicate box weights %s and %s before the transaction', async (first, second) => {
    const original = JSON.stringify({ boxes, boxItems })
    await expect(saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 5, grossWeightKg: first }, { boxNo: ' 1 ', quantity: 5, grossWeightKg: second }] })).rejects.toThrow('서로 다른 총중량')
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(JSON.stringify({ boxes, boxItems })).toBe(original)
  })

  it.each([3, null])('merges duplicate box quantities with consistent explicit weight %s', async (weight) => {
    boxes[0]!.grossWeightKg = '8.5'
    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 3 }, { boxNo: '1', quantity: 3, grossWeightKg: weight }, { boxNo: '1', quantity: 4, grossWeightKg: weight }] })
    expect(boxes[0]!.grossWeightKg).toBe(weight === null ? null : '3')
    expect(boxItems).toHaveLength(1)
    expect(boxItems[0]).toMatchObject({ boxId: 'box-1', quantity: 10 })
  })

  it('rejects conflicting weights for the same existing box even when renamed differently', async () => {
    await expect(saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ existingBoxId: 'box-1', boxNo: 'A', quantity: 5, grossWeightKg: 3 }, { existingBoxId: 'box-1', boxNo: 'B', quantity: 5, grossWeightKg: 4 }] })).rejects.toThrow('서로 다른 총중량')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('validates shared workbook weights across products before applying any product', async () => {
    const original = JSON.stringify({ boxes, boxItems, items })
    await expect(applyChinaOutboundWorkbook({ userId, shipmentId, boxSplits: [
      { shipmentItemId: 'item-1', allocations: [{ boxNo: 'SHARED', quantity: 10, grossWeightKg: 12 }] },
      { shipmentItemId: 'item-2', allocations: [{ boxNo: 'SHARED', quantity: 2, grossWeightKg: null }] },
    ], palletAssignments: [] })).rejects.toThrow('서로 다른 총중량')
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(JSON.stringify({ boxes, boxItems, items })).toBe(original)
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

  it.each([50, 1201])('saves %i new boxes in bounded database batches without changing inventory', async (count) => {
    boxes = []
    boxItems = []
    pallets = []
    const allocations = Array.from({ length: count }, (_, index) => ({
      boxNo: `BOX-${index + 1}`, quantity: index + 1, lengthCm: 10, widthCm: 20, heightCm: 30,
    }))
    items[0]!.reservedQuantity = allocations.reduce((total, allocation) => total + allocation.quantity, 0)
    const balances = JSON.stringify(inventory)
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((operation) => operation(tx))
    // SQL RETURNING order must not decide which quantity belongs to a box.
    reverseInsertResults = true

    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations, boxSplitStatus: 'completed' })

    expect(boxes).toHaveLength(count)
    expect(boxItems).toHaveLength(count)
    const boxById = new Map(boxes.map((box) => [box.id, box]))
    for (const allocation of boxItems) {
      expect(boxById.get(allocation.boxId as string)).toMatchObject({
        boxNo: `BOX-${allocation.quantity}`, sortOrder: Number(allocation.quantity) - 1,
        lengthCm: '10', widthCm: '20', heightCm: '30',
      })
    }
    expect(tx.insert.mock.calls.filter(([table]) => table === chinaOutboundBoxes)).toHaveLength(Math.ceil(count / 500))
    expect(tx.insert.mock.calls.filter(([table]) => table === chinaOutboundBoxItems)).toHaveLength(Math.ceil(count / 500))
    expect(items[0]).toMatchObject({ packedQuantity: items[0]!.reservedQuantity, boxSplitStatus: 'completed' })
    expect(JSON.stringify(inventory)).toBe(balances)
    expect(movements).toHaveLength(0)
  })

  it.each([50, 1201, 1500])('batches mixed measurements for %i existing boxes without rewriting allocations', async (count) => {
    boxes = Array.from({ length: count }, (_, index) => ({
      id: `existing-${index}`, userId, shipmentId, boxNo: `BOX-${index}`, palletId: 'pallet-1', status: 'open', completionStatus: 'completed',
      lengthCm: '10', widthCm: '20', heightCm: '30', grossWeightKg: '5', note: `tracking-${index}`, sortOrder: index,
    }))
    boxItems = boxes.flatMap((box, index) => [
      { id: `allocation-${index}`, userId, shipmentId, boxId: box.id, shipmentItemId: 'item-1', quantity: 1 },
      ...(index % 5 === 0 ? [{ id: `shared-${index}`, userId, shipmentId, boxId: box.id, shipmentItemId: 'item-2', quantity: 2 }] : []),
    ])
    Object.assign(items[0]!, { reservedQuantity: count, packedQuantity: count })
    const originalAllocations = JSON.stringify(boxItems)
    const originalInventory = JSON.stringify(inventory)
    const foreign = { ...boxes[0]!, id: 'foreign', userId: 'another-owner', shipmentId: 'another-shipment' }
    boxes.push(foreign)
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((operation) => operation(tx))
    reverseUpdateResults = true
    const allocations = Array.from({ length: count }, (_, index) => ({
      boxNo: `BOX-${index}`, quantity: 1,
      ...(index % 5 === 0 ? { lengthCm: 5, widthCm: 5, heightCm: 5, grossWeightKg: null }
        : index % 5 === 1 ? { lengthCm: index + 20, widthCm: 25, heightCm: 35, grossWeightKg: index + 10 }
          : index % 5 === 2 ? { grossWeightKg: index + 10 }
            : index % 5 === 3 ? { lengthCm: index + 20, widthCm: 25, heightCm: 35 }
              : { lengthCm: index + 20, widthCm: 25, heightCm: 35, grossWeightKg: null }),
    }))
    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations })

    const batches = tx.updateStatements.filter(({ values }) => values.lengthCm instanceof SQL)
    expect(batches).toHaveLength(Math.ceil(count / 500))
    for (const batch of batches) {
      const query = dialect.sqlToQuery(batch.condition)
      expect(query.sql).toContain('"user_id" =')
      expect(query.sql).toContain('"shipment_id" =')
      expect(query.params.slice(0, 2)).toEqual([userId, shipmentId])
      expect(query.params.length - 2).toBeLessThanOrEqual(500)
    }
    // One batch per 500 measurements, one completion update, one pallet update.
    expect(tx.update).toHaveBeenCalledTimes(Math.ceil(count / 500) + 2)
    expect(tx.delete).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalledWith(chinaOutboundShipmentItems)
    expect(JSON.stringify(boxItems)).toBe(originalAllocations)
    expect(JSON.stringify(inventory)).toBe(originalInventory)
    expect(boxes.at(-1)).toEqual(foreign)
    for (let index = 0; index < count; index += 1) {
      const row = boxes[index]!
      expect(row).toMatchObject({ id: `existing-${index}`, boxNo: `BOX-${index}`, palletId: 'pallet-1', note: `tracking-${index}`, sortOrder: index })
      expect([row.lengthCm, row.widthCm, row.heightCm]).toEqual(index % 5 === 0 || index % 5 === 2 ? ['10', '20', '30'] : [String(index + 20), '25', '35'])
      expect(row.grossWeightKg).toBe(index % 5 === 0 || index % 5 === 4 ? null : index % 5 === 3 ? '5' : String(index + 10))
      expect(row.completionStatus).toBe(index % 5 === 0 || index % 5 === 2 ? 'completed' : 'in_progress')
    }
  })

  it.each([undefined, 9, null])('keeps allocation IDs and item timestamps on no-op or weight-only saves (%s)', async (weight) => {
    boxes[0]!.grossWeightKg = '8.5'
    items[0]!.updatedAt = 'unchanged-item-time'
    const originalAllocations = JSON.stringify(boxItems)
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((operation) => operation(tx))
    await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1', allocations: [
        { boxNo: '1', quantity: 5, ...(weight !== undefined ? { grossWeightKg: weight } : {}) },
        { boxNo: '2', quantity: 5 },
      ],
    })
    expect(JSON.stringify(boxItems)).toBe(originalAllocations)
    expect(items[0]!.updatedAt).toBe('unchanged-item-time')
    expect(tx.delete).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).toHaveBeenCalledTimes(weight === undefined ? 0 : 1)
    expect(boxes[0]).toMatchObject({ grossWeightKg: weight === undefined ? '8.5' : weight === null ? null : '9', completionStatus: 'completed' })
    expect(pallets[0]!.completionStatus).toBe('completed')
  })

  it('skips identical dimension writes and preserves completion and other products in a shared box', async () => {
    items.push({ ...items[0]!, id: 'item-2', sku: 'SKU-2', reservedQuantity: 2, packedQuantity: 2 })
    boxItems.push({ id: 'other-allocation', userId, shipmentId, boxId: 'box-1', shipmentItemId: 'item-2', quantity: 2 })
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((operation) => operation(tx))

    await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1',
      allocations: [{ boxNo: '1', quantity: 5, lengthCm: 10, widthCm: 20, heightCm: 30 }, { boxNo: '2', quantity: 5 }],
    })

    expect(tx.update).not.toHaveBeenCalledWith(chinaOutboundBoxes)
    expect(boxItems.find((row) => row.id === 'other-allocation')).toMatchObject({ boxId: 'box-1', shipmentItemId: 'item-2', quantity: 2 })
    expect(boxes.slice(0, 2).map((box) => box.completionStatus)).toEqual(['completed', 'completed'])
    expect(pallets.map((pallet) => pallet.completionStatus)).toEqual(['completed', 'completed'])
  })

  it('reuses newly batched boxes across workbook products before assigning their pallet', async () => {
    boxes = []
    boxItems = []
    pallets = []
    items[0]!.reservedQuantity = 5
    items.push({ ...items[0]!, id: 'item-2', sku: 'SKU-2', reservedQuantity: 7, packedQuantity: 0 })
    reverseInsertResults = true
    const balances = JSON.stringify(inventory)

    await applyChinaOutboundWorkbook({
      userId, shipmentId,
      boxSplits: [
        { shipmentItemId: 'item-1', allocations: [{ boxNo: 'MIXED', quantity: 5, lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 12.345 }] },
        { shipmentItemId: 'item-2', allocations: [{ boxNo: 'MIXED', quantity: 7, lengthCm: 5, widthCm: 5, heightCm: 5 }] },
      ],
      palletAssignments: [{ boxNo: 'MIXED', palletNo: 'P1' }],
    })

    expect(boxes).toHaveLength(1)
    expect(boxItems.map((row) => [row.boxId, row.shipmentItemId, row.quantity])).toEqual([
      [boxes[0]!.id, 'item-1', 5], [boxes[0]!.id, 'item-2', 7],
    ])
    expect(boxes[0]).toMatchObject({ boxNo: 'MIXED', lengthCm: '10', widthCm: '20', heightCm: '30', grossWeightKg: '12.345', palletId: pallets[0]!.id })
    expect(items.map((item) => item.packedQuantity)).toEqual([5, 7])
    expect(JSON.stringify(inventory)).toBe(balances)
    expect(movements).toHaveLength(0)
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
