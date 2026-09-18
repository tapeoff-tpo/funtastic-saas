import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspaceUserId: vi.fn(),
  revalidatePath: vi.fn(),
  updatePurchaseRequestStatus: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'auth-user' } },
      }),
    },
  }),
}))

vi.mock('@/lib/admin-accounts/queries', () => ({
  getWorkspaceUserId: mocks.getWorkspaceUserId,
}))

vi.mock('@/lib/purchasing/purchase-requests', () => ({
  updatePurchaseRequestStatus: mocks.updatePurchaseRequestStatus,
}))

function patchRequest(body: unknown) {
  return { json: async () => body }
}

describe('PATCH /api/purchasing/purchase-requests/[id]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWorkspaceUserId.mockResolvedValue('workspace-user')
  })

  it('returns a status-transition business rule error as 409', async () => {
    mocks.updatePurchaseRequestStatus.mockRejectedValue(new Error('SaaS 중국재고 연동 발주는 중국출고 작업에서 출고 처리해주세요.'))
    const { PATCH } = await import('./route')

    const response = await PATCH(
      patchRequest({ status: 'outbound_requested' }) as never,
      { params: Promise.resolve({ id: 'purchase-item' }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'SaaS 중국재고 연동 발주는 중국출고 작업에서 출고 처리해주세요.',
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('revalidates both SaaS stock and outbound pages after a successful transition', async () => {
    mocks.updatePurchaseRequestStatus.mockResolvedValue({ id: 'purchase-item' })
    const { PATCH } = await import('./route')

    const response = await PATCH(
      patchRequest({ status: 'china_arrived' }) as never,
      { params: Promise.resolve({ id: 'purchase-item' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/purchasing/saas-china-inventory')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/purchasing/china-shipments')
  })
})
