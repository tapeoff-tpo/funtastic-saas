'use server'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { companySettings } from '@/lib/db/schema'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { eq } from 'drizzle-orm'

export async function getCompanySettings(userId: string) {
  const rows = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.userId, userId))
    .limit(1)
  return rows[0] ?? null
}

export async function saveCompanySettings(
  _prevState: { success?: boolean; error?: string } | null,
  formData: FormData,
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const companyName = (formData.get('companyName') as string) ?? ''
  const phone = (formData.get('phone') as string) ?? ''
  const address = (formData.get('address') as string) ?? ''
  const zipCode = (formData.get('zipCode') as string) ?? ''

  try {
    await db
      .insert(companySettings)
      .values({
        userId: workspaceUserId,
        companyName,
        phone,
        address,
        zipCode,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: companySettings.userId,
        set: {
          companyName,
          phone,
          address,
          zipCode,
          updatedAt: new Date(),
        },
      })

    return { success: true }
  } catch (err) {
    console.error('Failed to save company settings:', err)
    return { error: '저장에 실패했습니다.' }
  }
}
