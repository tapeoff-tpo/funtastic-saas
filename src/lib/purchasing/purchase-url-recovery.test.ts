import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ candidates: [] as unknown[], writes: [] as Array<Record<string, unknown>>, sources: vi.fn(), workflow: vi.fn(), execute: vi.fn(), insert: vi.fn() }))
vi.mock('@/lib/new-products/workflow', () => ({ ensureNewProductWorkflowTables: vi.fn() }))
vi.mock('./purchase-url-sync', () => ({ getPurchaseUrlReplacementSources: mocks.sources, syncWorkflowUrls: mocks.workflow }))
vi.mock('@/lib/db', () => {
  const tx = {
    select: () => { const builder = { from: () => builder, where: () => builder, orderBy: () => builder, for: async () => mocks.candidates }; return builder },
    update: () => ({ set: (value: Record<string, unknown>) => ({ where: async () => { mocks.writes.push(value) } }) }),
    insert: () => ({ values: mocks.insert }), execute: mocks.execute,
  }
  return { db: { ...tx, transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } }
})
import { markPurchaseUrlsForVerification } from './purchase-url-collector'

const oldUrl = 'https://detail.1688.com/offer/111111111111.html', newUrl = 'https://detail.1688.com/offer/222222222222.html'
beforeEach(() => {
  vi.clearAllMocks(); mocks.writes = []
  mocks.candidates = [{ id: 'p1', internalSku: '123456-0001', name: '상품', metadata: { esa009m: { '구매 URL': oldUrl, '원가': '100' } } }]
  mocks.sources.mockResolvedValue([]); mocks.workflow.mockResolvedValue(0); mocks.execute.mockResolvedValue([])
})
describe('failed purchase URL recovery', () => {
  it('replaces a failed master with the exact SKU purchase URL and syncs the workflow', async () => {
    mocks.sources.mockResolvedValue([{ sku: '123456-0001', url: newUrl, requestId: 'r1', workflowItemId: null, orderNumber: '1234567890123' }])
    expect(await markPurchaseUrlsForVerification({ userId: 'owner', url: oldUrl, skus: ['123456-0001'] }))
      .toMatchObject({ replaced: 1, updated: [{ id: 'p1' }] })
    expect(mocks.writes[0]).toMatchObject({ metadata: { esa009m: { '구매 URL': newUrl, '원가': '100' } } })
    expect(mocks.workflow).toHaveBeenCalledWith(expect.anything(), 'owner', expect.any(Array), expect.arrayContaining([{ sku: '123456-0001', url: newUrl, oldUrl }]))
  })
  it('preserves the old URL for review when no safe replacement exists', async () => {
    await markPurchaseUrlsForVerification({ userId: 'owner', url: oldUrl, skus: ['123456-0001'], reason: '판매 중지' })
    expect(mocks.writes[0]).toMatchObject({ metadata: { esa009m: { '구매 URL': oldUrl }, purchaseUrlVerification: { status: 'confirm_required', reason: '판매 중지' } } })
  })
  it('ignores a late verification result after the user has already changed the URL', async () => {
    mocks.candidates = [{ id: 'p1', internalSku: '123456-0001', name: '상품', metadata: { esa009m: { '구매 URL': newUrl } } }]
    mocks.sources.mockResolvedValue([{ sku: '123456-0001', url: newUrl, requestId: 'r1', workflowItemId: null, orderNumber: '1234567890123' }])
    expect(await markPurchaseUrlsForVerification({ userId: 'owner', url: oldUrl, skus: ['123456-0001'] })).toMatchObject({ updated: [], replaced: 0 })
    expect(mocks.writes).toEqual([])
    expect(mocks.workflow).toHaveBeenCalledWith(expect.anything(), 'owner', [], [])
  })
})
