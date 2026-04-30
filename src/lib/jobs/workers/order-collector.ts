import type { Job } from 'bullmq'
import { and, eq, sql } from 'drizzle-orm'
import type { OrderCollectionJobData } from '../queues'
import { db } from '@/lib/db'
import {
  orders,
  orderItems,
  claims,
  jobLogs,
  marketplaceConnections,
} from '@/lib/db/schema'
import { readCredential, storeCredential } from '@/lib/supabase/admin'
import { CoupangAdapter } from '@/lib/marketplace/adapters/coupang/adapter'
import { NaverAdapter } from '@/lib/marketplace/adapters/naver/adapter'
import { TenByTenAdapter } from '@/lib/marketplace/adapters/10x10/adapter'
import { Cafe24Adapter } from '@/lib/marketplace/adapters/cafe24/adapter'
import { ElevenstAdapter } from '@/lib/marketplace/adapters/elevenst/adapter'
import { EsmAdapter } from '@/lib/marketplace/adapters/esm/adapter'
import { KakaoStoreAdapter } from '@/lib/marketplace/adapters/kakao-store/adapter'
import { TossShoppingAdapter } from '@/lib/marketplace/adapters/toss-shopping/adapter'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { generateInternalNo } from '@/lib/orders/internal-no'
import '@/lib/marketplace/adapters/configs'
import type {
  MarketplaceAdapter,
  MarketplaceOrderIdentity,
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
): Pick<MarketplaceAdapter, 'config' | 'getOrders' | 'getClaimsOrders' | 'confirmOrder' | 'uploadInvoice'> {
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
    case '10x10':
      return new TenByTenAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
        shop_id: credentials.shop_id ?? credentials.shopId ?? '',
      })
    case 'cafe24':
      return new Cafe24Adapter({
        access_token: credentials.access_token ?? '',
        mall_id: credentials.mall_id ?? '',
      })
    case 'elevenst':
      return new ElevenstAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
      })
    case 'kakao-store':
      return new KakaoStoreAdapter({
        admin_app_key: credentials.admin_app_key ?? credentials.adminAppKey ?? '',
        seller_app_key: credentials.seller_app_key ?? credentials.sellerAppKey ?? credentials.api_key ?? '',
        channel_ids: credentials.channel_ids ?? credentials.channelIds ?? '101',
      })
    case 'gmarket':
      return new EsmAdapter({
        master_id: credentials.master_id ?? credentials.masterId ?? '',
        secret_key: credentials.secret_key ?? credentials.secretKey ?? '',
        seller_id: credentials.seller_id ?? credentials.sellerId ?? '',
        site_type: 'G',
      })
    case 'auction':
      return new EsmAdapter({
        master_id: credentials.master_id ?? credentials.masterId ?? '',
        secret_key: credentials.secret_key ?? credentials.secretKey ?? '',
        seller_id: credentials.seller_id ?? credentials.sellerId ?? '',
        site_type: 'A',
      })
    case 'toss-shopping':
      return new TossShoppingAdapter({
        access_key: credentials.access_key ?? credentials.accessKey ?? '',
        secret_key: credentials.secret_key ?? credentials.secretKey ?? '',
      })
    default:
      throw new Error(`Unknown marketplace: ${marketplaceId}. No adapter registered.`)
  }
}

function shouldAutoConfirmOrders(): boolean {
  return process.env.MARKETPLACE_AUTO_CONFIRM_ON_COLLECT === '1'
}

async function refreshCafe24AccessToken(params: {
  userId: string
  credentials: Record<string, string>
  aliasTag: string
}): Promise<void> {
  const { userId, credentials, aliasTag } = params
  const clientId = credentials.client_id
  const clientSecret = credentials.client_secret
  const mallId = credentials.mall_id
  const refreshToken = await readCredential('cafe24', userId, `refresh_token${aliasTag}`)

  if (!clientId || !clientSecret || !mallId || !refreshToken) return

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 400 && body.includes('invalid_grant')) {
      throw new Error('Cafe24 재연동이 필요합니다. 저장된 refresh_token이 만료되었거나 무효화되었습니다.')
    }
    throw new Error(`Cafe24 token refresh failed: ${res.status} ${res.statusText}${body ? `: ${body}` : ''}`)
  }

  const tokenData = await res.json() as { access_token?: string; refresh_token?: string }
  if (!tokenData.access_token) {
    throw new Error(`Cafe24 token refresh failed: access_token missing`)
  }

  credentials.access_token = tokenData.access_token
  await storeCredential('cafe24', userId, `access_token${aliasTag}`, tokenData.access_token)
  if (tokenData.refresh_token) {
    await storeCredential('cafe24', userId, `refresh_token${aliasTag}`, tokenData.refresh_token)
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
  /** Pre-created job_logs row ID (from API route). If provided, updates it instead of creating new. */
  jobLogId?: string
}): Promise<{ ordersCollected: number; claimsCollected: number }> {
  const { marketplaceId, connectionId, userId, jobType = 'order-collection', jobLogId } = params

  // 1. Create or reuse job log entry
  let logId: string
  if (jobLogId) {
    // Update existing pre-created row to 'running'
    await db
      .insert(jobLogs)
      .values({ id: jobLogId, jobType, marketplaceId, connectionId, status: 'running', startedAt: new Date() })
      .onConflictDoUpdate({
        target: [jobLogs.id],
        set: { status: 'running', startedAt: new Date() },
      })
    logId = jobLogId
  } else {
    const [row] = await db
      .insert(jobLogs)
      .values({ jobType, marketplaceId, connectionId, status: 'running', startedAt: new Date() })
      .returning({ id: jobLogs.id })
    logId = row.id
  }
  const jobLog = { id: logId }

  let ordersCollected = 0
  let claimsCollected = 0

  // Helper: 사용자에게 보여줄 진행 상태 메시지를 job_logs에 기록.
  // 최선의 노력으로 실행하고 실패해도 본 수집 흐름을 막지 않음.
  const setProgress = async (message: string) => {
    try {
      await db.update(jobLogs).set({ progressMessage: message }).where(eq(jobLogs.id, logId))
    } catch {
      // 로그 갱신 실패는 무시
    }
  }

  try {
    await setProgress('인증 정보 확인 중...')

    // 2. Look up connection to get storeAlias
    const [connection] = await db
      .select({ storeAlias: marketplaceConnections.storeAlias })
      .from(marketplaceConnections)
      .where(eq(marketplaceConnections.id, connectionId))
      .limit(1)

    const storeAlias = connection?.storeAlias ?? 'default'
    const aliasTag = storeAlias === 'default' ? '' : `_${storeAlias}`

    // 3. Read credentials from Vault (with alias suffix if non-default store)
    const adapterConfig = marketplaceRegistry.get(marketplaceId)
    const requiredCreds = adapterConfig.config.requiredCredentials
    const credentials: Record<string, string> = {}

    for (const credKey of requiredCreds) {
      const vaultKey = `${credKey}${aliasTag}`
      const value = await readCredential(marketplaceId, userId, vaultKey)
      if (!value) {
        throw new Error(
          `Missing credential "${credKey}" for ${marketplaceId} (user: ${userId})`
        )
      }
      credentials[credKey] = value
    }

    if (marketplaceId === 'cafe24') {
      await setProgress('Cafe24 토큰 갱신 중...')
      await refreshCafe24AccessToken({ userId, credentials, aliasTag })
    }

    // 3. Create adapter with credentials
    const adapter = createAdapter(marketplaceId, credentials)

    // 4. Fetch orders — manual: 1 day, scheduled: 7 days.
    // 10x10 rejects requests outside "within 7 days" and appears to count
    // calendar dates inclusively, so keep its manual range safely inside.
    const now = Date.now()
    const extendedManualMarketplaces = new Set(['10x10', 'cafe24', 'naver'])
    const lookbackLabel = jobType === 'manual-order-collection' && marketplaceId === '10x10'
      ? '6일'
      : jobType === 'manual-order-collection' && marketplaceId === 'cafe24'
        ? '6일'
      : jobType === 'manual-order-collection' && !extendedManualMarketplaces.has(marketplaceId)
      ? '1일'
      : '7일'
    const lookbackMs = marketplaceId === '10x10' || marketplaceId === 'cafe24'
      ? 6 * 24 * 60 * 60 * 1000
      : lookbackLabel === '1일'
        ? 1 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000
    const since = new Date(now - lookbackMs)

    await setProgress(`변경된 주문 조회 중... (최근 ${lookbackLabel})`)
    const fetchedOrders = await adapter.getOrders(since)
    const normalizedOrders = mergeNormalizedOrdersByOrderId(fetchedOrders)
    await setProgress(`${normalizedOrders.length}건 발견${normalizedOrders.length > 0 ? ' — 저장 중...' : ''}`)

    // UPSERT each order with deduplication on (marketplace_id, marketplace_order_id)
    // Track newly inserted 'new' status orders for auto-confirm
    const newOrderIds: Array<{ id: string; marketplaceOrderId: string; rawData: Record<string, unknown> | null }> = []

    const totalOrders = normalizedOrders.length
    let idx = 0
    for (const order of normalizedOrders) {
      idx++
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

      // 진행률 표시(많은 주문 시): 5건마다 또는 마지막 1건에서 갱신
      if (totalOrders >= 5 && (idx % 5 === 0 || idx === totalOrders)) {
        await setProgress(`주문 저장 중 (${idx}/${totalOrders})`)
      }

      // Collect newly-new orders for auto-confirm
      if (upsertedOrder.status === 'new') {
        newOrderIds.push({
          id: upsertedOrder.id,
          marketplaceOrderId: order.marketplaceOrderId,
          rawData: enrichOrderRawData(order),
        })
      }
    }

    // 4.5 Auto-confirm: 신규 주문을 즉시 주문확인(몰 통보)으로 전환
    // 이유: 수집 후 처리 시간 동안 구매자 취소 가능성을 줄이기 위함
    // confirmOrder 실패한 주문은 'new' 상태 유지 → 확정 대기 탭에서 수동 재시도
    if (
      newOrderIds.length > 0 &&
      typeof adapter.confirmOrder === 'function' &&
      shouldAutoConfirmOrders()
    ) {
      await setProgress(`신규 주문 확인 중 (0/${newOrderIds.length})`)
      let confirmIdx = 0
      for (const o of newOrderIds) {
        confirmIdx++
        try {
          const result = await adapter.confirmOrder(o.marketplaceOrderId, o.rawData ?? undefined)
          if (result.success) {
            await db
              .update(orders)
              .set({ status: 'confirmed', marketplaceStatus: 'CONFIRMED', updatedAt: new Date() })
              .where(eq(orders.id, o.id))
          }
        } catch (err) {
          console.warn(`[OrderCollector] Auto-confirm failed for ${marketplaceId} order ${o.marketplaceOrderId}:`, err instanceof Error ? err.message : err)
          // 실패 시 status는 'new' 유지 — 사용자가 확정 대기 탭에서 수동으로 재시도
        }
        if (confirmIdx === newOrderIds.length || confirmIdx % 5 === 0) {
          await setProgress(`신규 주문 확인 중 (${confirmIdx}/${newOrderIds.length})`)
        }
      }
    } else if (newOrderIds.length > 0 && !shouldAutoConfirmOrders()) {
      await setProgress(
        `${newOrderIds.length} new orders saved; auto-confirm disabled for parallel Sabangnet run`
      )
    }

    // 5. Fetch claims — manual 수집에서는 스킵 (속도 우선, 신규주문만 수집)
    //    스케줄 잡(7일치)은 그대로 클레임도 수집해 놓치는 건 없게 함.
    if (jobType !== 'manual-order-collection') {
      await setProgress('클레임(취소/교환/반품) 조회 중...')
      try {
        const normalizedClaims = await adapter.getClaimsOrders(since)
        for (const claim of normalizedClaims) {
          const wasUpserted = await upsertClaim(claim, userId)
          if (wasUpserted) {
            claimsCollected++
          }
        }
      } catch (claimError) {
        console.warn(`[OrderCollector] Claims collection failed for ${marketplaceId}:`, claimError instanceof Error ? claimError.message : claimError)
        // Don't let claims failure block order collection success
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
        progressMessage: null,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [jobLogs.id],
        set: {
          status: 'completed',
          ordersCollected,
          claimsCollected,
          progressMessage: null,
          completedAt: new Date(),
        },
      })

    await db
      .update(marketplaceConnections)
      .set({
        status: 'connected',
        lastCheckedAt: new Date(),
        lastSuccessAt: new Date(),
        lastErrorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(marketplaceConnections.id, connectionId))

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

    await db
      .update(marketplaceConnections)
      .set({
        status: 'error',
        lastCheckedAt: new Date(),
        lastErrorMessage: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(marketplaceConnections.id, connectionId))

    throw error
  }
}

/**
 * BullMQ job handler — delegates to collectOrdersForConnection.
 */
export async function processOrderCollection(
  job: Job<OrderCollectionJobData>
): Promise<{ ordersCollected: number; claimsCollected: number }> {
  return collectOrdersForConnection({
    ...job.data,
    jobLogId: job.data.jobLogId,
    jobType: job.data.jobType,
  })
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
  const rawData = enrichOrderRawData(order)

  return db
    .insert(orders)
    .values({
      internalNo: generateInternalNo(),
      userId,
      connectionId,
      marketplaceId: order.marketplaceId,
      marketplaceOrderId: order.marketplaceOrderId,
      status: order.status,
      marketplaceStatus: order.marketplaceStatus,
      buyerName: order.buyerName,
      buyerPhone: order.buyerPhone,
      buyerPhone2: order.buyerPhone2,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      recipientPhone2: order.recipientPhone2,
      shippingAddress: order.shippingAddress,
      orderedAt: order.orderedAt,
      totalAmount: String(order.totalAmount ?? 0),
      deliveryMessage: order.deliveryMessage ?? null,
      rawData,
      collectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [orders.marketplaceId, orders.marketplaceOrderId],
      // partial unique index — 복사본은 제외하고 원본끼리만 dedup
      targetWhere: sql`is_copy = false`,
      set: {
        status: order.status,
        marketplaceStatus: order.marketplaceStatus,
        deliveryMessage: order.deliveryMessage ?? null,
        rawData,
        updatedAt: new Date(),
      },
    })
    .returning({ id: orders.id, status: orders.status })
}

function mergeNormalizedOrdersByOrderId(ordersToMerge: NormalizedOrder[]): NormalizedOrder[] {
  const grouped = new Map<string, NormalizedOrder[]>()

  for (const order of ordersToMerge) {
    const key = `${order.marketplaceId}:${order.marketplaceOrderId}`
    const current = grouped.get(key) ?? []
    current.push(order)
    grouped.set(key, current)
  }

  return Array.from(grouped.values()).map((group) => {
    if (group.length === 1) return group[0]

    const first = group[0]
    const items = group.flatMap((order) => order.items)
    const itemTotal = items.reduce(
      (sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0),
      0
    )

    return {
      ...first,
      items,
      totalAmount: itemTotal > 0 ? itemTotal : first.totalAmount,
      rawData: {
        ...(first.rawData ?? {}),
        mergedOrders: group.map((order) => order.rawData),
      },
    }
  })
}

function enrichOrderRawData(order: NormalizedOrder): Record<string, unknown> {
  const itemIds = order.items
    .map((item) => item.marketplaceItemId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const orderIdentity: MarketplaceOrderIdentity = {
    orderId: order.marketplaceOrderId,
    itemIds,
  }

  return {
    ...(order.rawData ?? {}),
    orderIdentity,
  }
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
    const [itemMatchedOrder] = await db
      .select({ id: orders.id })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.marketplaceId, claim.marketplaceId),
          eq(orderItems.marketplaceItemId, claim.marketplaceClaimId)
        )
      )
      .limit(1)

    if (!itemMatchedOrder) {
      console.warn(
        `[OrderCollector] Skipping claim ${claim.marketplaceClaimId}: ` +
          `no matching order found for ${claim.marketplaceOrderId}`
      )
      return false
    }

    matchingOrders.push(itemMatchedOrder)
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
