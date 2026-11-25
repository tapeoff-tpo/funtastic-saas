import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPurchaseRequest1688TrackingLookup, issueSavedInspectionBoxNumbers, savePurchaseInspection, updatePurchaseRequestPlanFields, updatePurchaseRequestStatus } from './purchase-requests'
import { type PurchaseInspection } from './purchase-inspection'

const fixture = vi.hoisted(() => ({
  current: {} as Record<string, unknown>, writes: [] as Array<Record<string, unknown>>,
  receive: vi.fn(), adjust: vi.fn(), recordCompletion: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: { transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
  execute: vi.fn(async (query) => query.queryChunks.some((chunk: { value?: string[] }) => chunk.value?.join?.('').includes('RETURNING last_number')) ? [{ last_number: 1 }] : []), select: () => ({ from: () => ({ where: () => ({ limit: async () => [fixture.current], for: async () => [fixture.current] }) }) }),
  update: () => ({ set: (values: Record<string, unknown>) => { fixture.writes.push(values); return { where: () => ({ returning: async () => [{ id: fixture.current.id }] }) } } }),
}) } }))
vi.mock('./purchase-payment-tracking', () => ({ ensurePurchasePaymentTrackingSchema: async () => {} }))
vi.mock('./purchase-fund-ledger', () => ({ ensurePurchaseFundLedgerSchema: async () => {}, reconcilePurchaseFundDebitsInTransaction: vi.fn(), recordPurchaseCompletionInTransaction: fixture.recordCompletion }))
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
  it('records one fund debit only when the purchase request moves to purchase completed', async () => {
    fixture.current.status = 'purchased'
    await updatePurchaseRequestStatus({ userId: 'workspace-id', id: 'purchase-id', status: 'purchase_completed' })
    expect(fixture.recordCompletion).toHaveBeenCalledOnce()
    expect(fixture.recordCompletion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'workspace-id', itemId: 'purchase-id' }))
    fixture.recordCompletion.mockClear()
    fixture.current.status = 'purchase_completed'
    await updatePurchaseRequestStatus({ userId: 'workspace-id', id: 'purchase-id', status: 'purchase_completed' })
    expect(fixture.recordCompletion).not.toHaveBeenCalled()
  })
  it('moves a successful initial waybill lookup into inspection without assuming box quantities or receiving inventory', async () => {
    await applyPurchaseRequest1688TrackingLookup({
      userId: 'workspace-id', id: 'purchase-id', supplierOrderNumber: '3317159640039018761',
      trackingNumbers: [' S71268668516 ', '9823528519765'],
    })

    expect(fixture.writes).toHaveLength(1)
    expect(fixture.writes[0]).toMatchObject({
      status: 'inspecting', trackingNumber: 'S71268668516', chinaReceivedQuantity: null,
      purchaseInspection: { expectedQuantity: 100, revision: 0, checkedAt: null, checkedBy: null },
    })
    const savedInspection = fixture.writes[0]!.purchaseInspection as PurchaseInspection
    expect(savedInspection.parcels.map((entry) => entry.trackingNumber)).toEqual(['S71268668516', '9823528519765'])
    for (const entry of savedInspection.parcels) {
      expect(entry.boxes).toEqual([{
        id: expect.any(String), quantity: null, lengthCm: null, widthCm: null, heightCm: null, weightKg: null,
      }])
    }
    expect(fixture.receive).not.toHaveBeenCalled()
    expect(fixture.adjust).not.toHaveBeenCalled()
  })
  it('preserves a manually entered waybill and the purchase-completed status when a later lookup returns', async () => {
    fixture.current.trackingNumber = 'MANUAL-SF001'
    const original = structuredClone(fixture.current)

    await expect(applyPurchaseRequest1688TrackingLookup({
      userId: 'workspace-id', id: 'purchase-id', supplierOrderNumber: '3317159640039018761',
      trackingNumbers: ['S71268668516'],
    })).rejects.toThrow('이미 등록된 송장 또는 검수 정보')

    expect(fixture.writes).toHaveLength(0)
    expect(fixture.current).toEqual(original)
    expect(fixture.receive).not.toHaveBeenCalled()
    expect(fixture.adjust).not.toHaveBeenCalled()
  })
  it('moves tracking entry into inspection and saves each parcel without receiving stock', async () => {
    await savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 0, parcels: [parcel], resolutionNote: '부족 10개 공급처 확인 중' } })
    expect(fixture.writes[0]).toMatchObject({ status: 'inspecting', chinaReceivedQuantity: 90, purchaseInspection: { expectedQuantity: 100, revision: 1, checkedBy: null } })
    expect(fixture.receive).not.toHaveBeenCalled()
  })
  it('issues missing box numbers for an arrived inspection without receiving stock again', async () => {
    const existingBox = { ...parcel.boxes[0]!, id: 'existing-box' }
    fixture.current.status = 'china_arrived'
    fixture.current.purchaseInspection = {
      ...inspection,
      parcels: [{ ...parcel, boxes: [existingBox, ...parcel.boxes] }],
      boxNumbers: { [existingBox.id]: '261124-018' },
    }

    const numbered = await issueSavedInspectionBoxNumbers('workspace-id', 'purchase-id')
    expect(numbered.boxNumbers).toEqual({
      [existingBox.id]: '261124-018',
      [parcel.boxes[0]!.id]: expect.stringMatching(/^\d{6}-001$/),
    })
    expect(numbered.revision).toBe(2)
    expect(fixture.writes).toEqual([{ purchaseInspection: numbered }])
    fixture.current.purchaseInspection = numbered

    await expect(issueSavedInspectionBoxNumbers('workspace-id', 'purchase-id')).resolves.toEqual(numbered)
    expect(fixture.writes).toHaveLength(1)
    expect(fixture.receive).not.toHaveBeenCalled()
    expect(fixture.adjust).not.toHaveBeenCalled()
  })
  it('preserves the reported-issue protection marker on later inspection saves', async () => {
    fixture.current.purchaseInspection = { ...inspection, hasReportedIssue: true }
    await savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 1, parcels: [parcel], resolutionNote: '부족 10개 공급처 확인 중' } })
    expect(fixture.writes[0]).toMatchObject({ purchaseInspection: { hasReportedIssue: true, revision: 2 } })
  })
  it('rejects stale edits and cannot complete an unexplained shortage', async () => {
    fixture.current.purchaseInspection = inspection
    await expect(savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 0, parcels: [parcel] } })).rejects.toThrow('다른 작업자')
    await expect(savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 1, parcels: [parcel], complete: true } })).rejects.toThrow('입고오류')
    expect(fixture.writes).toHaveLength(0)
  })
  it.each([
    { quantity: 0, complete: false },
    { quantity: 90, complete: false },
    { quantity: 110, complete: false },
    { quantity: 90, complete: true },
    { quantity: 110, complete: true },
  ])('blocks saving $quantity received units with complete=$complete when the discrepancy explanation is blank', async ({ quantity, complete }) => {
    const original = structuredClone(fixture.current)
    const parcels = [{ ...parcel, boxes: [{ ...parcel.boxes[0], quantity }] }]

    await expect(savePurchaseInspection({
      userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id',
      data: { revision: 0, parcels, complete, acknowledgeMismatch: true, stickerStatus: 'barcode', resolutionNote: '   ' },
    })).rejects.toThrow('수량 차이 오류 설명')

    expect(fixture.writes).toHaveLength(0)
    expect(fixture.current).toEqual(original)
    expect(fixture.receive).not.toHaveBeenCalled()
    expect(fixture.adjust).not.toHaveBeenCalled()
  })
  it('saves an explained discrepancy draft without completing measurements or acknowledging arrival', async () => {
    const parcels = [{ ...parcel, boxes: [{ ...parcel.boxes[0], quantity: 110, lengthCm: null, weightKg: null }] }]
    await savePurchaseInspection({
      userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id',
      data: { revision: 0, parcels, resolutionNote: '초과 10개 공급처 확인 중' },
    })
    expect(fixture.writes[0]).toMatchObject({
      status: 'inspecting', chinaReceivedQuantity: 110,
      purchaseInspection: { expectedQuantity: 100, checkedAt: null, checkedBy: null, resolutionNote: '초과 10개 공급처 확인 중' },
    })
    expect(fixture.receive).not.toHaveBeenCalled()
    expect(fixture.adjust).not.toHaveBeenCalled()
  })
  it('saves equal counts or unknown counting drafts without inventing a discrepancy', async () => {
    for (const quantity of [100, null]) {
      fixture.writes = []
      const parcels = [{ ...parcel, boxes: [{ ...parcel.boxes[0], quantity }] }]
      await savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 0, parcels } })
      expect(fixture.writes[0]).toMatchObject({ chinaReceivedQuantity: quantity, purchaseInspection: { resolutionNote: '', checkedAt: null } })
    }
    expect(fixture.receive).not.toHaveBeenCalled()
  })
  it('does not hide a known excess behind another uncounted box', async () => {
    const parcels = [{ ...parcel, boxes: [
      { ...parcel.boxes[0], quantity: 110 },
      { ...parcel.boxes[0], id: '00000000-0000-4000-8000-000000000003', quantity: null },
    ] }]
    await expect(savePurchaseInspection({
      userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 0, parcels },
    })).rejects.toThrow('수량 차이 오류 설명')
    expect(fixture.writes).toHaveLength(0)
    await savePurchaseInspection({
      userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 0, parcels, resolutionNote: '초과 입고 확인 중, 나머지 박스 미계수' },
    })
    expect(fixture.writes[0]).toMatchObject({ chinaReceivedQuantity: null, purchaseInspection: { checkedAt: null } })
    expect(fixture.receive).not.toHaveBeenCalled()
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
    await savePurchaseInspection({ userId: 'workspace-id', actorId: 'staff-id', id: 'purchase-id', data: { revision: 1, parcels: [parcel], resolutionNote: '부족 10개 공급처 확인 중' } })
    expect(fixture.writes[0]).toMatchObject({ purchaseInspection: { stickerStatus: 'quality' } })
  })
  it('blocks generic arrival and downstream status jumps before inspection', async () => {
    for (const status of ['china_arrived', 'outbound_requested', 'completed'] as const) {
      await expect(updatePurchaseRequestStatus({ userId: 'workspace-id', id: 'purchase-id', status })).rejects.toThrow('검수')
    }
    expect(fixture.receive).not.toHaveBeenCalled()
  })
  it('receives exactly the inspected quantity and does not receive a duplicate completion twice', async () => {
    fixture.current = { ...fixture.current, status: 'inspecting', rawData: {}, chinaReceivedQuantity: 90, purchaseInspection: { ...inspection, checkedAt: '2026-10-30T00:00:00Z', checkedBy: 'staff-id', resolutionNote: '부족 확인' } }
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
