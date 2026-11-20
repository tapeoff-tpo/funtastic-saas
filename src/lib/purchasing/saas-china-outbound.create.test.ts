import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SQL } from 'drizzle-orm'
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

import { addChinaOutboundSample, applyChinaOutboundInventoryPacking, saveChinaOutboundItemBoxSplits, saveChinaOutboundPalletDimensions, addChinaOutboundShipmentItems, cancelChinaOutboundShipment, createChinaOutboundShipment, deleteChinaOutboundShipment } from './saas-china-outbound'

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
      values: (values: Omit<Row, 'id'> | Array<Omit<Row, 'id'>>) => {
        const rows = table === saasChinaInventory ? inventories : table === chinaOutboundShipments ? shipments
          : table === chinaOutboundShipmentItems ? shipmentItems
            : table === saasChinaInventoryMovements ? movements
              : table === saasChinaShipmentPurchaseAllocations ? allocations
                : table === chinaOutboundBoxes ? boxes : table === chinaOutboundBoxItems ? boxItems : null
        if (!rows) throw new Error('Unexpected insert table')
        const defaults = table === saasChinaShipmentPurchaseAllocations
          ? { dispatchedQuantity: 0, releasedQuantity: 0 }
          : table === chinaOutboundShipmentItems ? { packedQuantity: 0, dispatchedQuantity: 0, boxSplitStatus: 'in_progress' }
            : table === chinaOutboundBoxes ? { status: 'open', palletId: null, sortOrder: 0, completionStatus: null } : {}
        const created = (Array.isArray(values) ? values : [values]).map((value) => ({ ...defaults, ...value, id: value.id ?? `created-${++sequence}` } as Row))
        rows.push(...created)
        return { returning: async () => created }
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
                    : table === chinaOutboundShipmentItems ? shipmentItems : table === chinaOutboundPallets ? pallets : table === chinaOutboundBoxes ? boxes : table === chinaOutboundBoxItems ? boxItems : null
          if (!rows) throw new Error('Unexpected update table')
          const matchingRows = queryRows(rows, condition)
          for (const match of matchingRows) {
            const resolved = Object.fromEntries(Object.entries(values).map(([field, value]) => {
              if (!(value instanceof SQL)) return [field, value]
              const query = dialect.sqlToQuery(value)
              if (!query.sql.startsWith('CASE ')) throw new Error('Unexpected SQL update')
              const position = query.params.indexOf(match.id)
              return [field, position < 0 ? match[field] : query.params[position + 1]]
            }))
            Object.assign(rows.find((row) => row.id === match.id)!, resolved)
          }
          return { returning: async () => matchingRows.map((match) => ({ ...rows.find((row) => row.id === match.id)! })) }
        },
      }),
    })),
    delete: vi.fn().mockImplementation((table: unknown) => ({
      where: (condition: SQL) => {
        const rows = table === chinaOutboundShipments ? shipments
          : table === chinaOutboundShipmentItems ? shipmentItems
            : table === saasChinaShipmentPurchaseAllocations ? allocations
              : table === chinaOutboundBoxes ? boxes
                : table === chinaOutboundBoxItems ? boxItems : table === chinaOutboundPallets ? pallets : null
        if (!rows) throw new Error('Unexpected delete table')
        const matchingRows = queryRows(rows, condition)
        const matchingIds = new Set(matchingRows.map((row) => row.id))
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (matchingIds.has(rows[index]!.id)) rows.splice(index, 1)
        }
        const result = Promise.resolve(matchingRows)
        return Object.assign(result, { returning: async () => matchingRows })
      },
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

  function measuredInventory(quantity = 100, totalBoxCount = 3) {
    Object.assign(inventories[0]!, { onHandQuantity: quantity, reservedQuantity: 0, availableQuantity: quantity, totalBoxCount,
      lengthCm: '50', widthCm: '40', heightCm: '30', grossWeightKg: String(totalBoxCount * 2.5), manualCbm: String(totalBoxCount * 0.125) })
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((callback) => callback(tx))
    return tx
  }

  function mixedInventory(quantities = [50, 100], count = 1, weight = 8, cbm = 0.003308) {
    const total = quantities.reduce((sum, quantity) => sum + quantity, 0)
    let start = 0
    inventories = quantities.map((quantity, index) => {
      const memberStartQuantity = start; start += quantity
      return {
        id: `mixed-${index}`, userId: workspaceUserId, warehouseCode: '중국창고', sku: `KELDI-${index}`, productName: index === 1 ? '켈디 지퍼고리' : '켈디지퍼고리', optionName: `옵션 ${index}`, optionKey: `옵션 ${index}`,
        onHandQuantity: quantity, availableQuantity: quantity, reservedQuantity: 0, packagingReferenceQuantity: quantity, totalBoxCount: index === 0 ? count : null,
        grossWeightKg: String(Math.round(weight * quantity / total * 1000) / 1000), manualCbm: String(Math.round(cbm * quantity / total * 1_000_000) / 1_000_000),
        packagingGroup: { version: 1, key: 'mixed-options', memberStartQuantity, totalBoxCount: count, referenceQuantity: total, grossWeightKg: weight, manualCbm: cbm, lengthCm: null, widthCm: null, heightCm: null },
      }
    })
    const tx = makeTransaction(); mocks.transaction.mockImplementation((callback) => callback(tx)); return tx
  }

  it('packs silver and black options in one shared physical box with proportional component measurements', async () => {
    mixedInventory()
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'mixed-0', quantity: 50 }, { inventoryId: 'mixed-1', quantity: 100 }] })
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatchObject({ inventoryPackingGroupKey: 'mixed-options', inventoryPackingGroupBoxIndex: 0, grossWeightKg: '8', manualCbm: '0.003308', lengthCm: '14.9', widthCm: '14.9', heightCm: '14.9' })
    expect(boxItems.map((row) => [row.boxId, row.quantity, row.grossWeightKg, row.manualCbm])).toEqual([[boxes[0]!.id, 50, '2.667', '0.001103'], [boxes[0]!.id, 100, '5.333', '0.002205']])
    expect(shipmentItems.every((row) => row.packedQuantity === row.reservedQuantity)).toBe(true)
    expect(boxItems.every((row) => row.shipmentId === shipment.id && row.userId === workspaceUserId && row.lengthCm === '14.9')).toBe(true)
  })

  it('keeps seven shared cartons for three options while conserving each option and the group totals', async () => {
    mixedInventory([20, 30, 60], 7, 124, 0.25)
    await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: inventories.map((row) => ({ inventoryId: row.id, quantity: Number(row.onHandQuantity) })) })
    expect(boxes).toHaveLength(7)
    expect(boxes.map((row) => row.boxNo)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(shipmentItems.map((item) => boxItems.filter((row) => row.shipmentItemId === item.id).reduce((sum, row) => sum + Number(row.quantity), 0))).toEqual([20, 30, 60])
    expect(Math.round(boxes.reduce((sum, row) => sum + Number(row.grossWeightKg), 0) * 1000)).toBe(124000)
    expect(Math.round(boxes.reduce((sum, row) => sum + Number(row.manualCbm), 0) * 1_000_000)).toBe(250000)
    expect(shipmentItems.map((item) => Math.round(boxItems.filter((row) => row.shipmentItemId === item.id).reduce((sum, row) => sum + Number(row.grossWeightKg), 0) * 1000))).toEqual([22545, 33819, 67636])
  })

  it('reuses the same group box and component when more of an option and another option are added later', async () => {
    mixedInventory()
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'mixed-0', quantity: 20 }] })
    const originalBox = boxes[0]!.id; const originalComponent = boxItems[0]!.id
    await addChinaOutboundShipmentItems({ userId: workspaceUserId, createdBy: 'admin', shipmentId: shipment.id, lines: [{ inventoryId: 'mixed-0', quantity: 30 }, { inventoryId: 'mixed-1', quantity: 100 }] })
    expect(boxes).toHaveLength(1); expect(boxes[0]!.id).toBe(originalBox)
    expect(boxItems).toHaveLength(2); expect(boxItems[0]!.id).toBe(originalComponent)
    expect(boxes[0]).toMatchObject({ grossWeightKg: '8', manualCbm: '0.003308' })
    expect(boxItems.map((row) => row.quantity)).toEqual([50, 100])
  })

  it('backfills shared option cartons together without changing stock or reservations, and remains idempotent', async () => {
    mixedInventory()
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'mixed-0', quantity: 50 }, { inventoryId: 'mixed-1', quantity: 100 }] }, { initializeInspectionPacking: false })
    const originalStock = structuredClone(inventories); const originalMovements = structuredClone(movements)
    expect(await applyChinaOutboundInventoryPacking({ userId: workspaceUserId, shipmentId: shipment.id })).toMatchObject({ createdBoxCount: 1, appliedItemCount: 2, packedQuantity: 150 })
    expect(boxes).toHaveLength(1); expect(boxItems).toHaveLength(2)
    expect(inventories).toEqual(originalStock); expect(movements).toEqual(originalMovements)
    expect(await applyChinaOutboundInventoryPacking({ userId: workspaceUserId, shipmentId: shipment.id })).toMatchObject({ createdBoxCount: 0, appliedItemCount: 0, packedQuantity: 0 })
    expect(boxes).toHaveLength(1); expect(boxItems).toHaveLength(2)
  })

  it('does not silently collapse duplicate component CBM rows in a marked mixed box', async () => {
    mixedInventory()
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'mixed-0', quantity: 50 }] })
    const previousBoxes = structuredClone(boxes); const previousComponents = structuredClone(boxItems)
    await expect(saveChinaOutboundItemBoxSplits({ userId: workspaceUserId, shipmentId: shipment.id, shipmentItemId: shipmentItems[0]!.id, allocations: [{ boxNo: '1', quantity: 20, manualCbm: 0.000441 }, { boxNo: '1', quantity: 30, manualCbm: 0.000662 }] })).rejects.toThrow('한 행')
    expect(boxes).toEqual(previousBoxes); expect(boxItems).toEqual(previousComponents)
  })

  it.each([true, false])('blocks moving a component across mixed and ordinary occupied box modes before writes (%s)', async (fromMixed) => {
    mixedInventory()
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'mixed-0', quantity: 50 }] })
    inventories.push({ ...inventories[0]!, id: 'ordinary', sku: 'ORDINARY', productName: '일반 상품', packagingGroup: null, packagingReferenceQuantity: 10, totalBoxCount: 1, onHandQuantity: 10, availableQuantity: 10, reservedQuantity: 0 })
    await addChinaOutboundShipmentItems({ userId: workspaceUserId, createdBy: 'admin', shipmentId: shipment.id, lines: [{ inventoryId: 'ordinary', quantity: 10 }] })
    const source = shipmentItems.find((item) => item.inventoryId === (fromMixed ? 'mixed-0' : 'ordinary'))!
    const previousBoxes = structuredClone(boxes); const previousComponents = structuredClone(boxItems)
    await expect(saveChinaOutboundItemBoxSplits({ userId: workspaceUserId, shipmentId: shipment.id, shipmentItemId: source.id, allocations: [{ boxNo: fromMixed ? '2' : '1', quantity: Number(source.reservedQuantity), manualCbm: 0.001 }] })).rejects.toThrow('2단계의 박스 합치기')
    expect(boxes).toEqual(previousBoxes); expect(boxItems).toEqual(previousComponents)
  })

  function existingUnpackedInventory(quantity = 100, totalBoxCount = 4) {
    const tx = measuredInventory(quantity, totalBoxCount)
    Object.assign(inventories[0]!, { reservedQuantity: quantity, availableQuantity: 0, lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: '29', manualCbm: '0.25' })
    shipmentItems.push({ id: 'existing-item', userId: workspaceUserId, shipmentId: 'existing-shipment', inventoryId: 'inventory-a', sku: 'SKU-A', reservedQuantity: quantity, packedQuantity: 0, dispatchedQuantity: 0, sortOrder: 0, boxSplitStatus: 'in_progress' })
    return tx
  }

  it('applies inventory totals to existing unboxed work without reserving stock again and is idempotent', async () => {
    const tx = existingUnpackedInventory()
    const before = structuredClone(inventories[0])
    const input = { userId: workspaceUserId, shipmentId: 'existing-shipment' }
    expect(await applyChinaOutboundInventoryPacking(input)).toEqual({ createdBoxCount: 4, packedQuantity: 100, appliedItemCount: 1, skippedItemCount: 0, preservedBoxCount: 0, missingPackagingCount: 0 })
    expect(boxes.map((box) => box.boxNo)).toEqual(['1', '2', '3', '4'])
    expect(boxItems.map((row) => row.quantity)).toEqual([25, 25, 25, 25])
    for (const row of [...boxes, ...boxItems]) expect(row).toMatchObject({ grossWeightKg: '7.25', manualCbm: '0.0625', lengthCm: '39.69', widthCm: '39.69', heightCm: '39.69' })
    expect(inventories[0]).toEqual({ ...before, packagingReferenceQuantity: 100 })
    expect(movements).toHaveLength(0); expect(purchaseLinks).toHaveLength(0); expect(allocations).toHaveLength(0)
    expect(tx.delete).not.toHaveBeenCalled()
    expect(await applyChinaOutboundInventoryPacking(input)).toEqual({ createdBoxCount: 0, packedQuantity: 0, appliedItemCount: 0, skippedItemCount: 1, preservedBoxCount: 4, missingPackagingCount: 0 })
    expect(boxes).toHaveLength(4)
  })

  it('preserves existing boxes, product allocations, and pallets while appending only the remaining quantities', async () => {
    existingUnpackedInventory()
    boxes.push({ id: 'manual-box', userId: workspaceUserId, shipmentId: 'existing-shipment', boxNo: '1', palletId: 'pallet-1', grossWeightKg: '99', lengthCm: '77', note: '수기 수정', status: 'open', sortOrder: 0 })
    boxItems.push({ id: 'manual-allocation', userId: workspaceUserId, shipmentId: 'existing-shipment', shipmentItemId: 'existing-item', boxId: 'manual-box', quantity: 25, grossWeightKg: '99' })
    shipmentItems[0]!.packedQuantity = 25
    const originals = structuredClone({ box: boxes[0], allocation: boxItems[0], pallets })
    const result = await applyChinaOutboundInventoryPacking({ userId: workspaceUserId, shipmentId: 'existing-shipment' })
    expect(result).toMatchObject({ createdBoxCount: 3, packedQuantity: 75, preservedBoxCount: 1 })
    expect({ box: boxes[0], allocation: boxItems[0], pallets }).toEqual(originals)
    expect(boxes.map((box) => box.boxNo)).toEqual(['1', '2', '3', '4'])
    expect(boxItems.slice(1).map((row) => row.quantity)).toEqual([25, 25, 25])
    expect(shipmentItems[0]).toMatchObject({ reservedQuantity: 100, packedQuantity: 100, boxSplitStatus: 'completed' })
  })

  it('leaves already packed items intact while filling other items and skipping missing packaging', async () => {
    existingUnpackedInventory()
    inventories.push({ id: 'other-inventory', userId: workspaceUserId, onHandQuantity: 20, reservedQuantity: 20, availableQuantity: 0 })
    shipmentItems.push({ id: 'already-packed', userId: workspaceUserId, shipmentId: 'existing-shipment', inventoryId: 'other-inventory', sku: 'SKU-B', reservedQuantity: 20, packedQuantity: 20, sortOrder: 1 })
    shipmentItems.push({ id: 'no-packaging', userId: workspaceUserId, shipmentId: 'existing-shipment', inventoryId: 'missing-inventory', sku: 'SKU-C', reservedQuantity: 5, packedQuantity: 0, sortOrder: 2 })
    boxes.push({ id: 'saved', userId: workspaceUserId, shipmentId: 'existing-shipment', boxNo: '1', status: 'sealed', sortOrder: 0 })
    boxItems.push({ id: 'saved-allocation', userId: workspaceUserId, shipmentId: 'existing-shipment', shipmentItemId: 'already-packed', boxId: 'saved', quantity: 20 })
    const saved = structuredClone({ item: shipmentItems[1], box: boxes[0], allocation: boxItems[0] })
    expect(await applyChinaOutboundInventoryPacking({ userId: workspaceUserId, shipmentId: 'existing-shipment' })).toMatchObject({ createdBoxCount: 4, packedQuantity: 100, appliedItemCount: 1, skippedItemCount: 2, preservedBoxCount: 1, missingPackagingCount: 1 })
    expect({ item: shipmentItems[1], box: boxes[0], allocation: boxItems[0] }).toEqual(saved)
    expect(boxes.slice(1).map((box) => box.boxNo)).toEqual(['2', '3', '4', '5'])
  })

  it('makes no writes when inventory has no packaging and validates all stored allocation counts before applying', async () => {
    const tx = existingUnpackedInventory()
    for (const field of ['totalBoxCount', 'lengthCm', 'widthCm', 'heightCm', 'grossWeightKg', 'manualCbm']) inventories[0]![field] = null
    expect(await applyChinaOutboundInventoryPacking({ userId: workspaceUserId, shipmentId: 'existing-shipment' })).toMatchObject({ createdBoxCount: 0, missingPackagingCount: 1 })
    expect(tx.insert).not.toHaveBeenCalled(); expect(tx.update).not.toHaveBeenCalled()
    inventories[0]!.totalBoxCount = 4
    shipmentItems.push({ id: 'bad-item', userId: workspaceUserId, shipmentId: 'existing-shipment', inventoryId: 'other-inventory', sku: 'SKU-BAD', reservedQuantity: 10, packedQuantity: 3, sortOrder: 1 })
    await expect(applyChinaOutboundInventoryPacking({ userId: workspaceUserId, shipmentId: 'existing-shipment' })).rejects.toThrow('SKU-BAD의 분할 수량')
    expect(tx.insert).not.toHaveBeenCalled(); expect(tx.update).not.toHaveBeenCalled()
  })

  it('does not apply an existing shipment owned by another workspace or a closed shipment', async () => {
    const tx = existingUnpackedInventory()
    await expect(applyChinaOutboundInventoryPacking({ userId: 'foreign-workspace', shipmentId: 'existing-shipment' })).rejects.toThrow('찾을 수 없습니다')
    shipments[0]!.status = 'ready'
    await expect(applyChinaOutboundInventoryPacking({ userId: workspaceUserId, shipmentId: 'existing-shipment' })).rejects.toThrow('초안 또는 포장중')
    expect(tx.insert).not.toHaveBeenCalled(); expect(tx.update).not.toHaveBeenCalled()
  })

  it('applies a 77-item existing work list in bounded batches while preserving its saved box', async () => {
    const tx = makeTransaction(); mocks.transaction.mockImplementation((callback) => callback(tx))
    inventories = Array.from({ length: 77 }, (_, index) => ({ id: `stock-${index}`, userId: workspaceUserId, onHandQuantity: 20, reservedQuantity: 20, availableQuantity: 0, totalBoxCount: 1, grossWeightKg: '5', manualCbm: '0.1' }))
    shipmentItems = inventories.map((inventory, index) => ({ id: `item-${index}`, userId: workspaceUserId, shipmentId: 'existing-shipment', inventoryId: inventory.id, sku: `SKU-${index}`, reservedQuantity: 20, packedQuantity: index === 0 ? 20 : 0, sortOrder: index }))
    boxes = [{ id: 'saved-box', userId: workspaceUserId, shipmentId: 'existing-shipment', boxNo: '1', sortOrder: 0, status: 'open', palletId: 'pallet-1', grossWeightKg: '9' }]
    boxItems = [{ id: 'saved-item', userId: workspaceUserId, shipmentId: 'existing-shipment', shipmentItemId: 'item-0', boxId: 'saved-box', quantity: 20 }]
    const original = structuredClone({ box: boxes[0], allocation: boxItems[0] })
    expect(await applyChinaOutboundInventoryPacking({ userId: workspaceUserId, shipmentId: 'existing-shipment' })).toEqual({ createdBoxCount: 76, packedQuantity: 1520, appliedItemCount: 76, skippedItemCount: 1, preservedBoxCount: 1, missingPackagingCount: 0 })
    expect(boxes).toHaveLength(77)
    expect({ box: boxes[0], allocation: boxItems[0] }).toEqual(original)
    expect(shipmentItems.every((item) => item.packedQuantity === 20)).toBe(true)
    expect(tx.select).toHaveBeenCalledTimes(5)
    expect(tx.insert).toHaveBeenCalledTimes(2)
    expect(tx.update).toHaveBeenCalledTimes(3)
    expect(movements).toEqual([])
  })

  it('automatically creates numbered inventory boxes and preserves their measurement fields on both records', async () => {
    const tx = measuredInventory()
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 100 }] })
    expect(boxes.map((box) => box.boxNo)).toEqual(['1', '2', '3'])
    expect(boxItems.map((row) => row.quantity)).toEqual([34, 33, 33])
    for (const row of [...boxes, ...boxItems]) expect(row).toMatchObject({ userId: workspaceUserId, shipmentId: shipment.id, lengthCm: '50', widthCm: '40', heightCm: '30', grossWeightKg: '2.5', manualCbm: '0.125' })
    expect(boxes.every((box) => box.status === 'open' && box.completionStatus == null && box.palletId == null)).toBe(true)
    expect(shipmentItems[0]).toMatchObject({ packedQuantity: 100, reservedQuantity: 100, boxSplitStatus: 'completed' })
    expect(inventories[0]).toMatchObject({ onHandQuantity: 100, reservedQuantity: 100, availableQuantity: 0, packagingReferenceQuantity: 100, totalBoxCount: 3 })
    expect(tx.insert.mock.calls.filter(([table]) => table === chinaOutboundBoxes)).toHaveLength(1)
    expect(tx.insert.mock.calls.filter(([table]) => table === chinaOutboundBoxItems)).toHaveLength(1)
  })

  it('keeps original carton capacity when subsequent stock has already been dispatched', async () => {
    measuredInventory(80, 10)
    inventories[0]!.packagingReferenceQuantity = 100
    await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 80 }] })
    expect(boxes).toHaveLength(8)
    expect(boxItems.map((row) => row.quantity)).toEqual(Array(8).fill(10))
    expect(inventories[0]).toMatchObject({ packagingReferenceQuantity: 100, totalBoxCount: 10 })
  })

  it('preserves source carton offsets and total precision when 34 units are followed by 66 additional units', async () => {
    measuredInventory(100, 3)
    Object.assign(inventories[0]!, { grossWeightKg: '29', manualCbm: '0.25' })
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 34 }] })
    const initial = structuredClone(boxes[0])
    await addChinaOutboundShipmentItems({ userId: workspaceUserId, createdBy: 'admin', shipmentId: shipment.id, lines: [{ inventoryId: 'inventory-a', quantity: 66 }] })
    expect(boxes).toHaveLength(3)
    expect(boxes[0]).toEqual(initial)
    expect(boxItems.map((row) => row.quantity)).toEqual([34, 33, 33])
    expect(boxes.map((box) => box.grossWeightKg)).toEqual(['9.666', '9.666', '9.668'])
    expect(boxes.map((box) => box.manualCbm)).toEqual(['0.083333', '0.083333', '0.083334'])
    expect(boxes.reduce((sum, box) => sum + Number(box.grossWeightKg), 0)).toBe(29)
    expect(boxes.reduce((sum, box) => sum + Number(box.manualCbm), 0)).toBe(0.25)
    expect(shipmentItems[0]).toMatchObject({ reservedQuantity: 100, packedQuantity: 100, boxSplitStatus: 'completed' })
  })

  it('starts after already dispatched source cartons and retains the last carton precision remainder', async () => {
    measuredInventory(66, 3)
    Object.assign(inventories[0]!, { packagingReferenceQuantity: 100, grossWeightKg: '29', manualCbm: '0.25' })
    await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 66 }] })
    expect(boxItems.map((row) => row.quantity)).toEqual([33, 33])
    expect(boxes.map((box) => box.grossWeightKg)).toEqual(['9.666', '9.668'])
    expect(boxes.map((box) => box.manualCbm)).toEqual(['0.083333', '0.083334'])
  })

  it('prorates a source carton total across partial reservations without counting its weight twice', async () => {
    measuredInventory(100, 4)
    Object.assign(inventories[0]!, { grossWeightKg: '29', manualCbm: '0.25' })
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 20 }] })
    await addChinaOutboundShipmentItems({ userId: workspaceUserId, createdBy: 'admin', shipmentId: shipment.id, lines: [{ inventoryId: 'inventory-a', quantity: 5 }] })
    expect(boxItems.map((row) => row.quantity)).toEqual([20, 5])
    expect(boxes.map((box) => box.grossWeightKg)).toEqual(['5.8', '1.45'])
    expect(boxes.map((box) => box.manualCbm)).toEqual(['0.05', '0.0125'])
    expect(boxes.reduce((sum, box) => sum + Number(box.grossWeightKg), 0)).toBe(7.25)
    expect(boxes.reduce((sum, box) => sum + Number(box.manualCbm), 0)).toBe(0.0625)
  })

  it.each([100, 50])('divides an uploaded four-box total of 29kg and 0.25CBM starting with %s outbound units', async (initialQuantity) => {
    measuredInventory(100, 4)
    Object.assign(inventories[0]!, { grossWeightKg: '29', manualCbm: '0.25', lengthCm: null, widthCm: null, heightCm: null })
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: initialQuantity }] })
    const firstIds = boxes.map((box) => box.id)
    expect(boxes).toHaveLength(initialQuantity / 25)
    expect(boxes[0]).toMatchObject({ grossWeightKg: '7.25', manualCbm: '0.0625', lengthCm: '39.69', widthCm: '39.69', heightCm: '39.69' })
    if (initialQuantity < 100) await addChinaOutboundShipmentItems({ userId: workspaceUserId, createdBy: 'admin', shipmentId: shipment.id, lines: [{ inventoryId: 'inventory-a', quantity: 100 - initialQuantity }] })
    expect(boxes).toHaveLength(4)
    expect(boxes.slice(0, firstIds.length).map((box) => box.id)).toEqual(firstIds)
    expect(boxItems.map((row) => row.quantity)).toEqual([25, 25, 25, 25])
    expect(boxes.reduce((sum, box) => sum + Number(box.grossWeightKg), 0)).toBe(29)
    expect(boxes.reduce((sum, box) => sum + Number(box.manualCbm), 0)).toBe(0.25)
    expect(boxItems.every((row) => row.grossWeightKg === '7.25' && row.manualCbm === '0.0625')).toBe(true)
  })

  it('appends only the added inventory quantity without altering existing carton IDs, edits, or pallet assignments', async () => {
    measuredInventory(100, 10)
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 60 }] })
    Object.assign(boxes[0]!, { boxNo: 'CUSTOM-7', palletId: 'pallet-1', lengthCm: '77', grossWeightKg: '9' })
    const originalBoxes = structuredClone(boxes)
    await addChinaOutboundShipmentItems({ userId: workspaceUserId, createdBy: 'admin', shipmentId: shipment.id, lines: [{ inventoryId: 'inventory-a', quantity: 20 }] })
    expect(boxes.slice(0, 6)).toEqual(originalBoxes)
    expect(boxes.slice(6).map((box) => box.boxNo)).toEqual(['1', '7'])
    expect(boxItems.map((row) => row.quantity)).toEqual(Array(8).fill(10))
    expect(shipmentItems[0]).toMatchObject({ reservedQuantity: 80, packedQuantity: 80, boxSplitStatus: 'completed' })
  })

  it('adds a new warehouse identity with its own measurements and numbers after existing boxes', async () => {
    measuredInventory(10, 2)
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 10 }] })
    inventories.push({ ...inventories[0]!, id: 'inventory-b', warehouseCode: '대량창고', onHandQuantity: 6, reservedQuantity: 0, availableQuantity: 6, totalBoxCount: 1, packagingReferenceQuantity: null, lengthCm: '20', manualCbm: '0.2' })
    await addChinaOutboundShipmentItems({ userId: workspaceUserId, createdBy: 'admin', shipmentId: shipment.id, lines: [{ inventoryId: 'inventory-b', quantity: 6 }] })
    expect(boxes.map((box) => box.boxNo)).toEqual(['1', '2', '3'])
    expect(boxes[2]).toMatchObject({ lengthCm: '20', manualCbm: '0.2' })
    expect(shipmentItems).toEqual(expect.arrayContaining([expect.objectContaining({ inventoryId: 'inventory-a', originWarehouseCode: '중국창고', packedQuantity: 10 }), expect.objectContaining({ inventoryId: 'inventory-b', originWarehouseCode: '대량창고', packedQuantity: 6 })]))
  })

  it('does not repack older manually unpacked stock when only newly added quantity has inventory metadata', async () => {
    const tx = makeTransaction(); mocks.transaction.mockImplementation((callback) => callback(tx))
    const shipment = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 4 }] })
    Object.assign(inventories[0]!, { totalBoxCount: 2, grossWeightKg: '3' })
    await addChinaOutboundShipmentItems({ userId: workspaceUserId, createdBy: 'admin', shipmentId: shipment.id, lines: [{ inventoryId: 'inventory-a', quantity: 2 }] })
    expect(boxItems.map((row) => row.quantity)).toEqual([2])
    expect(shipmentItems[0]).toMatchObject({ reservedQuantity: 6, packedQuantity: 2, boxSplitStatus: 'in_progress' })
  })

  it('retains manual packing when inventory packaging fields are all absent', async () => {
    const tx = makeTransaction(); mocks.transaction.mockImplementation((callback) => callback(tx))
    await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 3 }] })
    expect(boxes).toEqual([]); expect(boxItems).toEqual([])
    expect(inventories[0]!.packagingReferenceQuantity).toBeUndefined()
    expect(shipmentItems[0]).toMatchObject({ packedQuantity: 0, boxSplitStatus: 'in_progress' })
  })

  it('creates count-only boxes with blank measurements and fills missing dimensions from CBM-only metadata', async () => {
    measuredInventory(10, 2)
    Object.assign(inventories[0]!, { lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: null, manualCbm: null })
    await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 5 }] })
    expect(boxes[0]).toMatchObject({ lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: null, manualCbm: null })
    inventories[0]!.manualCbm = '0.25'
    await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 5 }] })
    expect(boxes[1]).toMatchObject({ lengthCm: '50', widthCm: '50', heightCm: '50', grossWeightKg: null, manualCbm: '0.125' })
  })

  it('keeps exact inspection boxes ahead of generic inventory packaging and uses fallback only for uninspected remainder', async () => {
    inspectedLot()
    Object.assign(inventories[0]!, { totalBoxCount: 2, lengthCm: '60', widthCm: '50', heightCm: '40', grossWeightKg: '9', manualCbm: '0.12' })
    purchaseLinks[0]!.receivedQuantity = 6
    const inspection = purchaseItems[0]!.purchaseInspection as { parcels: unknown[] }
    inspection.parcels = [inspection.parcels[0]]
    await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 10 }] })
    expect(boxItems.map((row) => row.quantity)).toEqual([6, 4])
    expect(boxes[0]).toMatchObject({ lengthCm: '50', grossWeightKg: '3' })
    expect(boxes[1]).toMatchObject({ lengthCm: '60', grossWeightKg: '3.6', manualCbm: '0.048' })
    expect(shipmentItems[0]).toMatchObject({ reservedQuantity: 10, packedQuantity: 10 })
  })

  it('skips inventory fallback and inspection boxes when an explicit registration workbook supplies its own packing', async () => {
    inspectedLot()
    Object.assign(inventories[0]!, { totalBoxCount: 2, manualCbm: '0.125' })
    await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', lines: [{ inventoryId: 'inventory-a', quantity: 10 }] }, { initializeInspectionPacking: false })
    expect(boxes).toEqual([]); expect(boxItems).toEqual([])
    expect(inventories[0]!.packagingReferenceQuantity).toBeUndefined()
    expect(shipmentItems[0]).toMatchObject({ packedQuantity: 0 })
    expect(allocations[0]!.inspectionBoxes).toHaveLength(2)
  })

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

  it('deletes only the selected shipment and packing records while releasing its inventory and purchase-lot reservations', async () => {
    inventories[0]!.reservedQuantity = 0
    inventories[0]!.availableQuantity = 10
    shipments = []
    purchaseLinks = [{ id: 'lot-a', userId: workspaceUserId, inventoryId: 'inventory-a', purchaseRequestItemId: 'purchase-a', receivedQuantity: 10, reservedQuantity: 0, dispatchedQuantity: 0 }]
    purchaseItems = [{ id: 'purchase-a', userId: workspaceUserId, rawData: {} }]
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((callback) => callback(tx))
    const first = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', shipmentNo: 'A', lines: [{ inventoryId: 'inventory-a', quantity: 4 }] })
    const second = await createChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', shipmentNo: 'B', lines: [{ inventoryId: 'inventory-a', quantity: 3 }] })
    for (const [index, shipment] of [first, second].entries()) {
      pallets.push({ id: `delete-pallet-${index}`, userId: workspaceUserId, shipmentId: shipment.id })
      boxes.push({ id: `delete-box-${index}`, userId: workspaceUserId, shipmentId: shipment.id, palletId: `delete-pallet-${index}` })
      boxItems.push({ id: `delete-box-item-${index}`, userId: workspaceUserId, shipmentId: shipment.id, boxId: `delete-box-${index}` })
    }

    await expect(deleteChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', shipmentId: first.id })).resolves.toMatchObject({ id: first.id })

    expect(shipments.map((shipment) => shipment.id)).toEqual([second.id])
    expect(inventories[0]).toMatchObject({ onHandQuantity: 10, reservedQuantity: 3, availableQuantity: 7 })
    expect(purchaseLinks[0]).toMatchObject({ reservedQuantity: 3, dispatchedQuantity: 0 })
    expect(purchaseItems[0]).toMatchObject({ status: 'outbound_requested', rawData: { saasChinaReservedQuantity: 3, outboundRequestedQuantity: 3 } })
    for (const rows of [allocations, shipmentItems, boxes, boxItems]) {
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ shipmentId: second.id })
    }
    expect(pallets.some((pallet) => pallet.shipmentId === first.id)).toBe(false)
    expect(pallets.find((pallet) => pallet.id === 'delete-pallet-1')).toMatchObject({ shipmentId: second.id })
    expect(movements.map((movement) => [movement.movementType, movement.onHandDelta, movement.reservedDelta])).toEqual([
      ['shipment_reservation', 0, 4], ['shipment_reservation', 0, 3], ['shipment_release', 0, -4],
    ])
    expect(tx.delete.mock.calls.map(([table]) => table)).toEqual([
      saasChinaShipmentPurchaseAllocations, chinaOutboundBoxItems, chinaOutboundBoxes,
      chinaOutboundPallets, chinaOutboundShipmentItems, chinaOutboundShipments,
    ])
  })

  it('does not delete dispatched work or release its inventory', async () => {
    shipments[0]!.status = 'dispatched'
    const before = JSON.stringify({ shipments, inventories, pallets })
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await expect(deleteChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', shipmentId: 'existing-shipment' })).rejects.toThrow('출고완료')

    expect(JSON.stringify({ shipments, inventories, pallets })).toBe(before)
    expect(tx.delete).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
    expect(movements).toEqual([])
  })

  it('deletes cancelled work without releasing reservations a second time', async () => {
    shipments[0]!.status = 'cancelled'
    const inventoryBefore = structuredClone(inventories)
    shipmentItems = [{ id: 'released-item', userId: workspaceUserId, shipmentId: 'existing-shipment', inventoryId: 'inventory-a', reservedQuantity: 4 }]
    const tx = makeTransaction()
    mocks.transaction.mockImplementation((callback) => callback(tx))

    await deleteChinaOutboundShipment({ userId: workspaceUserId, createdBy: 'admin', shipmentId: 'existing-shipment' })

    expect(shipments).toEqual([])
    expect(shipmentItems).toEqual([])
    expect(pallets).toEqual([])
    expect(inventories).toEqual(inventoryBefore)
    expect(movements).toEqual([])
    expect(tx.update).not.toHaveBeenCalled()
  })
})
