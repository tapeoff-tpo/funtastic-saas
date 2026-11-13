import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { purchaseRequestItems } from '@/lib/db/schema'
import { ensurePurchasePaymentTrackingSchema } from './purchase-payment-tracking'
import type { PurchaseInspection } from './purchase-inspection'

export function isPurchaseTrackingLookupBlocked(mode: 'initial' | 'recollect', inspection: PurchaseInspection | null, receivedQuantity: number | null) {
  if (mode === 'initial') return Boolean(inspection)
  if (!inspection) return true
  return Boolean(inspection.hasReportedIssue || inspection.checkedAt || inspection.checkedBy || inspection.resolutionNote.trim())
    || receivedQuantity !== null
    || inspection.parcels.some((parcel) => parcel.boxes.some((box) => (
      box.quantity !== null || box.lengthCm !== null || box.widthCm !== null || box.heightCm !== null || box.weightKg !== null
    )))
}

/** Load the complete stage independently of table pagination and selection. */
export async function getPurchase1688TrackingCandidates(userId: string, mode: 'initial' | 'recollect') {
  await ensurePurchasePaymentTrackingSchema()
  const rows = await db.select({
    id: purchaseRequestItems.id,
    sku: purchaseRequestItems.sku,
    productName: purchaseRequestItems.productName,
    optionName: purchaseRequestItems.optionName,
    supplierOrderNumber: purchaseRequestItems.supplierOrderNumber,
    trackingNumber: purchaseRequestItems.trackingNumber,
    purchaseInspection: purchaseRequestItems.purchaseInspection,
    chinaReceivedQuantity: purchaseRequestItems.chinaReceivedQuantity,
  }).from(purchaseRequestItems).where(and(
    eq(purchaseRequestItems.userId, userId),
    eq(purchaseRequestItems.status, mode === 'initial' ? 'purchase_completed' : 'inspecting'),
  )).orderBy(desc(purchaseRequestItems.updatedAt), asc(purchaseRequestItems.id))
  return rows.map(({ purchaseInspection, chinaReceivedQuantity, ...candidate }) => ({
    ...candidate,
    trackingNumber: candidate.trackingNumber?.trim() ? candidate.trackingNumber : purchaseInspection?.parcels[0]?.trackingNumber ?? null,
    lookupBlocked: isPurchaseTrackingLookupBlocked(mode, purchaseInspection, chinaReceivedQuantity),
  }))
}
