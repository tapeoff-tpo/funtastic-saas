/**
 * 매핑관리 보드용 orderItem 단위 행 조회 API.
 *
 * 사방넷 주문서확정관리 화면처럼 한 행 = order_items 한 건. 좌측은 쇼핑몰 수집 데이터,
 * 우측은 mapping_sources(품번/단품 우선순위) → mapping_codes → mapping_components → inventory
 * 가 LEFT JOIN 으로 붙어 매핑 적용 결과를 그대로 보여준다.
 *
 * 매칭 우선순위 (같은 쇼핑몰 단품 → 같은 쇼핑몰 품번 → 전역 유일 단품/품번 fallback) 는
 * src/app/api/products/mapping-codes/unmapped/route.ts 와 동일한 SQL 패턴을 사용.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

type ProductMatch = 'all' | 'matched' | 'unmatched'
type OptionMatch = 'all' | 'matched' | 'unmatched' | 'sku'

interface ComponentSummary {
  sku: string
  quantity: number
  productName: string | null
  optionName: string | null
}

interface OrderRow {
  orderItemId: string
  orderId: string
  marketplaceId: string
  marketplaceOrderId: string
  orderedAt: string
  marketplaceItemId: string
  productName: string
  optionText: string | null
  quantity: number
  /**
   * 매핑 상태:
   *  - 'both'    : 품번 + 단품 둘 다 매핑됨 (매핑완료)
   *  - 'option'  : 단품만
   *  - 'product' : 품번만
   *  - 'unmapped': 둘 다 없음
   */
  mappingStatus: 'both' | 'option' | 'product' | 'unmapped'
  hasProductMapping: boolean
  hasOptionMapping: boolean
  mappingSourceId: string | null
  mappingCodeId: string | null
  mappingCode: string | null
  mappingName: string | null
  components: ComponentSummary[]
  /** oi.unit_price — Postgres numeric 컬럼은 string 으로 반환됨 */
  unitPrice: string | null
  /** unitPrice * quantity — 서버에서 곱한 값 (decimal as string) */
  totalAmount: string | null
  /** orders.mapped_at — null = 미확정, value = 확정완료 */
  mappedAt: string | null
}

function parseProductMatch(v: string | null): ProductMatch {
  return v === 'matched' || v === 'unmatched' ? v : 'all'
}
function parseOptionMatch(v: string | null): OptionMatch {
  return v === 'matched' || v === 'unmatched' || v === 'sku' ? v : 'all'
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const sp = req.nextUrl.searchParams

  const from = sp.get('from')
  const to = sp.get('to')
  const marketplacesParam = sp.get('marketplaceIds')
  const marketplaceIds = marketplacesParam
    ? marketplacesParam.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  const productMatch = parseProductMatch(sp.get('productMatch'))
  const optionMatch = parseOptionMatch(sp.get('optionMatch'))
  const q = (sp.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSizeRaw = parseInt(sp.get('pageSize') ?? '50', 10) || 50
  const pageSize = Math.min(200, Math.max(1, pageSizeRaw))
  const offset = (page - 1) * pageSize
  const exactOptionId = '__exact__'

  // ---------- 동적 WHERE 절 (parametrized) ----------
  // o.user_id = user.id 는 항상.
  const whereParts: ReturnType<typeof sql>[] = [
    sql`o.user_id = ${workspaceUserId}`,
    sql`oi.marketplace_item_id IS NOT NULL`,
    sql`oi.marketplace_item_id <> ''`,
  ]

  if (from) whereParts.push(sql`o.ordered_at >= ${from}`)
  if (to) whereParts.push(sql`o.ordered_at < (${to}::date + INTERVAL '1 day')`)
  if (marketplaceIds.length > 0) {
    // drizzle 의 sql template 은 JS 배열을 Postgres array literal 로 직접 직렬화하지 않음.
    // ANY(${arr}) 로 넘기면 "ssgmall" 같은 단일 문자열 그대로 전달돼 22P02 (malformed array literal) 발생.
    // 각 원소를 개별 파라미터로 펼쳐 IN (...) 로 변환.
    const ids = sql.join(marketplaceIds.map((id) => sql`${id}`), sql`, `)
    whereParts.push(sql`o.marketplace_id IN (${ids})`)
  }
  if (q) {
    const like = `%${q}%`
    whereParts.push(sql`(
      oi.marketplace_item_id ILIKE ${like}
      OR oi.product_name ILIKE ${like}
      OR COALESCE(oi.option_text, '') ILIKE ${like}
    )`)
  }

  // productMatch / optionMatch 필터
  if (productMatch === 'matched') {
    whereParts.push(sql`mc.id IS NOT NULL`)
  } else if (productMatch === 'unmatched') {
    whereParts.push(sql`mc.id IS NULL`)
  }

  if (optionMatch === 'matched') {
    whereParts.push(sql`ms.marketplace_option_id IS NOT NULL AND ms.marketplace_option_id <> ''`)
  } else if (optionMatch === 'unmatched') {
    whereParts.push(sql`(ms.id IS NULL OR ms.marketplace_option_id IS NULL OR ms.marketplace_option_id = '')`)
  } else if (optionMatch === 'sku') {
    // mapping_components 의 sku 가 inventory 에 1개 이상 존재
    whereParts.push(sql`EXISTS (
      SELECT 1
      FROM mapping_components mc2
      INNER JOIN inventory inv2 ON inv2.user_id = o.user_id AND inv2.sku = mc2.sku
      WHERE mc2.mapping_code_id = mc.id
    )`)
  }

  const whereClause = sql.join(whereParts, sql` AND `)

  // LATERAL JOIN: 단품 우선 매칭 1건. 같은 oi 에 단품 매핑과 품번 매핑이 모두 있더라도 단품 1건만 채택.
  const lateralJoin = sql`
    LEFT JOIN LATERAL (
      SELECT s.*
      FROM mapping_sources s
      WHERE s.user_id = o.user_id
        AND s.marketplace_id = o.marketplace_id
        AND (
          (s.marketplace_option_id <> ''
            AND (
              oi.marketplace_item_id = s.marketplace_product_id || '-' || s.marketplace_option_id
              OR (s.marketplace_option_id = ${exactOptionId}
                AND oi.marketplace_item_id = s.marketplace_product_id)
              OR (oi.marketplace_item_id = s.marketplace_product_id
                AND LEFT(COALESCE(oi.option_text, ''), 100) = s.marketplace_option_id)
            ))
          OR (s.marketplace_option_id = ''
            AND (oi.marketplace_item_id = s.marketplace_product_id
              OR oi.marketplace_item_id LIKE s.marketplace_product_id || '-%'))
        )
      ORDER BY (s.marketplace_option_id <> '') DESC
      LIMIT 1
    ) ms ON TRUE
  `

  // ---------- COUNT (필터 적용된 전체) ----------
  const countResult = await db.execute<{ total: number }>(sql`
    SELECT COUNT(DISTINCT oi.id)::int AS total
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    ${lateralJoin}
    LEFT JOIN mapping_codes mc ON mc.id = ms.mapping_code_id AND mc.user_id = o.user_id
    WHERE ${whereClause}
  `)
  const totalRaw = (countResult as unknown as Array<{ total: number }>)[0]?.total
  const total = typeof totalRaw === 'number' ? totalRaw : Number(totalRaw ?? 0)

  // ---------- DATA ----------
  const rowsResult = await db.execute(sql`
    SELECT
      oi.id                           AS "orderItemId",
      o.id                            AS "orderId",
      o.marketplace_id                AS "marketplaceId",
      o.marketplace_order_id          AS "marketplaceOrderId",
      o.ordered_at                    AS "orderedAt",
      oi.marketplace_item_id          AS "marketplaceItemId",
      oi.product_name                 AS "productName",
      oi.option_text                  AS "optionText",
      oi.quantity                     AS "quantity",
      oi.unit_price                   AS "unitPrice",
      (oi.unit_price * oi.quantity)   AS "totalAmount",
      o.mapped_at                     AS "mappedAt",
      ms.id                           AS "mappingSourceId",
      ms.marketplace_option_id        AS "msOptionId",
      mc.id                           AS "mappingCodeId",
      mc.code                         AS "mappingCode",
      mc.name                         AS "mappingName",
      -- 품번 매핑(option_id 빈 문자열) 별도 존재 여부. LATERAL JOIN 은 단품 우선이라
      -- 둘 다 있을 때 단품만 채택되어 품번 존재가 가려지므로 별도 EXISTS 로 확인.
      EXISTS (
        SELECT 1 FROM mapping_sources s2
        WHERE s2.user_id = o.user_id
          AND s2.marketplace_id = o.marketplace_id
          AND s2.marketplace_option_id = ''
          AND (oi.marketplace_item_id = s2.marketplace_product_id
            OR oi.marketplace_item_id LIKE s2.marketplace_product_id || '-%')
      )                               AS "hasProductMapping",
      EXISTS (
        SELECT 1 FROM mapping_sources s3
        WHERE s3.user_id = o.user_id
          AND s3.marketplace_id = o.marketplace_id
          AND s3.marketplace_option_id <> ''
          AND (
            oi.marketplace_item_id = s3.marketplace_product_id || '-' || s3.marketplace_option_id
            OR (s3.marketplace_option_id = ${exactOptionId}
              AND oi.marketplace_item_id = s3.marketplace_product_id)
            OR (oi.marketplace_item_id = s3.marketplace_product_id
              AND LEFT(COALESCE(oi.option_text, ''), 100) = s3.marketplace_option_id)
          )
      )                               AS "hasOptionMapping",
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'sku', mcomp.sku,
              'quantity', mcomp.quantity,
              'productName', (
                SELECT MAX(inv.product_name)
                FROM inventory inv
                WHERE inv.user_id = o.user_id AND inv.sku = mcomp.sku
              ),
              'optionName', (
                SELECT MAX(inv.option_name)
                FROM inventory inv
                WHERE inv.user_id = o.user_id AND inv.sku = mcomp.sku
              )
            )
            ORDER BY mcomp.id
          )
          FROM mapping_components mcomp
          WHERE mcomp.mapping_code_id = mc.id
        ),
        '[]'::json
      ) AS "components"
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    ${lateralJoin}
    LEFT JOIN mapping_codes mc ON mc.id = ms.mapping_code_id AND mc.user_id = o.user_id
    WHERE ${whereClause}
    ORDER BY o.ordered_at DESC, oi.id
    LIMIT ${pageSize}
    OFFSET ${offset}
  `)

  // drizzle execute 의 결과는 Postgres driver 별로 shape 가 약간 다르다.
  // (postgres-js): rows array 를 직접 반환. (node-postgres): { rows } 객체.
  const rawRows = Array.isArray(rowsResult)
    ? (rowsResult as unknown as Record<string, unknown>[])
    : ((rowsResult as { rows?: Record<string, unknown>[] }).rows ?? [])

  const rows: OrderRow[] = rawRows.map((r) => {
    const mappingCodeId = (r.mappingCodeId as string | null) ?? null
    const hasProductMapping = Boolean(r.hasProductMapping)
    const hasOptionMapping = Boolean(r.hasOptionMapping)
    let status: 'both' | 'option' | 'product' | 'unmapped' = 'unmapped'
    if (hasProductMapping && hasOptionMapping) {
      status = 'both'
    } else if (hasOptionMapping) {
      status = 'option'
    } else if (hasProductMapping) {
      status = 'product'
    }
    const componentsRaw = r.components
    const components: ComponentSummary[] = Array.isArray(componentsRaw)
      ? (componentsRaw as ComponentSummary[])
      : typeof componentsRaw === 'string'
        ? (JSON.parse(componentsRaw) as ComponentSummary[])
        : []

    const orderedAtRaw = r.orderedAt
    const orderedAt = orderedAtRaw instanceof Date
      ? orderedAtRaw.toISOString()
      : String(orderedAtRaw ?? '')

    return {
      orderItemId: String(r.orderItemId),
      orderId: String(r.orderId),
      marketplaceId: String(r.marketplaceId),
      marketplaceOrderId: String(r.marketplaceOrderId ?? ''),
      orderedAt,
      marketplaceItemId: String(r.marketplaceItemId ?? ''),
      productName: String(r.productName ?? ''),
      optionText: (r.optionText as string | null) ?? null,
      quantity: Number(r.quantity ?? 0),
      mappingStatus: status,
      hasProductMapping,
      hasOptionMapping,
      mappingSourceId: (r.mappingSourceId as string | null) ?? null,
      mappingCodeId,
      mappingCode: (r.mappingCode as string | null) ?? null,
      mappingName: (r.mappingName as string | null) ?? null,
      components,
      unitPrice: r.unitPrice == null ? null : String(r.unitPrice),
      totalAmount: r.totalAmount == null ? null : String(r.totalAmount),
      mappedAt: r.mappedAt
        ? (r.mappedAt instanceof Date
            ? r.mappedAt.toISOString()
            : String(r.mappedAt))
        : null,
    }
  })

  return NextResponse.json({ rows, total, page, pageSize })
}
