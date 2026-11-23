import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import type { ImportDocumentDraft } from './china-import-editing'

let ready: Promise<unknown> | undefined
function ensureDraftTable() {
  return ready ??= (async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS shipment_import_document_drafts (
      user_id uuid NOT NULL, shipment_id uuid NOT NULL, actor_id uuid NOT NULL,
      snapshot text NOT NULL, inputs jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, shipment_id)
    )`)
    await db.execute(sql`ALTER TABLE shipment_import_document_drafts ENABLE ROW LEVEL SECURITY`)
    await db.execute(sql`REVOKE ALL ON shipment_import_document_drafts FROM PUBLIC`)
  })().catch((error) => { ready = undefined; throw error })
}
export async function getImportDocumentDraft(userId: string, shipmentId: string) {
  const [state] = await db.execute<{ exists: boolean }>(sql`SELECT to_regclass('shipment_import_document_drafts') IS NOT NULL AS exists`)
  if (!state?.exists) return null
  const [row] = await db.execute<{ inputs: ImportDocumentDraft; snapshot: string; revision: number }>(sql`
    SELECT inputs, snapshot, revision FROM shipment_import_document_drafts WHERE user_id=${userId} AND shipment_id=${shipmentId}`)
  return row ?? null
}
export async function saveImportDocumentDraft(input: { userId: string; shipmentId: string; actorId: string; snapshot: string; inputs: ImportDocumentDraft; revision: number }) {
  await ensureDraftTable()
  // A shared document may be open on another computer. Never silently replace
  // a newer save made by another operator.
  if (input.revision === 0) {
    const [saved] = await db.execute<{ revision: number }>(sql`
      INSERT INTO shipment_import_document_drafts (user_id, shipment_id, actor_id, snapshot, inputs)
      VALUES (${input.userId}, ${input.shipmentId}, ${input.actorId}, ${input.snapshot}, ${JSON.stringify(input.inputs)}::jsonb)
      ON CONFLICT (user_id, shipment_id) DO NOTHING RETURNING revision`)
    return saved ?? null
  }
  const [updated] = await db.execute<{ revision: number }>(sql`
    UPDATE shipment_import_document_drafts SET actor_id=${input.actorId}, snapshot=${input.snapshot}, inputs=${JSON.stringify(input.inputs)}::jsonb,
      revision=revision+1, updated_at=now()
    WHERE user_id=${input.userId} AND shipment_id=${input.shipmentId} AND revision=${input.revision} RETURNING revision`)
  return updated ?? null
}
