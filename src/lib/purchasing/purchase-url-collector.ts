import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { productChangeLogs, products, purchaseRequestItems } from '@/lib/db/schema'
import { PURCHASE_URL_HEADER } from './items'

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

export function canonicalize1688OfferUrl(value: string | null | undefined) {
  if (!value) return null
  const decoded = safeDecodeURIComponent(value.trim())
  try {
    const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded)
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'detail.1688.com') return null
    const match = url.pathname.match(/^\/offer\/(\d{6,30})\.html\/?$/i)
    return match ? `https://detail.1688.com/offer/${match[1]}.html` : null
  } catch {
    return null
  }
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

  return db.transaction(async (tx) => {
    const requests = await tx
      .select({
        sku: purchaseRequestItems.sku,
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        sql`BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')) = ${orderNumber}`,
      ))

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
      .for('update')

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

function uniqueCanonicalUrls(values: Array<string | PurchaseUrlCandidate>) {
  return Array.from(new Set(values.flatMap((value) => {
    const url = canonicalize1688OfferUrl(typeof value === 'string' ? value : value.url)
    return url ? [url] : []
  })))
}

function purchaseUrlFromMetadata(metadata: unknown) {
  const root = recordValue(metadata)
  const esa009m = recordValue(root.esa009m)
  const value = esa009m[PURCHASE_URL_HEADER]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function metadataWithPurchaseUrl(metadata: unknown, url: string) {
  const root = recordValue(metadata)
  const esa009m = recordValue(root.esa009m)
  return {
    ...root,
    esa009m: {
      ...esa009m,
      [PURCHASE_URL_HEADER]: url,
    },
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
