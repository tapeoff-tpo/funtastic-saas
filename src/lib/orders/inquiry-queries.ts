/**
 * Phase 8 — Marketplace inquiries queries.
 *
 * Two responsibilities:
 *   1. upsertInquiries: bulk upsert NormalizedInquiry[] from a worker run.
 *      - Uses unique (user_id, marketplace_id, marketplace_inquiry_id) for dedup.
 *      - Best-effort resolves order_id by matching marketplace_order_id within
 *        the same user + marketplace. NULL when no match (per migration 013
 *        ON DELETE SET NULL semantics).
 *   2. listInquiriesByOrderIds: bulk lookup for orders UI to attach inquiry
 *      indicators to order rows (Phase 8 SC-03).
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { inquiries, orders } from '@/lib/db/schema'
import type { NormalizedInquiry } from '@/lib/marketplace/types'

export async function upsertInquiries(
  userId: string,
  marketplaceId: string,
  items: NormalizedInquiry[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0
  let updated = 0

  for (const item of items) {
    // Best-effort order_id resolution. NULL when not found.
    let orderId: string | null = null
    if (item.marketplaceOrderId) {
      const [match] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.userId, userId),
            eq(orders.marketplaceId, marketplaceId),
            eq(orders.marketplaceOrderId, item.marketplaceOrderId),
          ),
        )
        .limit(1)
      orderId = match?.id ?? null
    }

    const result = await db
      .insert(inquiries)
      .values({
        userId,
        marketplaceId,
        marketplaceInquiryId: item.marketplaceInquiryId,
        marketplaceOrderId: item.marketplaceOrderId ?? null,
        orderId,
        inquiryType: item.inquiryType,
        question: item.question,
        answeredAt: item.answeredAt ?? null,
        requestedAt: item.requestedAt,
        rawData: item.rawData,
      })
      .onConflictDoUpdate({
        target: [
          inquiries.userId,
          inquiries.marketplaceId,
          inquiries.marketplaceInquiryId,
        ],
        set: {
          answeredAt: item.answeredAt ?? null,
          rawData: item.rawData,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({
        id: inquiries.id,
        createdAt: inquiries.createdAt,
        updatedAt: inquiries.updatedAt,
      })

    const row = result[0]
    if (row && row.createdAt.getTime() === row.updatedAt.getTime()) {
      inserted++
    } else {
      updated++
    }
  }

  return { inserted, updated }
}

/**
 * Phase 8 — bulk fetch inquiries for a list of order IDs (orders UI integration).
 * Returns rows linked via inquiries.order_id — orders without resolved
 * inquiries.order_id will not appear.
 */
export async function listInquiriesByOrderIds(orderIds: string[]) {
  if (orderIds.length === 0) return []
  return db.select().from(inquiries).where(inArray(inquiries.orderId, orderIds))
}
