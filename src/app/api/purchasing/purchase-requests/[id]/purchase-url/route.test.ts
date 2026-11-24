import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), owner: vi.fn(), confirm: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/auth/menu-access', () => ({ getUserMenuAccess: mocks.access }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/purchasing/purchase-url-sync', () => ({ confirmPurchaseOrderProductUrl: mocks.confirm }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { POST } from './route'
const url = 'https://detail.1688.com/offer/111111111111.html'
const body = { orderNumber: '1234567890123', url, expectedUrl: null }
const request = (value: unknown) => ({ json: async () => value }) as never
const params = { params: Promise.resolve({ id: 'request1' }) }
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: 'staff', mustChangePassword: false })
  mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/purchasing/orders'] })
  mocks.owner.mockResolvedValue('workspace-owner'); mocks.confirm.mockResolvedValue({ url, updatedProducts: 1, updatedWorkflow: 1 })
})
describe('confirm per-product order offer', () => {
  it('uses the signing-in permissions and writes within the canonical workspace', async () => {
    const response = await POST(request(body), params)
    expect(response.status).toBe(200)
    expect(mocks.confirm).toHaveBeenCalledWith({ userId: 'workspace-owner', requestId: 'request1', ...body })
    expect(mocks.revalidate).toHaveBeenCalledWith('/purchasing/orders')
    expect(mocks.revalidate).toHaveBeenCalledWith('/new-products')
  })
  it('blocks anonymous and forbidden requests before reading/writing order data', async () => {
    mocks.user.mockResolvedValue(null)
    expect((await POST(request(body), params)).status).toBe(401)
    mocks.user.mockResolvedValue({ id: 'reviewer' }); mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/purchasing/purchases'] })
    expect((await POST(request(body), params)).status).toBe(403)
    expect(mocks.owner).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled()
  })
  it('validates the order and explicit previous URL and returns a concurrent selection conflict', async () => {
    expect((await POST(request({ ...body, orderNumber: 'invalid' }), params)).status).toBe(400)
    mocks.confirm.mockRejectedValue(new Error('상품 링크가 변경됐습니다.'))
    expect((await POST(request(body), params)).status).toBe(409)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
