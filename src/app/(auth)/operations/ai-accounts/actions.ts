'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createAiAccount } from '@/lib/operations/ai-accounts'
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
