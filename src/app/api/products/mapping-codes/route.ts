/**
 * Mapping codes API — 매핑코드 목록/생성.
 *
 * GET: 사용자의 매핑코드 + sources/components 카운트.
 * POST: 매핑코드 + sources + components 일괄 생성 (트랜잭션).
 */
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { mappingCodes, mappingSources, mappingComponents, products, productVariants, inventory } from '@/lib/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { isBlockedMappingSourcePair, stripMappingTextWrapper } from '@/lib/orders/mapping-match'
import { normalizeMappingSources } from '@/lib/orders/mapping-source-normalize'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

function normalizeSourceOption(source: SourceInput): SourceInput {
  const optionId = stripMappingTextWrapper(source.marketplaceOptionId)
  if (optionId) return { ...source, marketplaceOptionId: optionId, optionNameSnapshot: stripMappingTextWrapper(source.optionNameSnapshot) || source.optionNameSnapshot }

  const collectedOption = stripMappingTextWrapper(source.optionNameSnapshot)
  return collectedOption
    ? { ...source, marketplaceOptionId: collectedOption, optionNameSnapshot: collectedOption }
    : { ...source, marketplaceOptionId: '' }
}

function uniqueSources(sources: SourceInput[]): SourceInput[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = [
      source.marketplaceId,
      source.marketplaceProductId,
      source.marketplaceOptionId ?? '',
    ].join('\u0000')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isMappingSourceConflict(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('mapping_sources_user_market_product_option_uniq')
    || normalized.includes('mapping_sources_user_id_marketplace')
    || (normalized.includes('duplicate key') && normalized.includes('mapping_sources'))
    || (normalized.includes('23505') && normalized.includes('mapping_sources'))
}

function errorSearchText(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return error instanceof Error ? error.message : String(error)
  }

  const parts: string[] = []
  const appendError = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    for (const key of ['message', 'code', 'constraint', 'constraint_name', 'detail', 'table']) {
      if (record[key] !== undefined) parts.push(String(record[key]))
    }
  }

  appendError(error)
  appendError((error as { cause?: unknown }).cause)
  return parts.join(' ')
}

async function findInvalidComponentSkus(userId: string, components: ComponentInput[]): Promise<string[]> {
  const requestedSkus = Array.from(new Set(
    components.map((component) => component.sku.trim()).filter(Boolean),
  ))
  if (requestedSkus.length === 0) return []

  const [productRows, variantRows, inventoryRows] = await Promise.all([
    db
      .select({ sku: products.internalSku })
      .from(products)
      .where(and(eq(products.userId, userId), inArray(products.internalSku, requestedSkus))),
    db
      .select({ sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.userId, userId), inArray(productVariants.sku, requestedSkus))),
    db
      .select({ sku: inventory.sku })
      .from(inventory)
      .where(and(eq(inventory.userId, userId), inArray(inventory.sku, requestedSkus))),
  ])
  const validRows = [...productRows, ...variantRows, ...inventoryRows]
  const validSkus = new Set(validRows.map((row) => row.sku))
  return requestedSkus.filter((sku) => !validSkus.has(sku))
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

async function findMatchingMappingCodeIds(userId: string, query: string): Promise<string[]> {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return []

  const conditions = tokens.map((token) => {
    const pattern = `%${token}%`
    const compactPattern = `%${normalizeSearchText(token)}%`

    return sql`(
      mc.code ILIKE ${pattern}
      OR mc.name ILIKE ${pattern}
      OR COALESCE(mc.note, '') ILIKE ${pattern}
      OR regexp_replace(lower(mc.code), '\\s+', '', 'g') LIKE ${compactPattern}
      OR regexp_replace(lower(mc.name), '\\s+', '', 'g') LIKE ${compactPattern}
      OR regexp_replace(lower(COALESCE(mc.note, '')), '\\s+', '', 'g') LIKE ${compactPattern}
      OR EXISTS (
        SELECT 1
        FROM mapping_sources ms
        WHERE ms.mapping_code_id = mc.id
          AND (
            ms.marketplace_id ILIKE ${pattern}
            OR ms.marketplace_product_id ILIKE ${pattern}
            OR ms.marketplace_option_id ILIKE ${pattern}
            OR COALESCE(ms.product_name_snapshot, '') ILIKE ${pattern}
            OR COALESCE(ms.option_name_snapshot, '') ILIKE ${pattern}
            OR regexp_replace(lower(ms.marketplace_id), '\\s+', '', 'g') LIKE ${compactPattern}
            OR regexp_replace(lower(ms.marketplace_product_id), '\\s+', '', 'g') LIKE ${compactPattern}
            OR regexp_replace(lower(ms.marketplace_option_id), '\\s+', '', 'g') LIKE ${compactPattern}
            OR regexp_replace(lower(COALESCE(ms.product_name_snapshot, '')), '\\s+', '', 'g') LIKE ${compactPattern}
            OR regexp_replace(lower(COALESCE(ms.option_name_snapshot, '')), '\\s+', '', 'g') LIKE ${compactPattern}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM mapping_components mcp
        LEFT JOIN inventory inv
          ON inv.user_id = mcp.user_id
         AND inv.sku = mcp.sku
        WHERE mcp.mapping_code_id = mc.id
          AND (
            mcp.sku ILIKE ${pattern}
            OR COALESCE(inv.product_name, '') ILIKE ${pattern}
            OR COALESCE(inv.option_name, '') ILIKE ${pattern}
            OR regexp_replace(lower(mcp.sku), '\\s+', '', 'g') LIKE ${compactPattern}
            OR regexp_replace(lower(COALESCE(inv.product_name, '')), '\\s+', '', 'g') LIKE ${compactPattern}
            OR regexp_replace(lower(COALESCE(inv.option_name, '')), '\\s+', '', 'g') LIKE ${compactPattern}
          )
      )
    )`
  })

  const rows = await db.execute<{ id: string }>(sql`
    SELECT mc.id::text AS id
    FROM mapping_codes mc
    WHERE mc.user_id = ${userId}
      AND ${sql.join(conditions, sql` AND `)}
    ORDER BY mc.updated_at DESC
    LIMIT 500
  `)

  return rows.map((row) => row.id)
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const search = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const matchedIds = search ? await findMatchingMappingCodeIds(workspaceUserId, search) : []
  if (search && matchedIds.length === 0) {
    return NextResponse.json(
      { codes: [] },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  }

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
        createdAt: Date | null
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
          'optionNameSnapshot', ${mappingSources.optionNameSnapshot},
          'createdAt', ${mappingSources.createdAt}
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
    .where(and(
      eq(mappingCodes.userId, workspaceUserId),
      search ? inArray(mappingCodes.id, matchedIds) : undefined,
    ))
    .orderBy(sql`${mappingCodes.updatedAt} DESC`)

  return NextResponse.json(
    { codes: rows },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
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

  const invalidComponentSkus = await findInvalidComponentSkus(workspaceUserId, body.components)
  if (invalidComponentSkus.length > 0) {
    return NextResponse.json({
      error: `상품관리/재고관리에 없는 내부상품코드는 매핑할 수 없습니다: ${invalidComponentSkus.join(', ')}`,
      invalidSkus: invalidComponentSkus,
    }, { status: 400 })
  }

  const normalizedSources = uniqueSources(await normalizeMappingSources(
    workspaceUserId,
    body.sources.map(normalizeSourceOption),
  ))

  if (normalizedSources.some(isBlockedSource)) {
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

      if (normalizedSources.length > 0) {
        for (const source of normalizedSources) {
          await tx
            .delete(mappingSources)
            .where(and(
              eq(mappingSources.userId, workspaceUserId),
              eq(mappingSources.marketplaceId, source.marketplaceId),
              eq(mappingSources.marketplaceProductId, source.marketplaceProductId),
              eq(mappingSources.marketplaceOptionId, source.marketplaceOptionId ?? ''),
            ))
        }
        await tx.insert(mappingSources).values(
          normalizedSources.map((s) => ({
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
    const msg = errorSearchText(e) || 'unknown error'
    if (isMappingSourceConflict(msg)) {
      return NextResponse.json({ error: '이미 다른 매핑코드에 연결된 마켓상품/옵션입니다. 기존 매핑을 수정하거나 먼저 연결을 해제해주세요.' }, { status: 409 })
    }
    if (msg.includes('mapping_codes_user_id_code_key') || msg.includes('mapping_codes_user_code_uniq')) {
      return NextResponse.json({ error: '이미 사용 중인 매핑코드입니다' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
