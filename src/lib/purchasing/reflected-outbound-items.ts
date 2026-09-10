import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { purchaseRequestItems } from '@/lib/db/schema'

export const OUTBOUND_COMPLETED_SOURCE = 'ecount_purchasing_snapshot_outbound_completed'
export const COMPLETED_OUTBOUND_RETENTION_DAYS = 14

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type OutboundComponent = {
  matchKey: string
  quantity: number
}

type CompletedOutboundRow = {
  id: string
  sku: string
  quantity: number
  rawData: Record<string, unknown>
}

type ReflectedOutboundRow = CompletedOutboundRow & {
  components: OutboundComponent[]
}

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
  outboundDates?: string[]
}) {
  await ensureReflectedOutboundItemsTable()
  return db.transaction(async (tx) => {
    const outboundDates = selectedOutboundDates(input)
    const selection = outboundDates.length > 0
      ? inArray(purchaseRequestItems.outboundExpectedDate, outboundDates)
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

    const reflected = rows.flatMap(reflectedOutboundRows)
    if (reflected.length !== rows.length) {
      throw new Error('선택 항목 중 재업로드 방지 식별키가 없는 건이 있습니다.')
    }

    await saveReflectedOutboundRows(tx, input.userId, reflected, input.reflectedByUserId)

    if (reflected.length > 0) {
      await tx.delete(purchaseRequestItems).where(and(
        eq(purchaseRequestItems.userId, input.userId),
        eq(purchaseRequestItems.status, 'completed'),
        inArray(purchaseRequestItems.id, reflected.map((row) => row.id)),
      ))
    }

    return {
      reflectedCount: reflected.length,
      reflectedQuantity: reflected.reduce((sum, row) => sum + row.quantity, 0),
    }
  })
}

/**
 * Removes Ecount Chinese-outbound-completed rows after their date is 14 full
 * calendar days old in Korea. The re-upload prevention marker is persisted
 * before deleting the source row, so the next Ecount upload does not restore
 * it. This intentionally does not touch China inventory movements: completed
 * outbound rows have already left the China-warehouse balance.
 */
export async function cleanupExpiredCompletedOutboundItems(input: {
  userId: string
  reflectedByUserId?: string
  now?: Date
}) {
  const cutoffDate = completedOutboundCleanupCutoffDate(input.now)
  await ensureReflectedOutboundItemsTable()

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`completed-outbound-cleanup:${input.userId}`}))`)

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
        sql`${purchaseRequestItems.rawData}->>'source' = ${OUTBOUND_COMPLETED_SOURCE}`,
        sql`${purchaseRequestItems.outboundExpectedDate} IS NOT NULL`,
        lte(purchaseRequestItems.outboundExpectedDate, cutoffDate),
      ))

    const reflected = rows.flatMap(reflectedOutboundRows)
    await saveReflectedOutboundRows(tx, input.userId, reflected, input.reflectedByUserId)

    if (reflected.length > 0) {
      await tx.delete(purchaseRequestItems).where(and(
        eq(purchaseRequestItems.userId, input.userId),
        eq(purchaseRequestItems.status, 'completed'),
        inArray(purchaseRequestItems.id, reflected.map((row) => row.id)),
        lte(purchaseRequestItems.outboundExpectedDate, cutoffDate),
      ))
    }

    return {
      cutoffDate,
      reflectedCount: reflected.length,
      reflectedQuantity: reflected.reduce((sum, row) => sum + row.quantity, 0),
      skippedMissingMatchKeyCount: rows.length - reflected.length,
    }
  })
}

/** KST date-only cutoff, inclusive: a 14-day-old outbound row is expired. */
export function completedOutboundCleanupCutoffDate(
  now: Date = new Date(),
  retentionDays = COMPLETED_OUTBOUND_RETENTION_DAYS,
) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const year = Number(values.year)
  const month = Number(values.month)
  const day = Number(values.day)
  const cutoff = new Date(Date.UTC(year, month - 1, day - retentionDays))
  return cutoff.toISOString().slice(0, 10)
}

function selectedOutboundDates(input: {
  outboundDate?: string
  outboundDates?: string[]
}) {
  return [...new Set([
    ...(input.outboundDates ?? []),
    ...(input.outboundDate ? [input.outboundDate] : []),
  ])]
}

function reflectedOutboundRows(row: CompletedOutboundRow): ReflectedOutboundRow[] {
  const components = outboundComponents(row.rawData)
  if (components.length > 0) return [{ ...row, components }]

  const matchKey = typeof row.rawData.fallbackMatchKey === 'string'
    ? row.rawData.fallbackMatchKey.trim()
    : ''
  return matchKey ? [{ ...row, components: [{ matchKey, quantity: row.quantity }] }] : []
}

async function saveReflectedOutboundRows(
  tx: DbTransaction,
  userId: string,
  rows: ReflectedOutboundRow[],
  reflectedByUserId?: string,
) {
  const components = rows.flatMap((row) => row.components.map((component) => ({
    sku: row.sku,
    matchKey: component.matchKey,
    quantity: component.quantity,
  })))
  for (const chunk of chunks(components, 500)) {
    await tx.execute(sql`
      INSERT INTO purchasing_reflected_outbound_items (
        user_id, match_key, sku, quantity, reflected_by_user_id, reflected_at
      ) VALUES ${sql.join(chunk.map((component) => sql`(
        ${userId}::uuid,
        ${component.matchKey},
        ${component.sku},
        ${component.quantity},
        ${reflectedByUserId ?? null}::uuid,
        now()
      )`), sql`, `)}
      ON CONFLICT (user_id, match_key) DO UPDATE SET
        sku = EXCLUDED.sku,
        quantity = EXCLUDED.quantity,
        reflected_by_user_id = EXCLUDED.reflected_by_user_id,
        reflected_at = now()
    `)
  }
}

function chunks<T>(values: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function outboundComponents(rawData: Record<string, unknown>): OutboundComponent[] {
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
