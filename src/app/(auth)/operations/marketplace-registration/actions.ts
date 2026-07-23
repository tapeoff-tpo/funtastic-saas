'use server'
import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  applyMarketplaceRegistration,
  syncFuntasticB2bRegistrationProducts,
} from '@/lib/operations/marketplace-registration'

export async function applyRegistrationAction(formData: FormData) {
  const user = await getCurrentUser(); if (!user) return
  await applyMarketplaceRegistration({ userId: await getWorkspaceUserId(user.id), productCode: String(formData.get('productCode') ?? ''), commonCategory: String(formData.get('commonCategory') ?? '').trim() || null, brand: String(formData.get('brand') ?? '').trim() || null, manufacturer: String(formData.get('manufacturer') ?? '').trim() || null, countryOfOrigin: String(formData.get('countryOfOrigin') ?? '').trim() || null, sourceProductUrl: String(formData.get('sourceProductUrl') ?? '').trim() || null, primaryImageUrl: String(formData.get('primaryImageUrl') ?? '').trim() || null, imageUrls: String(formData.get('detailImageUrls') ?? '').split(/\r?\n/).map((url) => url.trim()).filter(Boolean) })
  revalidatePath('/operations/marketplace-registration')
}

export async function syncFuntasticB2bAction() {
  const user = await getCurrentUser()
  if (!user) return { error: '로그인이 필요합니다.' }
  try {
    const result = await syncFuntasticB2bRegistrationProducts(await getWorkspaceUserId(user.id))
    revalidatePath('/operations/marketplace-registration')
    return result
  } catch (error) {
    console.error('Funtastic B2B registration sync failed:', error)
    return { error: error instanceof Error ? error.message : 'B2B 상품을 가져오지 못했습니다.' }
  }
}
