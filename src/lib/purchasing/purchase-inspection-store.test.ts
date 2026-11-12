import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPurchaseRequest1688TrackingLookup, savePurchaseInspection, updatePurchaseRequestPlanFields, updatePurchaseRequestStatus } from './purchase-requests'
import { type PurchaseInspection } from './purchase-inspection'

const fixture = vi.hoisted(() => ({
  current: {} as Record<string, unknown>, writes: [] as Array<Record<string, unknown>>,
  receive: vi.fn(), adjust: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: { transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
  execute: vi.fn(), select: () => ({ from: () => ({ where: () => ({ limit: async () => [fixture.current], for: async () => [fixture.current] }) }) }),
  update: () => ({ set: (values: Record<string, unknown>) => { fixture.writes.push(values); return { where: () => ({ returning: async () => [{ id: fixture.current.id }] }) } } }),
}) } }))
vi.mock('./purchase-payment-tracking', () => ({ ensurePurchasePaymentTrackingSchema: async () => {} }))
vi.mock('./purchase-fund-ledger', () => ({ ensurePurchaseFundLedgerSchema: async () => {}, reconcilePurchaseFundDebitsInTransaction: vi.fn() }))
vi.mock('@/lib/new-products/cny-cost', () => ({ getLatestCnyKrwReferenceRate: async () => ({ rate: 200, date: '2026-10-30' }) }))
vi.mock('./saas-china-outbound', () => ({
  ensureSaasChinaOutboundSchema: async () => {}, hasSaasChinaPurchaseLinkInTransaction: async () => false,
  receiveSaasChinaPurchaseArrivalInTransaction: fixture.receive, adjustSaasChinaPurchaseArrivalQuantityInTransaction: fixture.adjust,
}))
const parcel = { id: '00000000-0000-4000-8000-000000000001', trackingNumber: 'SF001', boxes: [{ id: '00000000-0000-4000-8000-000000000002', quantity: 90, lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 10 }] }
const inspection: PurchaseInspection = { version: 1, revision: 1, expectedQuantity: 100, parcels: [parcel], checkedAt: null, checkedBy: null, resolutionNote: '' }
describe('inspection persistence and arrival safety', () => {
  beforeEach(() => {
    vi.clearAllMocks(); fixture.writes = []
    fixture.current = { id: 'purchase-id', userId: 'workspace-id', status: 'purchase_completed', requestedQuantity: 100, actualPurchaseQuantity: 100, chinaReceivedQuantity: null, supplierOrderNumber: '3317159640039018761', trackingNumber: null, rawData: { saasChinaMode: true }, purchaseInspection: null, costExchangeRateKrw: '200', sku: 'SKU-A', productName: '상품A' }
  })
  it('moves tracking entry into inspection and saves each parcel without receiving stock', async () => {
    await savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 0, parcels: [parcel] } })
    expect(fixture.writes[0]).toMatchObject({ status: 'inspecting', chinaReceivedQuantity: 90, purchaseInspection: { expectedQuantity: 100, revision: 1, checkedBy: null } })
    expect(fixture.receive).not.toHaveBeenCalled()
  })
  it('preserves the reported-issue protection marker on later inspection saves', async () => {
    fixture.current.purchaseInspection = { ...inspection, hasReportedIssue: true }
    await savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 1, parcels: [parcel] } })
    expect(fixture.writes[0]).toMatchObject({ purchaseInspection: { hasReportedIssue: true, revision: 2 } })
  })
  it('rejects stale edits and cannot complete an unexplained shortage', async () => {
    fixture.current.purchaseInspection = inspection
    await expect(savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 0, parcels: [parcel] } })).rejects.toThrow('다른 작업자')
    await expect(savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 1, parcels: [parcel], complete: true } })).rejects.toThrow('입고오류')
    expect(fixture.writes).toHaveLength(0)
  })
  it('records the real inspector only after shortage verification', async () => {
    const data = { revision: 0, parcels: [parcel], complete: true, acknowledgeMismatch: true, resolutionNote: '부족 10개 공급처 확인' }
    const context = { userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id' }
    await expect(savePurchaseInspection({ ...context, data })).rejects.toThrow('스티커 부착 상태')
    await savePurchaseInspection({ ...context, data: { ...data, stickerStatus: 'barcode' } })
    expect(fixture.writes[0]).toMatchObject({ purchaseInspection: { checkedBy: 'staff-id', resolutionNote: '부족 10개 공급처 확인', expectedQuantity: 100, stickerStatus: 'barcode' } })
    expect(fixture.receive).not.toHaveBeenCalled()
  })
  it('preserves the recorded sticker status when another entry point only edits tracking', async () => {
    fixture.current.purchaseInspection = { ...inspection, stickerStatus: 'quality' }
    await savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 1, parcels: [parcel] } })
    expect(fixture.writes[0]).toMatchObject({ purchaseInspection: { stickerStatus: 'quality' } })
  })
  it('blocks generic arrival and downstream status jumps before inspection', async () => {
    for (const status of ['china_arrived', 'outbound_requested', 'completed'] as const) {
      await expect(updatePurchaseRequestStatus({ userId: 'workspace-id', id: 'purchase-id', status })).rejects.toThrow('검수')
    }
    expect(fixture.receive).not.toHaveBeenCalled()
  })
  it('receives exactly the inspected quantity and does not receive a duplicate completion twice', async () => {
    fixture.current = { ...fixture.current, status: 'inspecting', chinaReceivedQuantity: 90, purchaseInspection: { ...inspection, checkedAt: '2026-10-30T00:00:00Z', checkedBy: 'staff-id', resolutionNote: '부족 확인' } }
    await updatePurchaseRequestStatus({ userId: 'workspace-id', id: 'purchase-id', status: 'china_arrived' })
    expect(fixture.receive.mock.calls[0][1]).toMatchObject({ userId: 'workspace-id', purchaseRequestItemId: 'purchase-id', quantity: 90 })
    fixture.current.status = 'china_arrived'
    await updatePurchaseRequestStatus({ userId: 'workspace-id', id: 'purchase-id', status: 'china_arrived' })
    expect(fixture.receive).toHaveBeenCalledTimes(1)
  })
  it('locks inspection after arrival and prevents generic received-quantity overrides', async () => {
    fixture.current = { ...fixture.current, status: 'china_arrived', purchaseInspection: inspection, chinaReceivedQuantity: 90 }
    await expect(savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 1, parcels: [parcel] } })).rejects.toThrow('구매완료·검수')
    await expect(updatePurchaseRequestPlanFields({ userId: 'workspace-id', id: 'purchase-id', chinaReceivedQuantity: 100 })).rejects.toThrow('검수 화면')
    expect(fixture.adjust).not.toHaveBeenCalled()
    await expect(updatePurchaseRequestStatus({ userId: 'workspace-id', id: 'purchase-id', status: 'purchase_completed' })).rejects.toThrow('이전 단계')
  })
  it('replaces an untouched legacy logistics-id inspection with exact waybills only', async () => {
    fixture.current = {
      ...fixture.current,
      status: 'inspecting',
      trackingNumber: 'LP00850611544129',
      purchaseInspection: {
        version: 1,
        revision: 3,
        expectedQuantity: 100,
        checkedAt: null,
        checkedBy: null,
        resolutionNote: '',
        parcels: [
          { id: '00000000-0000-4000-8000-000000000011', trackingNumber: 'LP00850611544129', boxes: [{ id: '00000000-0000-4000-8000-000000000012', quantity: null, lengthCm: null, widthCm: null, heightCm: null, weightKg: null }] },
          { id: '00000000-0000-4000-8000-000000000013', trackingNumber: '750735732', boxes: [{ id: '00000000-0000-4000-8000-000000000014', quantity: null, lengthCm: null, widthCm: null, heightCm: null, weightKg: null }] },
        ],
      },
    }

    await applyPurchaseRequest1688TrackingLookup({
      userId: 'workspace-id',
      id: 'purchase-id',
      supplierOrderNumber: '3317159640039018761',
      trackingNumbers: ['9823528519765'],
      replaceUninspectedInspection: true,
    })

    expect(fixture.writes[0]).toMatchObject({
      trackingNumber: '9823528519765',
      chinaReceivedQuantity: null,
      purchaseInspection: {
        revision: 4,
        expectedQuantity: 100,
        parcels: [expect.objectContaining({ trackingNumber: '9823528519765' })],
      },
    })
  })
  it('does not replace a legacy inspection after boxes or quantities were entered', async () => {
    fixture.current = { ...fixture.current, status: 'inspecting', trackingNumber: 'LP00850611544129', purchaseInspection: inspection }
    await expect(applyPurchaseRequest1688TrackingLookup({
      userId: 'workspace-id',
      id: 'purchase-id',
      supplierOrderNumber: '3317159640039018761',
      trackingNumbers: ['9823528519765'],
      replaceUninspectedInspection: true,
    })).rejects.toThrow('이미 검수 수량·박스 정보를 입력한')
    expect(fixture.writes).toHaveLength(0)
  })
})
