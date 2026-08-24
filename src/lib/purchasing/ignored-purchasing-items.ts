import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export function purchasingItemIdentity(input: {
  source: string
  sku: string
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
}) {
  return [input.source, input.sku, input.purchaseManagementCode ?? '', input.supplierOrderNumber ?? ''].join('|')
}

export async function ensureIgnoredPurchasingItemsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS purchasing_ignored_items (
      user_id uuid NOT NULL,
      identity_key text NOT NULL,
      reason text,
      ignored_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, identity_key)
    )
  `)
}

export async function getIgnoredPurchasingItemKeys(userId: string) {
  await ensureIgnoredPurchasingItemsTable()
  const rows = await db.execute(sql`
    SELECT identity_key AS "identityKey"
    FROM purchasing_ignored_items
    WHERE user_id = ${userId}::uuid
  `)
  return new Set(rows.map((row) => String(row.identityKey)))
}

export async function ignorePurchasingItem(input: {
  userId: string
  identityKey: string
  reason: string
}) {
  await ensureIgnoredPurchasingItemsTable()
  await db.execute(sql`
    INSERT INTO purchasing_ignored_items (user_id, identity_key, reason, ignored_at)
    VALUES (${input.userId}::uuid, ${input.identityKey}, ${input.reason}, now())
    ON CONFLICT (user_id, identity_key) DO UPDATE SET
      reason = EXCLUDED.reason,
      ignored_at = now()
  `)
}
