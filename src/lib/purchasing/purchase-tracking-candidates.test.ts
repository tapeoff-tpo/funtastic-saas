import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
const mocks = vi.hoisted(() => ({ where: vi.fn(), ensure: vi.fn(), records: Array.from({ length: 110 }, (_, i) => ({ id: String(i) })) }))
vi.mock('@/lib/db', () => ({ db: { select: () => ({ from: () => ({ where: (condition: SQL) => {
  mocks.where(condition)
  return { orderBy: async () => mocks.records }
} }) }) } }))
vi.mock('./purchase-payment-tracking', () => ({ ensurePurchasePaymentTrackingSchema: mocks.ensure }))
import { getPurchase1688TrackingCandidates, isPurchaseTrackingLookupBlocked } from './purchase-tracking-candidates'
import type { PurchaseInspection } from './purchase-inspection'

describe('whole-stage tracking candidate query', () => {
  beforeEach(() => vi.clearAllMocks())
  it('keeps all 110 rows and scopes the query to the workspace and lifecycle stage', async () => {
    expect(await getPurchase1688TrackingCandidates('owner', 'initial')).toHaveLength(110)
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0])
    expect(query.params).toEqual(['owner', 'purchase_completed'])
    expect(mocks.ensure).toHaveBeenCalledOnce()
  })
  it('uses inspection rather than completed arrivals for recollection', async () => {
    await getPurchase1688TrackingCandidates('owner', 'recollect')
    expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual(['owner', 'inspecting'])
  })
  it('skips stored inspections even without the primary tracking field and skips recollection after manual inspection starts', () => {
    const inspection: PurchaseInspection = { version: 1, revision: 1, expectedQuantity: 10, checkedAt: null, checkedBy: null, resolutionNote: '',
      parcels: [{ id: 'parcel', trackingNumber: 'LP001', boxes: [{ id: 'box', quantity: null, lengthCm: null, widthCm: null, heightCm: null, weightKg: null }] }] }
    expect(isPurchaseTrackingLookupBlocked('initial', inspection, null)).toBe(true)
    expect(isPurchaseTrackingLookupBlocked('recollect', inspection, null)).toBe(false)
    expect(isPurchaseTrackingLookupBlocked('recollect', { ...inspection, hasReportedIssue: true }, null)).toBe(true)
    expect(isPurchaseTrackingLookupBlocked('recollect', inspection, 10)).toBe(true)
    const measured = { ...inspection, parcels: [{ ...inspection.parcels[0], boxes: [{ ...inspection.parcels[0].boxes[0], lengthCm: 50 }] }] }
    expect(isPurchaseTrackingLookupBlocked('recollect', measured, null)).toBe(true)
  })
})
