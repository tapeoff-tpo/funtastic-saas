import { describe, expect, it, vi } from 'vitest'
import { purchaseRequestItems } from '@/lib/db/schema'
const mocks = vi.hoisted(() => ({ writes: [] as Array<{ table: unknown; values: Record<string, unknown> }>, execute: vi.fn(async () => [{ count: 0 }]) }))
vi.mock('@/lib/new-products/workflow', () => ({ ensureNewProductWorkflowTables: vi.fn() }))
vi.mock('@/lib/db', () => {
  const tx = {
    select: () => ({ from: (table: unknown) => {
      const rows = table === purchaseRequestItems
        ? [{ id: 'request1', sku: '123456-0001', productName: '상품', rawData: { keep: 'original' } }]
        : [{ id: 'master1', internalSku: '123456-0001', name: '상품', metadata: { esa009m: { '구매 URL': 'https://detail.1688.com/offer/111111111111.html' } } }]
      const builder = { where: () => builder, orderBy: () => builder, for: async () => rows }
      return builder
    } }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { mocks.writes.push({ table, values }) } }) }),
    execute: mocks.execute,
  }
  return { db: { ...tx, transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } }
})
import { applyPurchaseUrlCollectionResult } from './purchase-url-collector'
describe('retained purchase URL collection evidence', () => {
  it('keeps the newly observed order URL even when the master already has an older working URL', async () => {
    const newUrl = 'https://detail.1688.com/offer/222222222222.html'
    const result = await applyPurchaseUrlCollectionResult({ userId: 'owner', orderNumber: '1234567890123', candidates: [{ url: newUrl }] })
    expect(result.status).toBe('already_set')
    expect(mocks.writes).toHaveLength(1)
    expect(mocks.writes[0]).toMatchObject({ table: purchaseRequestItems, values: { rawData: { keep: 'original', purchaseUrlLookup: { resolvedUrl: newUrl, orderNumber: '1234567890123' } } } })
    expect(Object.keys(mocks.writes[0].values)).toEqual(['rawData'])
  })
})
