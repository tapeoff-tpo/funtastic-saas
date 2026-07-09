'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  addAiAccountMessage,
  addAiAccountUserCandidate,
  createAiAccount,
  deleteAiAccount,
  deleteAiAccountUserCandidate,
  deleteAiAccountUserCandidates,
  updateAiAccount,
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
    secondaryEmail: String(formData.get('secondaryEmail') ?? ''),
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
    authorNames: formData.getAll('authorNames').map((value) => String(value)),
    messageType: String(formData.get('messageType') ?? ''),
    message: String(formData.get('message') ?? ''),
  })
  revalidatePath('/operations/ai-accounts')
}

export async function updateAiAccountLimitsAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  const fiveHourHour = String(formData.get('fiveHourHour') ?? '').trim()
  const fiveHourMinute = String(formData.get('fiveHourMinute') ?? '').trim()
  const weeklyRemainingPercent = String(formData.get('weeklyRemainingPercent') ?? '').trim()
  const weeklyLimitDate = String(formData.get('weeklyLimitDate') ?? '').trim()
  const fiveHourLimit = fiveHourHour || fiveHourMinute
    ? `${fiveHourHour.padStart(2, '0')}:${fiveHourMinute.padStart(2, '0')}`
    : String(formData.get('fiveHourLimit') ?? '')
  const weeklyLimit = weeklyRemainingPercent || weeklyLimitDate
    ? `잔여 ${weeklyRemainingPercent || '-'}% / ${weeklyLimitDate || '-'}`
    : String(formData.get('weeklyLimit') ?? '')

  await updateAiAccountLimits({
    userId,
    accountId: String(formData.get('accountId') ?? ''),
    fiveHourLimit,
    fiveHourLimitPeriod: String(formData.get('fiveHourLimitPeriod') ?? ''),
    weeklyLimit,
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

export async function deleteAiAccountUserCandidatesAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  await deleteAiAccountUserCandidates({
    userId,
    ids: formData.getAll('ids').map((value) => String(value)),
  })
  revalidatePath('/operations/ai-accounts')
}

export async function updateAiAccountAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  await updateAiAccount({
    userId,
    accountId: String(formData.get('accountId') ?? ''),
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    secondaryEmail: String(formData.get('secondaryEmail') ?? ''),
  })
  revalidatePath('/operations/ai-accounts')
}

export async function deleteAiAccountAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  await deleteAiAccount({
    userId,
    accountId: String(formData.get('accountId') ?? ''),
  })
  revalidatePath('/operations/ai-accounts')
}
