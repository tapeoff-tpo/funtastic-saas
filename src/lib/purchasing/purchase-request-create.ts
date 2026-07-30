import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { purchaseRequestItems } from '@/lib/db/schema'

export type CreatePurchaseRequestInput = {
  userId: string
  sku: string
  productName: string
  optionName?: string | null
  requestedQuantity: number
  buyerCode?: string | null
  memo?: string | null
  createdFrom?: 'item_master' | 'purchasing_review'
}

const PURCHASE_BUYERS: Record<string, string> = {
  '1': '한상철',
  '2': '김기환',
  '3': '최종석',
  '4': '오지은',
  '5': '김소희',
}

export async function createPurchaseRequest(input: CreatePurchaseRequestInput) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${purchaseRequestWriteLockKey(input.userId)})::bigint)`)

    const [{ maxRowNumber }] = await tx
      .select({
        maxRowNumber: sql<number>`COALESCE(MAX(${purchaseRequestItems.rowNumber}), 0)::int`,
      })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.userId, input.userId))

    const [row] = await tx
      .insert(purchaseRequestItems)
      .values({
        userId: input.userId,
        rowNumber: maxRowNumber + 1,
        status: 'requested',
        sku: input.sku,
        productName: input.productName,
        optionName: input.optionName?.trim() || null,
        requestedQuantity: input.requestedQuantity,
        buyerCode: input.buyerCode?.trim() || null,
        buyerName: input.buyerCode ? PURCHASE_BUYERS[input.buyerCode] ?? null : null,
        purchaseMemo: input.memo?.trim() || null,
        rawData: {
          source: 'manual_purchase_request',
          createdFrom: input.createdFrom ?? 'purchasing_review',
        },
      })
      .returning({ id: purchaseRequestItems.id })

    return row
  })
}

export function purchaseRequestWriteLockKey(userId: string) {
  return `purchase-request-write:${userId}`
}
