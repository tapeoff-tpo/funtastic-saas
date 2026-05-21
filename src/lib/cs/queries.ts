import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { claims, inquiries } from '@/lib/db/schema'
import type { ClaimStatus, ClaimType } from '@/lib/orders/types'

type CountRow<T extends string> = {
  key: T
  value: number
}

export interface CsOverview {
  totalClaims: number
  openClaims: number
  unansweredInquiries: number
  claimsByType: Record<ClaimType, number>
  claimsByStatus: Record<ClaimStatus, number>
  recentUnansweredInquiries: CsInquiryRow[]
}

export interface CsInquiryRow {
  id: string
  marketplaceId: string
  marketplaceInquiryId: string
  marketplaceOrderId: string | null
  orderId: string | null
  inquiryType: string
  question: string
  requestedAt: Date
}

export interface CsInquiryListResult {
  inquiries: CsInquiryRow[]
  total: number
}

const CLAIM_TYPES: ClaimType[] = ['cancel', 'return', 'exchange']
const CLAIM_STATUSES: ClaimStatus[] = ['requested', 'processing', 'completed', 'rejected']

function emptyRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>
}

export async function getCsOverview(userId: string): Promise<CsOverview> {
  const [
    totalClaimRows,
    openClaimRows,
    unansweredInquiryRows,
    claimTypeRows,
    claimStatusRows,
    recentUnansweredInquiries,
  ] = await Promise.all([
    db.select({ value: count(claims.id) }).from(claims).where(eq(claims.userId, userId)),
    db
      .select({ value: count(claims.id) })
      .from(claims)
      .where(and(eq(claims.userId, userId), eq(claims.claimStatus, 'requested'))),
    db
      .select({ value: count(inquiries.id) })
      .from(inquiries)
      .where(and(eq(inquiries.userId, userId), isNull(inquiries.answeredAt))),
    db
      .select({ key: claims.claimType, value: count(claims.id) })
      .from(claims)
      .where(eq(claims.userId, userId))
      .groupBy(claims.claimType),
    db
      .select({ key: claims.claimStatus, value: count(claims.id) })
      .from(claims)
      .where(eq(claims.userId, userId))
      .groupBy(claims.claimStatus),
    db
      .select({
        id: inquiries.id,
        marketplaceId: inquiries.marketplaceId,
        marketplaceInquiryId: inquiries.marketplaceInquiryId,
        marketplaceOrderId: inquiries.marketplaceOrderId,
        orderId: inquiries.orderId,
        inquiryType: inquiries.inquiryType,
        question: inquiries.question,
        requestedAt: inquiries.requestedAt,
      })
      .from(inquiries)
      .where(and(eq(inquiries.userId, userId), isNull(inquiries.answeredAt)))
      .orderBy(desc(inquiries.requestedAt))
      .limit(20),
  ])

  const claimsByType = emptyRecord(CLAIM_TYPES)
  const claimsByStatus = emptyRecord(CLAIM_STATUSES)

  for (const row of claimTypeRows as CountRow<ClaimType>[]) {
    claimsByType[row.key] = row.value
  }
  for (const row of claimStatusRows as CountRow<ClaimStatus>[]) {
    claimsByStatus[row.key] = row.value
  }

  return {
    totalClaims: totalClaimRows[0]?.value ?? 0,
    openClaims: openClaimRows[0]?.value ?? 0,
    unansweredInquiries: unansweredInquiryRows[0]?.value ?? 0,
    claimsByType,
    claimsByStatus,
    recentUnansweredInquiries,
  }
}

export async function getUnansweredInquiries(
  userId: string,
  page = 1,
  pageSize = 50,
): Promise<CsInquiryListResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  const offset = (safePage - 1) * pageSize
  const [totalRows, rows] = await Promise.all([
    db
      .select({ value: count(inquiries.id) })
      .from(inquiries)
      .where(and(eq(inquiries.userId, userId), isNull(inquiries.answeredAt))),
    db
      .select({
        id: inquiries.id,
        marketplaceId: inquiries.marketplaceId,
        marketplaceInquiryId: inquiries.marketplaceInquiryId,
        marketplaceOrderId: inquiries.marketplaceOrderId,
        orderId: inquiries.orderId,
        inquiryType: inquiries.inquiryType,
        question: inquiries.question,
        requestedAt: inquiries.requestedAt,
      })
      .from(inquiries)
      .where(and(eq(inquiries.userId, userId), isNull(inquiries.answeredAt)))
      .orderBy(desc(inquiries.requestedAt))
      .limit(pageSize)
      .offset(offset),
  ])

  return {
    inquiries: rows,
    total: totalRows[0]?.value ?? 0,
  }
}
