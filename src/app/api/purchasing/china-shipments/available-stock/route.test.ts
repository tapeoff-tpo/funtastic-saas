import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), owner: vi.fn(), stock: vi.fn(), names: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/auth/menu-access', () => ({ assertMenuAccess: mocks.access }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ getSaasChinaInventory: mocks.stock }))
vi.mock('@/lib/purchasing/items', () => ({ getPurchasingItemLabelDataBySku: mocks.names }))
import { GET } from './route'

beforeEach(() => vi.resetAllMocks())
it('rejects unauthenticated stock access', async () => {
  mocks.user.mockResolvedValue(null)
  expect((await GET()).status).toBe(401)
  expect(mocks.stock).not.toHaveBeenCalled()
})
it('resolves the shared owner and returns only available stock with Chinese names and receipt dates', async () => {
  mocks.user.mockResolvedValue({ id: 'admin-other' }); mocks.owner.mockResolvedValue('canonical-owner')
  mocks.stock.mockResolvedValue({ items: [
    { id: 'available', sku: 'SKU1', productName: '상품', availableQuantity: 2, lastReceivedAt: new Date('2026-11-03T00:00:00Z') },
    { id: 'reserved', sku: 'SKU2', availableQuantity: 0 },
  ] })
  mocks.names.mockResolvedValue(new Map([['SKU1', { chineseProductName: '商品' }]]))
  const response = await GET()
  expect(mocks.access).toHaveBeenCalledWith('/purchasing/china-shipments')
  expect(mocks.stock).toHaveBeenCalledWith('canonical-owner')
  expect(mocks.names).toHaveBeenCalledWith('canonical-owner', ['SKU1'])
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect((await response.json()).items).toMatchObject([{ id: 'available', chineseProductName: '商品', lastReceivedAt: '2026-11-03T00:00:00.000Z' }])
})
it('preserves saved product and material categories per available inventory row under the owner', async () => {
  mocks.user.mockResolvedValue({ id: 'admin-other' }); mocks.owner.mockResolvedValue('canonical-owner')
  mocks.stock.mockResolvedValue({ items: [
    { id: 'product-stock', warehouseCode: '중국창고', sku: 'SKU1', productName: '상품', itemCategory: '[상품]', availableQuantity: 6 },
    { id: 'material-stock', warehouseCode: '부자재창고', sku: 'SKU1', productName: '상품', itemCategory: '[부재료]', availableQuantity: 4 },
    { id: 'legacy-stock', warehouseCode: '중국창고', sku: 'SKU2', productName: '기존 상품', availableQuantity: 1 },
    { id: 'reserved-stock', warehouseCode: '중국창고', sku: 'SKU3', itemCategory: '[원재료]', availableQuantity: 0 },
  ] })
  mocks.names.mockResolvedValue(new Map())
  const response = await GET()
  expect(mocks.owner).toHaveBeenCalledWith('admin-other')
  expect(mocks.stock).toHaveBeenCalledWith('canonical-owner')
  expect(mocks.names).toHaveBeenCalledWith('canonical-owner', ['SKU1', 'SKU1', 'SKU2'])
  expect((await response.json()).items).toMatchObject([
    { id: 'product-stock', sku: 'SKU1', itemCategory: '[상품]', availableQuantity: 6 },
    { id: 'material-stock', sku: 'SKU1', itemCategory: '[부재료]', availableQuantity: 4 },
    { id: 'legacy-stock', sku: 'SKU2', itemCategory: null, availableQuantity: 1 },
  ])
})
