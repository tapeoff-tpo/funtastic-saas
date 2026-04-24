import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import {
  productNameMappings,
  orderItems,
  orders,
  products,
} from '@/lib/db/schema'
import { eq, and, sql, desc, notExists, gte } from 'drizzle-orm'
import { subDays } from 'date-fns'

/** Split name into tokens (Korean-friendly). Filter tokens shorter than 2 chars. */
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2),
  )
}

/** Jaccard similarity between two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

interface Suggestion {
  productId: string
  name: string
  sku: string
  score: number
}

/**
 * GET /api/products/mappings
 *
 * Returns:
 * - mappings: all saved product name mappings for the user
 * - unmapped: distinct (marketplaceId, productName) from orders in last 90 days
 *   that have no existing mapping
 */
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [mappings, unmappedRaw, allProducts] = await Promise.all([
    // All existing mappings, with optional product name
    db
      .select({
        id: productNameMappings.id,
        marketplaceId: productNameMappings.marketplaceId,
        marketplaceName: productNameMappings.marketplaceName,
        displayName: productNameMappings.displayName,
        productId: productNameMappings.productId,
        productName: products.name,
        variantId: productNameMappings.variantId,
        quantity: productNameMappings.quantity,
        updatedAt: productNameMappings.updatedAt,
      })
      .from(productNameMappings)
      .leftJoin(products, eq(productNameMappings.productId, products.id))
      .where(eq(productNameMappings.userId, user.id))
      .orderBy(desc(productNameMappings.updatedAt)),

    // Distinct product names from recent orders without a mapping
    db
      .select({
        marketplaceId: orders.marketplaceId,
        productName: orderItems.productName,
        orderCount: sql<number>`cast(count(${orderItems.id}) as int)`.as('order_count'),
        lastOrderedAt: sql<string>`max(${orders.orderedAt})`.as('last_ordered_at'),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.userId, user.id),
          gte(orders.orderedAt, subDays(new Date(), 90)),
          notExists(
            db
              .select({ one: sql`1` })
              .from(productNameMappings)
              .where(
                and(
                  eq(productNameMappings.userId, user.id),
                  eq(productNameMappings.marketplaceId, orders.marketplaceId),
                  eq(productNameMappings.marketplaceName, orderItems.productName),
                ),
              ),
          ),
        ),
      )
      .groupBy(orders.marketplaceId, orderItems.productName)
      .orderBy(desc(sql`order_count`))
      .limit(200),

    // All user's products — used to compute suggestions
    db
      .select({
        id: products.id,
        name: products.name,
        internalSku: products.internalSku,
      })
      .from(products)
      .where(eq(products.userId, user.id)),
  ])

  // Pre-compute product token sets once
  const productTokens = allProducts.map((p) => ({
    productId: p.id,
    name: p.name,
    sku: p.internalSku,
    tokens: tokenize(p.name),
  }))

  // For each unmapped name, compute top-3 suggestions
  const unmapped = unmappedRaw.map((u) => {
    const queryTokens = tokenize(u.productName)
    const scored: Suggestion[] = []
    for (const p of productTokens) {
      const score = jaccard(queryTokens, p.tokens)
      if (score > 0.1) {
        scored.push({ productId: p.productId, name: p.name, sku: p.sku, score })
      }
    }
    scored.sort((a, b) => b.score - a.score)
    return { ...u, suggestions: scored.slice(0, 3) }
  })

  return NextResponse.json({ mappings, unmapped })
}

/**
 * POST /api/products/mappings
 *
 * Creates or updates a product name mapping (upsert).
 * Body: { marketplaceId, marketplaceName, displayName, productId? }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    marketplaceId: string
    marketplaceName: string
    displayName: string
    productId?: string | null
    variantId?: string | null
    quantity?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.marketplaceId || !body.marketplaceName || !body.displayName?.trim()) {
    return NextResponse.json(
      { error: 'marketplaceId, marketplaceName, displayName 필수' },
      { status: 400 },
    )
  }

  const qty = Math.max(1, Math.floor(body.quantity ?? 1))

  const [mapping] = await db
    .insert(productNameMappings)
    .values({
      userId: user.id,
      marketplaceId: body.marketplaceId,
      marketplaceName: body.marketplaceName,
      displayName: body.displayName.trim(),
      productId: body.productId ?? null,
      variantId: body.variantId ?? null,
      quantity: qty,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        productNameMappings.userId,
        productNameMappings.marketplaceId,
        productNameMappings.marketplaceName,
      ],
      set: {
        displayName: body.displayName.trim(),
        productId: body.productId ?? null,
        variantId: body.variantId ?? null,
        quantity: qty,
        updatedAt: new Date(),
      },
    })
    .returning()

  return NextResponse.json({ mapping })
}
