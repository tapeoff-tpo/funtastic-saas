import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspaceUserId: vi.fn(),
  revalidatePath: vi.fn(),
  deletePurchaseRequestItem: vi.fn(),
  updatePurchaseRequestPlanFields: vi.fn(),
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
  deletePurchaseRequestItem: mocks.deletePurchaseRequestItem,
  updatePurchaseRequestPlanFields: mocks.updatePurchaseRequestPlanFields,
}))

function patchRequest(body: unknown) {
  return { json: async () => body }
}

describe('PATCH /api/purchasing/purchase-requests/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWorkspaceUserId.mockResolvedValue('workspace-user')
  })

  it('returns a business rule error as 409 without revalidating stale pages', async () => {
    mocks.updatePurchaseRequestPlanFields.mockRejectedValue(new Error('SaaS 중국재고에 이미 출고 예약된 수량보다 적게 입고수량을 변경할 수 없습니다.'))
    const { PATCH } = await import('./route')

    const response = await PATCH(
      patchRequest({ chinaReceivedQuantity: 4 }) as never,
      { params: Promise.resolve({ id: 'purchase-item' }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'SaaS 중국재고에 이미 출고 예약된 수량보다 적게 입고수량을 변경할 수 없습니다.',
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('revalidates both SaaS stock and outbound pages after a successful update', async () => {
    mocks.updatePurchaseRequestPlanFields.mockResolvedValue({
      id: 'purchase-item',
      excludedRecommendationCount: 0,
    })
    const { PATCH } = await import('./route')

    const response = await PATCH(
      patchRequest({ saasChinaMode: true }) as never,
      { params: Promise.resolve({ id: 'purchase-item' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/purchasing/saas-china-inventory')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/purchasing/china-shipments')
  })

  it('returns a linked SaaS purchase deletion rule as 409', async () => {
    mocks.deletePurchaseRequestItem.mockRejectedValue(new Error('SaaS 중국재고 또는 중국출고와 연결된 발주는 삭제할 수 없습니다.'))
    const { DELETE } = await import('./route')

    const response = await DELETE(
      patchRequest({}) as never,
      { params: Promise.resolve({ id: 'purchase-item' }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'SaaS 중국재고 또는 중국출고와 연결된 발주는 삭제할 수 없습니다.',
    })
  })
})
