import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), sync: vi.fn(), mark: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/auth/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/purchasing/purchase-url-sync', () => ({ syncPurchaseUrlsFromHistory: mocks.sync }))
vi.mock('@/lib/purchasing/purchase-url-collector', () => ({ getPurchaseUrlVerificationQueue: vi.fn(), markPurchaseUrlsForVerification: mocks.mark }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { POST } from './route'
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: 'staff' } } }); mocks.owner.mockResolvedValue('owner') })
const req = (body: unknown) => ({ json: async () => body }) as never
describe('purchase URL history sync API', () => {
  it('synchronizes the canonical workspace, then refreshes both item screens', async () => {
    mocks.sync.mockResolvedValue({ updatedProducts: 2, updatedWorkflow: 3 })
    const result = await POST(req({ action: 'sync' }))
    expect(await result.json()).toEqual({ updatedProducts: 2, updatedWorkflow: 3 })
    expect(mocks.sync).toHaveBeenCalledWith('owner')
    expect(mocks.revalidate).toHaveBeenCalledWith('/costs')
    expect(mocks.revalidate).toHaveBeenCalledWith('/new-products')
  })
  it('reports replacement counts after a failed URL check', async () => {
    mocks.mark.mockResolvedValue({ updated: [{ id: 'master' }], replaced: 1, updatedWorkflow: 2 })
    const result = await POST(req({ url: 'https://detail.1688.com/offer/111111111111.html', skus: ['123456-0001'] }))
    expect(await result.json()).toEqual({ updated: 1, replaced: 1, updatedWorkflow: 2 })
  })
  it('blocks anonymous sync requests before any write', async () => {
    mocks.user.mockResolvedValue({ data: { user: null } })
    expect((await POST(req({ action: 'sync' }))).status).toBe(401)
    expect(mocks.sync).not.toHaveBeenCalled()
  })
})
