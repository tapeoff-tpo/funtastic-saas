import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), select: vi.fn(), saved: vi.fn(), resolve: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/db', () => ({ db: { select: mocks.select } }))
vi.mock('@/lib/new-products/catalogue-images', () => ({ findSavedNewProductImages: mocks.saved }))
vi.mock('@/lib/purchasing/product-image-catalogue', () => ({ resolvePurchasingProductImages: mocks.resolve }))
import { GET } from './route'

const id = '00000000-0000-4000-8000-000000000001'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ id: 'staff' }); mocks.owner.mockResolvedValue('workspace')
  const where = () => ({ limit: async () => [{ sku: 'SKU-1', productName: '상품 A', images: [{ url: '/image.jpg', sortOrder: 0 }] }] })
  mocks.select.mockImplementation(() => ({ from: () => ({ where, innerJoin: () => ({ where }) }) }))
  mocks.saved.mockResolvedValue([])
  mocks.resolve.mockResolvedValue({ source: 'item-master', imageUrls: ['/image.jpg'] })
})
describe('authenticated product images', () => {
  it('uses shared workspace ownership and prefers saved product-management images', async () => {
    mocks.saved.mockResolvedValue([{ url: '/api/purchasing/product-images/files/saved', sortOrder: 0 }])
    const response = await GET(new Request(`https://local/product-images?shipmentItemId=${id}`))
    expect(response.status).toBe(200)
    expect(mocks.owner).toHaveBeenCalledWith('staff')
    expect(mocks.saved).toHaveBeenCalledWith('workspace', 'SKU-1', '상품 A')
    expect(await response.json()).toMatchObject({ source: 'product-management', imageUrls: ['/api/purchasing/product-images/files/saved'] })
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('rejects anonymous requests and missing or conflicting references before reading data', async () => {
    mocks.user.mockResolvedValueOnce(null)
    expect((await GET(new Request(`https://local/product-images?purchaseItemId=${id}`))).status).toBe(401)
    expect((await GET(new Request(`https://local/product-images?purchaseItemId=${id}&shipmentItemId=${id}`))).status).toBe(400)
    expect((await GET(new Request('https://local/product-images?sku=untrusted'))).status).toBe(400)
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it('returns retryable catalogue errors without claiming that the product has no images', async () => {
    mocks.resolve.mockRejectedValue(new Error('offline'))
    const response = await GET(new Request(`https://local/product-images?purchaseItemId=${id}&catalogue=1`))
    expect(response.status).toBe(502)
    expect(mocks.saved).not.toHaveBeenCalled()
  })
})
