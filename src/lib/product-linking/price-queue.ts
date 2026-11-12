import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { amount } from './plan'
const rows = <T>(r: unknown): T[] => (r as { rows?: T[] }).rows ?? (r as T[])
export type PriceQueueRow = {
  id: string
  sku: string
  name: string
  cost: string | null
  b2b: string | null
  b2c: string | null
  excluded: boolean
  reason: string
  workflowId: string | null
}
export async function listPriceQueue(
  userId: string,
  filter: 'missing' | 'excluded' | 'all',
  search: string,
) {
  const term = `%${search.trim().slice(0, 100)}%`
  const missingPrice = (key: string) =>
    sql`COALESCE(regexp_replace(t.raw_data->>${key}, '[,원[:space:]]', '', 'g'), '') !~ '^[0-9]*[1-9][0-9]*(\\.0+)?$'`
  const excluded = sql`COALESCE(p.metadata->'priceWorkflow'->>'excluded', 'false') = 'true'`
  const filterClause =
    filter === 'excluded'
      ? excluded
      : filter === 'missing'
        ? sql`NOT (${excluded}) AND (${missingPrice('B2B 판매가')} OR ${missingPrice('B2C 판매가')})`
        : sql`true`
  return rows<PriceQueueRow>(
    await db.execute(sql`
   SELECT p.id, p.internal_sku AS sku, p.name, p.cost_price::text AS cost,
     t.raw_data->>'B2B 판매가' AS b2b, t.raw_data->>'B2C 판매가' AS b2c,
     ${excluded} AS excluded, COALESCE(p.metadata->'priceWorkflow'->>'reason', '') AS reason,
     p.metadata->'newProductWorkflow'->>'itemId' AS "workflowId"
   FROM products p
   LEFT JOIN LATERAL (
     SELECT raw_data FROM analytics_price_table_rows
     WHERE user_id = p.user_id AND product_code = p.internal_sku AND source_sheet_name = '상품등록'
     ORDER BY updated_at DESC, id LIMIT 1
   ) t ON true
   WHERE p.user_id = ${userId}::uuid
     AND (p.name ILIKE ${term} OR p.internal_sku ILIKE ${term})
     AND (${filterClause})
   ORDER BY p.updated_at DESC, p.id LIMIT 100
 `),
  )
}
export async function saveQueuePrices(
  userId: string,
  actorId: string,
  input: {
    id: string
    b2b: string
    b2c: string
    excluded: boolean
    reason: string
  },
) {
  if (input.excluded && !input.reason.trim())
    throw new Error('입력 제외 사유를 입력해주세요.')
  for (const value of [input.b2b, input.b2c])
    if (value.trim() && (amount(value) == null || amount(value)! > 2147483647))
      throw new Error('판매가는 0 이상 21억 원 이하 숫자로 입력해주세요.')
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`product-link:${userId}`}))`,
    )
    const [p] = rows<{ id: string; internal_sku: string; name: string }>(
      await tx.execute(
        sql`SELECT id,internal_sku,name FROM products WHERE id=${input.id}::uuid AND user_id=${userId}::uuid FOR UPDATE`,
      ),
    )
    if (!p) throw new Error('원가·품목 상품을 찾을 수 없습니다.')
    const existing = rows<{ id: string; raw_data: Record<string, string> }>(
      await tx.execute(
        sql`SELECT id,raw_data FROM analytics_price_table_rows WHERE user_id=${userId}::uuid AND product_code=${p.internal_sku} AND source_sheet_name='상품등록' FOR UPDATE`,
      ),
    )
    if (existing.length > 1)
      throw new Error(
        '같은 품목코드의 판매가 행이 여러 개입니다. 옵션별 코드를 먼저 확인해주세요.',
      )
    const raw = {
      ...(existing[0]?.raw_data ?? {}),
      상품코드: p.internal_sku,
      ...(input.b2b.trim() ? { 'B2B 판매가': String(amount(input.b2b)) } : {}),
      ...(input.b2c.trim() ? { 'B2C 판매가': String(amount(input.b2c)) } : {}),
    }
    if (existing[0])
      await tx.execute(
        sql`UPDATE analytics_price_table_rows SET raw_data=${JSON.stringify(raw)}::jsonb,updated_at=now() WHERE id=${existing[0].id}::uuid AND user_id=${userId}::uuid`,
      )
    else if (input.b2b.trim() || input.b2c.trim())
      await tx.execute(
        sql`INSERT INTO analytics_price_table_rows(user_id,source_file_name,source_sheet_name,row_number,product_code,product_name,raw_data) VALUES(${userId}::uuid,'상품업무 연계','상품등록',0,${p.internal_sku},${p.name},${JSON.stringify(raw)}::jsonb)`,
      )
    await tx.execute(
      sql`UPDATE products SET metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('priceWorkflow',jsonb_build_object('excluded',${input.excluded}::boolean,'reason',${input.reason.trim().slice(0, 500)}::text,'updatedBy',${actorId}::text,'updatedAt',now())),updated_at=now() WHERE id=${p.id}::uuid AND user_id=${userId}::uuid`,
    )
  })
}
