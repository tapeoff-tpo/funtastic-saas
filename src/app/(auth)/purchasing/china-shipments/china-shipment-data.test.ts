import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ detail: vi.fn(), stock: vi.fn(), images: vi.fn(), names: vi.fn() }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ getChinaOutboundShipmentDetail: mocks.detail, getSaasChinaInventory: mocks.stock }))
vi.mock('@/lib/new-products/catalogue-images', () => ({ findSavedNewProductImagesBatch: mocks.images }))
vi.mock('@/lib/purchasing/items', () => ({ getPurchasingItemLabelDataBySku: mocks.names }))
import { loadChinaShipmentDetailView } from './china-shipment-data'

beforeEach(() => vi.resetAllMocks())
it('starts Chinese names without waiting for photo lookup and preserves measurement snapshots', async () => {
  let release!: (value: object) => void
  mocks.images.mockReturnValue(new Promise((resolve) => { release = resolve }))
  mocks.names.mockResolvedValue(new Map([['SKU1', { chineseProductName: '主数据名称' }]]))
  mocks.detail.mockResolvedValue({
    shipment: { id: 'shipment', createdAt: new Date() },
    items: [{ id: 'item', sku: 'SKU1', chineseProductName: '已确认名称', packedQuantity: 1, reservedQuantity: 1 }],
    pallets: [{ id: 'pallet', grossWeightKg: '20.125', lengthCm: '120', widthCm: '100', heightCm: '150' }],
    boxes: [{ id: 'box', grossWeightKg: '5.125' }], boxItems: [],
  })
  const pending = loadChinaShipmentDetailView('owner', 'shipment')
  await vi.waitFor(() => expect(mocks.names).toHaveBeenCalledWith('owner', ['SKU1']))
  expect(mocks.images).toHaveBeenCalledTimes(1)
  release({})
  const result = await pending
  expect(result?.items[0].chineseProductName).toBe('已确认名称')
  expect(result?.pallets[0]).toMatchObject({ grossWeightKg: 20.125, lengthCm: 120, widthCm: 100, heightCm: 150 })
  expect(result?.boxes[0].grossWeightKg).toBe(5.125)
  expect(mocks.stock).not.toHaveBeenCalled()
})
it('does no catalogue work for a missing or unauthorized shipment', async () => {
  mocks.detail.mockResolvedValue(null)
  expect(await loadChinaShipmentDetailView('owner', 'other')).toBeNull()
  expect(mocks.images).not.toHaveBeenCalled(); expect(mocks.names).not.toHaveBeenCalled()
})
