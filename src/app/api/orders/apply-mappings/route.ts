/**
 * POST /api/orders/apply-mappings
 *
 * Looks up productOptionMappings for every orderItem that lacks a SKU,
 * matching on (userId, marketplaceId, productName, optionText), and
 * writes the resolved variantSku back to orderItems.sku.
 *
 * Call this after saving new option mappings so the orders table
 * immediately reflects the correct SKUs.
 *
 * Body (optional): { orderIds?: string[] }  — limit to specific orders.
 * If omitted, applies to all orders for the user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orderItems, orders, productOptionMappings } from '@/lib/db/schema'
import { eq, and, isNull, inArray, sql } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { orderIds?: string[] } = {}
  try { body = await req.json() } catch { /* optional body */ }

  // Find orderItems that still have no SKU, joined to their order's marketplaceId
  const conditions = [
    eq(orders.userId, user.id),
    isNull(orderItems.sku),
  ]
  if (body.orderIds && body.orderIds.length > 0) {
    conditions.push(inArray(orders.id, body.orderIds))
  }

  const unmappedItems = await db
    .select({
      itemId: orderItems.id,
      productName: orderItems.productName,
      optionText: orderItems.optionText,
      marketplaceId: orders.marketplaceId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(...conditions))

  if (unmappedItems.length === 0) {
    return NextResponse.json({ updated: 0 })
  }

  // Load all option mappings for this user once
  const optionMaps = await db
    .select({
      marketplaceId: productOptionMappings.marketplaceId,
      marketplaceName: productOptionMappings.marketplaceName,
      optionText: productOptionMappings.optionText,
      variantSku: productOptionMappings.variantSku,
      quantity: productOptionMappings.quantity,
    })
    .from(productOptionMappings)
    .where(eq(productOptionMappings.userId, user.id))

  // Build lookup: "marketplaceId::productName::optionText" → { sku, qty }
  const lookup = new Map<string, { sku: string; qty: number }>()
  for (const m of optionMaps) {
    const val = { sku: m.variantSku, qty: m.quantity ?? 1 }
    lookup.set(`${m.marketplaceId}::${m.marketplaceName}::${m.optionText}`, val)
    // Also try empty optionText as fallback (product-level option mapping)
    if (!lookup.has(`${m.marketplaceId}::${m.marketplaceName}::`)) {
      lookup.set(`${m.marketplaceId}::${m.marketplaceName}::`, val)
    }
  }

  // Resolve SKUs and update
  let updated = 0
  const updates: Array<{ itemId: string; variantSku: string; multiplier: number }> = []

  for (const item of unmappedItems) {
    const optText = item.optionText?.trim() ?? ''
    const key = `${item.marketplaceId}::${item.productName}::${optText}`
    const hit = lookup.get(key) ?? lookup.get(`${item.marketplaceId}::${item.productName}::`)
    if (hit) {
      updates.push({ itemId: item.itemId, variantSku: hit.sku, multiplier: hit.qty })
    }
  }

  if (updates.length > 0) {
    for (const u of updates) {
      await db
        .update(orderItems)
        .set({ sku: u.variantSku, skuMultiplier: u.multiplier })
        .where(eq(orderItems.id, u.itemId))
      updated += 1
    }
  }

  return NextResponse.json({ updated, total: unmappedItems.length })
}
