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
  saveChinaOutboundBoxesMeasurements,
  saveChinaOutboundItemBoxSplits,
  saveChinaOutboundPalletCompletionStatuses,
  saveChinaOutboundPalletTareWeight,
  saveChinaOutboundPalletDimensions,
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
            const tableName = table === chinaOutboundBoxItems ? 'china_outbound_box_items' : 'china_outbound_boxes'
            expect(query.sql).toMatch(new RegExp(`^CASE "${tableName}"\\."id" (?:WHEN \\$\\d+ THEN \\$\\d+::numeric ?)+ ELSE "${tableName}"\\."${column}" END$`))
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

  it.each([0, 5, 7.125])('saves pallet tare %s without changing physical dimensions, legacy gross, or inventory', async (weight) => {
    Object.assign(pallets[0]!, { tareWeightKg: '5', grossWeightKg: '99', lengthCm: '120', widthCm: '100', heightCm: '150' })
    const balances = JSON.stringify(inventory)
    await saveChinaOutboundPalletTareWeight({ userId, shipmentId, palletId: 'pallet-1', tareWeightKg: weight })
    expect(pallets[0]).toMatchObject({ tareWeightKg: String(weight), grossWeightKg: '99', lengthCm: '120', widthCm: '100', heightCm: '150' })
    expect(JSON.stringify(inventory)).toBe(balances)
    expect(movements).toHaveLength(0)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000, '5'])('rejects invalid pallet tare %s before writes', async (weight) => {
    const original = JSON.stringify(pallets)
    await expect(saveChinaOutboundPalletTareWeight({ userId, shipmentId, palletId: 'pallet-1', tareWeightKg: weight as number })).rejects.toThrow('파렛트 무게')
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(JSON.stringify(pallets)).toBe(original)
  })

  it('scopes tare edits to this workspace and an editable shipment', async () => {
    await expect(saveChinaOutboundPalletTareWeight({ userId: 'other', shipmentId, palletId: 'pallet-1', tareWeightKg: 6 })).rejects.toThrow('찾을 수 없습니다')
    await expect(saveChinaOutboundPalletTareWeight({ userId, shipmentId, palletId: 'other', tareWeightKg: 6 })).rejects.toThrow('찾을 수 없습니다')
    shipments[0]!.status = 'dispatched'
    await expect(saveChinaOutboundPalletTareWeight({ userId, shipmentId, palletId: 'pallet-1', tareWeightKg: 6 })).rejects.toThrow('초안 또는 포장중')
  })

  it('skips rewriting unchanged pallet tare', async () => {
    pallets[0]!.tareWeightKg = '5.000'
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((callback) => callback(tx))
    await saveChinaOutboundPalletTareWeight({ userId, shipmentId, palletId: 'pallet-1', tareWeightKg: 5 })
    expect(tx.update).not.toHaveBeenCalled()
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
    expect(boxes[1]).toMatchObject({ lengthCm: '50', widthCm: '40', heightCm: '30', grossWeightKg: '10' })
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
    expect(boxes[0]!.grossWeightKg).toBeNull()
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

  it('sums different per-product workbook weights and leaves an incomplete mixed weight blank', async () => {
    items.push({ ...items[0]!, id: 'item-2', sku: 'SKU-2', reservedQuantity: 2, packedQuantity: 0 })
    const workbook = { userId, shipmentId, boxSplits: [
      { shipmentItemId: 'item-1', allocations: [{ boxNo: 'SHARED', quantity: 10, grossWeightKg: 12.0004 }] },
      { shipmentItemId: 'item-2', allocations: [{ boxNo: 'SHARED', quantity: 2, grossWeightKg: 3.0004 as number | null }] },
    ], palletAssignments: [] }
    await applyChinaOutboundWorkbook(workbook)
    expect(boxes.find((box) => box.boxNo === 'SHARED')!.grossWeightKg).toBe('15')
    await applyChinaOutboundWorkbook(workbook)
    expect(boxes.find((box) => box.boxNo === 'SHARED')!.grossWeightKg).toBe('15')
    workbook.boxSplits[1]!.allocations[0]!.grossWeightKg = null
    await applyChinaOutboundWorkbook(workbook)
    expect(boxes.find((box) => box.boxNo === 'SHARED')!.grossWeightKg).toBeNull()
  })

  it('stores a Chinese name only on the requested outbound item', async () => {
    await saveChinaOutboundItemChineseName({ userId, shipmentId, shipmentItemId: 'item-1', chineseProductName: '水杯' })
    expect(items[0]!.chineseProductName).toBe('水杯')
    await expect(saveChinaOutboundItemChineseName({ userId: 'foreign', shipmentId, shipmentItemId: 'item-1', chineseProductName: '别的' })).rejects.toThrow('찾을 수 없습니다')
    expect(items[0]!.chineseProductName).toBe('水杯')
  })

  it('applies selected physical measurements together without changing product measurements or quantities', async () => {
    Object.assign(boxItems[0]!, { grossWeightKg: '3', lengthCm: '10', widthCm: '20', heightCm: '30' })
    const originalAllocations = JSON.stringify(boxItems)
    const originalInventory = JSON.stringify(inventory)
    const result = await saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: ['box-1', 'box-2', 'box-1'], lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 12.345 })
    expect(result).toEqual({ updatedBoxCount: 2 })
    expect(boxes.slice(0, 2).map(({ lengthCm, widthCm, heightCm, grossWeightKg, completionStatus }) => ({ lengthCm, widthCm, heightCm, grossWeightKg, completionStatus }))).toEqual([
      { lengthCm: '50', widthCm: '40', heightCm: '30', grossWeightKg: '12.345', completionStatus: 'in_progress' },
      { lengthCm: '50', widthCm: '40', heightCm: '30', grossWeightKg: '12.345', completionStatus: 'in_progress' },
    ])
    expect(pallets.map((row) => row.completionStatus)).toEqual(['in_progress', 'in_progress'])
    expect(JSON.stringify(boxItems)).toBe(originalAllocations)
    expect(JSON.stringify(inventory)).toBe(originalInventory)
    expect(boxes[2]).not.toHaveProperty('grossWeightKg')
  })

  it('preserves weight on dimension-only application and dimensions on weight-only application', async () => {
    boxes[0]!.grossWeightKg = '9'
    await saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: ['box-1'], lengthCm: 60, widthCm: 50, heightCm: 40 })
    expect(boxes[0]).toMatchObject({ lengthCm: '60', widthCm: '50', heightCm: '40', grossWeightKg: '9' })
    boxes[0]!.completionStatus = 'completed'; pallets[0]!.completionStatus = 'completed'
    await saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: ['box-1'], grossWeightKg: 7.125 })
    expect(boxes[0]).toMatchObject({ lengthCm: '60', widthCm: '50', heightCm: '40', grossWeightKg: '7.125', completionStatus: 'completed' })
    expect(pallets[0]!.completionStatus).toBe('completed')
    const tx = makeTransaction(); mocks.transaction.mockImplementation((operation) => operation(tx))
    await saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: ['box-1'], grossWeightKg: 7.125 })
    expect(tx.update).not.toHaveBeenCalled()
  })

  it.each(['sealed', 'foreign', 'missing', 'closed'])('validates the complete bulk selection before writes (%s)', async (invalid) => {
    const tx = makeTransaction(); mocks.transaction.mockImplementation((operation) => operation(tx))
    if (invalid === 'sealed') boxes[1]!.status = 'sealed'
    if (invalid === 'foreign') boxes[1]!.userId = 'another-workspace'
    if (invalid === 'closed') shipments[0]!.status = 'dispatched'
    const before = JSON.stringify({ boxes, boxItems, pallets })
    await expect(saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: ['box-1', invalid === 'missing' ? 'missing' : 'box-2'], lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 10 })).rejects.toThrow()
    expect(tx.update).not.toHaveBeenCalled()
    expect(JSON.stringify({ boxes, boxItems, pallets })).toBe(before)
  })

  it.each([
    {}, { lengthCm: 10 }, { lengthCm: 10, widthCm: 20 }, { lengthCm: 0, widthCm: 20, heightCm: 30 },
    { grossWeightKg: 0 }, { grossWeightKg: 0.0001 }, { grossWeightKg: Number.NaN }, { grossWeightKg: 1_000_000_000 },
  ])('rejects invalid bulk measurements before opening a transaction (%j)', async (measurements) => {
    await expect(saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: ['box-1'], ...measurements })).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('uses bounded writes for a large bulk selection', async () => {
    boxes = Array.from({ length: 1201 }, (_, index) => ({ id: `bulk-${index}`, userId, shipmentId, boxNo: String(index + 1), status: 'open', completionStatus: 'completed', grossWeightKg: '3', lengthCm: '10', widthCm: '20', heightCm: '30' }))
    const tx = makeTransaction(); mocks.transaction.mockImplementation((operation) => operation(tx))
    await saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: boxes.map((box) => box.id), grossWeightKg: 5 })
    expect(tx.update).toHaveBeenCalledTimes(3)
    expect(boxes.every((box) => box.grossWeightKg === '5' && box.completionStatus === 'completed')).toBe(true)
    for (const statement of tx.updateStatements) {
      const query = dialect.sqlToQuery(statement.condition)
      expect(query.params.slice(0, 2)).toEqual([userId, shipmentId])
      expect(query.params.length).toBeLessThanOrEqual(502)
    }
  })

  it.each([false, true])('merges duplicate box rows using the largest effective CBM regardless of manual-row order (%s)', async (reverse) => {
    boxes = []; boxItems = []
    const allocations = [
      { boxNo: '1', quantity: 4, manualCbm: 0.1 },
      { boxNo: '1', quantity: 6, lengthCm: 100, widthCm: 100, heightCm: 100 },
    ]
    if (reverse) allocations.reverse()
    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations })
    expect(boxes[0]).toMatchObject({ manualCbm: '1', lengthCm: '100', widthCm: '100', heightCm: '100' })
    expect(boxItems[0]).toMatchObject({ quantity: 10, manualCbm: '1' })
    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations: allocations.map((allocation) => ({ ...allocation, manualCbm: null })) })
    expect(boxes[0]).toMatchObject({ manualCbm: null, lengthCm: '100', widthCm: '100', heightCm: '100' })
    expect(boxItems[0]!.manualCbm).toBeNull()
  })

  it('persists CBM without dimensions and uses the largest component CBM across mixed-box edits and moves', async () => {
    boxes = []; boxItems = []
    items.push({ ...items[0]!, id: 'item-2', sku: 'SKU-2', reservedQuantity: 2, packedQuantity: 0 })
    const first = { userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 10, manualCbm: 0.1234567 }] }
    const second = { userId, shipmentId, shipmentItemId: 'item-2', allocations: [{ boxNo: '1', quantity: 2, manualCbm: 0.2 }] }
    const saved = await saveChinaOutboundItemBoxSplits(first)
    expect(saved.boxes[0]).toMatchObject({ manualCbm: 0.123457, lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: null })
    expect(saved.boxItems[0]).toMatchObject({ manualCbm: 0.123457 })
    await saveChinaOutboundItemBoxSplits(second)
    expect(boxes[0]).toMatchObject({ manualCbm: '0.2', lengthCm: null, widthCm: null, heightCm: null })
    await saveChinaOutboundItemBoxSplits(second)
    expect(boxes[0]!.manualCbm).toBe('0.2')
    boxes[0]!.status = 'open'
    await saveChinaOutboundBoxDimensions({ userId, shipmentId, boxId: boxes[0]!.id, lengthCm: null, widthCm: null, heightCm: null, manualCbm: 0.9 })
    await saveChinaOutboundItemBoxSplits(second)
    expect(boxes[0]!.manualCbm).toBe('0.9')
    second.allocations[0]!.manualCbm = 0.4
    await saveChinaOutboundItemBoxSplits(second)
    expect(boxes[0]!.manualCbm).toBe('0.4')
    second.allocations[0]!.boxNo = '2'
    await saveChinaOutboundItemBoxSplits(second)
    expect(boxes.map((box) => box.manualCbm)).toEqual(['0.123457', '0.4'])
    expect(boxes.every((box) => box.lengthCm === null && box.widthCm === null && box.heightCm === null)).toBe(true)
  })

  it('sums option CBM shares only in imported shared cartons and preserves physical overrides on an unchanged save', async () => {
    boxes = []; boxItems = []
    Object.assign(items[0]!, { reservedQuantity: 50, packedQuantity: 0 })
    items.push({ ...items[0]!, id: 'item-2', sku: 'SKU-BLACK', reservedQuantity: 100, packedQuantity: 0 })
    const silver = { userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 50, grossWeightKg: 2.667, manualCbm: 0.001103, lengthCm: 14.9, widthCm: 14.9, heightCm: 14.9 }] }
    const black = { userId, shipmentId, shipmentItemId: 'item-2', allocations: [{ boxNo: '1', quantity: 100, grossWeightKg: 5.333, manualCbm: 0.002205, lengthCm: 14.9, widthCm: 14.9, heightCm: 14.9 }] }
    await saveChinaOutboundItemBoxSplits(silver)
    Object.assign(boxes[0]!, { inventoryPackingGroupKey: 'mixed-keldi', inventoryPackingGroupBoxIndex: 0 })
    const saved = await saveChinaOutboundItemBoxSplits(black)
    expect(boxes[0]).toMatchObject({ grossWeightKg: '8', manualCbm: '0.003308', lengthCm: '14.9', widthCm: '14.9', heightCm: '14.9' })
    expect(saved.boxes[0]).toMatchObject({ inventoryPackingGroupKey: 'mixed-keldi', inventoryPackingGroupBoxIndex: 0 })
    expect(boxItems.map((row) => Number(row.manualCbm))).toEqual([0.001103, 0.002205])
    boxes[0]!.status = 'open'
    await saveChinaOutboundBoxDimensions({ userId, shipmentId, boxId: boxes[0]!.id, lengthCm: 14.9, widthCm: 14.9, heightCm: 14.9, manualCbm: 0.01 })
    await saveChinaOutboundItemBoxSplits(black)
    expect(boxes[0]!.manualCbm).toBe('0.01')
    black.allocations[0].manualCbm = 0.004
    await saveChinaOutboundItemBoxSplits(black)
    expect(boxes[0]!.manualCbm).toBe('0.005103')
    expect(movements).toHaveLength(0)
  })

  it('retains summed group CBM when mixed cartons and duplicate option components are merged', async () => {
    boxes = boxes.slice(0, 2)
    Object.assign(boxes[0]!, { inventoryPackingGroupKey: 'mixed-keldi', inventoryPackingGroupBoxIndex: 0, grossWeightKg: '2.667', manualCbm: '0.001103' })
    Object.assign(boxes[1]!, { inventoryPackingGroupKey: 'mixed-keldi', inventoryPackingGroupBoxIndex: 1, lengthCm: '10', widthCm: '20', heightCm: '30', grossWeightKg: '5.333', manualCbm: '0.002205' })
    Object.assign(boxItems[0]!, { grossWeightKg: '2.667', manualCbm: '0.001103' })
    Object.assign(boxItems[1]!, { grossWeightKg: '5.333', manualCbm: '0.002205' })
    const target = await mergeChinaOutboundBoxes({ userId, shipmentId, boxIds: ['box-1', 'box-2'] })
    expect(boxes.find((box) => box.id === target.id)).toMatchObject({ grossWeightKg: '8', manualCbm: '0.003308', inventoryPackingGroupKey: expect.any(String) })
    expect(boxItems).toHaveLength(1)
    expect(boxItems[0]).toMatchObject({ quantity: 10, grossWeightKg: '8', manualCbm: '0.003308' })
  })

  it('converts legacy container CBM into option shares before merging with an imported group carton', async () => {
    boxes = boxes.slice(0, 2)
    Object.assign(boxes[0]!, { inventoryPackingGroupKey: 'mixed-keldi', inventoryPackingGroupBoxIndex: 0, grossWeightKg: '8', manualCbm: '0.003308' })
    Object.assign(boxes[1]!, { lengthCm: '50', widthCm: '40', heightCm: '30', grossWeightKg: '20', manualCbm: '0.1' })
    items.push({ ...items[0]!, id: 'item-2', reservedQuantity: 20, packedQuantity: 20 }, { ...items[0]!, id: 'item-3', reservedQuantity: 30, packedQuantity: 30 })
    boxItems = [
      { id: 'one', userId, shipmentId, boxId: 'box-1', shipmentItemId: 'item-1', quantity: 10, grossWeightKg: '8', manualCbm: '0.003308' },
      { id: 'two', userId, shipmentId, boxId: 'box-2', shipmentItemId: 'item-2', quantity: 20, grossWeightKg: '5', manualCbm: '0.1', lengthCm: '50', widthCm: '40', heightCm: '30' },
      { id: 'three', userId, shipmentId, boxId: 'box-2', shipmentItemId: 'item-3', quantity: 30, grossWeightKg: '15', manualCbm: '0.1', lengthCm: '50', widthCm: '40', heightCm: '30' },
    ]
    const target = await mergeChinaOutboundBoxes({ userId, shipmentId, boxIds: ['box-1', 'box-2'] })
    expect(boxes.find((box) => box.id === target.id)).toMatchObject({ manualCbm: '0.103308', inventoryPackingGroupKey: `merged:${target.id}`, inventoryPackingGroupBoxIndex: null })
    expect(boxItems.map((row) => Number(row.manualCbm))).toEqual([0.003308, 0.04, 0.06])
    await saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-2', allocations: [{ boxNo: target.boxNo as string, quantity: 20, manualCbm: 0.05, grossWeightKg: 5, lengthCm: 50, widthCm: 40, heightCm: 30 }] })
    expect(boxes.find((box) => box.id === target.id)).toMatchObject({ grossWeightKg: '28', manualCbm: '0.113308' })
  })

  it.each([false, true])('keeps cross-mode carton moves unchanged and directs the user to the merge action (%s)', async (reverse) => {
    Object.assign(boxes[reverse ? 1 : 0]!, { inventoryPackingGroupKey: 'mixed-keldi', inventoryPackingGroupBoxIndex: 0 })
    const beforeBoxes = JSON.stringify(boxes)
    const beforeItems = JSON.stringify(boxItems)
    await expect(saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '2', quantity: 10 }] })).rejects.toThrow('박스 합치기')
    expect(JSON.stringify(boxes)).toBe(beforeBoxes)
    expect(JSON.stringify(boxItems)).toBe(beforeItems)
  })

  it('saves and clears independent box and pallet CBM while preserving unknown dimensions and measured weight', async () => {
    boxes[1]!.grossWeightKg = '7'
    await saveChinaOutboundBoxDimensions({ userId, shipmentId, boxId: 'box-2', lengthCm: null, widthCm: null, heightCm: null, manualCbm: 0.3212346 })
    expect(boxes[1]).toMatchObject({ manualCbm: '0.321235', grossWeightKg: '7', lengthCm: null, widthCm: null, heightCm: null })
    await saveChinaOutboundBoxDimensions({ userId, shipmentId, boxId: 'box-2', lengthCm: null, widthCm: null, heightCm: null, manualCbm: null })
    expect(boxes[1]!.manualCbm).toBeNull()
    await saveChinaOutboundPalletDimensions({ userId, shipmentId, palletId: 'pallet-1', lengthCm: null, widthCm: null, heightCm: null, manualCbm: 1.2 })
    expect(pallets[0]).toMatchObject({ manualCbm: '1.2', lengthCm: null, widthCm: null, heightCm: null })
    await saveChinaOutboundPalletDimensions({ userId, shipmentId, palletId: 'pallet-1', lengthCm: null, widthCm: null, heightCm: null })
    expect(pallets[0]!.manualCbm).toBe('1.2')
    await saveChinaOutboundPalletDimensions({ userId, shipmentId, palletId: 'pallet-1', lengthCm: null, widthCm: null, heightCm: null, manualCbm: null })
    expect(pallets[0]).toMatchObject({ manualCbm: null, lengthCm: null, widthCm: null, heightCm: null })
  })

  it('bulk applies CBM and fills missing dimensions while preserving measured dimensions, weights and component measurements', async () => {
    const before = JSON.stringify(boxItems)
    boxes[0]!.grossWeightKg = '7'
    await saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: ['box-1', 'box-2'], manualCbm: 0.4567894 })
    expect(boxes[0]).toMatchObject({ manualCbm: '0.456789', grossWeightKg: '7', lengthCm: '10', widthCm: '20', heightCm: '30' })
    expect(boxes[1]).toMatchObject({ manualCbm: '0.456789', lengthCm: expect.any(String), widthCm: expect.any(String), heightCm: expect.any(String) })
    expect(Number(boxes[1]!.lengthCm)).toBeGreaterThan(0)
    expect(Number(boxes[1]!.lengthCm) * Number(boxes[1]!.widthCm) * Number(boxes[1]!.heightCm) / 1_000_000).toBeCloseTo(0.456789, 3)
    expect(JSON.stringify(boxItems)).toBe(before)
    await saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: ['box-1'], manualCbm: null })
    expect(boxes[0]!.manualCbm).toBeNull()
    expect(boxes[1]!.manualCbm).toBe('0.456789')
  })

  it('estimates bulk CBM dimensions separately for boxes with different measured sides and skips unchanged retries', async () => {
    Object.assign(boxes[0]!, { lengthCm: '40', widthCm: '25', heightCm: null })
    Object.assign(boxes[1]!, { lengthCm: '50', widthCm: null, heightCm: null })
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((callback) => callback(tx))
    await saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: ['box-1', 'box-2'], manualCbm: 0.125 })
    expect(boxes[0]).toMatchObject({ lengthCm: '40', widthCm: '25', heightCm: '125', manualCbm: '0.125' })
    expect(boxes[1]).toMatchObject({ lengthCm: '50', widthCm: '50', heightCm: '50', manualCbm: '0.125' })
    const boxWrites = tx.updateStatements.filter((entry) => entry.table === chinaOutboundBoxes)
    expect(boxWrites).toHaveLength(2) // one measured batch, one completion-status invalidation batch
    const beforeRetry = tx.updateStatements.length
    await saveChinaOutboundBoxesMeasurements({ userId, shipmentId, boxIds: ['box-1', 'box-2'], manualCbm: 0.125 })
    expect(tx.updateStatements).toHaveLength(beforeRetry)
  })

  it.each([0, -1, 0.0000001, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000])('rejects invalid manual CBM before writes (%s)', async (manualCbm) => {
    await expect(saveChinaOutboundItemBoxSplits({ userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 10, manualCbm }] })).rejects.toThrow('CBM')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('recomputes a mixed box from saved product measurements across retries, edits, shrinking, and moves', async () => {
    boxes = []; boxItems = []
    items.push({ ...items[0]!, id: 'item-2', sku: 'SKU-2', reservedQuantity: 2, packedQuantity: 0 })
    const first = { userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 10, lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 4 }] }
    const second = { userId, shipmentId, shipmentItemId: 'item-2', allocations: [{ boxNo: '1', quantity: 2, lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 7 }] }
    await saveChinaOutboundItemBoxSplits(first)
    await saveChinaOutboundItemBoxSplits(second)
    expect(boxes[0]).toMatchObject({ lengthCm: '50', widthCm: '40', heightCm: '30', grossWeightKg: '11' })
    await saveChinaOutboundItemBoxSplits(second)
    expect(boxes[0]!.grossWeightKg).toBe('11')
    second.allocations[0]!.grossWeightKg = 5
    await saveChinaOutboundItemBoxSplits(second)
    expect(boxes[0]!.grossWeightKg).toBe('9')
    Object.assign(second.allocations[0]!, { lengthCm: 5, widthCm: 5, heightCm: 5 })
    await saveChinaOutboundItemBoxSplits(second)
    expect(boxes[0]).toMatchObject({ lengthCm: '10', widthCm: '20', heightCm: '30', grossWeightKg: '9' })
    second.allocations[0]!.boxNo = '2'
    await saveChinaOutboundItemBoxSplits(second)
    expect(boxes.map((box) => box.grossWeightKg)).toEqual(['4', '5'])
    await saveChinaOutboundPackageWeight({ userId, shipmentId, packageId: boxes[0]!.id, kind: 'box', grossWeightKg: 99 })
    await saveChinaOutboundItemBoxSplits(first)
    expect(boxes[0]!.grossWeightKg).toBe('99')
    first.allocations[0]!.grossWeightKg = 6
    await saveChinaOutboundItemBoxSplits(first)
    expect(boxes[0]!.grossWeightKg).toBe('6')
  })

  it('seeds a legacy single-product measurement once when another product joins the box', async () => {
    boxes[0]!.grossWeightKg = '3'
    items.push({ ...items[0]!, id: 'item-2', sku: 'SKU-2', reservedQuantity: 2, packedQuantity: 0 })
    const input = { userId, shipmentId, shipmentItemId: 'item-2', allocations: [{ boxNo: '1', quantity: 2, lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 7 }] }
    const saved = await saveChinaOutboundItemBoxSplits(input)
    expect(boxes[0]!.grossWeightKg).toBe('10')
    expect(saved.updatedOtherBoxItems).toEqual(expect.arrayContaining([expect.objectContaining({ shipmentItemId: 'item-1', grossWeightKg: 3, lengthCm: 10 })]))
    await saveChinaOutboundItemBoxSplits(input)
    expect(boxes[0]!.grossWeightKg).toBe('10')
    expect(boxItems.find((row) => row.id === 'allocation-1')!.grossWeightKg).toBe('3')
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
    const originalAllocations = boxItems.map(({ id, boxId, shipmentItemId, quantity }) => ({ id, boxId, shipmentItemId, quantity }))
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
    const boxBatches = batches.filter(({ table }) => table === chinaOutboundBoxes)
    const componentBatches = batches.filter(({ table }) => table === chinaOutboundBoxItems)
    expect(boxBatches).toHaveLength(Math.ceil(count / 500))
    expect(componentBatches.length).toBeLessThanOrEqual(Math.ceil(count / 500))
    for (const batch of batches) {
      const query = dialect.sqlToQuery(batch.condition)
      expect(query.sql).toContain('"user_id" =')
      expect(query.sql).toContain('"shipment_id" =')
      expect(query.params.slice(0, 2)).toEqual([userId, shipmentId])
      expect(query.params.length - 2).toBeLessThanOrEqual(500)
    }
    // Both physical and per-item measurements stay bounded to 500 rows per write.
    expect(tx.update).toHaveBeenCalledTimes(batches.length + 2)
    expect(tx.delete).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalledWith(chinaOutboundShipmentItems)
    expect(boxItems.map(({ id, boxId, shipmentItemId, quantity }) => ({ id, boxId, shipmentItemId, quantity }))).toEqual(originalAllocations)
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
    const originalAllocations = boxItems.map(({ id, boxId, shipmentItemId, quantity }) => ({ id, boxId, shipmentItemId, quantity }))
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((operation) => operation(tx))
    await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1', allocations: [
        { boxNo: '1', quantity: 5, ...(weight !== undefined ? { grossWeightKg: weight } : {}) },
        { boxNo: '2', quantity: 5 },
      ],
    })
    expect(boxItems.map(({ id, boxId, shipmentItemId, quantity }) => ({ id, boxId, shipmentItemId, quantity }))).toEqual(originalAllocations)
    expect(items[0]!.updatedAt).toBe('unchanged-item-time')
    expect(tx.delete).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).toHaveBeenCalledTimes(weight === undefined ? 1 : 2)
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
    expect(boxes[0]).toMatchObject({ boxNo: 'MIXED', lengthCm: '10', widthCm: '20', heightCm: '30', grossWeightKg: null, palletId: pallets[0]!.id })
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

  it('returns only the saved item allocations and all affected physical boxes without extra reads', async () => {
    shipments[0]!.status = 'draft'
    boxes[0]!.grossWeightKg = '8.5'
    boxes[0]!.note = 'keep source note'
    boxItems.push({ id: 'mixed-other', userId, shipmentId, boxId: 'box-1', shipmentItemId: 'item-2', quantity: 2 })
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((operation) => operation(tx))
    const saved = await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1', boxSplitStatus: 'completed',
      allocations: [
        { boxNo: '1', quantity: 4, lengthCm: 5, widthCm: 5, heightCm: 5 },
        { boxNo: '4', quantity: 6, lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 12.345 },
      ],
    })
    expect(tx.select).toHaveBeenCalledTimes(4)
    expect(saved).toMatchObject({ shipmentId, shipmentItemId: 'item-1', shipmentStatus: 'packing', packedQuantity: 10, boxSplitStatus: 'completed' })
    expect(saved.boxes.map((box) => box.boxNo)).toEqual(['1', '2', '4'])
    expect(saved.boxes[0]).toMatchObject({ id: 'box-1', editable: true, completionStatus: 'in_progress', note: 'keep source note', lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 8.5 })
    expect(saved.boxes[1]).toMatchObject({ id: 'box-2', completionStatus: 'in_progress', palletId: 'pallet-2' })
    expect(saved.boxes[2]).toMatchObject({ boxNo: '4', lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 12.345 })
    expect(saved.boxItems.map((row) => [row.boxId, row.shipmentItemId, row.quantity])).toEqual([
      ['box-1', 'item-1', 4], [saved.boxes[2]!.id, 'item-1', 6],
    ])
    expect(saved.boxItems.every((row) => Boolean(row.id))).toBe(true)
    expect(saved.reopenedPalletIds.sort()).toEqual(['pallet-1', 'pallet-2'])
    expect(boxItems.find((row) => row.id === 'mixed-other')).toMatchObject({ boxId: 'box-1', quantity: 2 })
    expect(JSON.stringify(saved)).not.toContain('workspace-a')
  })

  it('returns unchanged allocation IDs and completed packages for a weight-only save', async () => {
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((operation) => operation(tx))
    const saved = await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 5, grossWeightKg: 7.125 }, { boxNo: '2', quantity: 5 }],
    })
    expect(tx.select).toHaveBeenCalledTimes(4)
    expect(saved.boxItems.map((row) => row.id)).toEqual(['allocation-1', 'allocation-2'])
    expect(saved.boxes[0]).toMatchObject({ grossWeightKg: 7.125, completionStatus: 'completed' })
    expect(saved.reopenedPalletIds).toEqual([])
    expect(tx.delete).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('normalizes a legacy null product status in the response without rewriting its stored flag', async () => {
    items[0]!.boxSplitStatus = null
    const saved = await saveChinaOutboundItemBoxSplits({
      userId, shipmentId, shipmentItemId: 'item-1', allocations: [{ boxNo: '1', quantity: 5 }, { boxNo: '2', quantity: 5 }],
    })
    expect(saved.boxSplitStatus).toBe('completed')
    expect(items[0]!.boxSplitStatus).toBeNull()
    expect(saved.reopenedPalletIds).toEqual([])
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
