'use server'
import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { applyMarketplaceRegistration } from '@/lib/operations/marketplace-registration'

export async function applyRegistrationAction(formData: FormData) {
  const user = await getCurrentUser(); if (!user) return
  await applyMarketplaceRegistration({ userId: await getWorkspaceUserId(user.id), productCode: String(formData.get('productCode') ?? ''), productName: '', stock: 0, commonCategory: String(formData.get('commonCategory') ?? '').trim() || null, brand: String(formData.get('brand') ?? '').trim() || null, manufacturer: String(formData.get('manufacturer') ?? '').trim() || null, countryOfOrigin: String(formData.get('countryOfOrigin') ?? '').trim() || null })
  revalidatePath('/operations/marketplace-registration')
}
