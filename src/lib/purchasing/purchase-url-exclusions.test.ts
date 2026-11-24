// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => ({ client: null as unknown as import('@electric-sql/pglite').PGlite }))
vi.mock('@/lib/new-products/workflow', () => ({ ensureNewProductWorkflowTables: vi.fn() }))
vi.mock('./purchase-url-sync', () => ({
  getPurchaseUrlReplacementSources: vi.fn(async () => []),
  resolveOrderPurchaseUrls: vi.fn(() => []),
  syncWorkflowUrls: vi.fn(async () => 0),
}))
vi.mock('@/lib/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  memory.client = new PGlite()
  const database = drizzle(memory.client)
  type QueryDatabase = Pick<typeof database, 'select' | 'update' | 'insert' | 'execute'>
  const expose = (connection: QueryDatabase) => ({
    select: connection.select.bind(connection),
    update: connection.update.bind(connection),
    insert: connection.insert.bind(connection),
    execute: async (...args: Parameters<QueryDatabase['execute']>) => (await connection.execute(...args)).rows,
  })
  return { db: { ...expose(database), transaction: (fn: (tx: ReturnType<typeof expose>) => Promise<unknown>) => database.transaction(tx => fn(expose(tx))) } }
})

import { getPurchaseUrlCollectionQueue, getPurchaseUrlVerificationQueue, markPurchaseUrlsAsVerifiedOpen, markPurchaseUrlsForVerification } from './purchase-url-collector'
import { ensurePurchaseUrlVerificationHistory } from './purchase-url-verification-history'

const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const OWNER = uuid(900001), OTHER = uuid(900002)
const offer = (number: number) => `https://detail.1688.com/offer/${String(number).padStart(12, '1')}.html`
let nextId = 0

async function product(input: { sku: string; status?: string; legacy?: boolean; url?: string | null; userId?: string; metadata?: Record<string, unknown> }) {
  const id = uuid(++nextId)
  await memory.client.query(`INSERT INTO products (id,user_id,internal_sku,name,purchasing_status,metadata)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [id, input.userId ?? OWNER, input.sku, input.sku,
    input.status ?? 'active', JSON.stringify({ esa009m: { '구매 URL': input.url ?? null },
      ...(input.legacy ? { purchasingOutgoingMetrics: { isDiscontinued: true } } : {}), ...input.metadata })])
  return id
}

async function request(input: { sku: string; userId?: string; rawData?: Record<string, unknown>; orderNumber?: string }) {
  const id = uuid(++nextId)
  await memory.client.query(`INSERT INTO purchase_request_items (id,user_id,sku,product_name,supplier_order_number,raw_data)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [id, input.userId ?? OWNER, input.sku, input.sku,
    input.orderNumber ?? '1234567890123', JSON.stringify(input.rawData ?? {})])
  return id
}

async function workflow(input: { primary?: string; codes?: string[]; requestId?: string; url: string; userId?: string; metadata?: Record<string, unknown> }) {
  const id = uuid(++nextId)
  await memory.client.query(`INSERT INTO new_product_workflow_items (id,user_id,product_name,sabangnet_code,source_url,metadata)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [id, input.userId ?? OWNER, id, input.primary ?? null, input.url,
    JSON.stringify({ optionDetails: (input.codes ?? []).map(sabangnetOptionCode => ({ sabangnetOptionCode })),
      ...(input.requestId ? { purchaseLink: { requestId: input.requestId } } : {}), ...input.metadata })])
  return id
}

beforeAll(async () => {
  await memory.client.exec(`
    CREATE TABLE products (id uuid PRIMARY KEY, user_id uuid NOT NULL, internal_sku text NOT NULL,
      name text NOT NULL, purchasing_status text DEFAULT 'active', metadata jsonb, updated_at timestamptz DEFAULT now());
    CREATE TABLE purchase_request_items (id uuid PRIMARY KEY, user_id uuid NOT NULL, sku text NOT NULL,
      product_name text NOT NULL, option_name text, supplier_order_number text, raw_data jsonb,
      updated_at timestamptz DEFAULT now());
    CREATE TABLE new_product_workflow_items (id uuid PRIMARY KEY, user_id uuid NOT NULL, product_name text,
      registered_product_name text, sabangnet_code text, source_url text, metadata jsonb, updated_at timestamptz DEFAULT now());
  `)
  await ensurePurchaseUrlVerificationHistory()
}, 30_000)
beforeEach(async () => {
  nextId = 0
  await memory.client.exec('TRUNCATE products, purchase_request_items, new_product_workflow_items, purchasing_url_verification_history')
})
afterAll(async () => { await memory.client.close() })

describe('discontinued purchase URL exclusions in PostgreSQL', () => {
  it('excludes both discontinuation flags but retains the active SKU sharing their URL', async () => {
    const url = offer(1)
    await product({ sku: '100001-0001', status: 'discontinued', url })
    await product({ sku: '100001-0002', legacy: true, url })
    await product({ sku: '100001-0003', url })
    const result = await getPurchaseUrlVerificationQueue({ userId: OWNER })
    expect(result.links).toEqual([{ url, items: [{ sku: '100001-0003', productName: '100001-0003' }] }])
    expect(result.totalItems).toBe(1)
  })

  it('removes all-discontinued workflows and keeps groups with an active option', async () => {
    await product({ sku: '100001-0001', status: 'discontinued' })
    await product({ sku: '100001-0002', legacy: true })
    await product({ sku: '100001-0003' })
    await workflow({ primary: '100001-0001', codes: ['100001-0001', '100001-0002'], url: offer(1) })
    const mixed = await workflow({ primary: '100001-0001', codes: ['100001-0002', '100001-0003'], url: offer(2) })
    expect((await getPurchaseUrlVerificationQueue({ userId: OWNER })).links).toEqual([
      { url: offer(2), items: [{ sku: `new-product:${mixed}`, productName: mixed }] },
    ])
  })

  it('retains new products with no SKU, an unregistered option or malformed legacy option metadata', async () => {
    await product({ sku: '100001-0001', status: 'discontinued' })
    const noSku = await workflow({ url: offer(1) })
    const unknown = await workflow({ primary: '100001-0001', codes: ['100001-9999'], url: offer(2) })
    const malformed = await workflow({ url: offer(3), metadata: { optionDetails: { legacy: true } } })
    const result = await getPurchaseUrlVerificationQueue({ userId: OWNER })
    expect(result.links.flatMap(link => link.items.map(item => item.sku)))
      .toEqual([noSku, unknown, malformed].map(id => `new-product:${id}`))
  })

  it('follows explicit purchase links in both directions without hiding unrelated same-name products', async () => {
    await product({ sku: '100001-0001', status: 'discontinued' })
    const purchaseId = await request({ sku: '100001-0001' })
    await workflow({ requestId: purchaseId, url: offer(1) })
    const reverse = await workflow({ url: offer(2) })
    await request({ sku: '100001-0001', rawData: { productWorkflow: { itemId: reverse } } })
    const unrelated = await workflow({ url: offer(3) })
    expect((await getPurchaseUrlVerificationQueue({ userId: OWNER })).links).toEqual([
      { url: offer(3), items: [{ sku: `new-product:${unrelated}`, productName: unrelated }] },
    ])
  })

  it('uses only this workspace status and ignores purchase relations belonging to another workspace', async () => {
    await product({ sku: '100001-0001', status: 'discontinued', userId: OTHER, url: offer(1) })
    await product({ sku: '100001-0001', url: offer(1) })
    await product({ sku: '100001-0002', status: 'discontinued', userId: OTHER })
    const own = await workflow({ primary: '100001-0001', url: offer(2) })
    const crossWorkspace = await workflow({ url: offer(3) })
    await request({ sku: '100001-0002', userId: OTHER, rawData: { productWorkflow: { itemId: crossWorkspace } } })
    await workflow({ primary: '100001-0001', userId: OTHER, url: offer(4) })
    const result = await getPurchaseUrlVerificationQueue({ userId: OWNER })
    expect(result.links.flatMap(link => link.items.map(item => item.sku))).toEqual([
      '100001-0001', `new-product:${own}`, `new-product:${crossWorkspace}`,
    ])
  })

  it('excludes discontinued blank-URL rows from collection before grouping shared orders', async () => {
    await product({ sku: '100001-0001', status: 'discontinued' })
    await product({ sku: '100001-0002', legacy: true })
    const activeId = await product({ sku: '100001-0003' })
    await request({ sku: '100001-0001' })
    await request({ sku: '100001-0002' })
    const activeRequest = await request({ sku: '100001-0003' })
    expect(await getPurchaseUrlCollectionQueue({ userId: OWNER })).toMatchObject({
      totalItems: 1,
      orders: [{ orderNumber: '1234567890123', items: [{ requestId: activeRequest, productId: activeId, sku: '100001-0003' }] }],
    })
  })

  it('ignores a delayed failed-verification result after every checked item becomes discontinued', async () => {
    const url = offer(1)
    const id = await product({ sku: '100001-0001', status: 'discontinued', url })
    const workflowId = await workflow({ primary: '100001-0001', url })
    expect(await markPurchaseUrlsForVerification({ userId: OWNER, url, skus: ['100001-0001', `new-product:${workflowId}`], reason: '판매 중지' }))
      .toEqual({ updated: [], replaced: 0, updatedWorkflow: 0 })
    const result = await memory.client.query<{ metadata: Record<string, unknown> }>('SELECT metadata FROM products WHERE id=$1', [id])
    expect(result.rows[0].metadata).toEqual({ esa009m: { '구매 URL': url } })
    const checkedWorkflow = await memory.client.query<{ metadata: Record<string, unknown> }>('SELECT metadata FROM new_product_workflow_items WHERE id=$1', [workflowId])
    expect(checkedWorkflow.rows[0].metadata).not.toHaveProperty('purchaseUrlVerification')
  })

  it('clears matching and legacy master failure flags while preserving the purchase URL, cost and unrelated metadata', async () => {
    const url = offer(1)
    const matchingMetadata = {
      esa009m: { '구매 URL': `${url}?spm=order`, '원가': '125', 'HS CODE': '123456' },
      extra: { keep: true },
      purchaseUrlVerification: { status: 'confirm_required', failedUrl: `${url}?sku=red`, reason: '일시 오류' },
    }
    const legacyMetadata = {
      esa009m: { '구매 URL': url, '배송비': '5' },
      purchasingOutgoingMetrics: { isDiscontinued: false },
      purchaseUrlVerification: { status: 'confirm_required', reason: '과거 형식' },
    }
    const first = await product({ sku: '100001-0001', metadata: matchingMetadata })
    const second = await product({ sku: '100001-0002', metadata: legacyMetadata })
    expect(await markPurchaseUrlsAsVerifiedOpen({ userId: OWNER, url, skus: ['100001-0001', '100001-0002'] }))
      .toMatchObject({ updated: [{ id: first }, { id: second }], replaced: 0, updatedWorkflow: 0 })
    const result = await memory.client.query<{ id: string; metadata: Record<string, unknown> }>('SELECT id, metadata FROM products ORDER BY id')
    expect(result.rows).toEqual([
      { id: first, metadata: { esa009m: matchingMetadata.esa009m, extra: matchingMetadata.extra } },
      { id: second, metadata: { esa009m: legacyMetadata.esa009m, purchasingOutgoingMetrics: legacyMetadata.purchasingOutgoingMetrics } },
    ])
  })

  it('preserves edited, discontinued, differently failed, foreign-workspace and unrequested master rows on a late normal result', async () => {
    const url = offer(1), otherUrl = offer(2)
    const flag = { status: 'confirm_required', failedUrl: url, reason: '확인 필요' }
    const inputs = [
      { sku: '100001-0001', metadata: { esa009m: { '구매 URL': otherUrl, '원가': '100' }, purchaseUrlVerification: flag } },
      { sku: '100001-0002', status: 'discontinued', url, metadata: { purchaseUrlVerification: flag } },
      { sku: '100001-0003', legacy: true, url, metadata: { purchaseUrlVerification: flag } },
      { sku: '100001-0004', url, metadata: { purchaseUrlVerification: { ...flag, failedUrl: otherUrl } } },
      { sku: '100001-0005', userId: OTHER, url, metadata: { purchaseUrlVerification: flag } },
      { sku: '100001-0006', url, metadata: { purchaseUrlVerification: flag } },
    ]
    for (const input of inputs) await product(input)
    const before = await memory.client.query('SELECT id, metadata FROM products ORDER BY id')
    expect(await markPurchaseUrlsAsVerifiedOpen({ userId: OWNER, url, skus: inputs.slice(0, 5).map(input => input.sku) }))
      .toEqual({ updated: [], replaced: 0, updatedWorkflow: 0 })
    expect((await memory.client.query('SELECT id, metadata FROM products ORDER BY id')).rows).toEqual(before.rows)
  })

  it('clears only the requested eligible workflow failure flag and preserves its source URL and other details', async () => {
    const url = offer(1)
    const sourceUrl = `${url}?spm=original`
    const keep = { estimatedCost: 300, supplier: '기존 거래처' }
    const id = await workflow({ url: sourceUrl, metadata: {
      ...keep,
      purchaseUrlVerification: { status: 'confirm_required', failedUrl: `${url}?sku=red`, reason: '시간 초과' },
    } })
    expect(await markPurchaseUrlsAsVerifiedOpen({ userId: OWNER, url, skus: [`new-product:${id}`] }))
      .toEqual({ updated: [], replaced: 0, updatedWorkflow: 1 })
    const result = await memory.client.query<{ sourceUrl: string; metadata: Record<string, unknown> }>(
      'SELECT source_url AS "sourceUrl", metadata FROM new_product_workflow_items WHERE id=$1', [id],
    )
    expect(result.rows).toEqual([{ sourceUrl, metadata: { optionDetails: [], ...keep } }])
  })

  it('preserves workflows after source edits or discontinuation, and protects other failed URLs, workspaces and IDs', async () => {
    const url = offer(1), otherUrl = offer(2)
    const flag = { status: 'confirm_required', failedUrl: url, reason: '확인 필요' }
    await product({ sku: '100001-0001', status: 'discontinued' })
    const edited = await workflow({ url: otherUrl, metadata: { purchaseUrlVerification: flag } })
    const discontinued = await workflow({ primary: '100001-0001', url, metadata: { purchaseUrlVerification: flag } })
    const differentlyFailed = await workflow({ url, metadata: { purchaseUrlVerification: { ...flag, failedUrl: otherUrl } } })
    const foreign = await workflow({ userId: OTHER, url, metadata: { purchaseUrlVerification: flag } })
    const unrequested = await workflow({ url, metadata: { purchaseUrlVerification: flag } })
    const differentStatus = await workflow({ url, metadata: { purchaseUrlVerification: { ...flag, status: 'manual_review' } } })
    const noFlag = await workflow({ url, metadata: { keep: '검증 오류 없음' } })
    const before = await memory.client.query('SELECT id, source_url, metadata FROM new_product_workflow_items ORDER BY id')
    expect(await markPurchaseUrlsAsVerifiedOpen({ userId: OWNER, url,
      skus: [edited, discontinued, differentlyFailed, foreign, differentStatus, noFlag].map(id => `new-product:${id}`),
    })).toEqual({ updated: [], replaced: 0, updatedWorkflow: 0 })
    expect((await memory.client.query('SELECT id, source_url, metadata FROM new_product_workflow_items ORDER BY id')).rows).toEqual(before.rows)
    expect(before.rows).toEqual(expect.arrayContaining([expect.objectContaining({ id: unrequested })]))
  })
})
