import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import type { OrderCollectionJobData } from '../queues'
import { db } from '@/lib/db'
import {
  orders,
  orderItems,
  claims,
  jobLogs,
} from '@/lib/db/schema'
import { readCredential } from '@/lib/supabase/admin'
import { CoupangAdapter } from '@/lib/marketplace/adapters/coupang/adapter'
import { NaverAdapter } from '@/lib/marketplace/adapters/naver/adapter'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import '@/lib/marketplace/adapters/configs'
import type {
  MarketplaceAdapter,
  NormalizedOrder,
  NormalizedClaim,
} from '@/lib/marketplace/types'

/**
 * Create a marketplace adapter instance with credentials.
 *
 * Instantiates the correct adapter class based on marketplaceId,
 * passing the Vault-retrieved credentials for API authentication.
 */
export function createAdapter(
  marketplaceId: string,
  credentials: Record<string, string>
): Pick<MarketplaceAdapter, 'config' | 'getOrders' | 'getClaimsOrders'> {
  switch (marketplaceId) {
    case 'coupang':
      return new CoupangAdapter({
        access_key: credentials.access_key ?? credentials.accessKey ?? '',
        secret_key: credentials.secret_key ?? credentials.secretKey ?? '',
        vendor_id: credentials.vendor_id ?? credentials.vendorId ?? '',
      })
    case 'naver':
      return new NaverAdapter({
        client_id: credentials.client_id ?? credentials.clientId ?? '',
        client_secret: credentials.client_secret ?? credentials.clientSecret ?? '',
      })
    default:
      throw new Error(`Unknown marketplace: ${marketplaceId}. No adapter registered.`)
  }
}

/**
 * Standalone order collection — no BullMQ dependency.
 * Used by both the BullMQ worker and the manual collection API route.
 */
export async function collectOrdersForConnection(params: {
  marketplaceId: string
  connectionId: string
  userId: string
  jobType?: string
}): Promise<{ ordersCollected: number; claimsCollected: number }> {
  const { marketplaceId, connectionId, userId, jobType = 'order-collection' } = params

  // 1. Create job log entry
  const [jobLog] = await db
    .insert(jobLogs)
    .values({
      jobType,
      marketplaceId,
      connectionId,
      status: 'running',
      startedAt: new Date(),
    })
    .returning({ id: jobLogs.id })

  let ordersCollected = 0
  let claimsCollected = 0

  try {
    // 2. Read credentials from Vault
    const adapterConfig = marketplaceRegistry.get(marketplaceId)
    const requiredCreds = adapterConfig.config.requiredCredentials
    const credentials: Record<string, string> = {}

    for (const credKey of requiredCreds) {
      const value = await readCredential(marketplaceId, userId, credKey)
      if (!value) {
        throw new Error(
          `Missing credential "${credKey}" for ${marketplaceId} (user: ${userId})`
        )
      }
      credentials[credKey] = value
    }

    // 3. Create adapter with credentials
    const adapter = createAdapter(marketplaceId, credentials)

    // 4. Fetch orders (15-minute overlap window for safety)
    const since = new Date(Date.now() - 15 * 60 * 1000)
    const normalizedOrders = await adapter.getOrders(since)

    // UPSERT each order with deduplication on (marketplace_id, marketplace_order_id)
    for (const order of normalizedOrders) {
      const [upsertedOrder] = await upsertOrder(order, connectionId, userId)
      // Re-insert order items (delete existing first to handle updates)
      await db.delete(orderItems).where(eq(orderItems.orderId, upsertedOrder.id))
      if (order.items.length > 0) {
        await db.insert(orderItems).values(
          order.items.map((item) => ({
            orderId: upsertedOrder.id,
            marketplaceItemId: item.marketplaceItemId,
            productName: item.productName,
            optionText: item.optionText,
            quantity: item.quantity,
            unitPrice: String(item.unitPrice),
            sku: item.sku,
          }))
        )
      }
      ordersCollected++
    }

    // 5. Fetch claims (per D-09: collected alongside orders)
    const normalizedClaims = await adapter.getClaimsOrders(since)

    for (const claim of normalizedClaims) {
      const wasUpserted = await upsertClaim(claim, userId)
      if (wasUpserted) {
        claimsCollected++
      }
    }

    // 6. Update job log with success
    await db
      .insert(jobLogs)
      .values({
        id: jobLog.id,
        jobType,
        marketplaceId,
        connectionId,
        status: 'completed',
        ordersCollected,
        claimsCollected,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [jobLogs.id],
        set: {
          status: 'completed',
          ordersCollected,
          claimsCollected,
          completedAt: new Date(),
        },
      })

    return { ordersCollected, claimsCollected }
  } catch (error) {
    // Log error to job_logs
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    await db
      .insert(jobLogs)
      .values({
        id: jobLog.id,
        jobType,
        marketplaceId,
        connectionId,
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [jobLogs.id],
        set: {
          status: 'failed',
          errorMessage,
          completedAt: new Date(),
        },
      })

    throw error
  }
}

/**
 * BullMQ job handler — delegates to collectOrdersForConnection.
 */
export async function processOrderCollection(
  job: Job<OrderCollectionJobData>
): Promise<{ ordersCollected: number; claimsCollected: number }> {
  return collectOrdersForConnection(job.data)
}

/**
 * UPSERT a normalized order into the database.
 * Deduplicates on (marketplace_id, marketplace_order_id) per D-04.
 * Preserves raw marketplace data per D-03.
 */
async function upsertOrder(
  order: NormalizedOrder,
  connectionId: string,
  userId: string
) {
  return db
    .insert(orders)
    .values({
      userId,
      connectionId,
      marketplaceId: order.marketplaceId,
      marketplaceOrderId: order.marketplaceOrderId,
      status: order.status,
      marketplaceStatus: order.marketplaceStatus,
      buyerName: order.buyerName,
      buyerPhone: order.buyerPhone,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      shippingAddress: order.shippingAddress,
      orderedAt: order.orderedAt,
      totalAmount: String(order.totalAmount),
      rawData: order.rawData,
      collectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [orders.marketplaceId, orders.marketplaceOrderId],
      set: {
        status: order.status,
        marketplaceStatus: order.marketplaceStatus,
        rawData: order.rawData,
        updatedAt: new Date(),
      },
    })
    .returning({ id: orders.id })
}

/**
 * UPSERT a normalized claim into the database.
 * Looks up the orderId from the orders table using marketplaceOrderId.
 * Deduplicates on (marketplace_id, marketplace_claim_id) per D-04.
 */
async function upsertClaim(
  claim: NormalizedClaim,
  userId: string
): Promise<boolean> {
  // Look up orderId from marketplace order ID
  const matchingOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.marketplaceId, claim.marketplaceId),
        eq(orders.marketplaceOrderId, claim.marketplaceOrderId)
      )
    )

  if (matchingOrders.length === 0) {
    console.warn(
      `[OrderCollector] Skipping claim ${claim.marketplaceClaimId}: ` +
        `no matching order found for ${claim.marketplaceOrderId}`
    )
    return false
  }

  const orderId = matchingOrders[0].id

  await db
    .insert(claims)
    .values({
      orderId,
      userId,
      marketplaceId: claim.marketplaceId,
      marketplaceClaimId: claim.marketplaceClaimId,
      claimType: claim.claimType,
      claimStatus: claim.claimStatus,
      reason: claim.reason,
      rawData: claim.rawData,
      requestedAt: claim.requestedAt,
    })
    .onConflictDoUpdate({
      target: [claims.marketplaceId, claims.marketplaceClaimId],
      set: {
        claimStatus: claim.claimStatus,
        reason: claim.reason,
        rawData: claim.rawData,
        updatedAt: new Date(),
      },
    })

  return true
}
