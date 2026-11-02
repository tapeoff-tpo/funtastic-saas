import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  chinaOutboundShipmentItems,
  chinaOutboundPallets,
  chinaOutboundBoxes,
  chinaOutboundBoxItems,
  chinaOutboundShipments,
  purchaseRequestItems,
  saasChinaInventory,
  saasChinaInventoryMovements,
  saasChinaPurchaseLinks,
  saasChinaShipmentPurchaseAllocations,
} from '@/lib/db/schema'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mocks }))

import { addChinaOutboundSample, saveChinaOutboundPalletDimensions, addChinaOutboundShipmentItems, cancelChinaOutboundShipment, createChinaOutboundShipment } from './saas-china-outbound'

type Row = { id: string; userId: string; [key: string]: unknown }

const dialect = new PgDialect()
const workspaceUserId = 'workspace-a'
let inventories: Row[]
let shipments: Row[]
let shipmentItems: Row[]
let movements: Row[]
let purchaseLinks: Row[]
let allocations: Row[]
let purchaseItems: Row[]
let boxes: Row[]
let boxItems: Row[]
let pallets: Row[]
let sequence: number

function paramsFor(condition: SQL) {
  return dialect.sqlToQuery(condition).params
}

function queryRows(rows: Row[], condition: SQL) {
  const query = dialect.sqlToQuery(condition)
  if (query.sql.includes('false')) return []
  return rows.filter((row) => (
    (!query.sql.includes('"user_id"') || query.params.includes(row.userId))
    && (!query.sql.includes('"inventory_id"') || query.params.includes(row.inventoryId))
    && (!query.sql.includes('"shipment_id"') || query.params.includes(row.shipmentId))
    && (!query.sql.includes('"shipment_item_id"') || query.params.includes(row.shipmentItemId))
    && (!query.sql.includes('"purchase_link_id"') || query.params.includes(row.purchaseLinkId))
    && (!query.sql.match(/"id"\s+(?:in|=)/i) || query.params.includes(row.id))
  )).map((row) => ({ ...row }))
}

function makeTransaction() {
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockImplementation(() => ({
      from: (table: unknown) => ({
        where: (condition: SQL) => {
          const rows = table === saasChinaInventory ? inventories
            : table === saasChinaPurchaseLinks ? purchaseLinks
              : table === saasChinaShipmentPurchaseAllocations ? allocations
                : table === purchaseRequestItems ? purchaseItems
                  : table === chinaOutboundShipments ? shipments
                    : table === chinaOutboundShipmentItems ? shipmentItems
                      : table === chinaOutboundPallets ? pallets : table === chinaOutboundBoxes ? boxes : table === chinaOutboundBoxItems ? boxItems : null
          if (!rows) throw new Error('Unexpected select table')
          const result = Promise.resolve(queryRows(rows, condition))
          return Object.assign(result, {
            orderBy: () => result,
            limit: async (count: number) => (await result).slice(0, count),
          })
        },
      }),
    })),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: (values: Omit<Row, 'id'>) => {
        const rows = table === saasChinaInventory ? inventories : table === chinaOutboundShipments ? shipments
          : table === chinaOutboundShipmentItems ? shipmentItems
            : table === saasChinaInventoryMovements ? movements
              : table === saasChinaShipmentPurchaseAllocations ? allocations
                : table === chinaOutboundBoxes ? boxes : table === chinaOutboundBoxItems ? boxItems : null
        if (!rows) throw new Error('Unexpected insert table')
        const defaults = table === saasChinaShipmentPurchaseAllocations
          ? { dispatchedQuantity: 0, releasedQuantity: 0 }
          : table === chinaOutboundShipmentItems ? { packedQuantity: 0, dispatchedQuantity: 0, boxSplitStatus: 'in_progress' } : {}
        const row = { ...defaults, ...values, id: `created-${++sequence}` } as Row
        rows.push(row)
        return { returning: async () => [row] }
      },
    })),
    update: vi.fn().mockImplementation((table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: SQL) => {
          const rows = table === saasChinaInventory ? inventories
            : table === saasChinaPurchaseLinks ? purchaseLinks
              : table === purchaseRequestItems ? purchaseItems
                : table === chinaOutboundShipments ? shipments
                  : table === saasChinaShipmentPurchaseAllocations ? allocations
                    : table === chinaOutboundShipmentItems ? shipmentItems : table === chinaOutboundPallets ? pallets : table === chinaOutboundBoxes ? boxes : null
          if (!rows) throw new Error('Unexpected update table')
          const matchingRows = queryRows(rows, condition)
          for (const match of matchingRows) {
            Object.assign(rows.find((row) => row.id === match.id)!, values)
          }
          return { returning: async () => matchingRows.map((match) => ({ ...rows.find((row) => row.id === match.id)! })) }
        },
      }),
    })),
  }
  return tx
}

describe('createChinaOutboundShipment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sequence = 0
    inventories = [{
      id: 'inventory-a', userId: workspaceUserId, sku: 'SKU-A', productName: '상품 A',
      optionKey: '', optionName: null, warehouseCode: '중국창고',
      onHandQuantity: 10, reservedQuantity: 4, availableQuantity: 6,
    }]
    shipments = [{ id: 'existing-shipment', userId: workspaceUserId, status: 'draft', shipmentNo: 'A' }]
    shipmentItems = []
    movements = []
    purchaseLinks = []
    allocations = []
    purchaseItems = []
    boxes = []; boxItems = []; pallets = [{ id: 'pallet-1', userId: workspaceUserId, shipmentId: 'existing-shipment', palletNo: 'P1' }]
    mocks.execute.mockResolvedValue(undefined)
  })

  it('receives and reserves manual samples without modifying purchased stock or purchase links', async () => {
    const tx = makeTransaction(); mocks.transaction.mockImplementation((callback) => callback(tx))
    const original = JSON.stringify(inventories)
    const input = { userId: workspaceUserId, createdBy: 'admin', shipmentId: 'existing-shipment', requestId: '11111111-1111-4111-8111-111111111111', productName: '수기 샘플', quantity: 3, warehouseCode: '중국창고' }
    const first = await addChinaOutboundSample(input)
    const retry = await addChinaOutboundSample(input)
    expect(retry.id).toBe(first.id)
    expect(shipmentItems).toHaveLength(1)
    expect(shipmentItems[0]).toMatchObject({ itemCategory: '샘플', reservedQuantity: 3, packedQuantity: 0 })
    expect(inventories).toHaveLength(2)
    expect(JSON.stringify(inventories.slice(0, 1))).toBe(original)
    expect(inventories[1]).toMatchObject({ itemCategory: '샘플', onHandQuantity: 3, reservedQuantity: 3, availableQuantity: 0 })
    expect(movements.map((row) => [row.movementType, row.onHandDelta, row.reservedDelta])).toEqual([['arrival', 3, 0], ['shipment_reservation', 0, 3]])
    expect(purchaseLinks).toHaveLength(0); expect(allocations).toHaveLength(0)
  })

  it('rejects manual samples in closed work and validates quantity before writing', async () => {
    const tx = makeTransaction(); mocks.transaction.mockImplementation((callback) => callback(tx))
    const input = { userId: workspaceUserId, createdBy: 'admin', shipmentId: 'existing-shipment', requestId: '11111111-1111-4111-8111-111111111111', productName: '샘플', quantity: 3, warehouseCode: '중국창고' }
    shipments[0]!.status = 'dispatched'
    await expect(addChinaOutboundSample(input)).rejects.toThrow('초안 또는 포장중')
    await expect(addChinaOutboundSample({ ...input, quantity: 0 })).rejects.toThrow()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('supports an explicit empty draft for samples while retaining normal creation validation', async () => {
    const tx = makeTransaction(); mocks.transaction.mockImplementation((callback) => callback(tx))
    await expect(createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [] })).rejects.toThrow('하나 이상')
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [] }, { allowEmpty: true })
    expect(shipment.status).toBe('draft'); expect(shipmentItems).toHaveLength(0); expect(movements).toHaveLength(0)
  })

  it('saves all measured pallet dimensions and rejects invalid, foreign, and closed updates', async () => {
    const tx = makeTransaction(); mocks.transaction.mockImplementation((callback) => callback(tx))
    const input = { userId: workspaceUserId, shipmentId: 'existing-shipment', palletId: 'pallet-1', lengthCm: 120, widthCm: 100, heightCm: 150 }
    await saveChinaOutboundPalletDimensions(input)
    expect(pallets[0]).toMatchObject({ lengthCm: '120', widthCm: '100', heightCm: '150' })
    await expect(saveChinaOutboundPalletDimensions({ ...input, heightCm: 0 })).rejects.toThrow('모두 입력')
    await expect(saveChinaOutboundPalletDimensions({ ...input, userId: 'foreign' })).rejects.toThrow('찾을 수 없습니다')
    shipments[0]!.status = 'dispatched'
    await expect(saveChinaOutboundPalletDimensions(input)).rejects.toThrow('초안 또는 포장중')
  })

  it.each(['draft', 'packing', 'ready'])(
    'creates separate work while an existing shipment is %s and reserves only remaining stock',
    async (status) => {
      shipments[0]!.status = status
      const tx = makeTransaction()
      mocks.transaction.mockImplementation((callback) => callback(tx))

      const second = await createChinaOutboundShipment({
        userId: workspaceUserId, createdBy: 'admin', shipmentNo: 'B',
        lines: [{ inventoryId: 'inventory-a', quantity: 3 }],
      })
      const third = await createChinaOutboundShipment({
        userId: workspaceUserId, createdBy: 'admin', shipmentNo: 'C',
        lines: [{ inventoryId: 'inventory-a', quantity: 3 }],
      })

      expect(second.id).not.toBe(third.id)
      expect(shipments).toHaveLength(3)
      expect(shipments[0]).toMatchObject({ id: 'existing-shipment', status, shipmentNo: 'A' })
      expect(shipmentItems.map((item) => item.reservedQuantity)).toEqual([3, 3])
      expect(inventories[0]).toMatchObject({ onHandQuantity: 10, reservedQuantity: 10, availableQuantity: 0 })
      expect(movements.map((movement) => movement.reservedDelta)).toEqual([3, 3])
      expect(tx.execute).toHaveBeenCalledTimes(2)
      expect(paramsFor(tx.execute.mock.calls[0]![0])).toEqual([`saas-china-outbound:${workspaceUserId}`])
      expect(tx.execute.mock.invocationCallOrder[0]).toBeLessThan(tx.select.mock.invocationCallOrder[0]!)

      await expect(createChinaOutboundShipment({
        userId: workspaceUserId, createdBy: 'admin', shipmentNo: 'D',
        lines: [{ inventoryId: 'inventory-a', quantity: 1 }],
      })).rejects.toThrow('SKU-A의 작업 가능 수량은 0개입니다.')
      expect(shipments).toHaveLength(3)
      expect(inventories[0]).toMatchObject({ reservedQuantity: 10, availableQuantity: 0 })
    },
  )

  it('does not reserve an inventory item belonging to another workspace', async () => {
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await expect(createChinaOutboundShipment({
      userId: 'workspace-b', createdBy: 'admin', shipmentNo: 'B',
      lines: [{ inventoryId: 'inventory-a', quantity: 1 }],
    })).rejects.toThrow('SaaS 중국재고에서 찾을 수 없는 출고 품목이 있습니다.')
    expect(shipments).toHaveLength(1)
    expect(inventories[0]).toMatchObject({ reservedQuantity: 4, availableQuantity: 6 })
  })

  function inspectedLot() {
    inventories[0]!.reservedQuantity = 0; inventories[0]!.availableQuantity = 10
    purchaseLinks = [{ id: 'lot-a', userId: workspaceUserId, inventoryId: 'inventory-a', purchaseRequestItemId: 'purchase-a', receivedQuantity: 10, reservedQuantity: 0, dispatchedQuantity: 0 }]
    purchaseItems = [{ id: 'purchase-a', userId: workspaceUserId, rawData: {}, purchaseInspection: {
      version: 1, revision: 1, expectedQuantity: 10, checkedAt: '2026-11-02T01:00:00Z', checkedBy: 'staff', resolutionNote: '', parcels: [
        { id: 'parcel-a', trackingNumber: 'SF001', boxes: [{ id: 'receipt-a', quantity: 6, lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 3 }] },
        { id: 'parcel-b', trackingNumber: 'YT002', boxes: [{ id: 'receipt-b', quantity: 4, lengthCm: 20, widthCm: 20, heightCm: 10, weightKg: 2 }] },
      ],
    } }]
    mocks.transaction.mockImplementation((callback) => callback(makeTransaction()))
  }

  it('creates initial boxes from the exact reserved receipt and leaves physical stock unchanged', async () => {
    inspectedLot()
    await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 10 }] })
    expect(boxItems.map((row) => row.quantity)).toEqual([6, 4])
    expect(boxes.map((row) => [row.boxNo, row.lengthCm, row.grossWeightKg])).toEqual([['1', '50', '3'], ['2', '20', '2']])
    expect(shipmentItems[0]).toMatchObject({ reservedQuantity: 10, packedQuantity: 10 })
    expect(allocations[0]).toMatchObject({ inspectionBoxes: [expect.objectContaining({ trackingNumber: 'SF001', quantity: 6 }), expect.objectContaining({ trackingNumber: 'YT002', quantity: 4 })] })
    expect(inventories[0]!.onHandQuantity).toBe(10)
  })

  it('adds only new boxes when adding stock and preserves the existing box IDs and edits', async () => {
    inspectedLot()
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 6 }] })
    const firstId = boxes[0]!.id; boxes[0]!.boxNo = 'CUSTOM-7'
    await addChinaOutboundShipmentItems({ userId: workspaceUserId, createdBy: 'admin', shipmentId: shipment.id, lines: [{ inventoryId: 'inventory-a', quantity: 4 }] })
    expect(boxes[0]).toMatchObject({ id: firstId, boxNo: 'CUSTOM-7' })
    expect(boxItems.map((row) => row.quantity)).toEqual([6, 4])
    expect(shipmentItems[0]).toMatchObject({ reservedQuantity: 10, packedQuantity: 10 })
  })

  it('reuses a cancelled receipt allocation while retaining another shipment reservation', async () => {
    inspectedLot()
    const first = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 6 }] })
    const second = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 4 }] })
    await cancelChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', shipmentId: first.id })
    const third = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 6 }] })
    expect(allocations.find((row) => row.shipmentId === third.id)?.inspectionBoxes).toEqual([expect.objectContaining({ receiptBoxId: 'receipt-a', quantity: 6 })])
    expect(allocations.find((row) => row.shipmentId === second.id)?.releasedQuantity).toBe(0)
    expect(purchaseLinks[0]!.reservedQuantity).toBe(10)
  })

  it('keeps linked purchase-lot reservations in sync across different active shipments', async () => {
    purchaseLinks = [{
      id: 'lot-a', userId: workspaceUserId, inventoryId: 'inventory-a', purchaseRequestItemId: 'purchase-a',
      receivedQuantity: 10, reservedQuantity: 4, dispatchedQuantity: 0,
    }]
    purchaseItems = [{ id: 'purchase-a', userId: workspaceUserId, rawData: {} }]
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((callback) => callback(tx))

    for (const shipmentNo of ['B', 'C']) {
      await createChinaOutboundShipment({
        userId: workspaceUserId, createdBy: 'admin', shipmentNo,
        lines: [{ inventoryId: 'inventory-a', quantity: 3 }],
      })
    }

    expect(purchaseLinks[0]).toMatchObject({ reservedQuantity: 10, dispatchedQuantity: 0 })
    expect(allocations.map((allocation) => allocation.reservedQuantity)).toEqual([3, 3])
    expect(new Set(allocations.map((allocation) => allocation.shipmentId)).size).toBe(2)
    expect(purchaseItems[0]).toMatchObject({
      status: 'outbound_requested',
      rawData: { saasChinaReservedQuantity: 10, outboundRequestedQuantity: 10 },
    })
  })

  it('releases only the cancelled shipment while preserving the other shipment and its purchase-lot reservation', async () => {
    inventories[0]!.reservedQuantity = 0
    inventories[0]!.availableQuantity = 10
    shipments = []
    purchaseLinks = [{
      id: 'lot-a', userId: workspaceUserId, inventoryId: 'inventory-a', purchaseRequestItemId: 'purchase-a',
      receivedQuantity: 10, reservedQuantity: 0, dispatchedQuantity: 0,
    }]
    purchaseItems = [{ id: 'purchase-a', userId: workspaceUserId, rawData: {} }]
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((callback) => callback(tx))

    const first = await createChinaOutboundShipment({
      userId: workspaceUserId, createdBy: 'admin', shipmentNo: 'A',
      lines: [{ inventoryId: 'inventory-a', quantity: 4 }],
    })
    const second = await createChinaOutboundShipment({
      userId: workspaceUserId, createdBy: 'admin', shipmentNo: 'B',
      lines: [{ inventoryId: 'inventory-a', quantity: 3 }],
    })
    const cancelled = await cancelChinaOutboundShipment({
      userId: workspaceUserId, createdBy: 'admin', shipmentId: first.id,
    })

    expect(cancelled).toMatchObject({ id: first.id, status: 'cancelled' })
    expect(shipments.find((shipment) => shipment.id === second.id)).toMatchObject({ status: 'draft', shipmentNo: 'B' })
    expect(inventories[0]).toMatchObject({ onHandQuantity: 10, reservedQuantity: 3, availableQuantity: 7 })
    expect(purchaseLinks[0]).toMatchObject({ reservedQuantity: 3, dispatchedQuantity: 0 })
    expect(allocations.find((allocation) => allocation.shipmentId === first.id)).toMatchObject({
      purchaseLinkId: 'lot-a', reservedQuantity: 4, releasedQuantity: 4, dispatchedQuantity: 0,
    })
    expect(allocations.find((allocation) => allocation.shipmentId === second.id)).toMatchObject({
      purchaseLinkId: 'lot-a', reservedQuantity: 3, releasedQuantity: 0, dispatchedQuantity: 0,
    })
    expect(shipmentItems.find((item) => item.shipmentId === second.id)).toMatchObject({
      inventoryId: 'inventory-a', reservedQuantity: 3,
    })
    expect(purchaseItems[0]).toMatchObject({
      status: 'outbound_requested',
      rawData: { saasChinaReservedQuantity: 3, outboundRequestedQuantity: 3 },
    })
    expect(movements.map((movement) => movement.reservedDelta)).toEqual([4, 3, -4])
  })
})
