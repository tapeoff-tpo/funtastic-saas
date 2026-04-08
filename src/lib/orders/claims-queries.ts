/**
 * Claims queries with server-side filtering and pagination.
 *
 * Used by the /orders/claims page to list, filter, and paginate claims.
 * Joins with orders and orderItems for display context.
 */

import { db } from '@/lib/db'
import { claims, orders, orderItems } from '@/lib/db/schema'
import { eq, and, desc, count, inArray } from 'drizzle-orm'
import type { ClaimType, ClaimStatus } from './types'

const DEFAULT_PAGE_SIZE = 50

export interface ClaimFilters {
  claimType?: ClaimType
  claimStatus?: ClaimStatus
  page?: number
  pageSize?: number
}

export interface ClaimWithOrder {
  // Claim fields
  id: string
  orderId: string
  userId: string
  marketplaceId: string
  marketplaceClaimId: string
  claimType: ClaimType
  claimStatus: ClaimStatus
  reason: string | null
  requestedAt: Date
  createdAt: Date
  updatedAt: Date
  // Joined order fields
  buyerName: string
  recipientName: string
  marketplaceOrderId: string
  // First item productName for context
  productName: string | null
}

/**
 * Get claims with filtering and pagination.
 * Returns claims joined with order context and first item product name.
 */
export async function getClaims(
  userId: string,
  filters: ClaimFilters = {},
): Promise<{ claims: ClaimWithOrder[]; total: number }> {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const offset = (page - 1) * pageSize

  // Build WHERE conditions
  const conditions = [eq(claims.userId, userId)]

  if (filters.claimType) {
    conditions.push(eq(claims.claimType, filters.claimType))
  }

  if (filters.claimStatus) {
    conditions.push(eq(claims.claimStatus, filters.claimStatus))
  }

  const whereClause = and(...conditions)

  // Fetch claims joined with orders
  const claimRows = await db
    .select({
      id: claims.id,
      orderId: claims.orderId,
      userId: claims.userId,
      marketplaceId: claims.marketplaceId,
      marketplaceClaimId: claims.marketplaceClaimId,
      claimType: claims.claimType,
      claimStatus: claims.claimStatus,
      reason: claims.reason,
      requestedAt: claims.requestedAt,
      createdAt: claims.createdAt,
      updatedAt: claims.updatedAt,
      buyerName: orders.buyerName,
      recipientName: orders.recipientName,
      marketplaceOrderId: orders.marketplaceOrderId,
    })
    .from(claims)
    .innerJoin(orders, eq(claims.orderId, orders.id))
    .where(whereClause)
    .orderBy(desc(claims.requestedAt))
    .limit(pageSize)
    .offset(offset)

  // Fetch first item productName per order (one query, then map)
  const orderIds = claimRows.map((r) => r.orderId)
  const productNameByOrderId = new Map<string, string>()

  if (orderIds.length > 0) {
    const itemRows = await db
      .select({
        orderId: orderItems.orderId,
        productName: orderItems.productName,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))

    // Keep only the first product name per order (items are unordered, take first seen)
    for (const row of itemRows) {
      if (!productNameByOrderId.has(row.orderId)) {
        productNameByOrderId.set(row.orderId, row.productName)
      }
    }
  }

  // Combine results
  const result: ClaimWithOrder[] = claimRows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    userId: row.userId,
    marketplaceId: row.marketplaceId,
    marketplaceClaimId: row.marketplaceClaimId,
    claimType: row.claimType as ClaimType,
    claimStatus: row.claimStatus as ClaimStatus,
    reason: row.reason,
    requestedAt: row.requestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    buyerName: row.buyerName,
    recipientName: row.recipientName,
    marketplaceOrderId: row.marketplaceOrderId,
    productName: productNameByOrderId.get(row.orderId) ?? null,
  }))

  // Get total count
  const [countResult] = await db
    .select({ value: count(claims.id) })
    .from(claims)
    .innerJoin(orders, eq(claims.orderId, orders.id))
    .where(whereClause)

  return {
    claims: result,
    total: countResult?.value ?? 0,
  }
}
