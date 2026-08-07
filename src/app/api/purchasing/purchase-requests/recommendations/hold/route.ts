import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { purchaseRequestItems } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  held: z.boolean(),
})

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '보류할 발주검토 항목이 올바르지 않습니다.' }, { status: 400 })

  const userId = await getWorkspaceUserId(user.id)
  const rows = await db
    .select({ id: purchaseRequestItems.id, rawData: purchaseRequestItems.rawData })
    .from(purchaseRequestItems)
    .where(and(
      eq(purchaseRequestItems.userId, userId),
      eq(purchaseRequestItems.status, 'requested'),
      inArray(purchaseRequestItems.id, body.data.ids),
    ))

  const updatedIds: string[] = []
  for (const row of rows) {
    if (row.rawData?.source !== 'auto_purchase_recommendation') continue
    await db
      .update(purchaseRequestItems)
      .set({
        rawData: {
          ...row.rawData,
          manualHold: body.data.held,
          manualHoldAt: body.data.held ? new Date().toISOString() : null,
        },
        updatedAt: new Date(),
      })
      .where(and(eq(purchaseRequestItems.userId, userId), eq(purchaseRequestItems.id, row.id)))
    updatedIds.push(row.id)
  }

  return NextResponse.json({ updatedCount: updatedIds.length, updatedIds })
}
