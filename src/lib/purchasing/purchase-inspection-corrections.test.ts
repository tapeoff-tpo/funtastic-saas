// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown>, hasIssue: true, execute: vi.fn(), reconcile: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { transaction: async (fn: (tx: unknown) => unknown) => fn({ execute: state.execute }) } }))
vi.mock('./purchase-payment-tracking', () => ({ ensurePurchasePaymentTrackingSchema: async () => {} }))
vi.mock('./purchase-inspection-issues', () => ({ ensurePurchaseInspectionIssueSchema: async () => {} }))
vi.mock('./purchase-fund-ledger', () => ({ ensurePurchaseFundLedgerSchema: async () => {}, reconcilePurchaseFundDebitsInTransaction: state.reconcile }))
vi.mock('@/lib/new-products/cny-cost', () => ({ getLatestCnyKrwReferenceRate: async () => ({ rate: 200 }) }))
import { correctInspectionPurchaseQuantity } from './purchase-inspection-corrections'

const id = '00000000-0000-4000-8000-000000000001'
const issueId = '00000000-0000-4000-8000-000000000002'
const data = { issueId, actualPurchaseQuantity: 90, reason: '구매수량 오기입 정정', expectedRevision: 2 }
const input = { userId: id, actorId: id, id, data }
const dialect = new PgDialect()

describe('issue-linked purchase quantity correction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.hasIssue = true
    state.current = { status: 'inspecting', actualPurchaseQuantity: 100, requestedQuantity: 100, rawData: { original: true },
      inspection: { version: 1, revision: 2, expectedQuantity: 100, parcels: [{ id: 'parcel', boxes: [{ quantity: 90 }] }], checkedAt: '2026-11-12', checkedBy: 'inspector', resolutionNote: '확인', hasReportedIssue: true } }
    state.execute.mockImplementation(async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql
      if (text.includes('SELECT status::text')) return [state.current]
      if (text.includes('SELECT id FROM purchase_inspection_issues')) return state.hasIssue ? [{ id: issueId }] : []
      return []
    })
  })

  it('corrects only the purchase baseline, preserves parcel facts, and records the reason and actor', async () => {
    const saved = await correctInspectionPurchaseQuantity(input)
    expect(saved?.inspection).toMatchObject({ revision: 3, expectedQuantity: 90, checkedAt: null, checkedBy: null,
      parcels: [{ boxes: [{ quantity: 90 }] }], hasReportedIssue: true })
    expect(saved?.correction).toMatchObject({ issueId, previousQuantity: 100, actualPurchaseQuantity: 90, actorId: id, reason: data.reason })
    const update = state.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query as SQL)).find((query) => query.sql.includes('UPDATE purchase_request_items'))!
    expect(update.sql).not.toMatch(/(?:requested_quantity|china_received_quantity)\s*=/)
    expect(update.params).toContain(JSON.stringify({ original: true, inspectionPurchaseCorrections: [saved?.correction] }))
    expect(state.reconcile).toHaveBeenCalledOnce()
  })

  it('rejects stale revisions, unrelated issues, and post-arrival changes', async () => {
    await expect(correctInspectionPurchaseQuantity({ ...input, data: { ...data, expectedRevision: 1 } })).rejects.toThrow('다른 작업자')
    state.hasIssue = false
    await expect(correctInspectionPurchaseQuantity(input)).rejects.toThrow('이 구매 건')
    state.current.status = 'china_arrived'
    await expect(correctInspectionPurchaseQuantity(input)).rejects.toThrow('중국창고도착 전')
    expect(state.reconcile).not.toHaveBeenCalled()
    expect(state.execute.mock.calls.some(([query]) => dialect.sqlToQuery(query as SQL).sql.includes('UPDATE purchase_request_items'))).toBe(false)
  })
})
