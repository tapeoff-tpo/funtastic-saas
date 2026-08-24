import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { purchaseRequestItems } from '@/lib/db/schema'

const OUTBOUND_COMPLETED_SOURCE = 'ecount_purchasing_snapshot_outbound_completed'

export async function ensureReflectedOutboundItemsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS purchasing_reflected_outbound_items (
      user_id uuid NOT NULL,
      match_key text NOT NULL,
      sku text NOT NULL,
      quantity integer NOT NULL,
      reflected_by_user_id uuid,
      reflected_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, match_key)
    )
  `)
}

export async function getReflectedOutboundMatchKeys(userId: string) {
  await ensureReflectedOutboundItemsTable()
  const rows = await db.execute(sql`
    SELECT match_key AS "matchKey"
    FROM purchasing_reflected_outbound_items
    WHERE user_id = ${userId}::uuid
  `)
  return new Set(rows.map((row) => String(row.matchKey)))
}

export async function reflectSelectedOutboundItems(input: {
  userId: string
  reflectedByUserId: string
  ids?: string[]
  outboundDate?: string
}) {
  await ensureReflectedOutboundItemsTable()
  return db.transaction(async (tx) => {
    const selection = input.outboundDate
      ? eq(purchaseRequestItems.outboundExpectedDate, input.outboundDate)
      : inArray(purchaseRequestItems.id, input.ids ?? [])
    const rows = await tx
      .select({
        id: purchaseRequestItems.id,
        sku: purchaseRequestItems.sku,
        quantity: purchaseRequestItems.requestedQuantity,
        rawData: purchaseRequestItems.rawData,
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        eq(purchaseRequestItems.status, 'completed'),
        selection,
        sql`${purchaseRequestItems.rawData}->>'source' = ${OUTBOUND_COMPLETED_SOURCE}`,
      ))

    const reflected = rows.flatMap((row) => {
      const components = outboundComponents(row.rawData)
      if (components.length > 0) return [{ ...row, components }]

      const matchKey = typeof row.rawData.fallbackMatchKey === 'string'
        ? row.rawData.fallbackMatchKey.trim()
        : ''
      return matchKey ? [{ ...row, components: [{ matchKey, quantity: row.quantity }] }] : []
    })
    if (reflected.length !== rows.length) {
      throw new Error('선택 항목 중 재업로드 방지 식별키가 없는 건이 있습니다.')
    }

    for (const row of reflected) {
      for (const component of row.components) {
        await tx.execute(sql`
          INSERT INTO purchasing_reflected_outbound_items (
            user_id, match_key, sku, quantity, reflected_by_user_id, reflected_at
          ) VALUES (
            ${input.userId}::uuid, ${component.matchKey}, ${row.sku}, ${component.quantity},
            ${input.reflectedByUserId}::uuid, now()
          )
          ON CONFLICT (user_id, match_key) DO UPDATE SET
            sku = EXCLUDED.sku,
            quantity = EXCLUDED.quantity,
            reflected_by_user_id = EXCLUDED.reflected_by_user_id,
            reflected_at = now()
        `)
      }
    }

    if (reflected.length > 0) {
      await tx.delete(purchaseRequestItems).where(inArray(
        purchaseRequestItems.id,
        reflected.map((row) => row.id),
      ))
    }

    return {
      reflectedCount: reflected.length,
      reflectedQuantity: reflected.reduce((sum, row) => sum + row.quantity, 0),
    }
  })
}

function outboundComponents(rawData: Record<string, unknown>) {
  if (!Array.isArray(rawData.outboundComponents)) return []
  return rawData.outboundComponents.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const component = value as Record<string, unknown>
    const matchKey = typeof component.matchKey === 'string' ? component.matchKey.trim() : ''
    const quantity = Number(component.quantity)
    if (!matchKey || !Number.isFinite(quantity) || quantity <= 0) return []
    return [{ matchKey, quantity: Math.trunc(quantity) }]
  })
}
