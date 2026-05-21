'use server'

import { revalidatePath } from 'next/cache'
import { eq, and } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { inventory, inventoryAdjustmentSlips, products } from '@/lib/db/schema'
import { setStock } from '@/lib/inventory/actions'
import { getInventoryHistory } from '@/lib/inventory/queries'
import type { AdjustmentReason } from '@/lib/inventory/types'
import { getProfile, getWorkspaceUserId } from '@/lib/admin-accounts/queries'

interface ActionResult {
  success: boolean
  error?: string
}

/**
 * Server action: set stock for a SKU (create or update).
 * Extracts sku, productName, totalStock from FormData.
 */
export async function setStockAction(
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: '인증이 필요합니다.' }
  }

  const sku = formData.get('sku') as string | null
  const productName = formData.get('productName') as string | null
  const totalStockStr = formData.get('totalStock') as string | null

  if (!sku?.trim()) {
    return { success: false, error: '상품코드를 입력해주세요.' }
  }
  if (!productName?.trim()) {
    return { success: false, error: '상품명을 입력해주세요.' }
  }
  if (!totalStockStr || isNaN(Number(totalStockStr))) {
    return { success: false, error: '수량을 올바르게 입력해주세요.' }
  }

  const totalStock = Number(totalStockStr)
  if (totalStock < 0) {
    return { success: false, error: '수량은 0 이상이어야 합니다.' }
  }

  const warehouseZone = (formData.get('warehouseZone') as string | null)?.trim() || undefined
  const sectorCode = (formData.get('sectorCode') as string | null)?.trim() || undefined

  const result = await setStock(await getWorkspaceUserId(user.id), sku.trim(), productName.trim(), totalStock, {
    warehouseZone,
    sectorCode,
  })
  revalidatePath('/inventory')
  return result
}

/**
 * Server action: adjust stock by delta with reason.
 * Extracts sku, delta, reason, note from FormData.
 */
export async function adjustStockAction(
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: '인증이 필요합니다.' }
  }

  const sku = formData.get('sku') as string | null
  const inventoryId = formData.get('inventoryId') as string | null
  const deltaStr = formData.get('delta') as string | null
  const reason = formData.get('reason') as AdjustmentReason | null
  const note = (formData.get('note') as string | null)?.trim() || undefined

  if (!inventoryId?.trim() && !sku?.trim()) {
    return { success: false, error: '상품코드를 입력해주세요.' }
  }
  if (!deltaStr || isNaN(Number(deltaStr)) || Number(deltaStr) === 0) {
    return { success: false, error: '변동 수량을 올바르게 입력해주세요.' }
  }
  if (!reason) {
    return { success: false, error: '사유를 선택해주세요.' }
  }

  const delta = Number(deltaStr)
  const [workspaceUserId, profile] = await Promise.all([
    getWorkspaceUserId(user.id),
    getProfile(user.id),
  ])
  const [record] = await db
    .select()
    .from(inventory)
    .where(
      inventoryId?.trim()
        ? and(eq(inventory.userId, workspaceUserId), eq(inventory.id, inventoryId.trim()))
        : and(eq(inventory.userId, workspaceUserId), eq(inventory.sku, sku?.trim() ?? '')),
    )
    .limit(1)

  if (!record) {
    return { success: false, error: '재고관리에서 해당 상품코드를 찾을 수 없습니다.' }
  }

  await db.insert(inventoryAdjustmentSlips).values({
    inventoryId: record.id,
    userId: workspaceUserId,
    sku: record.sku,
    productName: record.productName,
    optionName: record.optionName,
    warehouseZone: record.warehouseZone,
    sectorCode: record.sectorCode,
    adjustmentReason: reason,
    delta,
    note,
    status: 'pending',
    registeredBy: user.id,
    registeredByName: profile?.displayName ?? profile?.email ?? user.email ?? null,
  })
  revalidatePath('/inventory/adjustments')
  return { success: true }
}

/**
 * Server action: update SaaS shipping cost (원가) for a product.
 *
 * Phase 8 / SC-07 — 재고관리 화면에서 상품별 배송비(원가) 인라인 편집.
 * - userId scope (RLS) — 다른 사용자 product 수정 불가
 * - value === null → 컬럼을 NULL로 클리어
 * - value 검증: 숫자 + 음수 거부
 */
export async function updateShippingCost(
  productId: string,
  value: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  if (value !== null) {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
      return { ok: false, error: 'invalid value' }
    }
  }

  await db
    .update(products)
    .set({
      shippingCost: value === null ? null : String(value),
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, productId), eq(products.userId, await getWorkspaceUserId(user.id))))

  revalidatePath('/inventory')
  return { ok: true }
}

/**
 * Server action: fetch inventory history for a given inventory item.
 */
export async function getHistoryAction(
  inventoryId: string,
  page = 1,
) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { items: [], total: 0 }
  }

  return getInventoryHistory(inventoryId, page, 20)
}
