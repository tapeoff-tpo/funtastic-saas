/**
 * POST /api/products/option-mappings
 *
 * Upsert option-level mappings: (marketplaceId, marketplaceName, optionText) → variantSku
 * Body: Array<{ marketplaceId, marketplaceName, optionText, variantSku, productId? }>
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { productOptionMappings } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Array<{
    marketplaceId: string
    marketplaceName: string
    optionText: string
    variantSku: string
    productId?: string | null
    quantity?: number
  }>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json({ error: '빈 배열' }, { status: 400 })
  }

  await db
    .insert(productOptionMappings)
    .values(
      body.map((item) => ({
        userId: user.id,
        marketplaceId: item.marketplaceId,
        marketplaceName: item.marketplaceName,
        optionText: item.optionText,
        variantSku: item.variantSku,
        productId: item.productId ?? null,
        quantity: Math.max(1, Math.floor(item.quantity ?? 1)),
        updatedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [
        productOptionMappings.userId,
        productOptionMappings.marketplaceId,
        productOptionMappings.marketplaceName,
        productOptionMappings.optionText,
      ],
      set: {
        variantSku: sql`excluded.variant_sku`,
        productId: sql`excluded.product_id`,
        quantity: sql`excluded.quantity`,
        updatedAt: new Date(),
      },
    })

  return NextResponse.json({ saved: body.length })
}
