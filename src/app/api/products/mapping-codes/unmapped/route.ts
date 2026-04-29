/**
 * 미매핑 마켓상품 자동 추출.
 *
 * 사용자의 주문에 등장한 (marketplaceId, marketplaceItemId) 중에서
 * mapping_sources 에 등록되지 않은 항목을 빈도순으로 반환.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 최근 90일 내 주문에 등장한 마켓상품 중 매핑되지 않은 항목.
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
    LEFT JOIN mapping_sources ms
      ON ms.user_id = o.user_id
     AND ms.marketplace_id = o.marketplace_id
     AND ms.marketplace_product_id = oi.marketplace_item_id
     AND ms.marketplace_option_id = ''
    WHERE o.user_id = ${user.id}
      AND oi.marketplace_item_id IS NOT NULL
      AND oi.marketplace_item_id <> ''
      AND ms.id IS NULL
      AND o.ordered_at > NOW() - INTERVAL '90 days'
    GROUP BY o.marketplace_id, oi.marketplace_item_id
    ORDER BY occurrences DESC
    LIMIT 500
  `)

  return NextResponse.json({ items: rows })
}
