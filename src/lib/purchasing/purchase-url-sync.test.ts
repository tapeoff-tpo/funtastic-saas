import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { products, purchaseRequestItems } from '@/lib/db/schema'

const mocks = vi.hoisted(() => ({ requests: [] as unknown[], masters: [] as unknown[], writes: [] as Array<{ table: unknown; values: Record<string, unknown> }>, execute: vi.fn(), ensure: vi.fn(), logs: vi.fn() }))
vi.mock('@/lib/new-products/workflow', () => ({ ensureNewProductWorkflowTables: mocks.ensure }))
vi.mock('@/lib/db', () => {
  const tx = {
    select: () => ({ from: (table: unknown) => {
      const result = () => table === purchaseRequestItems ? mocks.requests : mocks.masters
      const builder = { where: () => builder, orderBy: () => builder, for: async () => result(), then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result()).then(resolve) }
      return builder
    } }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { mocks.writes.push({ table, values }) } }) }),
    insert: () => ({ values: mocks.logs }), execute: mocks.execute,
  }
  return { db: { ...tx, transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } }
})
import { getPurchaseUrlForNewProduct, getPurchaseUrlReplacementSources, resolveOrderPurchaseUrls, savePurchaseTrackingProductLinks, syncPurchaseUrlsFromHistory, syncWorkflowUrls } from './purchase-url-sync'
import { db } from '@/lib/db'

const oldUrl = 'https://detail.1688.com/offer/111111111111.html'
const newUrl = 'https://detail.1688.com/offer/222222222222.html'
const request = { id: 'request-1', sku: '123456-0001', productName: '상품', orderNumber: '1234567890123', rawData: {} }
beforeEach(() => { vi.clearAllMocks(); mocks.requests = []; mocks.masters = []; mocks.writes = []; mocks.execute.mockResolvedValue([{ count: 1 }]) })

describe('order product URL matching', () => {
  it('shares an unambiguous offer across options of the same product', () => {
    expect(resolveOrderPurchaseUrls([request, { ...request, id: 'request-2', sku: '123456-0002' }], [{ url: newUrl }]))
      .toEqual([{ requestId: 'request-1', url: newUrl }, { requestId: 'request-2', url: newUrl }])
  })
  it('does not spread one link over unrelated products or guess between several links', () => {
    expect(resolveOrderPurchaseUrls([request, { ...request, id: 'other', sku: '654321-0001' }], [{ url: newUrl }])).toEqual([])
    expect(resolveOrderPurchaseUrls([request], [{ url: oldUrl }, { url: newUrl }])).toEqual([])
  })
  it('uses an explicit existing workflow link in a multi-product order', () => {
    expect(resolveOrderPurchaseUrls([{ ...request, rawData: { productWorkflow: { purchaseUrl: newUrl } } }], [{ url: oldUrl }, { url: newUrl }]))
      .toEqual([{ requestId: request.id, url: newUrl }])
  })
})

describe('purchase URL history reuse', () => {
  it('fills a new product on save only when its exact option codes agree on one URL', async () => {
    mocks.requests = [{ ...request, rawData: { productWorkflow: { purchaseUrl: newUrl } } }]
    expect(await db.transaction(tx => getPurchaseUrlForNewProduct(tx, 'owner', [request.sku]))).toBe(newUrl)
    mocks.requests.push({ ...request, sku: '123456-0002', rawData: { productWorkflow: { purchaseUrl: oldUrl } } })
    expect(await db.transaction(tx => getPurchaseUrlForNewProduct(tx, 'owner', [request.sku, '123456-0002']))).toBeNull()
    expect(await db.transaction(tx => getPurchaseUrlForNewProduct(tx, 'owner', []))).toBeNull()
  })
  it('fills only missing or failed masters, preserving working URLs and unrelated fields', async () => {
    mocks.requests = [
      { ...request, rawData: { purchaseUrlLookup: { orderNumber: request.orderNumber, resolvedUrl: newUrl } } },
      { ...request, sku: '123456-0002', rawData: { productWorkflow: { purchaseUrl: newUrl } } },
    ]
    mocks.masters = [
      { id: 'master1', sku: request.sku, metadata: { esa009m: { '구매 URL': oldUrl, '원가': '120' }, purchaseUrlVerification: { status: 'confirm_required' }, extra: 'keep' } },
      { id: 'master2', sku: '123456-0002', metadata: { esa009m: { '구매 URL': oldUrl } } },
    ]
    expect(await syncPurchaseUrlsFromHistory('owner')).toEqual({ updatedProducts: 1, updatedWorkflow: 1 })
    expect(mocks.writes).toHaveLength(1)
    expect(mocks.writes[0].table).toBe(products)
    const statement = new PgDialect().sqlToQuery(mocks.writes[0].values.metadata as SQL)
    expect(JSON.parse(statement.params[1] as string)).toEqual({ esa009m: { '구매 URL': newUrl, '원가': '120' }, extra: 'keep' })
    expect(mocks.logs).toHaveBeenCalledWith([expect.objectContaining({ oldValue: oldUrl, newValue: newUrl, userId: 'owner' })])
  })
  it('takes the newest purchase source once and never recycles the same failed link', async () => {
    mocks.requests = [{ ...request, rawData: { productWorkflow: { purchaseUrl: oldUrl } } }, { ...request, rawData: { productWorkflow: { purchaseUrl: newUrl } } }]
    expect(await getPurchaseUrlReplacementSources('owner', [request.sku], oldUrl)).toEqual([])
  })
  it('ignores lookup evidence when its supplier order was changed', async () => {
    mocks.requests = [{ ...request, rawData: { purchaseUrlLookup: { orderNumber: '9999999999999', resolvedUrl: newUrl } } }]
    expect(await getPurchaseUrlReplacementSources('owner', [request.sku], oldUrl)).toEqual([])
  })
  it('never saves a stale or foreign tracking result without the exact request in that order', async () => {
    mocks.requests = [{ ...request, id: 'different-request' }]
    await savePurchaseTrackingProductLinks({ userId: 'owner', requestId: request.id, orderNumber: request.orderNumber, links: [{ url: newUrl }] })
    expect(mocks.writes).toEqual([])
    expect(mocks.ensure).not.toHaveBeenCalled()
  })
  it('stores order evidence while preserving inspection/status and other raw data', async () => {
    mocks.requests = [{ ...request, rawData: { custom: 'preserved' } }]
    await savePurchaseTrackingProductLinks({ userId: 'owner', requestId: request.id, orderNumber: request.orderNumber, links: [{ url: newUrl }] })
    expect(mocks.writes[0]).toMatchObject({ table: purchaseRequestItems, values: { rawData: { custom: 'preserved', purchaseUrlLookup: { resolvedUrl: newUrl, orderNumber: request.orderNumber } } } })
    expect(Object.keys(mocks.writes[0].values)).toEqual(['rawData'])
  })
  it('uses exact workspace/SKU links, rejects conflicting option URLs, and guards concurrent editor changes', async () => {
    const source = { sku: request.sku, url: newUrl, requestId: request.id, workflowItemId: null, orderNumber: request.orderNumber }
    await db.transaction(tx => syncWorkflowUrls(tx, 'owner', [source]))
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0] as SQL)
    expect(query.params).toContain('owner')
    expect(query.sql).toContain('count(DISTINCT c.url) = 1')
    expect(query.sql).toContain('sabangnetOptionCode')
    expect(query.sql).toContain('IS NOT DISTINCT FROM matches."previousUrl"')
    expect(query.sql).not.toContain('product_name =')
  })
})
