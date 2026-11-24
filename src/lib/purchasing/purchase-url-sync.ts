import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { productChangeLogs, products, purchaseRequestItems } from '@/lib/db/schema'
import { ensureNewProductWorkflowTables } from '@/lib/new-products/workflow'
import { canonicalize1688OfferUrl, metadataWithPurchaseUrl, purchaseUrlFromMetadata, recordValue } from './purchase-url-values'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type OrderProductLink = { url: string; title?: string | null }
type PurchaseUrlSource = { sku: string; url: string; requestId: string; workflowItemId: string | null; orderNumber: string | null }
export const workflowVerificationSku = (id: string) => `new-product:${id}`

/** Links come only from the requested order's product section, never recommendations.
 * A single URL can cover several options of one product, but not unrelated SKUs.
 */
export function resolveOrderPurchaseUrls(
  rows: Array<{ id: string; sku: string; productName: string; rawData: unknown }>,
  links: OrderProductLink[],
) {
  const urls = [...new Set(links.map(link => canonicalize1688OfferUrl(link.url)).filter((url): url is string => Boolean(url)))]
  const groups = new Set(rows.map(row => /^\d{6}-\d{4}$/.test(row.sku.trim())
    ? row.sku.trim().split('-')[0] : row.productName.trim().replace(/\s+/g, ' ').toLowerCase()))
  return rows.flatMap(row => {
    const previous = canonicalize1688OfferUrl(recordValue(recordValue(row.rawData).productWorkflow).purchaseUrl as string | undefined)
    const url = urls.length === 1 && groups.size === 1 ? urls[0] : previous && urls.includes(previous) ? previous : null
    return url ? [{ requestId: row.id, url }] : []
  })
}

export async function savePurchaseTrackingProductLinks(input: {
  userId: string; requestId: string; orderNumber: string; links: OrderProductLink[]
}) {
  const links = input.links.flatMap(link => {
    const url = canonicalize1688OfferUrl(link.url)
    return url ? [{ url, title: link.title?.trim().slice(0, 1_000) || null }] : []
  }).slice(0, 30)
  if (!links.length) return { updatedProducts: 0, updatedWorkflow: 0 }
  const skus = await db.transaction(async tx => {
    const rows = await tx.select({ id: purchaseRequestItems.id, sku: purchaseRequestItems.sku,
      productName: purchaseRequestItems.productName, rawData: purchaseRequestItems.rawData,
    }).from(purchaseRequestItems).where(and(eq(purchaseRequestItems.userId, input.userId),
      eq(purchaseRequestItems.supplierOrderNumber, input.orderNumber))).orderBy(purchaseRequestItems.id).for('update')
    if (!rows.some(row => row.id === input.requestId)) return []
    const assignments = new Map(resolveOrderPurchaseUrls(rows, links).map(row => [row.requestId, row.url]))
    for (const row of rows) {
      await tx.update(purchaseRequestItems).set({ rawData: {
        ...recordValue(row.rawData), purchaseUrlLookup: { orderNumber: input.orderNumber, links,
          resolvedUrl: assignments.get(row.id) ?? null, observedAt: new Date().toISOString() },
      } }).where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, row.id)))
    }
    return rows.map(row => row.sku)
  })
  return skus.length ? syncPurchaseUrlsFromHistory(input.userId, skus) : { updatedProducts: 0, updatedWorkflow: 0 }
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

/** Fill blanks and previously failed masters. Existing working links stay in place. */
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
      if (currentUrl && recordValue(recordValue(row.metadata).purchaseUrlVerification).status !== 'confirm_required') continue
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
