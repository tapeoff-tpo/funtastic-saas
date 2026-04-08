'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { setStock, adjustStock } from '@/lib/inventory/actions'
import { getInventoryHistory } from '@/lib/inventory/queries'
import type { AdjustmentReason } from '@/lib/inventory/types'

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
    return { success: false, error: 'SKU를 입력해주세요.' }
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

  const result = await setStock(user.id, sku.trim(), productName.trim(), totalStock, {
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
  const deltaStr = formData.get('delta') as string | null
  const reason = formData.get('reason') as AdjustmentReason | null
  const note = (formData.get('note') as string | null)?.trim() || undefined

  if (!sku?.trim()) {
    return { success: false, error: 'SKU를 입력해주세요.' }
  }
  if (!deltaStr || isNaN(Number(deltaStr)) || Number(deltaStr) === 0) {
    return { success: false, error: '변동 수량을 올바르게 입력해주세요.' }
  }
  if (!reason) {
    return { success: false, error: '사유를 선택해주세요.' }
  }

  const delta = Number(deltaStr)
  const result = await adjustStock(user.id, sku.trim(), delta, reason, { note })
  revalidatePath('/inventory')
  return result
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
