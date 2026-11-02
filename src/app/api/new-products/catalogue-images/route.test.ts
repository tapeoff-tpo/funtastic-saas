import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), sync: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/new-products/catalogue-images', () => ({ syncNewProductCatalogueImages: mocks.sync }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { POST } from './route'
const request = (body: unknown) => new Request('https://local/api/new-products/catalogue-images', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: 'staff' }); mocks.owner.mockResolvedValue('workspace'); mocks.sync.mockResolvedValue({ results: [], nextCursor: null }) })
describe('copy product-management images', () => {
  it('records the real actor and shared workspace rather than accepting ownership from the client', async () => {
    expect((await POST(request({ userId: 'other-workspace' }))).status).toBe(200)
    expect(mocks.sync).toHaveBeenCalledWith({ userId: 'workspace', actorId: 'staff' })
  })
  it('rejects anonymous, password-restricted and malformed requests without writes', async () => {
    mocks.user.mockResolvedValueOnce(null)
    expect((await POST(request({}))).status).toBe(401)
    mocks.user.mockResolvedValueOnce({ id: 'staff', mustChangePassword: true })
    expect((await POST(request({}))).status).toBe(401)
    expect((await POST(request({ after: 'not-a-uuid' }))).status).toBe(400)
    expect(mocks.sync).not.toHaveBeenCalled()
  })
})
