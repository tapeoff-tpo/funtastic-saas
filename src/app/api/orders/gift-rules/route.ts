import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createGiftRule, listGiftRules, type GiftConditionType, type GiftRuleCondition } from '@/lib/orders/gift-rules'

interface CreateGiftRuleBody {
  name?: string
  marketplaceId?: string | null
  conditionType?: GiftConditionType
  minAmount?: string | null
  triggerSku?: string | null
  conditions?: GiftRuleCondition[]
  giftSku?: string
  giftQuantity?: number
}

function normalizeConditions(body: CreateGiftRuleBody): GiftRuleCondition[] {
  const raw = Array.isArray(body.conditions) ? body.conditions : []
  return raw
    .map((condition) => ({
      type: condition.type,
      value: String(condition.value ?? '').trim(),
    }))
    .filter((condition): condition is GiftRuleCondition => (
      (condition.type === 'amount' || condition.type === 'sku' || condition.type === 'marketplaceProductCode') &&
      condition.value.length > 0
    ))
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
  const conditions = normalizeConditions(body)
  const conditionType = body.conditionType ?? conditions[0]?.type
  const giftSku = body.giftSku?.trim()
  const giftQuantity = Math.max(1, Number(body.giftQuantity ?? 1))

  if (!name) return NextResponse.json({ error: '규칙명을 입력하세요.' }, { status: 400 })
  if (conditions.length === 0) {
    return NextResponse.json({ error: '조건을 1개 이상 입력하세요.' }, { status: 400 })
  }
  if (conditions.some((condition) => condition.type === 'amount' && Number(condition.value) <= 0)) {
    return NextResponse.json({ error: '금액 조건을 확인하세요.' }, { status: 400 })
  }
  if (!giftSku) return NextResponse.json({ error: '사은품 SKU를 선택하세요.' }, { status: 400 })

  const created = await createGiftRule(user.id, {
    name,
    marketplaceId: body.marketplaceId?.trim() || null,
    conditionType,
    minAmount: conditions.find((condition) => condition.type === 'amount')?.value ?? body.minAmount ?? null,
    triggerSku: conditions.find((condition) => condition.type === 'sku')?.value ?? body.triggerSku?.trim() ?? null,
    conditions,
    giftSku,
    giftQuantity,
  })

  return NextResponse.json({ id: created.id })
}
