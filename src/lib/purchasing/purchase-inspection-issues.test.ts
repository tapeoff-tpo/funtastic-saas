// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
const state = vi.hoisted(() => ({ current: {} as Record<string, unknown>, execute: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {
  execute: async () => [{ hasIssues: true, hasAttachments: true, protectedTables: 2 }],
  transaction: async (fn: (tx: unknown) => unknown) => fn({ execute: state.execute }),
} }))
vi.mock('./purchase-payment-tracking', () => ({ ensurePurchasePaymentTrackingSchema: async () => {} }))
import { createPurchaseInspectionIssue } from './purchase-inspection-issues'
const dialect = new PgDialect()
const input = { userId: '00000000-0000-4000-8000-000000000001', actorId: '00000000-0000-4000-8000-000000000002', purchaseRequestItemId: '00000000-0000-4000-8000-000000000003', description: '수량 부족', attachments: [] }

describe('inspection issue persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.current = { id: input.purchaseRequestItemId, status: 'inspecting', requestedQuantity: 100, actualPurchaseQuantity: 100, trackingNumber: 'SF001',
      purchaseInspection: { version: 1, revision: 4, expectedQuantity: 100, parcels: [{ id: 'parcel', boxes: [{ quantity: 90 }] }], checkedAt: null, checkedBy: null, resolutionNote: '' } }
    state.execute.mockImplementation(async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql
      if (text.includes('FOR UPDATE')) return [state.current]
      if (text.includes('INSERT INTO purchase_inspection_issues')) return [{ id: 'issue-id', description: input.description, createdAt: '', createdByUserId: input.actorId }]
      return []
    })
  })

  it('records a description without photos and protects the item without rebasing parcel revision', async () => {
    const saved = await createPurchaseInspectionIssue(input)
    expect(saved?.issue.attachments).toEqual([])
    expect(saved?.inspection).toMatchObject({ revision: 4, hasReportedIssue: true, parcels: [{ boxes: [{ quantity: 90 }] }] })
    const queries = state.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query as SQL))
    expect(queries.find((query) => query.sql.includes('INSERT INTO purchase_inspection_issues'))?.params).toContain(input.actorId)
    expect(queries.find((query) => query.sql.includes('UPDATE purchase_request_items'))?.params).toContain(JSON.stringify(saved?.inspection))
  })

  it('creates a protected empty inspection for a previously uninspected purchase', async () => {
    state.current = { ...state.current, status: 'purchase_completed', purchaseInspection: null }
    expect((await createPurchaseInspectionIssue(input))?.inspection).toMatchObject({ revision: 0, expectedQuantity: 100, hasReportedIssue: true })
  })
})
