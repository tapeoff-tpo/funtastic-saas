import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspaceUserId: vi.fn(),
  revalidatePath: vi.fn(),
  applyPurchaseRequest1688TrackingLookup: vi.fn(),
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
  applyPurchaseRequest1688TrackingLookup: mocks.applyPurchaseRequest1688TrackingLookup,
}))

function postRequest(body: unknown) {
  return { json: async () => body }
}

describe('POST /api/purchasing/purchase-requests/[id]/1688-tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWorkspaceUserId.mockResolvedValue('workspace-user')
  })

  it('applies the browser lookup result through the guarded purchasing service', async () => {
    mocks.applyPurchaseRequest1688TrackingLookup.mockResolvedValue({ id: 'purchase-item' })
    const { POST } = await import('./route')

    const response = await POST(
      postRequest({
        orderNumber: '3317159640039018761',
        trackingNumbers: ['S71268668516', 'S71268668517'],
        trackingSource: 'waybill_number',
      }) as never,
      { params: Promise.resolve({ id: 'purchase-item' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.applyPurchaseRequest1688TrackingLookup).toHaveBeenCalledWith({
      userId: 'workspace-user',
      id: 'purchase-item',
      supplierOrderNumber: '3317159640039018761',
      trackingNumbers: ['S71268668516', 'S71268668517'],
    })
    await expect(response.json()).resolves.toEqual({ id: 'purchase-item', trackingCount: 2 })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/purchasing/orders')
  })

  it('rejects an invalid 1688 order number before mutating the purchase item', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      postRequest({ orderNumber: 'not-an-order', trackingNumbers: ['S71268668516'], trackingSource: 'waybill_number' }) as never,
      { params: Promise.resolve({ id: 'purchase-item' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: '1688 송장 조회 결과가 올바르지 않습니다.' })
    expect(mocks.applyPurchaseRequest1688TrackingLookup).not.toHaveBeenCalled()
  })

  it('rejects a legacy extension result that cannot attest to the 运单号码 source', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      postRequest({ orderNumber: '3317159640039018761', trackingNumbers: ['LP00850611544129'] }) as never,
      { params: Promise.resolve({ id: 'purchase-item' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: '운송장번호 추출 확장프로그램을 1.9.0 이상으로 업데이트해주세요. 运单号码만 저장합니다.' })
    expect(mocks.applyPurchaseRequest1688TrackingLookup).not.toHaveBeenCalled()
  })

  it('does not overwrite a row when the service detects a newer manual update', async () => {
    mocks.applyPurchaseRequest1688TrackingLookup.mockRejectedValue(
      new Error('이미 등록된 송장 또는 검수 정보가 있어 1688 조회 결과를 덮어쓰지 않았습니다.'),
    )
    const { POST } = await import('./route')

    const response = await POST(
      postRequest({ orderNumber: '3317159640039018761', trackingNumbers: ['S71268668516'], trackingSource: 'waybill_number' }) as never,
      { params: Promise.resolve({ id: 'purchase-item' }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: '이미 등록된 송장 또는 검수 정보가 있어 1688 조회 결과를 덮어쓰지 않았습니다.',
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
