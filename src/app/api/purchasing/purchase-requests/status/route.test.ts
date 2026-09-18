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

describe('PATCH /api/purchasing/purchase-requests/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWorkspaceUserId.mockResolvedValue('workspace-user')
  })

  it('revalidates purchase and SaaS pages when one or more bulk status updates succeed', async () => {
    mocks.updatePurchaseRequestStatus.mockResolvedValue({ id: '1685b11a-7b5d-452c-80cb-8ce154ca4c9b' })
    const { PATCH } = await import('./route')

    const response = await PATCH(patchRequest({
      ids: ['1685b11a-7b5d-452c-80cb-8ce154ca4c9b'],
      status: 'china_arrived',
    }) as never)

    expect(response.status).toBe(200)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/purchasing/orders')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/purchasing/saas-china-inventory')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/purchasing/china-shipments')
  })

  it('reports a failed bulk transition as 409 without revalidating pages', async () => {
    mocks.updatePurchaseRequestStatus.mockRejectedValue(new Error('중국출고 작업에서 처리해주세요.'))
    const { PATCH } = await import('./route')

    const response = await PATCH(patchRequest({
      ids: ['1685b11a-7b5d-452c-80cb-8ce154ca4c9b'],
      status: 'outbound_requested',
    }) as never)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      updatedIds: [],
      failed: [{
        id: '1685b11a-7b5d-452c-80cb-8ce154ca4c9b',
        error: '중국출고 작업에서 처리해주세요.',
      }],
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
