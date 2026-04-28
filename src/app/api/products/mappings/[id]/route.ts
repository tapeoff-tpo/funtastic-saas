import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { productNameMappings } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { applyMappingsForUser } from '@/lib/orders/apply-mappings'

/**
 * DELETE /api/products/mappings/[id]
 * Deletes a mapping by ID (user-scoped).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  await db
    .delete(productNameMappings)
    .where(
      and(
        eq(productNameMappings.id, id),
        eq(productNameMappings.userId, user.id),
      ),
    )

  return NextResponse.json({ success: true })
}

/**
 * PUT /api/products/mappings/[id]
 * Updates displayName (and optionally productId) of an existing mapping.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  let body: { displayName: string; productId?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.displayName?.trim()) {
    return NextResponse.json({ error: 'displayName 필수' }, { status: 400 })
  }

  const [updated] = await db
    .update(productNameMappings)
    .set({
      displayName: body.displayName.trim(),
      productId: body.productId ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(productNameMappings.id, id),
        eq(productNameMappings.userId, user.id),
      ),
    )
    .returning()

  if (!updated) {
    return NextResponse.json({ error: '매핑을 찾을 수 없습니다' }, { status: 404 })
  }

  // 매핑 수정 직후 — 기존 주문에 대해 SKU 갈아끼우기 (벤더 SKU → 내부 재고코드).
  // 실패해도 매핑 저장 자체는 성공으로 처리.
  let applied: Awaited<ReturnType<typeof applyMappingsForUser>> | null = null
  try {
    applied = await applyMappingsForUser(user.id)
  } catch (err) {
    console.error('[products/mappings PUT] applyMappingsForUser failed:', err)
  }

  return NextResponse.json({ mapping: updated, applied })
}
