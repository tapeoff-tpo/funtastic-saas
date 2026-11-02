import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn(), resolve: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))
vi.mock('./workflow', () => ({ ensureNewProductWorkflowTables: vi.fn() }))
vi.mock('@/lib/purchasing/product-image-catalogue', () => ({ resolvePurchasingProductImages: mocks.resolve }))
import { downloadCatalogueImage, findSavedNewProductImages, syncNewProductCatalogueImages } from './catalogue-images'

const host = 'https://pub-c3849cebd2dd4a1a881a36c783c3845c.r2.dev/one.jpg'
const item = { id: '00000000-0000-4000-8000-000000000001', productName: '상품 A', registeredName: null, sku: 'SKU-A' }
const dialect = new PgDialect()
let existing: boolean
let writes: Array<{ sql: string; params: unknown[] }>
beforeEach(() => {
  vi.clearAllMocks(); existing = false; writes = []
  mocks.execute.mockResolvedValue([item])
  mocks.resolve.mockResolvedValue({ source: 'funtasticb2b', imageUrls: [host] })
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'content-type': 'image/jpeg' } })))
  mocks.transaction.mockImplementation(async (operation) => operation({ execute: async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement)
    if (query.sql.includes('FOR UPDATE')) return [{ id: item.id }]
    if (query.sql.includes('SELECT id FROM new_product_workflow_attachments')) return existing ? [{ id: 'existing-image' }] : []
    writes.push(query)
    if (query.sql.includes('INSERT INTO')) existing = true
    return []
  } }))
})
afterEach(() => vi.unstubAllGlobals())

describe('copy B2B images into product management', () => {
  it('stores actual image bytes in the existing attachment store and makes retries idempotent', async () => {
    const result = await syncNewProductCatalogueImages({ userId: 'workspace', actorId: 'admin' })
    expect(result.results[0]).toMatchObject({ status: 'saved', images: 1 })
    const insert = writes.find((write) => write.sql.includes('INSERT INTO'))!
    expect(insert.params).toContain('workspace')
    expect(insert.params).toContain('admin')
    expect(insert.params).toContain(Buffer.from([255, 216, 255, 217]).toString('base64'))
    expect(insert.sql).not.toContain('DELETE')
    writes = []
    expect((await syncNewProductCatalogueImages({ userId: 'workspace', actorId: 'admin' })).results[0].status).toBe('existing')
    expect(writes).toEqual([])
  })
  it('does not write unmatched or failed downloads, and preserves images uploaded during matching', async () => {
    mocks.resolve.mockResolvedValueOnce({ source: 'none', imageUrls: [], ambiguous: true })
    expect((await syncNewProductCatalogueImages({ userId: 'workspace', actorId: 'admin' })).results[0].status).toBe('unmatched')
    expect(writes).toEqual([])
    existing = true
    expect((await syncNewProductCatalogueImages({ userId: 'workspace', actorId: 'admin' })).results[0].status).toBe('existing')
    expect(writes).toEqual([])
    existing = false
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect((await syncNewProductCatalogueImages({ userId: 'workspace', actorId: 'admin' })).results[0].status).toBe('failed')
    expect(writes).toEqual([])
  })
  it('restricts copied files to the known image source, supported image bytes and a size limit', async () => {
    await expect(downloadCatalogueImage('http://127.0.0.1/image.jpg')).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad</html>', { headers: { 'content-type': 'image/jpeg' } })))
    await expect(downloadCatalogueImage(host)).rejects.toThrow('올바른')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': String(5 * 1024 * 1024) } })))
    await expect(downloadCatalogueImage(host)).rejects.toThrow()
  })
  it('uses a unique saved SKU or name and never reuses an ambiguous product attachment', async () => {
    mocks.execute.mockResolvedValue([{ id: 'one', exactSku: true, images: ['image-1'] }, { id: 'two', exactSku: false, images: ['image-2'] }])
    expect(await findSavedNewProductImages('workspace', 'SKU-A', '상품 A')).toEqual([{ url: '/api/purchasing/product-images/files/image-1', sortOrder: 0 }])
    mocks.execute.mockResolvedValue([{ id: 'one', exactSku: false, images: ['image-1'] }, { id: 'two', exactSku: false, images: ['image-2'] }])
    expect(await findSavedNewProductImages('workspace', 'SKU-A', '상품 A')).toEqual([])
  })
  it('uses read-only lookup, handles uninitialized tables, and surfaces genuine database failures', async () => {
    const { ensureNewProductWorkflowTables } = await import('./workflow')
    mocks.execute.mockResolvedValue([])
    await findSavedNewProductImages('workspace', 'SKU-A', '상품 A')
    expect(ensureNewProductWorkflowTables).not.toHaveBeenCalled()
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[0][0])
    expect(query.sql).toContain('jsonb_build_object')
    expect(query.sql).not.toContain('jsonb_array_elements')
    expect(query.params).toContain('workspace')
    mocks.execute.mockRejectedValueOnce({ cause: { code: '42P01' } })
    expect(await findSavedNewProductImages('workspace', 'SKU-A', '상품 A')).toEqual([])
    mocks.execute.mockRejectedValueOnce(new Error('connection lost'))
    await expect(findSavedNewProductImages('workspace', 'SKU-A', '상품 A')).rejects.toThrow('connection lost')
  })
})
