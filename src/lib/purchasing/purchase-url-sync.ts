import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { productChangeLogs, products, purchaseRequestItems } from '@/lib/db/schema'
import { ensureNewProductWorkflowTables } from '@/lib/new-products/workflow'
import { ALIBABA_ORDER_OR_CART_URL_PATTERN, canonicalize1688OfferUrl, is1688OrderOrCartUrl, metadataWithPurchaseUrl, purchaseUrlFromMetadata, recordValue } from './purchase-url-values'
import { matchOrderPurchaseUrls, normalizeOrderProductLinks, type OrderProductLink } from './purchase-order-url-match'
export { resolveOrderPurchaseUrls, type OrderProductLink } from './purchase-order-url-match'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type PurchaseUrlSource = { sku: string; url: string; requestId: string; workflowItemId: string | null; orderNumber: string | null }
export const workflowVerificationSku = (id: string) => `new-product:${id}`

export async function savePurchaseTrackingProductLinks(input: {
  userId: string; requestId: string; orderNumber: string; links: OrderProductLink[]
}) {
  const links = normalizeOrderProductLinks(input.links)
  if (!links.length) return { updatedProducts: 0, updatedWorkflow: 0 }
  const skus = await db.transaction(async tx => {
    const rows = await tx.select({ id: purchaseRequestItems.id, sku: purchaseRequestItems.sku,
      productName: purchaseRequestItems.productName, optionName: purchaseRequestItems.optionName,
      orderNumber: purchaseRequestItems.supplierOrderNumber, rawData: purchaseRequestItems.rawData, metadata: products.metadata,
    }).from(purchaseRequestItems).leftJoin(products, and(eq(products.userId, input.userId), eq(products.internalSku, purchaseRequestItems.sku)))
      .where(and(eq(purchaseRequestItems.userId, input.userId),
      eq(purchaseRequestItems.supplierOrderNumber, input.orderNumber))).orderBy(purchaseRequestItems.id).for('update', { of: purchaseRequestItems })
    if (!rows.some(row => row.id === input.requestId)) return []
    const assignments = new Map(matchOrderPurchaseUrls(rows, links).map(row => [row.requestId, row]))
    for (const row of rows) {
      await tx.update(purchaseRequestItems).set({ rawData: {
        ...recordValue(row.rawData), purchaseUrlLookup: { orderNumber: input.orderNumber, links,
          resolvedUrl: assignments.get(row.id)?.url ?? null, matchMethod: assignments.get(row.id)?.method ?? null, observedAt: new Date().toISOString() },
      } }).where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, row.id)))
    }
    return rows.map(row => row.sku)
  })
  return skus.length ? syncPurchaseUrlsFromHistory(input.userId, skus) : { updatedProducts: 0, updatedWorkflow: 0 }
}

/** Manual choice is limited to links observed in this exact order. Optimistic
 * checks keep a stale browser from undoing another operator's selection.
 */
export async function confirmPurchaseOrderProductUrl(input: {
  userId: string; requestId: string; orderNumber: string; url: string; expectedUrl: string | null
}) {
  const url = canonicalize1688OfferUrl(input.url)
  if (!url) throw new Error('1688 상품 링크를 확인해주세요.')
  const sku = await db.transaction(async tx => {
    const [row] = await tx.select({ id: purchaseRequestItems.id, sku: purchaseRequestItems.sku, rawData: purchaseRequestItems.rawData,
      orderNumber: purchaseRequestItems.supplierOrderNumber }).from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.requestId))).for('update')
    if (!row) throw new Error('발주 항목을 찾을 수 없습니다.')
    const lookup = recordValue(recordValue(row.rawData).purchaseUrlLookup)
    if (row.orderNumber !== input.orderNumber || lookup.orderNumber !== input.orderNumber) throw new Error('주문번호가 변경됐습니다. 다시 조회해주세요.')
    const current = canonicalize1688OfferUrl(lookup.resolvedUrl as string | null)
    if (current !== canonicalize1688OfferUrl(input.expectedUrl)) throw new Error('상품 링크가 변경됐습니다. 새로고침 후 다시 선택해주세요.')
    const links = normalizeOrderProductLinks(Array.isArray(lookup.links) ? lookup.links as OrderProductLink[] : [])
    if (!links.some(link => link.url === url)) throw new Error('이 주문에서 수집한 상품 링크만 선택할 수 있습니다.')
    await tx.update(purchaseRequestItems).set({ rawData: { ...recordValue(row.rawData), purchaseUrlLookup: {
      ...lookup, resolvedUrl: url, matchMethod: 'manual', confirmedAt: new Date().toISOString(),
    } } }).where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.requestId)))
    return row.sku
  })
  try {
    return { url, ...await syncPurchaseUrlsFromHistory(input.userId, [sku]) }
  } catch (error) {
    console.error('[confirmed-purchase-url-sync]', error)
    return { url, updatedProducts: 0, updatedWorkflow: 0,
      syncWarning: '상품 링크는 저장했습니다. 품목·상품관리 반영은 발주 URL 연동을 다시 실행해주세요.' }
  }
}

async function purchaseUrlSources(userId: string, skus?: string[], database: Pick<typeof db, 'select'> = db) {
  const rows = await database.select({ id: purchaseRequestItems.id, sku: purchaseRequestItems.sku,
    orderNumber: purchaseRequestItems.supplierOrderNumber, rawData: purchaseRequestItems.rawData,
  }).from(purchaseRequestItems).where(and(eq(purchaseRequestItems.userId, userId),
    skus?.length ? inArray(purchaseRequestItems.sku, skus) : undefined,
    sql`(${purchaseRequestItems.rawData}->'purchaseUrlLookup' IS NOT NULL
      OR ${purchaseRequestItems.rawData}->'productWorkflow'->>'purchaseUrl' IS NOT NULL)`,
  )).orderBy(sql`COALESCE(${purchaseRequestItems.outboundExpectedDate}, ${purchaseRequestItems.requestDate}, ${purchaseRequestItems.createdAt}::date) DESC`, desc(purchaseRequestItems.createdAt), desc(purchaseRequestItems.id))
  const sources = new Map<string, PurchaseUrlSource>()
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.sku)) continue
    seen.add(row.sku)
    const raw = recordValue(row.rawData), lookup = recordValue(raw.purchaseUrlLookup), workflow = recordValue(raw.productWorkflow)
    // A new unresolved lookup must not silently fall back to an old workflow link.
    const value = Object.keys(lookup).length
      ? lookup.orderNumber === row.orderNumber ? lookup.resolvedUrl : null
      : workflow.purchaseUrl
    const url = typeof value === 'string' ? canonicalize1688OfferUrl(value) : null
    if (!url) continue
    sources.set(row.sku, { sku: row.sku, url, requestId: row.id,
      workflowItemId: typeof workflow.itemId === 'string' ? workflow.itemId : null, orderNumber: row.orderNumber })
  }
  return [...sources.values()]
}

/** Fill blanks, failed links and order/cart addresses with a matched real offer. */
export async function syncPurchaseUrlsFromHistory(userId: string, skus?: string[]) {
  await ensureNewProductWorkflowTables(userId)
  const sources = await purchaseUrlSources(userId, skus)
  if (!sources.length) return { updatedProducts: 0, updatedWorkflow: 0 }
  const sourceBySku = new Map(sources.map(source => [source.sku, source]))
  return db.transaction(async tx => {
    const replacements: Array<{ sku: string; url: string; oldUrl: string | null }> = []
    const changes: Array<{ id: string; metadata: unknown; url: string }> = []
    const rows = await tx.select({ id: products.id, sku: products.internalSku, metadata: products.metadata })
      .from(products).where(and(eq(products.userId, userId), inArray(products.internalSku, sources.map(source => source.sku))))
      .orderBy(products.id).for('update')
    for (const row of rows) {
      const source = sourceBySku.get(row.sku)!
      const currentUrl = purchaseUrlFromMetadata(row.metadata)
      if (currentUrl && !is1688OrderOrCartUrl(currentUrl)
        && recordValue(recordValue(row.metadata).purchaseUrlVerification).status !== 'confirm_required') continue
      if (canonicalize1688OfferUrl(currentUrl) === source.url) continue
      changes.push({ id: row.id, metadata: row.metadata, url: source.url })
      replacements.push({ sku: row.sku, url: source.url, oldUrl: currentUrl })
    }
    await writeMasterUrls(tx, userId, changes)
    const updatedWorkflow = await syncWorkflowUrls(tx, userId, sources, replacements)
    return { updatedProducts: changes.length, updatedWorkflow }
  })
}

async function writeMasterUrls(tx: Transaction, userId: string,
  changes: Array<{ id: string; metadata: unknown; url: string }>) {
  // Bound statement size while avoiding one update and audit insert per SKU.
  for (let offset = 0; offset < changes.length; offset += 200) {
    const batch = changes.slice(offset, offset + 200)
    const cases = sql.join(batch.map(change => sql`WHEN ${products.id} = ${change.id}::uuid
      THEN ${JSON.stringify(metadataWithPurchaseUrl(change.metadata, change.url))}::jsonb`), sql` `)
    await tx.update(products).set({ metadata: sql`CASE ${cases} ELSE ${products.metadata} END`, updatedAt: new Date() })
      .where(and(eq(products.userId, userId), inArray(products.id, batch.map(change => change.id))))
    await tx.insert(productChangeLogs).values(batch.map(change => ({ productId: change.id, userId,
      fieldName: 'metadata.esa009m.구매 URL', oldValue: purchaseUrlFromMetadata(change.metadata), newValue: change.url })))
  }
}

/** Exact SKU / option-code / explicit workflow relation only; names never merge items. */
export async function syncWorkflowUrls(tx: Transaction, userId: string, sources: PurchaseUrlSource[],
  replacements: Array<{ sku: string; url: string; oldUrl: string | null }> = []) {
  if (!sources.length) return 0
  const result = await tx.execute(sql`
    WITH candidates AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(sources)}::jsonb)
        AS s(sku text, url text, "requestId" text, "workflowItemId" text, "orderNumber" text)
    ), replacements AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(replacements)}::jsonb) AS r(sku text, url text, "oldUrl" text)
    ), matches AS (
      SELECT item.id, item.source_url AS "previousUrl", min(c.url) AS url, bool_or(
        NULLIF(btrim(item.source_url), '') IS NULL
        OR btrim(item.source_url) ~* ${ALIBABA_ORDER_OR_CART_URL_PATTERN}
        OR (item.metadata->'purchaseUrlVerification'->>'status' = 'confirm_required'
          AND c.url IS DISTINCT FROM item.metadata->'purchaseUrlVerification'->>'failedUrl')
        OR EXISTS (SELECT 1 FROM replacements r WHERE r.sku = c.sku AND r.url = c.url
          AND regexp_replace(rtrim(split_part(split_part(item.source_url, '?', 1), '#', 1), '/'), '^http://', 'https://')
            = regexp_replace(rtrim(split_part(split_part(r."oldUrl", '?', 1), '#', 1), '/'), '^http://', 'https://'))
      ) AS eligible
      FROM new_product_workflow_items item JOIN candidates c ON (
        item.id::text = c."workflowItemId" OR item.sabangnet_code = c.sku
        OR item.metadata->'purchaseLink'->>'requestId' = c."requestId"
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(item.metadata->'optionDetails') = 'array'
          THEN item.metadata->'optionDetails' ELSE '[]'::jsonb END) opt WHERE opt->>'sabangnetOptionCode' = c.sku)
      )
      WHERE item.user_id = ${userId}::uuid
      GROUP BY item.id HAVING count(DISTINCT c.url) = 1
    ), updated AS (
      UPDATE new_product_workflow_items item SET source_url = matches.url,
        metadata = (COALESCE(item.metadata, '{}'::jsonb) - 'purchaseUrlVerification') || jsonb_build_object('purchaseUrlSync',
          jsonb_build_object('previousUrl', item.source_url, 'url', matches.url, 'at', now())), updated_at = now()
      FROM matches WHERE item.id = matches.id AND item.user_id = ${userId}::uuid AND matches.eligible
        AND item.source_url IS NOT DISTINCT FROM matches."previousUrl"
        AND item.source_url IS DISTINCT FROM matches.url
      RETURNING item.id
    ) SELECT count(*)::int AS count FROM updated
  `)
  return Number(result[0]?.count ?? 0)
}

export async function getPurchaseUrlReplacementSources(userId: string, skus: string[], failedUrl: string) {
  return (await purchaseUrlSources(userId, skus)).filter(source => source.url !== failedUrl)
}

/** Reuse the save transaction rather than waiting for another pool connection. */
export async function getPurchaseUrlForNewProduct(tx: Transaction, userId: string, skus: string[]) {
  if (!skus.length) return null
  const urls = [...new Set((await purchaseUrlSources(userId, skus, tx)).map(source => source.url))]
  return urls.length === 1 ? urls[0] : null
}
