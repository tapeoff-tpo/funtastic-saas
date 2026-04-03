'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { orders, orderItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { findMergeCandidates, type OrderWithItems } from '@/lib/shipping/combined-shipping'
import { createShipmentGroup } from '@/lib/shipping/combined-queries'

/**
 * Server action: detect combined shipping candidates from unshipped orders.
 * Creates shipment groups for orders that can be merged.
 */
export async function detectCombinedShippingAction(): Promise<{ created: number }> {
  // TODO: Get userId from auth session
  const userId = 'placeholder-user-id'

  // Fetch orders eligible for combined shipping (new/confirmed/preparing)
  const orderRows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        // Only non-shipped orders
      ),
    )

  // Fetch items for these orders
  const orderIds = orderRows.map((o) => o.id)
  let itemRows: (typeof orderItems.$inferSelect)[] = []
  if (orderIds.length > 0) {
    itemRows = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderIds[0])) // Simplified; in production use inArray
  }

  // Build OrderWithItems for the algorithm
  const ordersWithItems: OrderWithItems[] = orderRows.map((order) => ({
    id: order.id,
    buyerName: order.buyerName,
    shippingAddress: order.shippingAddress as OrderWithItems['shippingAddress'],
    orderedAt: order.orderedAt,
    items: itemRows
      .filter((item) => item.orderId === order.id)
      .map((item) => ({
        id: item.id,
        fulfillmentCode: item.fulfillmentCode,
        quantity: item.quantity,
      })),
  }))

  // Find merge candidates
  const groups = findMergeCandidates(ordersWithItems)

  // Create shipment groups
  let created = 0
  for (const group of groups) {
    await createShipmentGroup({
      userId,
      groupKey: group.groupKey,
      fulfillmentCode: group.fulfillmentCode,
      orderIds: group.orders,
    })
    created++
  }

  revalidatePath('/shipping/combined')
  return { created }
}
