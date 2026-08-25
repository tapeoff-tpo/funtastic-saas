'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  createManualSourcingItem,
  passManualSourcingToNewProduct,
  updateManualSourcingItem,
} from '@/lib/operations/sourcing'
import { createClient } from '@/lib/supabase/server'

type ManualSourcingValues = {
  productName: string
  productOption?: string
  chinaPurchaseUrl?: string
  chinaUnitPriceCny?: string
  unitShippingCny?: string
  exchangeRateKrw?: string
  domesticSaleUrl?: string
  domesticSalePrice?: string
  detailPageUrl?: string
  memo1?: string
  memo2?: string
  ownerOperatorId?: string | null
}

async function actionUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('로그인이 필요합니다.')
  return { userId: user.id, workspaceUserId: await getWorkspaceUserId(user.id) }
}

export async function createManualSourcingAction(values: ManualSourcingValues) {
  try {
    const auth = await actionUser()
    const result = await createManualSourcingItem({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      ...manualValues(values),
    })
    if ('error' in result) return { success: false as const, error: result.error }
    revalidatePath('/operations/sourcing')
    return { success: true as const, id: result.id }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

export async function updateManualSourcingAction(input: { itemId: string; values: ManualSourcingValues }) {
  try {
    const auth = await actionUser()
    const result = await updateManualSourcingItem({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      itemId: input.itemId,
      ...manualValues(input.values),
    })
    if ('error' in result) return { success: false as const, error: result.error }
    revalidatePath('/operations/sourcing')
    return result
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

export async function passManualSourcingAction(itemId: string) {
  try {
    const auth = await actionUser()
    const result = await passManualSourcingToNewProduct({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      itemId,
    })
    revalidatePath('/operations/sourcing')
    revalidatePath('/new-products')
    return { success: true as const, ...result }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

function manualValues(values: ManualSourcingValues) {
  return {
    productName: text(values.productName),
    productOption: nullableText(values.productOption),
    chinaPurchaseUrl: nullableText(values.chinaPurchaseUrl),
    chinaUnitPriceCny: nullableNumber(values.chinaUnitPriceCny),
    unitShippingCny: nullableNumber(values.unitShippingCny),
    exchangeRateKrw: nullableNumber(values.exchangeRateKrw),
    domesticSaleUrl: nullableText(values.domesticSaleUrl),
    domesticSalePrice: nullableInteger(values.domesticSalePrice),
    detailPageUrl: nullableText(values.detailPageUrl),
    memo1: nullableText(values.memo1),
    memo2: nullableText(values.memo2),
    ownerOperatorId: nullableText(values.ownerOperatorId, 100),
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function nullableText(value: unknown, maxLength = 20_000) {
  const normalized = text(value).trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function nullableNumber(value: unknown) {
  const normalized = text(value).replace(/,/g, '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function nullableInteger(value: unknown) {
  const parsed = nullableNumber(value)
  return parsed == null ? null : Math.round(parsed)
}

function message(error: unknown) {
  return error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.'
}
