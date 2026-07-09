'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  addAiAccountMessage,
  addAiAccountUserCandidate,
  createAiAccount,
  deleteAiAccountUserCandidate,
  updateAiAccountLimits,
} from '@/lib/operations/ai-accounts'
import { createClient } from '@/lib/supabase/server'

export async function createAiAccountAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const result = await createAiAccount({
    userId: await getWorkspaceUserId(user.id),
    name,
    email,
  })

  if ('error' in result) return { error: result.error }
  revalidatePath('/operations/ai-accounts')
  return { success: true }
}

async function getWorkspaceIdForAction() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return getWorkspaceUserId(user.id)
}

export async function addAiAccountMessageAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  await addAiAccountMessage({
    userId,
    accountId: String(formData.get('accountId') ?? ''),
    authorName: String(formData.get('authorName') ?? ''),
    message: String(formData.get('message') ?? ''),
  })
  revalidatePath('/operations/ai-accounts')
}

export async function updateAiAccountLimitsAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  await updateAiAccountLimits({
    userId,
    accountId: String(formData.get('accountId') ?? ''),
    fiveHourLimit: String(formData.get('fiveHourLimit') ?? ''),
    fiveHourLimitPeriod: String(formData.get('fiveHourLimitPeriod') ?? ''),
    weeklyLimit: String(formData.get('weeklyLimit') ?? ''),
  })
  revalidatePath('/operations/ai-accounts')
}

export async function addAiAccountUserCandidateAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  await addAiAccountUserCandidate({
    userId,
    name: String(formData.get('name') ?? ''),
  })
  revalidatePath('/operations/ai-accounts')
}

export async function deleteAiAccountUserCandidateAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  await deleteAiAccountUserCandidate({
    userId,
    id: String(formData.get('id') ?? ''),
  })
  revalidatePath('/operations/ai-accounts')
}
