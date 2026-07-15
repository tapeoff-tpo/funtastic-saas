'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  addSourcingCandidate,
  createSourcingItem,
  selectSourcingCandidate,
  updateSourcingItemStatus,
} from '@/lib/operations/sourcing'
import { createClient } from '@/lib/supabase/server'

async function getWorkspaceIdForAction() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return getWorkspaceUserId(user.id)
}

function numberValue(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? '').replace(/,/g, '').trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export async function createSourcingItemAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }

  const result = await createSourcingItem({
    userId,
    sourceTitle: String(formData.get('sourceTitle') ?? ''),
    sourceUrl: String(formData.get('sourceUrl') ?? ''),
    imageUrl: String(formData.get('imageUrl') ?? ''),
    category: String(formData.get('category') ?? ''),
    sourceRank: numberValue(formData, 'sourceRank'),
    sourcePrice: numberValue(formData, 'sourcePrice'),
    keyword: String(formData.get('keyword') ?? ''),
    memo: String(formData.get('memo') ?? ''),
  })
  revalidatePath('/operations/sourcing')
  return result
}

export async function updateSourcingItemStatusAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  await updateSourcingItemStatus({
    userId,
    itemId: String(formData.get('itemId') ?? ''),
    status: String(formData.get('status') ?? ''),
  })
  revalidatePath('/operations/sourcing')
}

export async function addSourcingCandidateAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }

  const result = await addSourcingCandidate({
    userId,
    itemId: String(formData.get('itemId') ?? ''),
    title: String(formData.get('title') ?? ''),
    candidateUrl: String(formData.get('candidateUrl') ?? ''),
    imageUrl: String(formData.get('imageUrl') ?? ''),
    priceText: String(formData.get('priceText') ?? ''),
    supplierName: String(formData.get('supplierName') ?? ''),
    matchScore: numberValue(formData, 'matchScore'),
    memo: String(formData.get('memo') ?? ''),
  })
  revalidatePath('/operations/sourcing')
  return result
}

export async function selectSourcingCandidateAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  await selectSourcingCandidate({
    userId,
    itemId: String(formData.get('itemId') ?? ''),
    candidateId: String(formData.get('candidateId') ?? ''),
  })
  revalidatePath('/operations/sourcing')
}
