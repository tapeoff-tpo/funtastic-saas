/**
 * Mapping codes API — 매핑코드 목록/생성.
 *
 * GET: 사용자의 모든 매핑코드 + sources/components 카운트.
 * POST: 매핑코드 + sources + components 일괄 생성 (트랜잭션).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { mappingCodes, mappingSources, mappingComponents } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'

interface SourceInput {
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId?: string
  productNameSnapshot?: string | null
  optionNameSnapshot?: string | null
}

interface ComponentInput {
  sku: string
  quantity: number
}

interface CreateBody {
  code: string
  name: string
  note?: string | null
  isActive?: boolean
  sources: SourceInput[]
  components: ComponentInput[]
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rows = await db
    .select({
      id: mappingCodes.id,
      code: mappingCodes.code,
      name: mappingCodes.name,
      note: mappingCodes.note,
      isActive: mappingCodes.isActive,
      createdAt: mappingCodes.createdAt,
      updatedAt: mappingCodes.updatedAt,
      sourcesCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${mappingSources}
        WHERE ${mappingSources.mappingCodeId} = ${mappingCodes.id}
      )`,
      componentsCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${mappingComponents}
        WHERE ${mappingComponents.mappingCodeId} = ${mappingCodes.id}
      )`,
    })
    .from(mappingCodes)
    .where(eq(mappingCodes.userId, user.id))
    .orderBy(sql`${mappingCodes.updatedAt} DESC`)

  return NextResponse.json({ codes: rows })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: CreateBody
  try {
    body = await req.json() as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const code = body.code?.trim()
  const name = body.name?.trim()
  if (!code || !name) {
    return NextResponse.json({ error: 'code 와 name 은 필수입니다' }, { status: 400 })
  }
  if (!Array.isArray(body.sources) || !Array.isArray(body.components)) {
    return NextResponse.json({ error: 'sources / components 는 배열이어야 합니다' }, { status: 400 })
  }
  if (body.components.length === 0) {
    return NextResponse.json({ error: '최소 1개 이상의 SKU 구성품이 필요합니다' }, { status: 400 })
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(mappingCodes)
        .values({
          userId: user.id,
          code,
          name,
          note: body.note?.trim() || null,
          isActive: body.isActive ?? true,
        })
        .returning()

      if (body.sources.length > 0) {
        await tx.insert(mappingSources).values(
          body.sources.map((s) => ({
            userId: user.id,
            mappingCodeId: created.id,
            marketplaceId: s.marketplaceId,
            marketplaceProductId: s.marketplaceProductId,
            marketplaceOptionId: s.marketplaceOptionId ?? '',
            productNameSnapshot: s.productNameSnapshot ?? null,
            optionNameSnapshot: s.optionNameSnapshot ?? null,
          })),
        )
      }

      await tx.insert(mappingComponents).values(
        body.components.map((c) => ({
          userId: user.id,
          mappingCodeId: created.id,
          sku: c.sku,
          quantity: c.quantity,
        })),
      )

      return created
    })

    return NextResponse.json({ id: result.id, code: result.code })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    if (msg.includes('mapping_codes_user_id_code_key') || msg.includes('mapping_codes_user_code_uniq')) {
      return NextResponse.json({ error: '이미 사용 중인 매핑코드입니다' }, { status: 409 })
    }
    if (msg.includes('mapping_sources_user_id_marketplace') || msg.includes('mapping_sources_user_market_product_option_uniq')) {
      return NextResponse.json({ error: '일부 마켓상품이 이미 다른 매핑코드에 연결되어 있습니다' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
