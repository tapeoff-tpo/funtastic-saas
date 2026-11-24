import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), execute: vi.fn(), select: vi.fn() }))
vi.mock('@/lib/new-products/workflow', () => ({ ensureNewProductWorkflowTables: mocks.ensure }))
vi.mock('./purchase-url-sync', () => ({ getPurchaseUrlReplacementSources: vi.fn(), syncWorkflowUrls: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute, select: mocks.select } }))
import { getPurchaseUrlVerificationQueue } from './purchase-url-collector'

describe('purchase URL verification queue', () => {
  it('checks both item master URLs and China purchase links, including workflow records with no SKU', async () => {
    const url = 'https://detail.1688.com/offer/111111111111.html'
    const builder = { from: () => builder, where: () => builder, orderBy: async () => [{ sku: '123456-0001', productName: '원가상품', metadata: { esa009m: { '구매 URL': url } } }] }
    mocks.select.mockReturnValue(builder)
    mocks.execute.mockResolvedValue([{ id: '12345678-1234-1234-1234-123456789012', productName: '신상품', sourceUrl: url }])
    expect(await getPurchaseUrlVerificationQueue({ userId: 'owner' })).toMatchObject({
      links: [{ url, items: [{ sku: '123456-0001', productName: '원가상품' }, { sku: 'new-product:12345678-1234-1234-1234-123456789012', productName: '신상품' }] }], totalItems: 2,
    })
    expect(mocks.ensure).toHaveBeenCalledWith('owner')
  })
})
