/**
 * Mapping codes API — 매핑코드 목록/생성.
 *
 * GET: 사용자의 모든 매핑코드 + sources/components 카운트.
 * POST: 매핑코드 + sources + components 일괄 생성 (트랜잭션).
 */
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { mappingCodes, mappingSources, mappingComponents } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { isBlockedMappingSourcePair } from '@/lib/orders/mapping-match'

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

function normalizeMappingCode(rawCode: string): string {
  const sanitized = rawCode.trim().replace(/[^a-zA-Z0-9_-]/g, '-')
  if (sanitized.length <= 40) return sanitized
  const hash = createHash('sha1').update(sanitized).digest('hex').slice(0, 8)
  return `${sanitized.slice(0, 31)}-${hash}`
}

function isBlockedSource(source: SourceInput): boolean {
  return isBlockedMappingSourcePair(
    source.marketplaceId,
    source.marketplaceProductId,
    source.marketplaceOptionId,
  )
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

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
      sources: sql<Array<{
        marketplaceId: string
        marketplaceName: string | null
        marketplaceProductId: string
        marketplaceOptionId: string
        productNameSnapshot: string | null
        optionNameSnapshot: string | null
      }>>`COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'marketplaceId', ${mappingSources.marketplaceId},
          'marketplaceName', COALESCE((
            SELECT mcx.display_name
            FROM marketplace_connections mcx
            WHERE mcx.user_id = ${mappingSources.userId}
              AND mcx.marketplace_id = ${mappingSources.marketplaceId}
            ORDER BY mcx.updated_at DESC
            LIMIT 1
          ), ${mappingSources.marketplaceId}),
          'marketplaceProductId', ${mappingSources.marketplaceProductId},
          'marketplaceOptionId', ${mappingSources.marketplaceOptionId},
          'productNameSnapshot', ${mappingSources.productNameSnapshot},
          'optionNameSnapshot', ${mappingSources.optionNameSnapshot}
        ) ORDER BY ${mappingSources.marketplaceId}, ${mappingSources.marketplaceProductId}, ${mappingSources.marketplaceOptionId})
        FROM ${mappingSources}
        WHERE ${mappingSources.mappingCodeId} = ${mappingCodes.id}
      ), '[]'::jsonb)`,
      components: sql<Array<{
        sku: string
        quantity: number
        productName: string | null
        optionName: string | null
      }>>`COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'sku', ${mappingComponents.sku},
          'quantity', ${mappingComponents.quantity},
          'productName', (
            SELECT MAX(i.product_name)
            FROM inventory i
            WHERE i.user_id = mapping_components.user_id
              AND i.sku = mapping_components.sku
          ),
          'optionName', (
            SELECT MAX(i.option_name)
            FROM inventory i
            WHERE i.user_id = mapping_components.user_id
              AND i.sku = mapping_components.sku
          )
        ) ORDER BY ${mappingComponents.sku})
        FROM ${mappingComponents}
        WHERE ${mappingComponents.mappingCodeId} = ${mappingCodes.id}
      ), '[]'::jsonb)`,
    })
    .from(mappingCodes)
    .where(eq(mappingCodes.userId, workspaceUserId))
    .orderBy(sql`${mappingCodes.updatedAt} DESC`)

  return NextResponse.json({ codes: rows })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: CreateBody
  try {
    body = await req.json() as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const code = body.code ? normalizeMappingCode(body.code) : ''
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

  if (body.sources.some(isBlockedSource)) {
    return NextResponse.json({ error: '주문번호/주문행번호는 상품 매핑키로 저장할 수 없습니다. 실제 상품코드 또는 자체코드로 매핑해 주세요.' }, { status: 400 })
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(mappingCodes)
        .values({
          userId: workspaceUserId,
          code,
          name,
          note: body.note?.trim() || null,
          isActive: body.isActive ?? true,
        })
        .returning()

      if (body.sources.length > 0) {
        await tx.insert(mappingSources).values(
          body.sources.map((s) => ({
            userId: workspaceUserId,
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
          userId: workspaceUserId,
          mappingCodeId: created.id,
          sku: c.sku,
          quantity: c.quantity,
        })),
      )

      return created
    })

    revalidateTag('product-mappings', 'max')
    revalidateTag('orders', 'max')
    revalidatePath('/orders')
    revalidatePath('/products/mapping-codes')
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
