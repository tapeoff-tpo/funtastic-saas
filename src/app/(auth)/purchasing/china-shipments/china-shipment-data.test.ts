import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ detail: vi.fn(), stock: vi.fn(), images: vi.fn(), names: vi.fn() }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ getChinaOutboundShipmentDetail: mocks.detail, getSaasChinaInventory: mocks.stock }))
vi.mock('@/lib/new-products/catalogue-images', () => ({ findSavedNewProductImagesBatch: mocks.images }))
vi.mock('@/lib/purchasing/items', () => ({ getPurchasingItemLabelDataBySku: mocks.names }))
import { loadChinaShipmentDetailView, loadChinaShipmentStockItems } from './china-shipment-data'

beforeEach(() => vi.resetAllMocks())
it('starts Chinese names without waiting for photo lookup and preserves measurement snapshots', async () => {
  let release!: (value: object) => void
  mocks.images.mockReturnValue(new Promise((resolve) => { release = resolve }))
  mocks.names.mockResolvedValue(new Map([['SKU2', { chineseProductName: '主数据名称' }]]))
  mocks.detail.mockResolvedValue({
    shipment: { id: 'shipment', createdAt: new Date() },
    items: [
      { id: 'item', sku: 'SKU1', chineseProductName: '已确认名称', packedQuantity: 1, reservedQuantity: 1 },
      { id: 'missing-name', sku: 'SKU2', chineseProductName: '', packedQuantity: 0, reservedQuantity: 1 },
    ],
    pallets: [{ id: 'pallet', palletNo: '1', grossWeightKg: '20.125', lengthCm: '120', widthCm: '100', heightCm: '150', manualCbm: '1.25' }],
    boxes: [{ id: 'box', grossWeightKg: '5.125', manualCbm: '0.125', inventoryPackingGroupKey: 'mixed-source', inventoryPackingGroupBoxIndex: 0 }], boxItems: [{ id: 'allocation', boxId: 'box', shipmentItemId: 'item', quantity: 1, manualCbm: '0.125' }],
  })
  const pending = loadChinaShipmentDetailView('owner', 'shipment')
  await vi.waitFor(() => expect(mocks.names).toHaveBeenCalledWith('owner', ['SKU2']))
  expect(mocks.images).toHaveBeenCalledTimes(1)
  release({})
  const result = await pending
  expect(result?.items[0].chineseProductName).toBe('已确认名称')
  expect(result?.items[1].chineseProductName).toBe('主数据名称')
  expect(result?.pallets[0]).toMatchObject({ grossWeightKg: 20.125, lengthCm: 120, widthCm: 100, heightCm: 150, manualCbm: 1.25 })
  expect(result?.boxes[0].grossWeightKg).toBe(5.125)
  expect(result?.boxes[0].manualCbm).toBe(0.125)
  expect(result?.boxes[0]).toMatchObject({ inventoryPackingGroupKey: 'mixed-source', inventoryPackingGroupBoxIndex: 0 })
  expect(result?.boxItems[0].manualCbm).toBe(0.125)
  expect(mocks.stock).not.toHaveBeenCalled()
})
it('skips the item-master name lookup when every shipment item already has its confirmed name', async () => {
  mocks.images.mockResolvedValue({})
  mocks.detail.mockResolvedValue({
    shipment: { id: 'shipment', createdAt: new Date() },
    items: [{ id: 'item', sku: 'SKU1', chineseProductName: '已确认名称', packedQuantity: 1, reservedQuantity: 1 }],
    pallets: [], boxes: [], boxItems: [],
  })
  const result = await loadChinaShipmentDetailView('owner', 'shipment')
  expect(result?.items[0].chineseProductName).toBe('已确认名称')
  expect(mocks.names).not.toHaveBeenCalled()
})
it('does no catalogue work for a missing or unauthorized shipment', async () => {
  mocks.detail.mockResolvedValue(null)
  expect(await loadChinaShipmentDetailView('owner', 'other')).toBeNull()
  expect(mocks.images).not.toHaveBeenCalled(); expect(mocks.names).not.toHaveBeenCalled()
})
it('preserves each saved stock category without merging identical SKUs across locations', async () => {
  mocks.stock.mockResolvedValue({ items: [
    { id: 'product-stock', warehouseCode: '중국창고', sku: 'SKU1', productName: '상품', itemCategory: '[상품]', optionName: '대', onHandQuantity: 8, reservedQuantity: 2, availableQuantity: 6 },
    { id: 'material-stock', warehouseCode: '부자재창고', sku: 'SKU1', productName: '상품', itemCategory: '[부재료]', optionName: '대', onHandQuantity: 4, reservedQuantity: 0, availableQuantity: 4 },
    { id: 'legacy-stock', warehouseCode: '중국창고', sku: 'SKU2', productName: '기존 상품', optionName: null, onHandQuantity: 1, reservedQuantity: 0, availableQuantity: 1 },
  ] })
  mocks.names.mockResolvedValue(new Map([['SKU1', { chineseProductName: '商品' }]]))
  const items = await loadChinaShipmentStockItems('canonical-owner')
  expect(mocks.stock).toHaveBeenCalledWith('canonical-owner')
  expect(mocks.names).toHaveBeenCalledWith('canonical-owner', ['SKU1', 'SKU1', 'SKU2'])
  expect(items).toMatchObject([
    { id: 'product-stock', sku: 'SKU1', itemCategory: '[상품]', availableQuantity: 6, chineseProductName: '商品' },
    { id: 'material-stock', sku: 'SKU1', itemCategory: '[부재료]', availableQuantity: 4, chineseProductName: '商品' },
    { id: 'legacy-stock', sku: 'SKU2', itemCategory: null, availableQuantity: 1 },
  ])
  expect(mocks.images).not.toHaveBeenCalled()
})

it('shows legacy box-labelled pallets as loose boxes without changing source data', async () => {
  const source = { shipment: { id: 'shipment', createdAt: new Date() }, items: [],
    pallets: [{ id: 'numeric', palletNo: '1' }, { id: 'loose', palletNo: 'box' }],
    boxes: [{ id: 'boxed', palletId: 'loose' }, { id: 'palletized', palletId: 'numeric' }], boxItems: [] }
  mocks.detail.mockResolvedValue(source)
  mocks.images.mockResolvedValue({})
  const view = await loadChinaShipmentDetailView('owner', 'shipment')
  expect(view!.pallets.map((p) => p.palletNo)).toEqual(['1'])
  expect(view!.boxes.find((b) => b.id === 'boxed')!.palletId).toBeNull()
  expect(view!.boxes.find((b) => b.id === 'palletized')!.palletId).toBe('numeric')
  expect(source.boxes[0].palletId).toBe('loose')
})
