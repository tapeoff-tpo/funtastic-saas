/**
 * GET /api/products/search?q=검색어&mode=product|option
 *
 * 상품코드(internalSku) 또는 상품명으로 검색.
 *
 * - mode=option (default) : 단품 단위 결과 (inventory row 1개당 1행).
 *   이미 매핑된 마켓 상품명을 옵션 힌트로 제공해서 variant 구분이 쉽도록 함.
 *
 * - mode=product : 품번 단위 결과. internalSku 의 첫 `-` 앞부분(prefix)으로 GROUP BY 해서
 *   같은 시리즈의 단품들을 하나의 행으로 묶어 보여줌. 품번매핑 시 단품을 잘못 고르는 것을 방지.
 *   결과 internalSku 는 prefix(예: "111729"). optionHint 는 "단품 N개" 표시.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products, inventory } from '@/lib/db/schema'
import { eq, and, or, ilike, ne, sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()
  const mode = req.nextUrl.searchParams.get('mode') === 'product' ? 'product' : 'option'

  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] })
  }

  const pattern = `%${q}%`

  if (mode === 'product') {
    // 품번 단위 그룹화. SKU prefix = split_part(internal_sku, '-', 1).
    // 같은 prefix 의 변형(단품)들을 통합해서 1행으로.
    const rowsResult = await db.execute(sql`
      SELECT
        split_part(p.internal_sku, '-', 1)                              AS "internalSku",
        MAX(p.name)                                                     AS "name",
        MAX(p.warehouse_location)                                       AS "warehouseLocation",
        MAX(p.base_price)                                               AS "basePrice",
        MAX(p.cost_price)                                               AS "costPrice",
        COUNT(DISTINCT p.internal_sku)::int                             AS "variantCount",
        COALESCE(SUM(COALESCE(i.available_stock, 0)), 0)::int           AS "availableStock"
      FROM products p
      LEFT JOIN inventory i
        ON i.sku = p.internal_sku AND i.user_id = p.user_id
      WHERE p.user_id = ${user.id}
        AND p.status <> 'deleted'
        AND (p.internal_sku ILIKE ${pattern} OR p.name ILIKE ${pattern})
      GROUP BY split_part(p.internal_sku, '-', 1)
      ORDER BY MAX(p.name)
      LIMIT 50
    `)

    const rawRows = Array.isArray(rowsResult)
      ? (rowsResult as unknown as Record<string, unknown>[])
      : ((rowsResult as { rows?: Record<string, unknown>[] }).rows ?? [])

    const results = rawRows.map((r) => {
      const variantCount = Number(r.variantCount ?? 1)
      return {
        id: String(r.internalSku ?? ''),  // prefix 자체를 id 로 — React key 용도
        internalSku: String(r.internalSku ?? ''),
        name: String(r.name ?? ''),
        warehouseLocation: (r.warehouseLocation as string | null) ?? null,
        basePrice: (r.basePrice as string | null) ?? null,
        costPrice: (r.costPrice as string | null) ?? null,
        optionName: null,
        // 품번 단위라 단일 옵션 힌트 의미가 없음 → 단품 개수만 표시
        optionHint: variantCount > 1 ? `단품 ${variantCount}개` : null,
        availableStock: Number(r.availableStock ?? 0),
        variantCount,
      }
    })

    return NextResponse.json({ results })
  }

  // mode = 'option' (기존 동작). 창고별 inventory 행은 SKU 기준으로 합산한다.
  const rows = await db
    .select({
      id: products.id,
      internalSku: products.internalSku,
      name: products.name,
      warehouseLocation: products.warehouseLocation,
      basePrice: products.basePrice,
      costPrice: products.costPrice,
      optionName: sql<string | null>`MAX(${inventory.optionName})`,
      availableStock: sql<number>`COALESCE(SUM(${inventory.availableStock}), 0)::int`,
    })
    .from(products)
    .leftJoin(
      inventory,
      and(eq(inventory.sku, products.internalSku), eq(inventory.userId, products.userId)),
    )
    .where(
      and(
        eq(products.userId, user.id),
        ne(products.status, 'deleted'),
        or(
          ilike(products.internalSku, pattern),
          ilike(products.name, pattern),
        ),
      ),
    )
    .groupBy(products.id)
    .limit(50)

  const results = rows.map((r) => ({ ...r, optionHint: r.optionName ?? null }))

  return NextResponse.json({ results })
}
