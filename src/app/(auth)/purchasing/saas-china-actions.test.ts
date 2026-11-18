import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertMenuAccess: vi.fn(),
  revalidatePath: vi.fn(),
  getWorkspaceUserId: vi.fn(),
  getUser: vi.fn(),
  saveBoxSplits: vi.fn(),
  savePalletTare: vi.fn(),
}))

vi.mock('@/lib/auth/menu-access', () => ({ assertMenuAccess: mocks.assertMenuAccess }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.getWorkspaceUserId }))
vi.mock('@/lib/auth/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ saveChinaOutboundItemBoxSplits: mocks.saveBoxSplits, saveChinaOutboundPalletTareWeight: mocks.savePalletTare }))

import { saveChinaOutboundItemBoxSplitsAction, saveChinaOutboundPalletTareWeightAction } from './saas-china-actions'

const shipmentId = '11111111-1111-4111-8111-111111111111'
const shipmentItemId = '22222222-2222-4222-8222-222222222222'

describe('China outbound item box split action weights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertMenuAccess.mockResolvedValue(undefined)
    mocks.getWorkspaceUserId.mockResolvedValue('canonical-owner')
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-login' } }, error: null })
    mocks.saveBoxSplits.mockResolvedValue(undefined)
  })

  it.each([undefined, null, 0.001, 12.345, 999_999_999])('forwards weight %s and preserves omitted versus explicit clear under the canonical workspace', async (weight) => {
    const allocation = { boxNo: '1', quantity: 10, ...(weight !== undefined ? { grossWeightKg: weight } : {}) }
    expect(await saveChinaOutboundItemBoxSplitsAction({ shipmentId, shipmentItemId, allocations: [allocation] })).toEqual({ ok: true })
    expect(mocks.assertMenuAccess).toHaveBeenCalledWith('/purchasing/china-shipments')
    expect(mocks.getWorkspaceUserId).toHaveBeenCalledWith('admin-login')
    expect(mocks.saveBoxSplits).toHaveBeenCalledExactlyOnceWith({ shipmentId, shipmentItemId, allocations: [allocation], userId: 'canonical-owner' })
    if (weight === undefined) expect(mocks.saveBoxSplits.mock.calls[0][0].allocations[0]).not.toHaveProperty('grossWeightKg')
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith('/purchasing/china-shipments')
  })

  it.each([0, -1, 0.0001, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000, '12', ''])('rejects invalid weight %s without invoking the write', async (weight) => {
    const result = await saveChinaOutboundItemBoxSplitsAction({ shipmentId, shipmentItemId, allocations: [{ boxNo: '1', quantity: 10, grossWeightKg: weight }] })
    expect(result.ok).toBe(false)
    expect(mocks.saveBoxSplits).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('returns committed packing state without triggering a complete page reload in fast mode', async () => {
    const savedState = { shipmentId, shipmentItemId, shipmentStatus: 'packing', packedQuantity: 10, boxSplitStatus: 'completed', boxes: [], boxItems: [], reopenedPalletIds: [] }
    mocks.saveBoxSplits.mockResolvedValue(savedState)
    const allocation = { boxNo: '1', quantity: 10 }
    expect(await saveChinaOutboundItemBoxSplitsAction({ shipmentId, shipmentItemId, returnSavedState: true, allocations: [allocation] })).toEqual({ ok: true, savedState })
    expect(mocks.assertMenuAccess).toHaveBeenCalledWith('/purchasing/china-shipments')
    expect(mocks.saveBoxSplits).toHaveBeenCalledExactlyOnceWith({ shipmentId, shipmentItemId, allocations: [allocation], userId: 'canonical-owner' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('reports a failed fast save without returning state or refreshing the page', async () => {
    mocks.saveBoxSplits.mockRejectedValue(new Error('저장 충돌'))
    expect(await saveChinaOutboundItemBoxSplitsAction({ shipmentId, shipmentItemId, returnSavedState: true, allocations: [{ boxNo: '1', quantity: 10 }] })).toEqual({ ok: false, error: '저장 충돌' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each([0, 5, 7.125])('saves editable pallet tare %s under the canonical workspace and refreshes packing documents', async (tareWeightKg) => {
    expect(await saveChinaOutboundPalletTareWeightAction({ shipmentId, palletId: shipmentItemId, tareWeightKg })).toEqual({ ok: true })
    expect(mocks.savePalletTare).toHaveBeenCalledExactlyOnceWith({ shipmentId, palletId: shipmentItemId, tareWeightKg, userId: 'canonical-owner' })
    expect(mocks.assertMenuAccess).toHaveBeenCalledWith('/purchasing/china-shipments')
    expect(mocks.revalidatePath.mock.calls).toEqual([['/purchasing/china-shipments'], ['/purchasing/import-documents']])
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000, '5', null])('rejects invalid pallet tare %s at the action boundary', async (tareWeightKg) => {
    expect((await saveChinaOutboundPalletTareWeightAction({ shipmentId, palletId: shipmentItemId, tareWeightKg })).ok).toBe(false)
    expect(mocks.savePalletTare).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
