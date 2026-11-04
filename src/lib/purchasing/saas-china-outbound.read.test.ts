import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { chinaOutboundShipmentItems, chinaOutboundShipments, chinaOutboundBoxes, chinaOutboundPallets, chinaOutboundBoxItems, saasChinaInventory, saasChinaShipmentPurchaseAllocations } from '@/lib/db/schema'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))
import { getChinaOutboundShipmentDetail, listSaasChinaOutboundWarehouses } from './saas-china-outbound'

beforeEach(() => vi.clearAllMocks())
describe('China outbound selection reads', () => {
  it('reads a configured warehouse catalog without acquiring the workspace write lock', async () => {
    mocks.execute.mockResolvedValueOnce([{ ready: true }]).mockResolvedValueOnce([
      { warehouseCode: '중국창고', isDefault: true, hasActiveInventory: true, configured: true },
    ])
    expect(await listSaasChinaOutboundWarehouses('owner')).toEqual([{ warehouseCode: '중국창고', isDefault: true, hasActiveInventory: true }])
    expect(mocks.transaction).not.toHaveBeenCalled()
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls.at(-1)![0])
    expect(query.params.every((param) => param === 'owner')).toBe(true)
    expect(query.sql).not.toMatch(/pg_advisory|\b(INSERT|UPDATE)\b/)
  })

  it('loads package and receipt allocations together and keeps all reads workspace scoped', async () => {
    let releaseBoxes!: (rows: unknown[]) => void
    const waitingBoxes = new Promise<unknown[]>((resolve) => { releaseBoxes = resolve })
    const started = new Set<unknown>()
    const clauses: SQL[] = []
    mocks.select.mockImplementation(() => ({ from: (table: unknown) => ({ where: (condition: SQL) => {
      started.add(table); clauses.push(condition)
      const rows = table === chinaOutboundShipments ? [{ id: 'shipment', originWarehouseCode: 'default' }]
        : table === chinaOutboundShipmentItems ? [{ id: 'item', inventoryId: 'inventory', originWarehouseCode: 'snapshot' }]
          : table === saasChinaInventory ? [{ id: 'inventory', warehouseCode: 'renamed', onHandQuantity: 12, availableQuantity: 2 }]
            : table === saasChinaShipmentPurchaseAllocations ? [{ shipmentItemId: 'item', inspectionBoxes: [{ receiptBoxId: 'receipt' }] }]
              : table === chinaOutboundBoxItems ? [{ id: 'allocation', shipmentItemId: 'item', boxId: 'box', quantity: 10 }, { id: 'orphan', shipmentItemId: 'foreign', boxId: 'box', quantity: 1 }]
                : []
      const result = table === chinaOutboundBoxes ? waitingBoxes : Promise.resolve(rows)
      return Object.assign(result, { orderBy: () => result, limit: async (count: number) => (await result).slice(0, count) })
    } }) }))
    const loading = getChinaOutboundShipmentDetail({ userId: 'owner', shipmentId: 'shipment' })
    await vi.waitFor(() => {
      expect(started.has(chinaOutboundBoxItems)).toBe(true)
      expect(started.has(saasChinaShipmentPurchaseAllocations)).toBe(true)
      expect(started.has(chinaOutboundPallets)).toBe(true)
    })
    releaseBoxes([{ id: 'box' }])
    const detail = await loading
    expect(detail?.boxItems).toHaveLength(1)
    expect(detail?.items[0]).toMatchObject({ warehouseCode: 'snapshot', onHandQuantity: 12, availableQuantity: 2, receiptPacking: [{ receiptBoxId: 'receipt' }] })
    for (const clause of clauses) expect(new PgDialect().sqlToQuery(clause).params).toContain('owner')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
