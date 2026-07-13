'use server'
import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createDealEvent, updateDealStatus } from '@/lib/operations/deal-calendar'
import { createClient } from '@/lib/supabase/server'

async function workspaceId() { const s = await createClient(); const { data: { user } } = await s.auth.getUser(); return user ? getWorkspaceUserId(user.id) : null }
export async function updateDealStatusAction(formData: FormData) { const userId = await workspaceId(); if (!userId) return; await updateDealStatus(userId, String(formData.get('id')), String(formData.get('status'))); revalidatePath('/operations/deal-calendar') }
export async function createDealEventAction(formData: FormData) { const userId = await workspaceId(); if (!userId) return; await createDealEvent({ userId, dealType: String(formData.get('dealType')), title: String(formData.get('title')), productCode: String(formData.get('productCode')) || null, dealPrice: Number(formData.get('dealPrice')), startsOn: String(formData.get('startsOn')), endsOn: String(formData.get('endsOn')), status: 'draft', dailyCapacity: 500, stock: 500 }); revalidatePath('/operations/deal-calendar') }
