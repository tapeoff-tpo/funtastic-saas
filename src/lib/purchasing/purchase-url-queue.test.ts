import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), execute: vi.fn(), select: vi.fn(), history: vi.fn() }))
vi.mock('@/lib/new-products/workflow', () => ({ ensureNewProductWorkflowTables: mocks.ensure }))
vi.mock('./purchase-url-sync', () => ({ getPurchaseUrlReplacementSources: vi.fn(), syncWorkflowUrls: vi.fn() }))
vi.mock('./purchase-url-verification-history', () => ({ getPurchaseUrlVerificationHistory: mocks.history }))
vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute, select: mocks.select } }))
import { getPurchaseUrlVerificationQueue } from './purchase-url-collector'

const offer = (n: number) => `https://detail.1688.com/offer/${100_000_000_000 + n}.html`
const rows = (urls: string[]) => urls.map((url, index) => ({ sku: `123456-${String(index + 1).padStart(4, '0')}`,
  productName: '상품', purchaseUrl: url }))
function masterRows(values: ReturnType<typeof rows>) {
  const builder = { from: () => builder, where: () => builder, orderBy: async () => values }
  mocks.select.mockReturnValue(builder)
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.history.mockResolvedValue([])
  mocks.execute.mockResolvedValue([])
})

describe('purchase URL verification queue', () => {
  it('checks both item master URLs and China purchase links, including workflow records with no SKU', async () => {
    const url = 'https://detail.1688.com/offer/111111111111.html'
    const builder = { from: () => builder, where: () => builder, orderBy: async () => [{ sku: '123456-0001', productName: '원가상품', purchaseUrl: url }] }
    mocks.select.mockReturnValue(builder)
    mocks.execute.mockResolvedValue([{ id: '12345678-1234-1234-1234-123456789012', productName: '신상품', sourceUrl: url }])
    expect(await getPurchaseUrlVerificationQueue({ userId: 'owner' })).toMatchObject({
      links: [{ url, items: [{ sku: '123456-0001', productName: '원가상품' }, { sku: 'new-product:12345678-1234-1234-1234-123456789012', productName: '신상품' }] }], totalItems: 2,
    })
    expect(mocks.ensure).toHaveBeenCalledWith('owner')
  })

  it('defaults to unverified and expired URLs, while separating issues and keeping a recent normal URL fresh for 30 days', async () => {
    masterRows(rows([offer(1), offer(2), offer(3), offer(4), offer(5)]))
    const now = Date.now()
    mocks.history.mockResolvedValue([
      { url: offer(2), status: 'open', checkedAt: new Date(now - 24 * 60 * 60 * 1_000).toISOString() },
      { url: offer(3), status: 'open', checkedAt: new Date(now - 31 * 24 * 60 * 60 * 1_000).toISOString() },
      { url: offer(4), status: 'unknown', checkedAt: new Date(now).toISOString() },
      { url: offer(5), status: 'unavailable', checkedAt: new Date(now).toISOString() },
    ])
    const due = await getPurchaseUrlVerificationQueue({ userId: 'owner' })
    expect(due.links.map(link => link.url)).toEqual([offer(1), offer(3)])
    expect(due).toMatchObject({ counts: { due: 2, issues: 2, all: 5 }, totalLinks: 2, hasMore: false })
    expect((await getPurchaseUrlVerificationQueue({ userId: 'owner', mode: 'issues' })).links.map(link => link.url))
      .toEqual([offer(4), offer(5)])
    expect((await getPurchaseUrlVerificationQueue({ userId: 'owner', mode: 'all' })).links).toHaveLength(5)
  })

  it('finds a changed URL even when the previously saved URL was checked recently', async () => {
    masterRows(rows([offer(2)]))
    mocks.history.mockResolvedValue([{ url: offer(1), status: 'open', checkedAt: new Date().toISOString() }])
    expect((await getPurchaseUrlVerificationQueue({ userId: 'owner' })).links.map(link => link.url)).toEqual([offer(2)])
  })

  it('reaches every one of 3641 URLs through bounded batches without a 2000 overall limit', async () => {
    const urls = Array.from({ length: 3_641 }, (_, index) => offer(index))
    masterRows(rows(urls))
    const visited: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = await getPurchaseUrlVerificationQueue({ userId: 'owner', mode: 'all', limit: 200, cursor })
      expect(page.totalLinks).toBe(3_641)
      expect(page.links.length).toBeLessThanOrEqual(200)
      visited.push(...page.links.map(link => link.url))
      cursor = page.nextCursor
      pages += 1
      if (pages > 20) throw new Error('pagination failed to make progress')
    } while (cursor)
    expect(pages).toBe(19)
    expect(visited).toEqual(urls)
    expect(new Set(visited).size).toBe(3_641)
  })

  it('continues by URL cursor when successful results disappear from the due list', async () => {
    masterRows(rows([offer(1), offer(2), offer(3), offer(4)]))
    const first = await getPurchaseUrlVerificationQueue({ userId: 'owner', limit: 2 })
    mocks.history.mockResolvedValue(first.links.map(link => ({ url: link.url, status: 'open', checkedAt: new Date().toISOString() })))
    const second = await getPurchaseUrlVerificationQueue({ userId: 'owner', limit: 2, cursor: first.nextCursor })
    expect(second.links.map(link => link.url)).toEqual([offer(3), offer(4)])
    expect(second.hasMore).toBe(false)
  })
})
