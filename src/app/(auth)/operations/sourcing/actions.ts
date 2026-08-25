'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  createSourcingMeeting,
  passManualSourcingToNewProduct,
  saveSourcingMeetingRows,
  updateSourcingMeeting,
} from '@/lib/operations/sourcing'
import { createClient } from '@/lib/supabase/server'

type SourcingMeetingValues = {
  meetingDate: string
  title?: string
  status?: 'open' | 'closed' | 'archived'
}

type SourcingRowValues = {
  clientId: string
  itemId?: string | null
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

export async function createSourcingMeetingAction(values: SourcingMeetingValues) {
  try {
    const auth = await actionUser()
    const meeting = await createSourcingMeeting({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      meetingDate: text(values.meetingDate),
      title: nullableText(values.title, 300),
      status: values.status,
    })
    revalidatePath('/operations/sourcing')
    return { success: true as const, id: meeting.id }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

export async function updateSourcingMeetingAction(input: { meetingId: string; values: SourcingMeetingValues }) {
  try {
    const auth = await actionUser()
    await updateSourcingMeeting({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      meetingId: input.meetingId,
      meetingDate: text(input.values.meetingDate),
      title: nullableText(input.values.title, 300),
      status: input.values.status,
    })
    revalidatePath('/operations/sourcing')
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

export async function saveSourcingMeetingRowsAction(input: {
  meetingId: string
  rows: SourcingRowValues[]
}) {
  try {
    const auth = await actionUser()
    const result = await saveSourcingMeetingRows({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      meetingId: input.meetingId,
      rows: input.rows.slice(0, 100).map(rowValues),
    })
    revalidatePath('/operations/sourcing')
    return { success: true as const, ...result }
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

function rowValues(values: SourcingRowValues) {
  return {
    clientId: text(values.clientId).slice(0, 100),
    itemId: nullableText(values.itemId, 100),
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
