import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { claims, inquiries, orderItems, orders } from '@/lib/db/schema'
import { MARKETPLACE_DISPLAY_NAMES } from '@/lib/marketplace/collect-options'
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

export type CsTicketSource = 'claim' | 'inquiry'
export type CsWorkstream = 'cs' | 'logistics' | 'marketplace'

export interface CsFilters {
  source?: CsTicketSource | 'all'
  workstream?: CsWorkstream | 'all'
  marketplace?: string
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export interface CsTicket {
  id: string
  source: CsTicketSource
  workstream: CsWorkstream
  title: string
  description: string | null
  status: string
  statusLabel: string
  type: string
  typeLabel: string
  marketplaceId: string
  marketplaceName: string
  marketplaceReferenceId: string
  orderId: string | null
  internalNo: string | null
  marketplaceOrderId: string | null
  buyerName: string | null
  recipientName: string | null
  productName: string | null
  requestedAt: Date
  updatedAt: Date
  needsLogistics: boolean
  needsMarketplaceReply: boolean
}

export interface CsTicketStats {
  total: number
  open: number
  logistics: number
  marketplaceReply: number
  completed: number
}

export interface CsTicketResult {
  tickets: CsTicket[]
  stats: CsTicketStats
  total: number
  marketplaces: Array<{ value: string; label: string }>
}

const CLAIM_TYPES: ClaimType[] = ['cancel', 'return', 'exchange']
const CLAIM_STATUSES: ClaimStatus[] = ['requested', 'processing', 'completed', 'rejected', 'withdrawn']

const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
}

const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  requested: '신규',
  processing: '처리중',
  completed: '완료',
  rejected: '반려',
  withdrawn: '철회',
}

const INQUIRY_TYPE_LABELS: Record<string, string> = {
  product: '상품문의',
  callcenter: '고객문의',
  online: '온라인문의',
}

function emptyRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>
}

function marketplaceName(marketplaceId: string) {
  return MARKETPLACE_DISPLAY_NAMES[marketplaceId] ?? marketplaceId
}

function ticketHaystack(ticket: CsTicket) {
  return [
    ticket.title,
    ticket.description,
    ticket.marketplaceName,
    ticket.marketplaceReferenceId,
    ticket.marketplaceOrderId,
    ticket.internalNo,
    ticket.buyerName,
    ticket.recipientName,
    ticket.productName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function matchesWorkstream(ticket: CsTicket, workstream?: CsWorkstream | 'all') {
  if (!workstream || workstream === 'all') return true
  if (workstream === 'logistics') return ticket.needsLogistics
  if (workstream === 'marketplace') return ticket.needsMarketplaceReply
  return ticket.workstream === workstream
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

export async function getCsTickets(
  userId: string,
  filters: CsFilters = {},
): Promise<CsTicketResult> {
  const page = Math.max(filters.page ?? 1, 1)
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 10), 100)

  const claimRows = await db
    .select({
      id: claims.id,
      orderId: claims.orderId,
      marketplaceId: claims.marketplaceId,
      marketplaceClaimId: claims.marketplaceClaimId,
      claimType: claims.claimType,
      claimStatus: claims.claimStatus,
      reason: claims.reason,
      requestedAt: claims.requestedAt,
      updatedAt: claims.updatedAt,
      internalNo: orders.internalNo,
      marketplaceOrderId: orders.marketplaceOrderId,
      buyerName: orders.buyerName,
      recipientName: orders.recipientName,
    })
    .from(claims)
    .innerJoin(orders, eq(claims.orderId, orders.id))
    .where(eq(claims.userId, userId))
    .orderBy(desc(claims.requestedAt))
    .limit(300)

  const inquiryRows = await db
    .select({
      id: inquiries.id,
      orderId: inquiries.orderId,
      marketplaceId: inquiries.marketplaceId,
      marketplaceInquiryId: inquiries.marketplaceInquiryId,
      marketplaceOrderId: inquiries.marketplaceOrderId,
      inquiryType: inquiries.inquiryType,
      question: inquiries.question,
      answeredAt: inquiries.answeredAt,
      requestedAt: inquiries.requestedAt,
      updatedAt: inquiries.updatedAt,
      orderInternalNo: orders.internalNo,
      orderMarketplaceOrderId: orders.marketplaceOrderId,
      buyerName: orders.buyerName,
      recipientName: orders.recipientName,
    })
    .from(inquiries)
    .leftJoin(orders, eq(inquiries.orderId, orders.id))
    .where(eq(inquiries.userId, userId))
    .orderBy(desc(inquiries.requestedAt))
    .limit(300)

  const orderIds = Array.from(
    new Set([
      ...claimRows.map((row) => row.orderId),
      ...inquiryRows.map((row) => row.orderId).filter((id): id is string => Boolean(id)),
    ]),
  )

  const productNameByOrderId = new Map<string, string>()
  if (orderIds.length > 0) {
    const itemRows = await db
      .select({
        orderId: orderItems.orderId,
        productName: orderItems.productName,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))

    for (const row of itemRows) {
      if (!productNameByOrderId.has(row.orderId)) {
        productNameByOrderId.set(row.orderId, row.productName)
      }
    }
  }

  const claimTickets: CsTicket[] = claimRows.map((row) => {
    const type = row.claimType as ClaimType
    const status = row.claimStatus as ClaimStatus
    const needsLogistics = type === 'return' || type === 'exchange'
    const needsMarketplaceReply = status === 'requested' || status === 'processing'
    return {
      id: row.id,
      source: 'claim',
      workstream: needsLogistics ? 'logistics' : 'cs',
      title: `${CLAIM_TYPE_LABELS[type] ?? type} 요청`,
      description: row.reason,
      status,
      statusLabel: CLAIM_STATUS_LABELS[status] ?? status,
      type,
      typeLabel: CLAIM_TYPE_LABELS[type] ?? type,
      marketplaceId: row.marketplaceId,
      marketplaceName: marketplaceName(row.marketplaceId),
      marketplaceReferenceId: row.marketplaceClaimId,
      orderId: row.orderId,
      internalNo: row.internalNo,
      marketplaceOrderId: row.marketplaceOrderId,
      buyerName: row.buyerName,
      recipientName: row.recipientName,
      productName: productNameByOrderId.get(row.orderId) ?? null,
      requestedAt: row.requestedAt,
      updatedAt: row.updatedAt,
      needsLogistics,
      needsMarketplaceReply,
    }
  })

  const inquiryTickets: CsTicket[] = inquiryRows.map((row) => {
    const answered = Boolean(row.answeredAt)
    const orderId = row.orderId
    const marketplaceOrderId = row.orderMarketplaceOrderId ?? row.marketplaceOrderId
    return {
      id: row.id,
      source: 'inquiry',
      workstream: 'cs',
      title: INQUIRY_TYPE_LABELS[row.inquiryType] ?? row.inquiryType,
      description: row.question,
      status: answered ? 'completed' : 'requested',
      statusLabel: answered ? '답변완료' : '미답변',
      type: row.inquiryType,
      typeLabel: INQUIRY_TYPE_LABELS[row.inquiryType] ?? row.inquiryType,
      marketplaceId: row.marketplaceId,
      marketplaceName: marketplaceName(row.marketplaceId),
      marketplaceReferenceId: row.marketplaceInquiryId,
      orderId,
      internalNo: row.orderInternalNo,
      marketplaceOrderId,
      buyerName: row.buyerName,
      recipientName: row.recipientName,
      productName: orderId ? productNameByOrderId.get(orderId) ?? null : null,
      requestedAt: row.requestedAt,
      updatedAt: row.updatedAt,
      needsLogistics: false,
      needsMarketplaceReply: !answered,
    }
  })

  const allTickets = [...claimTickets, ...inquiryTickets].sort(
    (a, b) => b.requestedAt.getTime() - a.requestedAt.getTime(),
  )

  const stats: CsTicketStats = {
    total: allTickets.length,
    open: allTickets.filter((ticket) => !['completed', 'rejected', 'withdrawn'].includes(ticket.status)).length,
    logistics: allTickets.filter((ticket) => ticket.needsLogistics && !['completed', 'rejected', 'withdrawn'].includes(ticket.status)).length,
    marketplaceReply: allTickets.filter((ticket) => ticket.needsMarketplaceReply).length,
    completed: allTickets.filter((ticket) => ticket.status === 'completed').length,
  }

  const search = filters.search?.trim().toLowerCase()
  const filtered = allTickets.filter((ticket) => {
    if (filters.source && filters.source !== 'all' && ticket.source !== filters.source) return false
    if (!matchesWorkstream(ticket, filters.workstream)) return false
    if (filters.marketplace && ticket.marketplaceId !== filters.marketplace) return false
    if (filters.status && ticket.status !== filters.status) return false
    if (search && !ticketHaystack(ticket).includes(search)) return false
    return true
  })

  const marketplaces = Array.from(
    new Map(allTickets.map((ticket) => [ticket.marketplaceId, ticket.marketplaceName])),
    ([value, label]) => ({ value, label }),
  ).sort((a, b) => a.label.localeCompare(b.label, 'ko-KR'))

  const offset = (page - 1) * pageSize

  return {
    tickets: filtered.slice(offset, offset + pageSize),
    stats,
    total: filtered.length,
    marketplaces,
  }
}
