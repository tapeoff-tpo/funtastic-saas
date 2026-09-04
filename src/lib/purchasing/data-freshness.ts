import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export type DataRefreshSource =
  | 'domestic_inventory'
  | 'purchasing_raw:purchaseRequest'
  | 'purchasing_raw:purchasePlan'
  | 'purchasing_raw:purchaseHistory'
  | 'purchasing_raw:chinaInventory'
  | 'purchasing_raw:chinaOutbound'
  | 'purchasing_raw:discontinuedProducts'

async function ensureDataRefreshEvents() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS data_refresh_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      source text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      completed_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS data_refresh_events_user_source_completed_idx
    ON data_refresh_events(user_id, source, completed_at DESC)
  `)
}

export async function recordDataRefresh(input: {
  userId: string
  source: DataRefreshSource
  metadata?: Record<string, unknown>
}) {
  await ensureDataRefreshEvents()
  await db.execute(sql`
    INSERT INTO data_refresh_events (user_id, source, metadata)
    VALUES (${input.userId}::uuid, ${input.source}, ${JSON.stringify(input.metadata ?? {})}::jsonb)
  `)
}

export async function getPurchasingDataFreshness(userId: string) {
  await ensureDataRefreshEvents()
  const result = await db.execute<{
    recommendationCalculatedAt: string | null
    targetStockMonths: string | null
    rawDataAppliedAt: string | null
    domesticInventoryAt: string | null
    chinaInventoryAt: string | null
    outboundRawAt: string | null
    outboundReflectionAt: string | null
  }>(sql`
    SELECT
      (
        SELECT MAX(NULLIF(raw_data->>'evaluatedAt', '')::timestamptz)
        FROM purchase_request_items
        WHERE user_id = ${userId}::uuid
          AND raw_data->>'source' = 'auto_purchase_recommendation'
      )::text AS "recommendationCalculatedAt",
      (
        SELECT raw_data->>'targetStockMonths'
        FROM purchase_request_items
        WHERE user_id = ${userId}::uuid
          AND raw_data->>'source' = 'auto_purchase_recommendation'
          AND NULLIF(raw_data->>'evaluatedAt', '') IS NOT NULL
        ORDER BY (raw_data->>'evaluatedAt')::timestamptz DESC
        LIMIT 1
      ) AS "targetStockMonths",
      COALESCE(
        (SELECT MAX(completed_at) FROM data_refresh_events WHERE user_id = ${userId}::uuid AND source LIKE 'purchasing_raw:%'),
        (SELECT MAX(updated_at) FROM purchasing_ecount_raw_files WHERE user_id = ${userId}::uuid)
      )::text AS "rawDataAppliedAt",
      COALESCE(
        (SELECT MAX(completed_at) FROM data_refresh_events WHERE user_id = ${userId}::uuid AND source = 'domestic_inventory'),
        (SELECT MAX(updated_at) FROM inventory WHERE user_id = ${userId}::uuid)
      )::text AS "domesticInventoryAt",
      COALESCE(
        (SELECT MAX(completed_at) FROM data_refresh_events WHERE user_id = ${userId}::uuid AND source = 'purchasing_raw:chinaInventory'),
        (SELECT MAX(updated_at) FROM china_warehouse_inventory WHERE user_id = ${userId}::uuid)
      )::text AS "chinaInventoryAt",
      COALESCE(
        (SELECT MAX(completed_at) FROM data_refresh_events WHERE user_id = ${userId}::uuid AND source = 'purchasing_raw:chinaOutbound'),
        (SELECT MAX(updated_at) FROM purchasing_ecount_raw_files WHERE user_id = ${userId}::uuid AND report_kind = 'chinaOutbound')
      )::text AS "outboundRawAt",
      (
        SELECT MAX(applied_at) FROM outbound_reflection_batches
        WHERE user_id = ${userId}::uuid
      )::text AS "outboundReflectionAt"
  `)
  const rows = Array.isArray(result) ? result : result.rows ?? []
  return rows[0] ?? {
    recommendationCalculatedAt: null,
    targetStockMonths: null,
    rawDataAppliedAt: null,
    domesticInventoryAt: null,
    chinaInventoryAt: null,
    outboundRawAt: null,
    outboundReflectionAt: null,
  }
}
