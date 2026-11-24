import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), sync: vi.fn(), mark: vi.fn(), open: vi.fn(), history: vi.fn(), queue: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/auth/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/purchasing/purchase-url-sync', () => ({ syncPurchaseUrlsFromHistory: mocks.sync }))
vi.mock('@/lib/purchasing/purchase-url-collector', () => ({ getPurchaseUrlVerificationQueue: mocks.queue, markPurchaseUrlsForVerification: mocks.mark,
  markPurchaseUrlsAsVerifiedOpen: mocks.open, PURCHASE_URL_VERIFICATION_BATCH_SIZE: 200 }))
vi.mock('@/lib/purchasing/purchase-url-verification-history', () => ({ savePurchaseUrlVerificationHistory: mocks.history }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { GET, POST } from './route'
import { NextRequest } from 'next/server'
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: 'staff' } } }); mocks.owner.mockResolvedValue('owner')
  mocks.open.mockResolvedValue({ updated: [], replaced: 0, updatedWorkflow: 0 }); mocks.history.mockResolvedValue(undefined)
})
const req = (body: unknown) => ({ json: async () => body }) as never
describe('purchase URL history sync API', () => {
  it('synchronizes the canonical workspace, then refreshes both item screens', async () => {
    mocks.sync.mockResolvedValue({ updatedProducts: 2, updatedWorkflow: 3 })
    const result = await POST(req({ action: 'sync' }))
    expect(await result.json()).toEqual({ updatedProducts: 2, updatedWorkflow: 3 })
    expect(mocks.sync).toHaveBeenCalledWith('owner')
    expect(mocks.revalidate).toHaveBeenCalledWith('/costs')
    expect(mocks.revalidate).toHaveBeenCalledWith('/new-products')
  })
  it('reports replacement counts after a failed URL check', async () => {
    mocks.mark.mockResolvedValue({ updated: [{ id: 'master' }], replaced: 1, updatedWorkflow: 2 })
    const result = await POST(req({ url: 'https://detail.1688.com/offer/111111111111.html', skus: ['123456-0001'] }))
    expect(await result.json()).toEqual({ updated: 1, replaced: 1, updatedWorkflow: 2 })
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', status: 'unavailable' }))
    expect(mocks.mark.mock.invocationCallOrder[0]).toBeLessThan(mocks.history.mock.invocationCallOrder[0])
  })
  it('persists successful URL checks too and clears only matching failure flags', async () => {
    const url = 'https://detail.1688.com/offer/111111111111.html'
    const result = await POST(req({ url: `${url}?spm=order`, skus: ['123456-0001'], status: 'open' }))
    expect(result.status).toBe(200)
    expect(mocks.mark).not.toHaveBeenCalled()
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', url }))
    expect(mocks.history).toHaveBeenCalledWith({ userId: 'owner', url, status: 'open', reason: undefined })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('does not acknowledge success if durable history storage fails', async () => {
    mocks.history.mockRejectedValueOnce(new Error('database temporarily unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await POST(req({ url: 'https://detail.1688.com/offer/111111111111.html', skus: ['123456-0001'], status: 'open' }))
      expect(result.status).toBe(500)
    } finally { log.mockRestore() }
  })
  it('defaults to due checks and accepts a legacy limit as a bounded batch without an overall cap', async () => {
    mocks.queue.mockResolvedValue({ links: [], totalLinks: 3641, hasMore: true, nextCursor: 'next', counts: { due: 3641, issues: 0, all: 3641 } })
    const result = await GET(new NextRequest('https://saas.example/api/purchasing/purchase-url-verification?limit=2000'))
    expect(result.status).toBe(200)
    expect(mocks.queue).toHaveBeenCalledWith({ userId: 'owner', mode: 'due', limit: 200 })
    expect(await result.json()).toMatchObject({ totalLinks: 3641, hasMore: true })
  })
  it('passes the canonical workspace and URL cursor to a full or issue-only queue', async () => {
    mocks.queue.mockResolvedValue({ links: [] })
    const cursor = 'https://detail.1688.com/offer/111111111111.html'
    await GET(new NextRequest(`https://saas.example/api/purchasing/purchase-url-verification?mode=issues&limit=25&cursor=${encodeURIComponent(cursor)}`))
    expect(mocks.queue).toHaveBeenCalledWith({ userId: 'owner', mode: 'issues', limit: 25, cursor })
  })
  it.each(['?mode=invalid', '?cursor=https://evil.example/', '?limit=-1'])('rejects invalid queue conditions %s', async query => {
    expect((await GET(new NextRequest(`https://saas.example/api/purchasing/purchase-url-verification${query}`))).status).toBe(400)
    expect(mocks.queue).not.toHaveBeenCalled()
  })
  it('blocks anonymous sync requests before any write', async () => {
    mocks.user.mockResolvedValue({ data: { user: null } })
    expect((await POST(req({ action: 'sync' }))).status).toBe(401)
    expect(mocks.sync).not.toHaveBeenCalled()
  })
})
