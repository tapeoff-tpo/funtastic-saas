'use server'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'

interface ActionResult {
  success?: boolean
  error?: string
}

export async function addManualChannel(
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: '인증이 필요합니다.' }
  }

  const rawName = formData.get('displayName') as string
  if (!rawName || rawName.trim() === '') {
    return { error: '쇼핑몰 이름을 입력해주세요.' }
  }

  const displayName = rawName.trim()
  if (displayName.length > 100) {
    return { error: '쇼핑몰 이름은 100자 이내로 입력해주세요.' }
  }

  const marketplaceId = `manual-${nanoid(6)}`

  try {
    await db.insert(marketplaceConnections).values({
      userId: user.id,
      marketplaceId,
      storeAlias: 'default',
      displayName,
      authType: 'api_key',
      status: 'connected',
      isManual: true,
      vaultSecretNames: [],
    })
  } catch (err) {
    return {
      error: `채널 추가 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  revalidatePath('/orders/collect')
  return { success: true }
}
