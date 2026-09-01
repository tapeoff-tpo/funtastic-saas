'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  addAiAccountMessage,
  bulkResetAiAccountRuntimeState,
  addAiAccountUserCandidate,
  bulkUpdateAiAccountOperationalState,
  bulkUpdateAiAccountRenewal,
  createAiAccount,
  deleteAiAccount,
  deleteAiAccountUserCandidate,
  deleteAiAccountUserCandidates,
  readAiAccountPassword,
  readAiAccountLoginInfo,
  resetAiAccountRuntimeState,
  updateAiAccount,
  updateAiAccountAvailability,
  updateAiAccountLimits,
  updateAiAccountLoginInfo,
  updateAiAccountOperationalState,
} from '@/lib/operations/ai-accounts'
import { createClient } from '@/lib/supabase/server'
import { parseWeeklyResetCode } from '@/lib/operations/ai-account-reset-code'

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
    loginMethod: String(formData.get('loginMethod') ?? ''),
    loginId: String(formData.get('loginId') ?? ''),
    loginPassword: String(formData.get('loginPassword') ?? ''),
    secondaryEmail: String(formData.get('secondaryEmail') ?? ''),
    password: String(formData.get('password') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    renewalDueOn: String(formData.get('renewalDueOn') ?? ''),
    resetAvailableCount: Number(formData.get('resetAvailableCount') ?? 0),
    sharedUse: formData.get('sharedUse') === 'on',
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
    authorNames: [],
    messageType: '직접입력',
    message: String(formData.get('message') ?? ''),
  })
  revalidatePath('/operations/ai-accounts')
}

export async function updateAiAccountOperationalStateAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }

  const result = await updateAiAccountOperationalState({
    userId,
    accountId: String(formData.get('accountId') ?? ''),
    status: String(formData.get('status') ?? ''),
    currentUserName: String(formData.get('currentUserName') ?? ''),
    renewalDueOn: String(formData.get('renewalDueOn') ?? ''),
    changedField: String(formData.get('changedField') ?? ''),
  })
  if (!('error' in result)) revalidatePath('/operations/ai-accounts')
  return result
}

export async function updateAiAccountAvailabilityAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return

  await updateAiAccountAvailability({
    userId,
    accountId: String(formData.get('accountId') ?? ''),
    resetAvailableCount: Number(formData.get('resetAvailableCount') ?? 0),
    sharedUse: String(formData.get('sharedUse') ?? '') === 'true',
    changedField: String(formData.get('changedField') ?? '') as 'resetAvailableCount' | 'sharedUse',
  })
  revalidatePath('/operations/ai-accounts')
}

export async function bulkUpdateAiAccountRenewalAction(input: {
  accountIds: string[]
  renewalDueOn: string
}) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }

  const result = await bulkUpdateAiAccountRenewal({ userId, ...input })
  if (!('error' in result)) revalidatePath('/operations/ai-accounts')
  return result
}

export async function bulkUpdateAiAccountOperationalStateAction(input: {
  status: string
  currentUserName?: string | null
  changedField: 'status' | 'currentUserName'
}) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }

  const result = await bulkUpdateAiAccountOperationalState({ userId, ...input })
  if (!('error' in result)) revalidatePath('/operations/ai-accounts')
  return result
}

export async function updateAiAccountLimitsAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }

  const normalizeTime = (value: string) => {
    const trimmed = value.trim()
    const digits = trimmed.replace(/\D/g, '')
    if (digits.length === 3) return `0${digits.slice(0, 1)}:${digits.slice(1)}`
    if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`
    return trimmed
  }
  const dailyResetTime = normalizeTime(String(formData.get('dailyResetTime') ?? ''))
  const weeklyResetValue = String(formData.get('weeklyResetTime') ?? '').trim()
  const weeklyReset = parseWeeklyResetCode(weeklyResetValue)
  if (weeklyReset.error) return { error: weeklyReset.error }

  const result = await updateAiAccountLimits({
    userId,
    accountId: String(formData.get('accountId') ?? ''),
    dailyRemainingPercent: String(formData.get('dailyRemainingPercent') ?? '').trim(),
    dailyResetTime,
    weeklyRemainingPercent: '',
    weeklyResetCode: weeklyReset.code,
    weeklyResetAt: weeklyReset.resetAt,
  })
  if (!('error' in result)) revalidatePath('/operations/ai-accounts')
  return result
}

export async function resetAiAccountRuntimeStateAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }
  const result = await resetAiAccountRuntimeState({
    userId,
    accountId: String(formData.get('accountId') ?? ''),
  })
  if (!('error' in result)) revalidatePath('/operations/ai-accounts')
  return result
}

export async function bulkResetAiAccountRuntimeStateAction() {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }
  const result = await bulkResetAiAccountRuntimeState({ userId })
  if (!('error' in result)) revalidatePath('/operations/ai-accounts')
  return result
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
    password: String(formData.get('password') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    renewalDueOn: String(formData.get('renewalDueOn') ?? ''),
    resetAvailableCount: Number(formData.get('resetAvailableCount') ?? 0),
    sharedUse: formData.get('sharedUse') === 'on',
  })
  revalidatePath('/operations/ai-accounts')
}

export async function readAiAccountPasswordAction(accountId: string) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }
  return readAiAccountPassword({ userId, accountId })
}

export async function readAiAccountLoginInfoAction(accountId: string) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }
  return readAiAccountLoginInfo({ userId, accountId })
}

export async function updateAiAccountLoginInfoAction(formData: FormData) {
  const userId = await getWorkspaceIdForAction()
  if (!userId) return { error: '로그인이 필요합니다.' }
  const result = await updateAiAccountLoginInfo({
    userId,
    accountId: String(formData.get('accountId') ?? ''),
    loginMethod: String(formData.get('loginMethod') ?? ''),
    loginId: String(formData.get('loginId') ?? ''),
    loginPassword: String(formData.get('loginPassword') ?? ''),
    gptId: String(formData.get('gptId') ?? ''),
    gptPassword: String(formData.get('gptPassword') ?? ''),
  })
  if (!('error' in result)) revalidatePath('/operations/ai-accounts')
  return result
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
