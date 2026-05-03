/**
 * 미매핑 마켓상품 자동 추출.
 *
 * 사용자의 주문에 등장한 (marketplaceId, marketplaceItemId) 중에서
 * mapping_sources 에 등록되지 않은 항목을 빈도순으로 반환.
 * 쇼핑몰 ID가 달라도 같은 상품코드가 한 매핑코드에만 연결되어 있으면 매핑된 것으로 본다.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const exactOptionId = '__exact__'

  // 최근 90일 내 주문에 등장한 마켓상품 중 매핑되지 않은 항목.
  // 사방넷 방식 매칭:
  //   - 단품매핑: ms.product_id || '-' || ms.option_id == oi.marketplace_item_id  (option_id != '')
  //   - 품번매핑: ms.option_id = '' AND (ms.product_id == oi.marketplace_item_id
  //                                    OR oi.marketplace_item_id LIKE ms.product_id || '-%')
  // 둘 중 하나라도 hit 하면 매핑됨, 모두 미스면 미매핑.
  const rows = await db.execute(sql`
    SELECT
      o.marketplace_id AS "marketplaceId",
      oi.marketplace_item_id AS "marketplaceItemId",
      MAX(oi.product_name) AS "productName",
      MAX(oi.option_text) AS "optionText",
      COUNT(*)::int AS "occurrences",
      MAX(o.ordered_at) AS "lastSeenAt"
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    WHERE o.user_id = ${user.id}
      AND oi.marketplace_item_id IS NOT NULL
      AND oi.marketplace_item_id <> ''
      AND o.ordered_at > NOW() - INTERVAL '90 days'
      AND NOT (
        EXISTS (
          SELECT 1 FROM mapping_sources ms
          WHERE ms.user_id = o.user_id
            AND ms.marketplace_id = o.marketplace_id
            AND (
              -- 단품매핑 정확일치
              (ms.marketplace_option_id <> ''
                AND (
                  oi.marketplace_item_id = ms.marketplace_product_id || '-' || ms.marketplace_option_id
                  OR (ms.marketplace_option_id = ${exactOptionId}
                    AND oi.marketplace_item_id = ms.marketplace_product_id)
                ))
              -- 품번매핑: 풀 일치 또는 productId+ "-" prefix
              OR (ms.marketplace_option_id = ''
                AND (oi.marketplace_item_id = ms.marketplace_product_id
                  OR oi.marketplace_item_id LIKE ms.marketplace_product_id || '-%'))
            )
        )
        OR (
          SELECT COUNT(DISTINCT ms.mapping_code_id)::int
          FROM mapping_sources ms
          WHERE ms.user_id = o.user_id
            AND (
              -- 쇼핑몰 ID fallback: 단품/품번 코드가 전역에서 한 매핑코드로만 귀결될 때만 매핑 처리
              (ms.marketplace_option_id <> ''
                AND (
                  oi.marketplace_item_id = ms.marketplace_product_id || '-' || ms.marketplace_option_id
                  OR (ms.marketplace_option_id = ${exactOptionId}
                    AND oi.marketplace_item_id = ms.marketplace_product_id)
                ))
              OR (ms.marketplace_option_id = ''
                AND (oi.marketplace_item_id = ms.marketplace_product_id
                  OR oi.marketplace_item_id LIKE ms.marketplace_product_id || '-%'))
            )
        ) = 1
      )
    GROUP BY o.marketplace_id, oi.marketplace_item_id
    ORDER BY occurrences DESC
    LIMIT 500
  `)

  return NextResponse.json({ items: rows })
}
