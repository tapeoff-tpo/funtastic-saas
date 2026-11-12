import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getLatestCnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import { ensurePurchasePaymentTrackingSchema } from './purchase-payment-tracking'
import { ensurePurchaseInspectionIssueSchema } from './purchase-inspection-issues'
import { ensurePurchaseFundLedgerSchema, reconcilePurchaseFundDebitsInTransaction } from './purchase-fund-ledger'
import type { PurchaseInspection } from './purchase-inspection'

export const inspectionPurchaseCorrectionSchema = z.object({
  issueId: z.string().uuid(),
  actualPurchaseQuantity: z.number().int().min(0).max(1_000_000),
  reason: z.string().trim().min(1).max(2_000),
  expectedRevision: z.number().int().min(0),
}).strict()

type Current = {
  status: string; actualPurchaseQuantity: number | null; requestedQuantity: number
  inspection: PurchaseInspection | null; rawData: Record<string, unknown>
}

function rows<T>(result: T[] | { rows?: T[] }) { return Array.isArray(result) ? result : result.rows ?? [] }

/** An explicit issue-linked purchase correction, never a received-stock edit. */
export async function correctInspectionPurchaseQuantity(input: {
  userId: string; actorId: string; id: string; data: unknown
}) {
  const data = inspectionPurchaseCorrectionSchema.parse(input.data)
  const [, , , rate] = await Promise.all([
    ensurePurchasePaymentTrackingSchema(), ensurePurchaseInspectionIssueSchema(),
    ensurePurchaseFundLedgerSchema(), getLatestCnyKrwReferenceRate(),
  ])
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)
    const [current] = rows<Current>(await tx.execute(sql`
      SELECT status::text AS status, actual_purchase_quantity AS "actualPurchaseQuantity",
        requested_quantity AS "requestedQuantity", purchase_inspection AS inspection, raw_data AS "rawData"
      FROM purchase_request_items
      WHERE id = ${input.id}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE
    `))
    if (!current) return null
    if (!['purchase_completed', 'inspecting'].includes(current.status) || !current.inspection) {
      throw new Error('중국창고도착 전 검수 항목만 구매수량을 정정할 수 있습니다.')
    }
    if (current.inspection.revision !== data.expectedRevision) {
      throw new Error('다른 작업자가 검수 정보를 변경했습니다. 다시 열어 확인해주세요.')
    }
    const [issue] = rows<{ id: string }>(await tx.execute(sql`
      SELECT id FROM purchase_inspection_issues
      WHERE id = ${data.issueId}::uuid AND user_id = ${input.userId}::uuid
        AND purchase_request_item_id = ${input.id}::uuid
    `))
    if (!issue) throw new Error('이 구매 건에 등록된 검수 오류를 선택해주세요.')
    const correction = {
      issueId: data.issueId, reason: data.reason, actorId: input.actorId, correctedAt: new Date().toISOString(),
      previousQuantity: current.actualPurchaseQuantity ?? current.requestedQuantity,
      previousExpectedQuantity: current.inspection.expectedQuantity,
      actualPurchaseQuantity: data.actualPurchaseQuantity,
    }
    const inspection: PurchaseInspection = {
      ...current.inspection, expectedQuantity: data.actualPurchaseQuantity,
      revision: current.inspection.revision + 1, checkedAt: null, checkedBy: null,
    }
    const previousCorrections = Array.isArray(current.rawData.inspectionPurchaseCorrections)
      ? current.rawData.inspectionPurchaseCorrections : []
    const rawData = { ...current.rawData, inspectionPurchaseCorrections: [...previousCorrections, correction] }
    await tx.execute(sql`
      UPDATE purchase_request_items SET actual_purchase_quantity = ${data.actualPurchaseQuantity},
        purchase_inspection = ${JSON.stringify(inspection)}::jsonb,
        raw_data = ${JSON.stringify(rawData)}::jsonb, status = 'inspecting', updated_at = now()
      WHERE id = ${input.id}::uuid AND user_id = ${input.userId}::uuid
    `)
    await reconcilePurchaseFundDebitsInTransaction(tx, {
      userId: input.userId, fallbackExchangeRateKrw: rate.rate, existingEntryMode: 'preserve',
    })
    return { id: input.id, actualPurchaseQuantity: data.actualPurchaseQuantity, inspection, correction }
  })
}
