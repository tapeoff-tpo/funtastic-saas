'use server'

import { nanoid } from 'nanoid'
import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  listMarketplaceBusinessSettings,
  saveMarketplaceBusinessSetting,
} from '@/lib/marketplace/business-settings'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import '@/lib/marketplace/adapters/configs'

interface ActionResult {
  success?: boolean
  error?: string
  message?: string
}

export async function createCustomMarketplace(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: '인증이 필요합니다.' }

  const marketplaceName = String(formData.get('marketplace_name') ?? '').trim()
  if (!marketplaceName) return { error: '추가할 마켓명을 입력해주세요.' }
  if (marketplaceName.length > 100) return { error: '마켓명은 100자 이내로 입력해주세요.' }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const normalizedName = normalizeName(marketplaceName)
  const [settings, configs] = await Promise.all([
    listMarketplaceBusinessSettings(workspaceUserId),
    Promise.resolve(marketplaceRegistry.listConfigs()),
  ])
  const duplicate = [
    ...settings.map((setting) => setting.systemMarketplaceName),
    ...configs.map((config) => config.name),
  ].some((name) => normalizeName(name) === normalizedName)
  if (duplicate) return { error: '이미 등록된 마켓명입니다.' }

  await saveMarketplaceBusinessSetting({
    userId: workspaceUserId,
    marketplaceId: `custom-${nanoid(10)}`,
    systemMarketplaceName: marketplaceName,
    salesExportMarketplaceId: '',
    salesFeePercent: null,
  })

  revalidatePath('/settings/market-settings')
  revalidatePath('/orders')
  revalidatePath('/analytics')
  updateTag('analytics')
  return { success: true, message: `${marketplaceName} 마켓을 추가했습니다.` }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}
