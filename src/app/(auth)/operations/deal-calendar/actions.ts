'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createDealEvent, updateDealChecklist, updateDealPerformance, updateDealStatus } from '@/lib/operations/deal-calendar'
import { createClient } from '@/lib/supabase/server'

async function workspaceId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? getWorkspaceUserId(user.id) : null
}

export async function updateDealStatusAction(formData: FormData) {
  const userId = await workspaceId()
  if (!userId) return
  await updateDealStatus(userId, String(formData.get('id')), String(formData.get('status')))
  revalidatePath('/operations/deal-calendar')
}

export async function updateDealChecklistAction(formData: FormData) {
  const userId = await workspaceId()
  if (!userId) return
  await updateDealChecklist(
    userId,
    String(formData.get('id')),
    String(formData.get('taskKey')),
    String(formData.get('completed')) === 'true',
  )
  revalidatePath('/operations/deal-calendar')
}

export async function updateDealPerformanceAction(formData: FormData) {
  const userId = await workspaceId()
  if (!userId) return
  await updateDealPerformance(
    userId,
    String(formData.get('id')),
    Number(formData.get('soldQuantity')),
    Number(formData.get('salesAmount')),
  )
  revalidatePath('/operations/deal-calendar')
}

export async function createDealEventAction(formData: FormData) {
  const userId = await workspaceId()
  if (!userId) return
  await createDealEvent({
    userId,
    platform: String(formData.get('platform') || 'kakao'),
    dealType: String(formData.get('dealType')),
    title: String(formData.get('title')),
    productCode: String(formData.get('productCode')) || null,
    options: String(formData.get('options')) || null,
    dealPrice: Number(formData.get('dealPrice')) || 0,
    campaignName: String(formData.get('campaignName')) || null,
    dailyBudget: Number(formData.get('dailyBudget')) || null,
    searchBid: Number(formData.get('searchBid')) || null,
    recommendationBid: Number(formData.get('recommendationBid')) || null,
    startsOn: String(formData.get('startsOn')),
    endsOn: String(formData.get('endsOn')),
    status: 'draft',
    dailyCapacity: 500,
    stock: 500,
  })
  revalidatePath('/operations/deal-calendar')
}
