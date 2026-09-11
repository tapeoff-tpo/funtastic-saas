import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  chinaWarehouseInventoryMovements,
  purchaseRequestItems,
} from '@/lib/db/schema'
import { ensurePurchasePaymentTrackingSchema } from './purchase-payment-tracking'

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000
const PURCHASE_ORDER_RETENTION_MONTHS = 2
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type PurchaseOrderRetentionCleanupResult = {
  cutoffDate: string
  deletedCount: number
  skippedMovementCount: number
}

/**
 * Returns the Korean calendar date two months before `now`.
 *
 * The day is clamped to the last day of the target month. For example,
 * April 30 becomes February 28 (or 29 in a leap year).
 */
export function getPurchaseOrderRetentionCutoffDate(now = new Date()): string {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('A valid date is required to calculate the purchase-order retention cutoff.')
  }

  const kstNow = new Date(now.getTime() + KST_OFFSET_MS)
  const currentYear = kstNow.getUTCFullYear()
  const currentMonth = kstNow.getUTCMonth()
  const currentDay = kstNow.getUTCDate()
  const targetMonthStart = new Date(Date.UTC(
    currentYear,
    currentMonth - PURCHASE_ORDER_RETENTION_MONTHS,
    1,
  ))
  const targetYear = targetMonthStart.getUTCFullYear()
  const targetMonth = targetMonthStart.getUTCMonth()
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const targetDay = Math.min(currentDay, lastDayOfTargetMonth)

  return [
    targetYear.toString().padStart(4, '0'),
    (targetMonth + 1).toString().padStart(2, '0'),
    targetDay.toString().padStart(2, '0'),
  ].join('-')
}

/**
 * Deletes only stale, raw-data-managed Ecount rows that carry a supplier order number.
 * Rows connected to a China-warehouse movement are deliberately retained so
 * inventory history can never be removed by this maintenance operation.
 * Active China-outbound rows use their outbound date so a recently shipped
 * order is not removed merely because its original purchase date is old.
 */
export async function cleanupExpiredEcountPurchaseOrderRows(input: {
  userId: string
  now?: Date
}): Promise<PurchaseOrderRetentionCleanupResult> {
  await ensurePurchasePaymentTrackingSchema()
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtext(${`ecount-purchasing-sync:${input.userId}`})::bigint
      )
    `)

    return cleanupExpiredEcountPurchaseOrderRowsInTransaction(tx, input)
  })
}

/** Runs cleanup inside a caller-owned transaction that already holds the sync lock. */
export async function cleanupExpiredEcountPurchaseOrderRowsInTransaction(
  tx: DbTransaction,
  input: { userId: string; now?: Date },
): Promise<PurchaseOrderRetentionCleanupResult> {
  const cutoffDate = getPurchaseOrderRetentionCutoffDate(input.now)
  const retentionDate = sql`CASE
    WHEN ${purchaseRequestItems.status} = 'outbound_requested'
      THEN COALESCE(${purchaseRequestItems.outboundExpectedDate}, ${purchaseRequestItems.requestDate})
    ELSE COALESCE(${purchaseRequestItems.requestDate}, ${purchaseRequestItems.outboundExpectedDate})
  END`

  type CleanupCountRow = {
    deletedCount: number | string
    skippedMovementCount: number | string
  }
  const result = await tx.execute<CleanupCountRow>(sql`
      WITH candidates AS MATERIALIZED (
        SELECT
          ${purchaseRequestItems.id} AS id,
          EXISTS (
            SELECT 1
            FROM ${chinaWarehouseInventoryMovements}
            WHERE ${chinaWarehouseInventoryMovements.purchaseRequestItemId} = ${purchaseRequestItems.id}
          ) AS has_inventory_movement
        FROM ${purchaseRequestItems}
        WHERE ${purchaseRequestItems.userId} = ${input.userId}::uuid
          AND NULLIF(BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')), '') IS NOT NULL
          AND COALESCE(${purchaseRequestItems.bulkPaymentPending}, false) = false
          AND ${purchaseRequestItems.status} <> 'completed'
          AND (
            starts_with(
              COALESCE(${purchaseRequestItems.rawData}->>'source', ''),
              'ecount_purchasing_snapshot_'
            )
            OR ${purchaseRequestItems.rawData}->>'source' = 'ecount_purchasing_replacement'
          )
          AND ${retentionDate} IS NOT NULL
          AND ${retentionDate} < ${cutoffDate}::date
      ),
      deleted AS (
        DELETE FROM ${purchaseRequestItems}
        USING candidates
        WHERE ${purchaseRequestItems.id} = candidates.id
          AND candidates.has_inventory_movement = false
        RETURNING ${purchaseRequestItems.id}
      )
      SELECT
        (SELECT COUNT(*)::int FROM deleted) AS "deletedCount",
        (
          SELECT COUNT(*)::int
          FROM candidates
          WHERE has_inventory_movement = true
        ) AS "skippedMovementCount"
    `)
  const rows = Array.isArray(result)
    ? result as unknown as CleanupCountRow[]
    : ((result as unknown as { rows?: CleanupCountRow[] }).rows ?? [])
  const row = rows[0]

  return {
    cutoffDate,
    deletedCount: Number(row?.deletedCount ?? 0),
    skippedMovementCount: Number(row?.skippedMovementCount ?? 0),
  }
}
