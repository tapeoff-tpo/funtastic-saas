import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  chinaOutboundBoxItems,
  chinaOutboundBoxes,
  chinaOutboundPallets,
  chinaOutboundShipmentItems,
  chinaOutboundShipments,
} from '@/lib/db/schema'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))

import {
  assignChinaOutboundBoxesToPallets,
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
      values: (values: Omit<Row, 'id'>) => ({
        returning: async () => {
          const row = { ...values, id: `new-${++insertedSequence}` } as Row
          rowsFor(table).push(row)
          return [row]
        },
      }),
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
    items = [{ id: 'item-1', userId, shipmentId, sku: 'SKU-1', reservedQuantity: 10, packedQuantity: 10, boxSplitStatus: 'completed' }]
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

  it('requires a used pallet with no in-progress boxes for completion', async () => {
    pallets[0]!.completionStatus = 'in_progress'
    boxes[0]!.completionStatus = 'in_progress'
    await expect(saveChinaOutboundPalletCompletionStatuses({ userId, shipmentId, updates: [{ palletId: 'pallet-1', status: 'completed' }] })).rejects.toThrow(/진행 중인 박스/)
    expect(pallets[0]).toMatchObject({ completionStatus: 'in_progress' })

    boxes[0]!.completionStatus = null
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

  it('blocks marking ready when a filled box or used pallet is in progress', async () => {
    boxes[0]!.completionStatus = 'in_progress'
    await expect(markChinaOutboundShipmentReady({ userId, shipmentId })).rejects.toThrow(/박스 상태가 진행 중/)
    expect(shipments[0]).toMatchObject({ status: 'packing' })
    boxes[0]!.completionStatus = 'completed'
    pallets[0]!.completionStatus = 'in_progress'
    await expect(markChinaOutboundShipmentReady({ userId, shipmentId })).rejects.toThrow(/파렛트 상태가 진행 중/)
    expect(shipments[0]).toMatchObject({ status: 'packing' })
  })

  it('reopens a box and its pallet only when its physical dimensions change', async () => {
    await saveChinaOutboundBoxDimensions({ userId, shipmentId, boxId: 'box-1', lengthCm: 10, widthCm: 20, heightCm: 30 })
    expect(boxes[0]).toMatchObject({ completionStatus: 'completed' })
    expect(pallets[0]).toMatchObject({ completionStatus: 'completed' })
    await saveChinaOutboundBoxDimensions({ userId, shipmentId, boxId: 'box-1', lengthCm: 11, widthCm: 20, heightCm: 30 })
    expect(boxes[0]).toMatchObject({ completionStatus: 'in_progress' })
    expect(pallets[0]).toMatchObject({ completionStatus: 'in_progress' })
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

  it('reopens both old and new pallets when a box is reassigned', async () => {
    await assignChinaOutboundBoxesToPallets({ userId, shipmentId, assignments: [{ boxNo: '1', palletNo: 'P2' }] })
    expect(boxes[0]).toMatchObject({ palletId: 'pallet-2' })
    expect(pallets[0]).toMatchObject({ completionStatus: 'in_progress' })
    expect(pallets[1]).toMatchObject({ completionStatus: 'in_progress' })
  })
})
