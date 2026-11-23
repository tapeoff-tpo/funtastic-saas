import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { orders, products } from '@/lib/db/schema'

/** One round trip for the cards, without scanning every historical order.
 * Keep the all-time counters as independent, indexable subqueries; only the
 * monthly counters and sales share the main, date-bounded order scan.
 */
export async function getDashboardSummary(
  workspaceUserId: string,
  { monthStart, dayStart, dayEnd }: { monthStart: Date; dayStart: Date; dayEnd: Date },
) {
  const newOrders = db.select({ count: sql<number>`count(*)::int` }).from(orders)
    .where(and(eq(orders.userId, workspaceUserId), eq(orders.status, 'new')))
  const heldOrders = db.select({ count: sql<number>`count(*)::int` }).from(orders)
    .where(and(eq(orders.userId, workspaceUserId), eq(orders.isHeld, true)))
  const allProducts = db.select({ count: sql<number>`count(*)::int` }).from(products)
    .where(eq(products.userId, workspaceUserId))

  const [summary] = await db.select({
    newOrderCount: sql<number>`(${newOrders})`,
    heldOrderCount: sql<number>`(${heldOrders})`,
    productCount: sql<number>`(${allProducts})`,
    monthOrderCount: sql<number>`count(*)::int`,
    todaySales: sql<string>`coalesce(sum(${orders.totalAmount}) FILTER (
      WHERE ${orders.orderedAt} >= ${dayStart.toISOString()}::timestamptz
        AND ${orders.orderedAt} < ${dayEnd.toISOString()}::timestamptz
    ), 0)::text`,
    monthSales: sql<string>`coalesce(sum(${orders.totalAmount}), 0)::text`,
  }).from(orders).where(and(eq(orders.userId, workspaceUserId), gte(orders.orderedAt, monthStart)))

  return {
    newOrderCount: summary?.newOrderCount ?? 0,
    heldOrderCount: summary?.heldOrderCount ?? 0,
    productCount: summary?.productCount ?? 0,
    monthOrderCount: summary?.monthOrderCount ?? 0,
    todaySales: Number(summary?.todaySales ?? 0),
    monthSales: Number(summary?.monthSales ?? 0),
  }
}
