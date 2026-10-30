import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), get: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/purchasing/purchase-requests', () => ({ getPurchaseInspection: mocks.get, savePurchaseInspection: mocks.save }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const id = '00000000-0000-4000-8000-000000000001'
const context = { params: Promise.resolve({ id }) }
const request = (body: unknown) => new NextRequest(`https://app.example/api/purchasing/purchase-requests/${id}/inspection`, { method: 'POST', body: JSON.stringify(body) })
const input = { revision: 0, parcels: [{ id: '00000000-0000-4000-8000-000000000002', trackingNumber: 'SF001', boxes: [{ id: '00000000-0000-4000-8000-000000000003', quantity: null, lengthCm: null, widthCm: null, heightCm: null, weightKg: null }] }] }
describe('purchase inspection endpoints', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: 'staff-id' }); mocks.owner.mockResolvedValue('owner-id'); mocks.get.mockResolvedValue({ id }); mocks.save.mockResolvedValue({ inspection: { revision: 1 }, summary: {} }) })
  it('requires login before any workspace read or write', async () => {
    mocks.user.mockResolvedValue(null)
    expect((await GET(request(null), context)).status).toBe(401)
    expect((await POST(request(input), context)).status).toBe(401)
    expect(mocks.owner).not.toHaveBeenCalled()
  })
  it('reads the shared workspace with no cache', async () => {
    const response = await GET(request(null), context)
    expect(mocks.get).toHaveBeenCalledWith('owner-id', id)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('separates workspace ownership from the real inspector identity', async () => {
    expect((await POST(request(input), context)).status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-id', actorId: 'staff-id', id, data: expect.objectContaining({ revision: 0 }) }))
  })
  it('rejects forged verification fields, invalid IDs and conflicting saves', async () => {
    expect((await POST(request({ ...input, checkedBy: 'forged' }), context)).status).toBe(400)
    expect((await GET(request(null), { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
    mocks.save.mockRejectedValue(new Error('다른 작업자가 검수 정보를 변경했습니다.'))
    expect((await POST(request(input), context)).status).toBe(409)
  })
})
