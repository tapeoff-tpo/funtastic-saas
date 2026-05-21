'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { runAutoCombineByContact } from '@/lib/shipping/auto-combine'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

/**
 * Server action: detect combined shipping candidates from unshipped orders.
 * Creates shipment groups for orders that can be merged.
 */
export async function detectCombinedShippingAction(): Promise<{ created: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { created: 0 }
  const userId = await getWorkspaceUserId(user.id)

  // Fetch orders eligible for combined shipping (new/confirmed/preparing)
  const orderRows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        inArray(orders.status, ['new', 'confirmed', 'preparing']),
      ),
    )

  const result = await runAutoCombineByContact(userId, orderRows.map((row) => row.id))

  revalidatePath('/shipping/combined')
  return { created: result.created }
}
