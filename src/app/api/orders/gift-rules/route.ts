import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createGiftRule, listGiftRules, type GiftConditionType } from '@/lib/orders/gift-rules'

interface CreateGiftRuleBody {
  name?: string
  marketplaceId?: string | null
  conditionType?: GiftConditionType
  minAmount?: string | null
  triggerSku?: string | null
  giftSku?: string
  giftQuantity?: number
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rules = await listGiftRules(user.id)
  return NextResponse.json({ rules })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: CreateGiftRuleBody
  try {
    body = await req.json() as CreateGiftRuleBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const name = body.name?.trim()
  const conditionType = body.conditionType
  const giftSku = body.giftSku?.trim()
  const giftQuantity = Math.max(1, Number(body.giftQuantity ?? 1))

  if (!name) return NextResponse.json({ error: '규칙명을 입력하세요.' }, { status: 400 })
  if (conditionType !== 'amount' && conditionType !== 'sku') {
    return NextResponse.json({ error: '조건 종류를 선택하세요.' }, { status: 400 })
  }
  if (conditionType === 'amount' && Number(body.minAmount ?? 0) <= 0) {
    return NextResponse.json({ error: '금액 조건을 입력하세요.' }, { status: 400 })
  }
  if (conditionType === 'sku' && !body.triggerSku?.trim()) {
    return NextResponse.json({ error: '품번코드 조건을 입력하세요.' }, { status: 400 })
  }
  if (!giftSku) return NextResponse.json({ error: '사은품 SKU를 선택하세요.' }, { status: 400 })

  const created = await createGiftRule(user.id, {
    name,
    marketplaceId: body.marketplaceId?.trim() || null,
    conditionType,
    minAmount: body.minAmount ?? null,
    triggerSku: body.triggerSku?.trim() || null,
    giftSku,
    giftQuantity,
  })

  return NextResponse.json({ id: created.id })
}
