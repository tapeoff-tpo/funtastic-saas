/**
 * GET  /api/products/bundles/[sku]  — 세트 구성품 목록 조회
 * PUT  /api/products/bundles/[sku]  — 세트 구성품 전체 교체 (upsert + 삭제)
 *
 * Body (PUT): Array<{ componentSku: string, quantity: number }>
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { productBundleItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sku } = await params

  const items = await db
    .select({
      componentSku: productBundleItems.componentSku,
      quantity: productBundleItems.quantity,
    })
    .from(productBundleItems)
    .where(and(eq(productBundleItems.userId, user.id), eq(productBundleItems.bundleSku, sku)))
    .orderBy(productBundleItems.createdAt)

  return NextResponse.json({ items })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sku } = await params

  let body: Array<{ componentSku: string; quantity: number }>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body)) {
    return NextResponse.json({ error: '배열 형식이어야 합니다' }, { status: 400 })
  }

  // Validate
  const items = body
    .map((r) => ({ componentSku: String(r.componentSku ?? '').trim(), quantity: Number(r.quantity) }))
    .filter((r) => r.componentSku && r.quantity > 0)

  await db.transaction(async (tx) => {
    // Delete all existing components for this bundle
    await tx
      .delete(productBundleItems)
      .where(and(eq(productBundleItems.userId, user.id), eq(productBundleItems.bundleSku, sku)))

    // Insert new components
    if (items.length > 0) {
      await tx.insert(productBundleItems).values(
        items.map((item) => ({
          userId: user.id,
          bundleSku: sku,
          componentSku: item.componentSku,
          quantity: item.quantity,
          updatedAt: new Date(),
        })),
      )
    }
  })

  return NextResponse.json({ saved: items.length })
}
