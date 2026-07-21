import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  MARKETPLACE_CHECK_STATUSES,
  saveMarketplaceProductCheck,
} from '@/lib/analytics/marketplace-product-checks'
import { createClient } from '@/lib/supabase/server'

const checkSchema = z.object({
  productCode: z.string().trim().min(1).max(100),
  marketplaceKey: z.string().trim().min(1).max(100),
  marketplaceName: z.string().trim().min(1).max(150),
  accountKey: z.string().trim().max(150).nullable().optional(),
  status: z.enum(MARKETPLACE_CHECK_STATUSES),
  marketplaceProductId: z.string().trim().max(300).nullable().optional(),
  marketplaceProductName: z.string().trim().max(1_000).nullable().optional(),
  sellerUrl: z.string().trim().max(2_000).nullable().optional(),
  source: z.string().trim().max(30).nullable().optional(),
  rawData: z.record(z.string(), z.unknown()).nullable().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = checkSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '상품 확인 정보가 올바르지 않습니다.' }, { status: 400 })

  const saved = await saveMarketplaceProductCheck({
    userId: await getWorkspaceUserId(user.id),
    ...body.data,
  })
  return NextResponse.json({ check: saved })
}
