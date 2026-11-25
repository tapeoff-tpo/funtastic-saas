import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import type { InspectionPrintRequest } from './purchase-inspection-label-types'

let schemaReady: Promise<void> | undefined

function ensureSchema() {
  schemaReady ??= (async () => {
    const [schema] = await db.execute<{ exists: boolean }>(sql`
      SELECT to_regclass(current_schema() || '.purchase_inspection_print_requests') IS NOT NULL AS "exists"
    `)
    if (schema?.exists) return
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('purchase-inspection-print-requests-schema'))`)
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS purchase_inspection_print_requests (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL,
          purchase_request_item_id uuid NOT NULL REFERENCES purchase_request_items(id) ON DELETE CASCADE,
          actor_id uuid NOT NULL,
          actor_name text NOT NULL,
          kind text NOT NULL CHECK (kind IN ('box', 'quality', 'barcode')),
          requested_at timestamptz NOT NULL DEFAULT now(),
          box_numbers jsonb,
          file_name text
        )
      `)
      await tx.execute(sql`
        CREATE INDEX IF NOT EXISTS purchase_inspection_print_requests_item_idx
        ON purchase_inspection_print_requests(user_id, purchase_request_item_id, requested_at DESC)
      `)
      await tx.execute(sql`ALTER TABLE purchase_inspection_print_requests ENABLE ROW LEVEL SECURITY`)
      await tx.execute(sql`REVOKE ALL ON purchase_inspection_print_requests FROM PUBLIC`)
    })
  })().catch((error) => {
    schemaReady = undefined
    throw error
  })
  return schemaReady
}

const printRequestFields = sql`
  id, kind, actor_name AS "actorName", requested_at AS "requestedAt",
  box_numbers AS "boxNumbers", file_name AS "fileName"
`

export async function listInspectionPrintRequests(userId: string, itemId: string) {
  await ensureSchema()
  return db.execute<InspectionPrintRequest>(sql`
    SELECT ${printRequestFields} FROM purchase_inspection_print_requests
    WHERE user_id = ${userId} AND purchase_request_item_id = ${itemId}
    ORDER BY requested_at DESC, id DESC LIMIT 100
  `)
}

export async function recordInspectionPrintRequest(input: {
  userId: string; itemId: string; actorId: string; kind: InspectionPrintRequest['kind']
  boxNumbers: string[] | null; fileName: string | null
}) {
  await ensureSchema()
  const [entry] = await db.execute<InspectionPrintRequest>(sql`
    INSERT INTO purchase_inspection_print_requests
      (user_id, purchase_request_item_id, actor_id, actor_name, kind, box_numbers, file_name)
    SELECT item.user_id, item.id, ${input.actorId}::uuid,
      COALESCE(NULLIF(btrim(actor.display_name), ''), actor.email, ${input.actorId}),
      ${input.kind}, ${input.boxNumbers === null ? null : JSON.stringify(input.boxNumbers)}::jsonb, ${input.fileName}
    FROM purchase_request_items item
    LEFT JOIN user_profiles actor ON actor.id = ${input.actorId}
    WHERE item.user_id = ${input.userId} AND item.id = ${input.itemId}
    RETURNING ${printRequestFields}
  `)
  if (!entry) throw new Error('발주 항목을 찾을 수 없습니다.')
  return entry
}
