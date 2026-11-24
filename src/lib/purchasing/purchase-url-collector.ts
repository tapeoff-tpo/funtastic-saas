import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { productChangeLogs, products, purchaseRequestItems } from '@/lib/db/schema'
import { PURCHASE_URL_HEADER } from './items'
import { ensureNewProductWorkflowTables } from '@/lib/new-products/workflow'
import { getPurchaseUrlReplacementSources, resolveOrderPurchaseUrls, syncWorkflowUrls } from './purchase-url-sync'
import { canonicalize1688OfferUrl, metadataWithPurchaseUrl, purchaseUrlFromMetadata, recordValue } from './purchase-url-values'
export { canonicalize1688OfferUrl } from './purchase-url-values'

const MAX_QUEUE_ROWS = 2_000

export type PurchaseUrlQueueItem = {
  requestId: string
  productId: string
  sku: string
  productName: string
  optionName: string | null
}

export type PurchaseUrlQueueOrder = {
  orderNumber: string
  items: PurchaseUrlQueueItem[]
}

export type PurchaseUrlCandidate = {
  url: string
  title?: string | null
}

export type PurchaseUrlVerificationLink = {
  url: string
  items: Array<{
    sku: string
    productName: string
  }>
}

export type PurchaseUrlAssignmentProduct = {
  productId: string
  sku: string
  productName: string
  currentUrl: string | null
}

export type PurchaseUrlAssignmentResolution =
  | {
    status: 'assign'
    assignments: Array<{ productId: string; url: string }>
    candidates: string[]
  }
  | {
    status: 'ambiguous' | 'already_set' | 'not_found'
    assignments: []
    candidates: string[]
  }

export function resolvePurchaseUrlAssignments(
  matchedProducts: PurchaseUrlAssignmentProduct[],
  candidateValues: Array<string | PurchaseUrlCandidate>,
): PurchaseUrlAssignmentResolution {
  const candidates = uniqueCanonicalUrls(candidateValues)
  if (candidates.length === 0) {
    return { status: 'not_found', assignments: [], candidates }
  }

  const missingProducts = matchedProducts.filter((product) => !product.currentUrl?.trim())
  if (missingProducts.length === 0) {
    return { status: 'already_set', assignments: [], candidates }
  }

  if (candidates.length === 1) {
    const exactGroup = resolveOrderPurchaseUrls(matchedProducts.map(product => ({
      id: product.productId, sku: product.sku, productName: product.productName, rawData: {},
    })), [{ url: candidates[0]! }])
    if (exactGroup.length !== matchedProducts.length) return { status: 'ambiguous', assignments: [], candidates }
    return {
      status: 'assign',
      assignments: missingProducts.map((product) => ({
        productId: product.productId,
        url: candidates[0]!,
      })),
      candidates,
    }
  }

  const knownUrls = new Set(
    matchedProducts
      .map((product) => canonicalize1688OfferUrl(product.currentUrl))
      .filter((url): url is string => Boolean(url)),
  )
  const remainingCandidates = candidates.filter((url) => !knownUrls.has(url))
  if (missingProducts.length === 1 && remainingCandidates.length === 1) {
    return {
      status: 'assign',
      assignments: [{ productId: missingProducts[0]!.productId, url: remainingCandidates[0]! }],
      candidates,
    }
  }

  return { status: 'ambiguous', assignments: [], candidates }
}

export async function getPurchaseUrlCollectionQueue(input: {
  userId: string
  orderPrefix?: string
  limit?: number
}) {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 300)
  const prefix = input.orderPrefix?.trim()
  const rows = await db
    .select({
      requestId: purchaseRequestItems.id,
      orderNumber: purchaseRequestItems.supplierOrderNumber,
      sku: purchaseRequestItems.sku,
      productName: purchaseRequestItems.productName,
      optionName: purchaseRequestItems.optionName,
      productId: products.id,
    })
    .from(purchaseRequestItems)
    .innerJoin(products, and(
      eq(products.userId, input.userId),
      eq(products.internalSku, purchaseRequestItems.sku),
    ))
    .where(and(
      eq(purchaseRequestItems.userId, input.userId),
      prefix
        ? sql`BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')) LIKE ${`${prefix}%`}`
        : undefined,
      sql`NULLIF(BTRIM(COALESCE(${products.metadata}->'esa009m'->>${PURCHASE_URL_HEADER}, '')), '') IS NULL`,
    ))
    .orderBy(desc(purchaseRequestItems.updatedAt))
    .limit(MAX_QUEUE_ROWS)

  const ordersByNumber = new Map<string, PurchaseUrlQueueOrder>()
  let skippedInvalid = 0
  for (const row of rows) {
    const orderNumber = row.orderNumber?.trim() ?? ''
    if (!/^\d{10,40}$/.test(orderNumber)) {
      skippedInvalid += 1
      continue
    }

    const existing = ordersByNumber.get(orderNumber) ?? { orderNumber, items: [] }
    if (!existing.items.some((item) => item.productId === row.productId)) {
      existing.items.push({
        requestId: row.requestId,
        productId: row.productId,
        sku: row.sku,
        productName: row.productName,
        optionName: row.optionName,
      })
    }
    ordersByNumber.set(orderNumber, existing)
  }

  const allOrders = Array.from(ordersByNumber.values())
  const orders = allOrders.slice(0, limit)
  return {
    orders,
    totalItems: orders.reduce((sum, order) => sum + order.items.length, 0),
    skippedInvalid,
    hasMore: allOrders.length > limit || rows.length === MAX_QUEUE_ROWS,
  }
}

export async function getPurchaseUrlVerificationQueue(input: {
  userId: string
  limit?: number
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const limit = Math.min(Math.max(input.limit ?? 1_000, 1), MAX_QUEUE_ROWS)
  const rows = await db
    .select({
      sku: products.internalSku,
      productName: products.name,
      metadata: products.metadata,
    })
    .from(products)
    .where(and(
      eq(products.userId, input.userId),
      sql`NULLIF(BTRIM(COALESCE(${products.metadata}->'esa009m'->>${PURCHASE_URL_HEADER}, '')), '') IS NOT NULL`,
    ))
    .orderBy(asc(products.internalSku))

  const linksByUrl = new Map<string, PurchaseUrlVerificationLink>()
  let skippedInvalid = 0
  for (const product of rows) {
    const url = canonicalize1688OfferUrl(purchaseUrlFromMetadata(product.metadata))
    if (!url) {
      skippedInvalid += 1
      continue
    }

    const link = linksByUrl.get(url) ?? { url, items: [] }
    if (!link.items.some((item) => item.sku === product.sku)) {
      link.items.push({ sku: product.sku, productName: product.productName })
    }
    linksByUrl.set(url, link)
  }

  const workflowRows = await db.execute<{ id: string; productName: string; sourceUrl: string }>(sql`
    SELECT id::text, COALESCE(NULLIF(registered_product_name, ''), product_name) AS "productName", source_url AS "sourceUrl"
    FROM new_product_workflow_items WHERE user_id = ${input.userId}::uuid AND NULLIF(btrim(source_url), '') IS NOT NULL
    ORDER BY id
  `)
  for (const item of workflowRows) {
    const url = canonicalize1688OfferUrl(item.sourceUrl)
    if (!url) { skippedInvalid += 1; continue }
    const link = linksByUrl.get(url) ?? { url, items: [] }
    link.items.push({ sku: `new-product:${item.id}`, productName: item.productName })
    linksByUrl.set(url, link)
  }

  const allLinks = Array.from(linksByUrl.values())
    .map((link) => ({
      ...link,
      items: link.items.sort((left, right) => left.sku.localeCompare(right.sku)),
    }))
    .sort((left, right) => left.url.localeCompare(right.url))
  const links = allLinks.slice(0, limit)
  return {
    links,
    totalItems: links.reduce((sum, link) => sum + link.items.length, 0),
    skippedInvalid,
    hasMore: allLinks.length > limit,
  }
}

export async function applyPurchaseUrlCollectionResult(input: {
  userId: string
  orderNumber: string
  candidates: PurchaseUrlCandidate[]
  skus?: string[]
}) {
  const orderNumber = input.orderNumber.trim()
  const canonicalCandidates = uniqueCanonicalUrls(input.candidates)
  await ensureNewProductWorkflowTables(input.userId)

  return db.transaction(async (tx) => {
    const requests = await tx
      .select({
        id: purchaseRequestItems.id,
        sku: purchaseRequestItems.sku,
        productName: purchaseRequestItems.productName,
        rawData: purchaseRequestItems.rawData,
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        sql`BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')) = ${orderNumber}`,
      )).orderBy(purchaseRequestItems.id).for('update')

    const orderAssignments = resolveOrderPurchaseUrls(requests, input.candidates)
    const resolvedById = new Map(orderAssignments.map(assignment => [assignment.requestId, assignment.url]))
    for (const request of requests) {
      await tx.update(purchaseRequestItems).set({ rawData: {
        ...recordValue(request.rawData), purchaseUrlLookup: { orderNumber, links: input.candidates,
          resolvedUrl: resolvedById.get(request.id) ?? null, observedAt: new Date().toISOString() },
      } }).where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, request.id)))
    }
    const skus = Array.from(new Set([
      ...requests.map((row) => row.sku.trim()),
      ...(input.skus ?? []).map((sku) => sku.trim()),
    ].filter(Boolean)))
    if (skus.length === 0) {
      return {
        status: 'unmatched' as const,
        orderNumber,
        updated: [],
        candidates: canonicalCandidates,
      }
    }

    const lockedProducts = await tx
      .select({
        id: products.id,
        internalSku: products.internalSku,
        name: products.name,
        metadata: products.metadata,
      })
      .from(products)
      .where(and(
        eq(products.userId, input.userId),
        inArray(products.internalSku, skus),
      ))
      .orderBy(products.id).for('update')

    await syncWorkflowUrls(tx, input.userId, requests.flatMap(request => {
      const url = resolvedById.get(request.id)
      const itemId = recordValue(recordValue(request.rawData).productWorkflow).itemId
      return url ? [{ sku: request.sku, url, requestId: request.id, orderNumber,
        workflowItemId: typeof itemId === 'string' ? itemId : null }] : []
    }))

    if (lockedProducts.length === 0) {
      return {
        status: 'unmatched' as const,
        orderNumber,
        updated: [],
        candidates: canonicalCandidates,
      }
    }

    const matchedProducts = lockedProducts.map((product) => ({
      productId: product.id,
      sku: product.internalSku,
      productName: product.name,
      currentUrl: purchaseUrlFromMetadata(product.metadata),
    }))
    const resolution = resolvePurchaseUrlAssignments(matchedProducts, canonicalCandidates)
    if (resolution.status !== 'assign') {
      return {
        status: resolution.status,
        orderNumber,
        updated: [],
        candidates: resolution.candidates,
        matchedProducts: matchedProducts.map(({ productId, sku, productName }) => ({
          productId,
          sku,
          productName,
        })),
      }
    }

    const productById = new Map(lockedProducts.map((product) => [product.id, product]))
    const updated: Array<{
      productId: string
      sku: string
      productName: string
      url: string
    }> = []

    for (const assignment of resolution.assignments) {
      const product = productById.get(assignment.productId)
      if (!product || purchaseUrlFromMetadata(product.metadata)) continue

      await tx
        .update(products)
        .set({
          metadata: metadataWithPurchaseUrl(product.metadata, assignment.url),
          updatedAt: new Date(),
        })
        .where(and(eq(products.userId, input.userId), eq(products.id, product.id)))

      await tx.insert(productChangeLogs).values({
        productId: product.id,
        userId: input.userId,
        fieldName: `metadata.esa009m.${PURCHASE_URL_HEADER}`,
        oldValue: null,
        newValue: assignment.url,
      })

      updated.push({
        productId: product.id,
        sku: product.internalSku,
        productName: product.name,
        url: assignment.url,
      })
    }

    return {
      status: updated.length > 0 ? 'updated' as const : 'already_set' as const,
      orderNumber,
      updated,
      candidates: resolution.candidates,
    }
  })
}

export async function markPurchaseUrlsForVerification(input: {
  userId: string
  url: string
  skus: string[]
  reason?: string | null
}) {
  const url = canonicalize1688OfferUrl(input.url)
  const skus = Array.from(new Set(input.skus.map((sku) => sku.trim()).filter(Boolean)))
  if (!url || skus.length === 0) return { updated: [], replaced: 0, updatedWorkflow: 0 }

  const reason = input.reason?.trim().slice(0, 1_000) || null
  await ensureNewProductWorkflowTables(input.userId)
  const workflowIds = skus.filter(sku => /^new-product:[0-9a-f-]{36}$/i.test(sku)).map(sku => sku.slice(12))
  const relatedCodes = workflowIds.length ? await db.execute<{ sku: string }>(sql`
    SELECT DISTINCT sku FROM new_product_workflow_items item
    CROSS JOIN LATERAL (SELECT item.sabangnet_code AS sku UNION SELECT opt->>'sabangnetOptionCode'
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(item.metadata->'optionDetails') = 'array'
        THEN item.metadata->'optionDetails' ELSE '[]'::jsonb END) opt) codes
    WHERE item.user_id = ${input.userId}::uuid AND item.id::text IN (${sql.join(workflowIds.map(id => sql`${id}`), sql`, `)})
      AND regexp_replace(rtrim(split_part(split_part(item.source_url, '?', 1), '#', 1), '/'), '^http://', 'https://') = ${url}
      AND NULLIF(btrim(sku), '') IS NOT NULL
    UNION SELECT request.sku FROM purchase_request_items request JOIN new_product_workflow_items item
      ON (item.metadata->'purchaseLink'->>'requestId' = request.id::text OR request.raw_data->'productWorkflow'->>'itemId' = item.id::text)
      AND item.user_id = request.user_id
    WHERE request.user_id = ${input.userId}::uuid AND item.id::text IN (${sql.join(workflowIds.map(id => sql`${id}`), sql`, `)})
      AND regexp_replace(rtrim(split_part(split_part(item.source_url, '?', 1), '#', 1), '/'), '^http://', 'https://') = ${url}
  `) : []
  const lookupSkus = [...new Set([...skus.filter(sku => !sku.startsWith('new-product:')), ...relatedCodes.map(row => row.sku)])]
  const sources = lookupSkus.length ? await getPurchaseUrlReplacementSources(input.userId, lookupSkus, url) : []
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: products.id,
        internalSku: products.internalSku,
        name: products.name,
        metadata: products.metadata,
      })
      .from(products)
      .where(and(
        eq(products.userId, input.userId),
        inArray(products.internalSku, lookupSkus),
      ))
      .orderBy(products.id)
      .for('update')

    const updated: Array<{ id: string; sku: string; productName: string }> = []
    const replacements: Array<{ sku: string; url: string; oldUrl: string | null }> = []
    for (const product of candidates) {
      const currentUrl = purchaseUrlFromMetadata(product.metadata)
      if (canonicalize1688OfferUrl(currentUrl) !== url) continue
      const replacement = sources.find(source => source.sku === product.internalSku)

      await tx
        .update(products)
        .set({
          metadata: replacement ? metadataWithPurchaseUrl(product.metadata, replacement.url)
            : metadataWithPurchaseUrlConfirmationRequired(product.metadata, reason),
          updatedAt: new Date(),
        })
        .where(and(eq(products.userId, input.userId), eq(products.id, product.id)))

      await tx.insert(productChangeLogs).values({
        productId: product.id,
        userId: input.userId,
        fieldName: `metadata.esa009m.${PURCHASE_URL_HEADER}`,
        oldValue: currentUrl,
        newValue: replacement?.url ?? '확인 필요',
      })
      if (replacement) replacements.push({ sku: product.internalSku, url: replacement.url, oldUrl: currentUrl })

      updated.push({ id: product.id, sku: product.internalSku, productName: product.name })
    }

    // A workflow may have a different (failed) URL from its master, or no
    // master row at all. Its own checked URL still authorizes an exact replacement.
    const checkedWorkflowSkus = new Set(relatedCodes.map(row => row.sku))
    const eligibleSources = sources.filter(source => checkedWorkflowSkus.has(source.sku) || replacements.some(row => row.sku === source.sku))
    const workflowReplacements = eligibleSources.map(source => ({ sku: source.sku, url: source.url, oldUrl: url }))
    const updatedWorkflow = await syncWorkflowUrls(tx, input.userId, eligibleSources, [...replacements, ...workflowReplacements])
    // Preserve the failing link for review and future verification when no
    // unambiguous newer purchase is available.
    if (workflowIds.length) await tx.execute(sql`
      UPDATE new_product_workflow_items SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'purchaseUrlVerification', jsonb_build_object('status', 'confirm_required', 'failedUrl', ${url}::text,
          'reason', ${reason}::text, 'checkedAt', now())), updated_at = now()
      WHERE user_id = ${input.userId}::uuid AND id::text IN (${sql.join(workflowIds.map(id => sql`${id}`), sql`, `)})
        AND regexp_replace(rtrim(split_part(split_part(source_url, '?', 1), '#', 1), '/'), '^http://', 'https://') = ${url}
    `)
    return { updated, replaced: replacements.length, updatedWorkflow }
  })
}

function uniqueCanonicalUrls(values: Array<string | PurchaseUrlCandidate>) {
  return Array.from(new Set(values.flatMap((value) => {
    const url = canonicalize1688OfferUrl(typeof value === 'string' ? value : value.url)
    return url ? [url] : []
  })))
}

function metadataWithPurchaseUrlConfirmationRequired(metadata: unknown, reason: string | null) {
  const root = recordValue(metadata)
  const esa009m = recordValue(root.esa009m)
  return {
    ...root,
    esa009m: {
      ...esa009m,
      [PURCHASE_URL_HEADER]: esa009m[PURCHASE_URL_HEADER] ?? null,
    },
    purchaseUrlVerification: {
      status: 'confirm_required',
      checkedAt: new Date().toISOString(),
      reason,
    },
  }
}
