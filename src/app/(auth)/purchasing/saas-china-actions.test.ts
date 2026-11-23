import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertMenuAccess: vi.fn(),
  revalidatePath: vi.fn(),
  getWorkspaceUserId: vi.fn(),
  getUser: vi.fn(),
  saveBoxSplits: vi.fn(),
  savePalletTare: vi.fn(),
  saveBoxesMeasurements: vi.fn(),
  saveBoxDimensions: vi.fn(),
  savePalletDimensions: vi.fn(),
  applyInventoryPacking: vi.fn(),
}))

vi.mock('@/lib/auth/menu-access', () => ({ assertMenuAccess: mocks.assertMenuAccess }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.getWorkspaceUserId }))
vi.mock('@/lib/auth/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ applyChinaOutboundInventoryPacking: mocks.applyInventoryPacking, saveChinaOutboundItemBoxSplits: mocks.saveBoxSplits, saveChinaOutboundPalletTareWeight: mocks.savePalletTare, saveChinaOutboundBoxesMeasurements: mocks.saveBoxesMeasurements, saveChinaOutboundBoxDimensions: mocks.saveBoxDimensions, saveChinaOutboundPalletDimensions: mocks.savePalletDimensions }))

import { applyChinaOutboundInventoryPackingAction, saveChinaOutboundItemBoxSplitsAction, saveChinaOutboundPalletTareWeightAction, saveChinaOutboundBoxesMeasurementsAction, saveChinaOutboundBoxDimensionsAction, saveChinaOutboundPalletDimensionsAction } from './saas-china-actions'

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

  it('applies inventory packaging to the selected existing work under the canonical workspace', async () => {
    const summary = { createdBoxCount: 4, packedQuantity: 100, appliedItemCount: 1, skippedItemCount: 1, preservedBoxCount: 1, missingPackagingCount: 0 }
    mocks.applyInventoryPacking.mockResolvedValueOnce(summary)
    expect(await applyChinaOutboundInventoryPackingAction({ shipmentId, userId: 'untrusted-owner' })).toEqual({ ok: true, inventoryPacking: summary })
    expect(mocks.applyInventoryPacking).toHaveBeenCalledExactlyOnceWith({ shipmentId, userId: 'canonical-owner' })
    expect(mocks.assertMenuAccess).toHaveBeenCalledWith('/purchasing/china-shipments')
    expect(mocks.revalidatePath.mock.calls).toEqual([['/purchasing/china-shipments'], ['/purchasing/import-documents']])
  })

  it('rejects invalid or unauthenticated existing-work packing requests before a write', async () => {
    expect((await applyChinaOutboundInventoryPackingAction({ shipmentId: 'invalid' })).ok).toBe(false)
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect((await applyChinaOutboundInventoryPackingAction({ shipmentId })).ok).toBe(false)
    expect(mocks.applyInventoryPacking).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
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

  it.each([{ lengthCm: 50, widthCm: 40, heightCm: 30 }, { grossWeightKg: 7.125 }, { lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 12 }])('applies selected box measurements under the canonical workspace (%j)', async (measurements) => {
    const input = { shipmentId, boxIds: [shipmentItemId], ...measurements }
    expect(await saveChinaOutboundBoxesMeasurementsAction(input)).toEqual({ ok: true })
    expect(mocks.assertMenuAccess).toHaveBeenCalledWith('/purchasing/china-shipments')
    expect(mocks.getWorkspaceUserId).toHaveBeenCalledWith('admin-login')
    expect(mocks.saveBoxesMeasurements).toHaveBeenCalledExactlyOnceWith({ ...input, userId: 'canonical-owner' })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/purchasing/china-shipments')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/purchasing/import-documents')
  })

  it.each([
    {}, { lengthCm: 10 }, { lengthCm: 10, widthCm: 20 }, { lengthCm: null, widthCm: 20, heightCm: 30 },
    { grossWeightKg: null }, { grossWeightKg: 0 }, { grossWeightKg: 0.0001 }, { grossWeightKg: '5' }, { grossWeightKg: Number.POSITIVE_INFINITY },
  ])('rejects invalid bulk measurements without reaching the service (%j)', async (measurements) => {
    expect((await saveChinaOutboundBoxesMeasurementsAction({ shipmentId, boxIds: [shipmentItemId], ...measurements })).ok).toBe(false)
    expect(mocks.saveBoxesMeasurements).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects an empty bulk selection', async () => {
    expect((await saveChinaOutboundBoxesMeasurementsAction({ shipmentId, boxIds: [], grossWeightKg: 5 })).ok).toBe(false)
    expect(mocks.saveBoxesMeasurements).not.toHaveBeenCalled()
  })

  it.each([0.000001, 0.123456, null])('forwards independent manual CBM %s without requiring dimensions or weight', async (manualCbm) => {
    const allocation = { boxNo: '1', quantity: 10, manualCbm }
    expect(await saveChinaOutboundItemBoxSplitsAction({ shipmentId, shipmentItemId, allocations: [allocation] })).toEqual({ ok: true })
    expect(mocks.saveBoxSplits).toHaveBeenCalledWith({ shipmentId, shipmentItemId, allocations: [allocation], userId: 'canonical-owner' })
    const dimensions = { lengthCm: null, widthCm: null, heightCm: null, manualCbm }
    expect(await saveChinaOutboundBoxDimensionsAction({ shipmentId, boxId: shipmentItemId, ...dimensions })).toEqual({ ok: true })
    expect(mocks.saveBoxDimensions).toHaveBeenCalledWith({ shipmentId, boxId: shipmentItemId, ...dimensions, userId: 'canonical-owner' })
    mocks.revalidatePath.mockClear()
    expect(await saveChinaOutboundPalletDimensionsAction({ shipmentId, palletId: shipmentItemId, ...dimensions })).toEqual({ ok: true })
    expect(mocks.savePalletDimensions).toHaveBeenCalledWith({ shipmentId, palletId: shipmentItemId, ...dimensions, userId: 'canonical-owner' })
    expect(mocks.revalidatePath.mock.calls).toEqual([['/purchasing/china-shipments']])
    expect(await saveChinaOutboundBoxesMeasurementsAction({ shipmentId, boxIds: [shipmentItemId], manualCbm })).toEqual({ ok: true })
    expect(mocks.saveBoxesMeasurements).toHaveBeenCalledWith({ shipmentId, boxIds: [shipmentItemId], manualCbm, userId: 'canonical-owner' })
  })

  it.each([0, -1, 0.0000001, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000, '0.1'])('rejects invalid manual CBM %s at every action boundary', async (manualCbm) => {
    expect((await saveChinaOutboundItemBoxSplitsAction({ shipmentId, shipmentItemId, allocations: [{ boxNo: '1', quantity: 10, manualCbm }] })).ok).toBe(false)
    expect((await saveChinaOutboundBoxDimensionsAction({ shipmentId, boxId: shipmentItemId, lengthCm: null, widthCm: null, heightCm: null, manualCbm })).ok).toBe(false)
    expect((await saveChinaOutboundPalletDimensionsAction({ shipmentId, palletId: shipmentItemId, lengthCm: null, widthCm: null, heightCm: null, manualCbm })).ok).toBe(false)
    expect((await saveChinaOutboundBoxesMeasurementsAction({ shipmentId, boxIds: [shipmentItemId], manualCbm })).ok).toBe(false)
    expect(mocks.saveBoxSplits).not.toHaveBeenCalled()
    expect(mocks.saveBoxDimensions).not.toHaveBeenCalled()
    expect(mocks.savePalletDimensions).not.toHaveBeenCalled()
    expect(mocks.saveBoxesMeasurements).not.toHaveBeenCalled()
  })
})
