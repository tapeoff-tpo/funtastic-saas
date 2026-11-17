import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import type { calculateShipmentCost } from './shipment-cost'

export async function confirmShipmentCost(entry: {
  userId: string
  shipmentId: string
  actorId: string
  bl: string
  date: string
  snapshot: string
  inputs: Parameters<typeof calculateShipmentCost>[1]
  result: ReturnType<typeof calculateShipmentCost>
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('shipment_landed_costs'))`)
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS shipment_landed_costs (
        user_id uuid NOT NULL, shipment_id uuid NOT NULL, actor_id uuid NOT NULL,
        bl text NOT NULL, cost_date date NOT NULL, snapshot text NOT NULL,
        inputs jsonb NOT NULL, result jsonb NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, shipment_id)
      )
    `)
    const inserted = await tx.execute(sql`
      INSERT INTO shipment_landed_costs (user_id, shipment_id, actor_id, bl, cost_date, snapshot, inputs, result)
      VALUES (${entry.userId}, ${entry.shipmentId}, ${entry.actorId}, ${entry.bl}, ${entry.date},
        ${entry.snapshot}, ${JSON.stringify(entry.inputs)}::jsonb, ${JSON.stringify(entry.result)}::jsonb)
      ON CONFLICT DO NOTHING RETURNING shipment_id
    `)
    return inserted.length > 0
  })
}

export type ShipmentCostHistoryRow = { sku: string; bl: string; date: string; quantity: number; unitCost: number }

export async function listShipmentCostHistory(userId: string, skus: string[]) {
  if (!skus.length) return []
  const [state] = await db.execute<{ exists: boolean }>(sql`SELECT to_regclass('shipment_landed_costs') IS NOT NULL AS exists`)
  if (!state?.exists) return []
  return db.execute<ShipmentCostHistoryRow>(sql`
    SELECT item->>'sku' AS sku, bl, cost_date::text AS date,
      (item->>'quantity')::integer AS quantity, (item->>'unitCost')::numeric::float8 AS "unitCost"
    FROM shipment_landed_costs CROSS JOIN LATERAL jsonb_array_elements(result->'rows') AS items(item)
    WHERE user_id = ${userId} AND item->>'sku' IN (${sql.join(skus.map((sku) => sql`${sku}`), sql`, `)})
    ORDER BY cost_date DESC, confirmed_at DESC
  `)
}
