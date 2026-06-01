/**
 * Mapping codes API — 단일 매핑코드 조회/수정/삭제.
 *
 * GET   : 코드 + sources + components 전체 반환 (편집 화면용).
 * PATCH : 코드/이름/노트/활성화 + sources/components 전체 교체 (트랜잭션).
 * DELETE: 매핑코드 + sources + components 삭제 (CASCADE).
 */
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { mappingCodes, mappingSources, mappingComponents, products, productVariants } from '@/lib/db/schema'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { eq, and, sql } from 'drizzle-orm'
import { isBlockedMappingSourcePair } from '@/lib/orders/mapping-match'
import { normalizeMappingSources } from '@/lib/orders/mapping-source-normalize'

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

interface UpdateBody {
  code?: string
  name?: string
  note?: string | null
  isActive?: boolean
  sources?: SourceInput[]
  components?: ComponentInput[]
}

function isBlockedSource(source: SourceInput): boolean {
  return isBlockedMappingSourcePair(
    source.marketplaceId,
    source.marketplaceProductId,
    source.marketplaceOptionId,
  )
}

function normalizeSourceOption(source: SourceInput): SourceInput {
  const optionId = source.marketplaceOptionId?.trim()
  if (optionId) return { ...source, marketplaceOptionId: optionId }

  const collectedOption = source.optionNameSnapshot?.trim()
  return collectedOption
    ? { ...source, marketplaceOptionId: collectedOption }
    : { ...source, marketplaceOptionId: '' }
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

  const rows = await db.execute<{ sku: string }>(sql`
    SELECT sku
    FROM (
      SELECT ${products.internalSku} AS sku
      FROM ${products}
      WHERE ${products.userId} = ${userId}
        AND ${products.internalSku} = ANY(${requestedSkus})
      UNION
      SELECT ${productVariants.sku} AS sku
      FROM ${productVariants}
      INNER JOIN ${products} ON ${products.id} = ${productVariants.productId}
      WHERE ${products.userId} = ${userId}
        AND ${productVariants.sku} = ANY(${requestedSkus})
    ) valid_skus
  `)
  const validRows = Array.isArray(rows)
    ? rows
    : (rows as unknown as { rows?: Array<{ sku: string }> }).rows ?? []
  const validSkus = new Set(validRows.map((row) => row.sku))
  return requestedSkus.filter((sku) => !validSkus.has(sku))
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const [code] = await db
    .select()
    .from(mappingCodes)
    .where(and(eq(mappingCodes.id, id), eq(mappingCodes.userId, workspaceUserId)))
    .limit(1)

  if (!code) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const sources = await db
    .select()
    .from(mappingSources)
    .where(eq(mappingSources.mappingCodeId, id))

  const components = await db
    .select({
      id: mappingComponents.id,
      userId: mappingComponents.userId,
      mappingCodeId: mappingComponents.mappingCodeId,
      sku: mappingComponents.sku,
      quantity: mappingComponents.quantity,
      createdAt: mappingComponents.createdAt,
      updatedAt: mappingComponents.updatedAt,
      productName: sql<string | null>`(
        SELECT MAX(i.product_name)
        FROM inventory i
        WHERE i.user_id = mapping_components.user_id
          AND i.sku = mapping_components.sku
      )`,
      optionName: sql<string | null>`(
        SELECT MAX(i.option_name)
        FROM inventory i
        WHERE i.user_id = mapping_components.user_id
          AND i.sku = mapping_components.sku
      )`,
    })
    .from(mappingComponents)
    .where(eq(mappingComponents.mappingCodeId, id))

  return NextResponse.json({ code, sources, components })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: UpdateBody
  try {
    body = await req.json() as UpdateBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  // Ownership check
  const [existing] = await db
    .select({ id: mappingCodes.id })
    .from(mappingCodes)
    .where(and(eq(mappingCodes.id, id), eq(mappingCodes.userId, workspaceUserId)))
    .limit(1)
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const normalizedSources = body.sources
    ? await normalizeMappingSources(workspaceUserId, body.sources.map(normalizeSourceOption))
    : undefined

  if (normalizedSources?.some(isBlockedSource)) {
    return NextResponse.json({ error: '주문번호/주문행번호는 상품 매핑키로 저장할 수 없습니다. 실제 상품코드 또는 자체코드로 매핑해 주세요.' }, { status: 400 })
  }

  if (body.components !== undefined) {
    const invalidComponentSkus = await findInvalidComponentSkus(workspaceUserId, body.components)
    if (invalidComponentSkus.length > 0) {
      return NextResponse.json({
        error: `상품관리/재고관리에 없는 내부상품코드는 매핑할 수 없습니다: ${invalidComponentSkus.join(', ')}`,
        invalidSkus: invalidComponentSkus,
      }, { status: 400 })
    }
  }

  try {
    await db.transaction(async (tx) => {
      // Update master row
      const updates: Record<string, unknown> = { updatedAt: new Date() }
      if (body.code !== undefined) updates.code = body.code.trim()
      if (body.name !== undefined) updates.name = body.name.trim()
      if (body.note !== undefined) updates.note = body.note?.trim() || null
      if (body.isActive !== undefined) updates.isActive = body.isActive

      if (Object.keys(updates).length > 1) {
        await tx.update(mappingCodes).set(updates).where(eq(mappingCodes.id, id))
      }

      // Replace sources if provided
      if (normalizedSources !== undefined) {
        await tx.delete(mappingSources).where(eq(mappingSources.mappingCodeId, id))
        if (normalizedSources.length > 0) {
          await tx.insert(mappingSources).values(
            normalizedSources.map((s) => ({
              userId: workspaceUserId,
              mappingCodeId: id,
              marketplaceId: s.marketplaceId,
              marketplaceProductId: s.marketplaceProductId,
              marketplaceOptionId: s.marketplaceOptionId ?? '',
              productNameSnapshot: s.productNameSnapshot ?? null,
              optionNameSnapshot: s.optionNameSnapshot ?? null,
            })),
          )
        }
      }

      // Replace components if provided
      if (body.components !== undefined) {
        if (body.components.length === 0) {
          throw new Error('최소 1개 이상의 SKU 구성품이 필요합니다')
        }
        await tx.delete(mappingComponents).where(eq(mappingComponents.mappingCodeId, id))
        await tx.insert(mappingComponents).values(
          body.components.map((c) => ({
            userId: workspaceUserId,
            mappingCodeId: id,
            sku: c.sku,
            quantity: c.quantity,
          })),
        )
      }
    })

    revalidateTag('product-mappings', 'max')
    revalidateTag('orders', 'max')
    revalidatePath('/orders')
    revalidatePath('/products/mapping-codes')
    return NextResponse.json({ ok: true })
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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const result = await db
    .delete(mappingCodes)
    .where(and(eq(mappingCodes.id, id), eq(mappingCodes.userId, workspaceUserId)))
    .returning({ id: mappingCodes.id })

  if (result.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 })
  revalidateTag('product-mappings', 'max')
  revalidateTag('orders', 'max')
  revalidatePath('/orders')
  revalidatePath('/products/mapping-codes')
  return NextResponse.json({ ok: true })
}
