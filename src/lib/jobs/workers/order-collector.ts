import type { Job } from 'bullmq'
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
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
import { CjOnestyleAdapter } from '@/lib/marketplace/adapters/cjonestyle/adapter'
import { ElevenstAdapter } from '@/lib/marketplace/adapters/elevenst/adapter'
import { EsmAdapter } from '@/lib/marketplace/adapters/esm/adapter'
import { OhouseAdapter } from '@/lib/marketplace/adapters/ohouse/adapter'
import { OnchannelAdapter } from '@/lib/marketplace/adapters/onchannel/adapter'
import { AblyAdapter } from '@/lib/marketplace/adapters/ably/adapter'
import { KakaoStoreAdapter } from '@/lib/marketplace/adapters/kakao-store/adapter'
import { TossShoppingAdapter } from '@/lib/marketplace/adapters/toss-shopping/adapter'
import { OwnerclanAdapter } from '@/lib/marketplace/adapters/ownerclan/adapter'
import { DomeggookAdapter } from '@/lib/marketplace/adapters/domeggook/adapter'
import { FuntasticB2bAdapter } from '@/lib/marketplace/adapters/funtastic-b2b/adapter'
import { DomesinAdapter } from '@/lib/marketplace/adapters/domesin/adapter'
import { SpecialofferAdapter } from '@/lib/marketplace/adapters/specialoffer/adapter'
import { DomechangoAdapter } from '@/lib/marketplace/adapters/domechango/adapter'
import { TobizonAdapter } from '@/lib/marketplace/adapters/tobizon/adapter'
import { SsgmallAdapter } from '@/lib/marketplace/adapters/ssgmall/adapter'
import { PlayautoEmpAdapter } from '@/lib/marketplace/adapters/playauto-emp/adapter'
import { HyundaiHmallAdapter } from '@/lib/marketplace/adapters/hyundai-hmall/adapter'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { normalizeMarketplaceCollectionStatus } from '@/lib/marketplace/collection-status'
import { generateInternalNo } from '@/lib/orders/internal-no'
import '@/lib/marketplace/adapters/configs'
import type {
  MarketplaceAdapter,
  MarketplaceOrderIdentity,
  NormalizedOrder,
  NormalizedOrderItem,
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
): Pick<MarketplaceAdapter, 'config' | 'getOrders' | 'getClaimsOrders' | 'confirmOrder' | 'uploadInvoice' | 'getInquiries'> {
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
    case 'cjonestyle':
      return new CjOnestyleAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
        seller_code: credentials.seller_code ?? credentials.sellerCode ?? '',
      })
    case 'elevenst':
      return new ElevenstAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
      })
    case 'ohouse':
      return new OhouseAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
      })
    case 'onchannel':
      return new OnchannelAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
        shop_id: credentials.shop_id ?? credentials.shopId ?? '',
      })
    case 'ably':
      return new AblyAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
        shop_id: credentials.shop_id ?? credentials.shopId ?? '',
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
    case 'ownerclan':
      return new OwnerclanAdapter({
        username: credentials.username ?? credentials.vendor_id ?? credentials.seller_id ?? '',
        password: credentials.password ?? credentials.vendor_password ?? credentials.api_key ?? '',
        vendor_id: credentials.vendor_id ?? '',
        vendor_password: credentials.vendor_password ?? '',
      })
    case 'domeggook':
      return new DomeggookAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
        seller_id: credentials.seller_id ?? credentials.sellerId ?? '',
        session_id: credentials.session_id ?? credentials.sessionId ?? credentials.sId ?? credentials.sid ?? '',
        password: credentials.password ?? credentials.pw ?? '',
      })
    case 'funtastic-b2b':
      return new FuntasticB2bAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
        base_url: credentials.base_url ?? credentials.baseUrl ?? '',
      })
    case 'domesin':
      return new DomesinAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
        seller_id: credentials.seller_id ?? credentials.sellerId ?? credentials.m_id ?? '',
      })
    case 'specialoffer':
      return new SpecialofferAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
      })
    case 'domechango':
      return new DomechangoAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
        secure_key: credentials.secure_key ?? credentials.secureKey ?? '',
      })
    case 'tobizon':
      return new TobizonAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
        secure_key: credentials.secure_key ?? credentials.secureKey ?? '',
        client_server_ip: credentials.client_server_ip ?? credentials.clientServerIp ?? '',
      })
    case 'ssgmall':
      return new SsgmallAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
      })
    case 'hyundai-hmall':
      return new HyundaiHmallAdapter({
        oauser_id: credentials.oauser_id ?? credentials.oauserId ?? '',
        oause_key: credentials.oause_key ?? credentials.oauseKey ?? '',
        ven_cd: credentials.ven_cd ?? credentials.venCd ?? '',
        ven2_cd: credentials.ven2_cd ?? credentials.ven2Cd ?? '',
        mda_gb: credentials.mda_gb ?? credentials.mdaGb ?? '',
        dlv_form_gbcd: credentials.dlv_form_gbcd ?? credentials.dlvFormGbcd ?? '',
        base_url: credentials.base_url ?? credentials.baseUrl ?? '',
        rgst_ip: credentials.rgst_ip ?? credentials.rgstIp ?? '',
      })
    case 'playauto-emp':
      return new PlayautoEmpAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
      })
    default:
      throw new Error(`Unknown marketplace: ${marketplaceId}. No adapter registered.`)
  }
}

function shouldAutoConfirmOrders(): boolean {
  // Absolute workflow rule: collection never confirms orders automatically.
  // 수집 → 신규 → 매핑 → 사용자가 [확정] 클릭 → 확인.
  // Do not re-enable without an explicit product decision and regression check.
  return false
}

function shouldConfirmOnCollect(marketplaceId: string): boolean {
  return marketplaceId === 'ssgmall' || marketplaceId === 'specialoffer'
}

function confirmedMarketplaceStatus(marketplaceId: string): string {
  if (marketplaceId === 'ssgmall') return '140'
  if (marketplaceId === 'specialoffer') return '4'
  return 'CONFIRMED'
}

function isIgnorableConfirmFailure(marketplaceId: string, message: string): boolean {
  if (marketplaceId !== 'ssgmall') return false
  return /배송지시\s*상태에서만\s*주문확인|해당\s*데이터가\s*없습니다|이미\s*주문확인|이미\s*처리/.test(message)
}

function shouldPreserveCollectedConfirmedStatus(marketplaceId: string): boolean {
  return marketplaceId === 'always' || marketplaceId === 'gs-shop'
}

function collectedOrderStatus(
  status: NormalizedOrder['status'],
  marketplaceId: string,
): NormalizedOrder['status'] {
  // Most collection paths keep orders in "신규" until local mapping confirmation.
  // Some RPA portals expose only already-confirmed/product-prep orders; preserve
  // that state for explicitly allowed marketplaces.
  if (status === 'confirmed' && !shouldPreserveCollectedConfirmedStatus(marketplaceId)) {
    return 'new'
  }
  return status
}

function orderStatusRank(value: unknown): SQL<number> {
  return sql<number>`CASE ${value}
    WHEN 'new' THEN 1
    WHEN 'confirmed' THEN 2
    WHEN 'preparing' THEN 3
    WHEN 'ready' THEN 4
    WHEN 'shipped' THEN 5
    WHEN 'delivering' THEN 6
    WHEN 'delivered' THEN 7
    WHEN 'cancelled' THEN 99
    ELSE 0
  END`
}

function collectedOrderUpdateStatus(status: NormalizedOrder['status'], marketplaceId: string): SQL {
  if (status === 'cancelled') return sql`'cancelled'::order_status`
  if (status === 'new') return sql`${orders.status}`
  if (status === 'confirmed') {
    if (shouldPreserveCollectedConfirmedStatus(marketplaceId)) {
      return sql`CASE
        WHEN ${orderStatusRank(orders.status)} >= ${orderStatusRank(status)} THEN ${orders.status}
        ELSE 'confirmed'::order_status
      END`
    }
    return sql`CASE
      WHEN ${orders.status} <> 'new' THEN ${orders.status}
      WHEN ${orders.mappedAt} IS NULL THEN 'new'::order_status
      ELSE ${orders.status}
    END`
  }

  return sql`CASE
    WHEN ${orderStatusRank(orders.status)} >= ${orderStatusRank(status)} THEN ${orders.status}
    ELSE ${status}::order_status
  END`
}

const RANGE_AWARE_ORDER_MARKETPLACES = new Set([
  'ownerclan',
  '10x10',
  'coupang',
  'cafe24',
  'naver',
  'toss-shopping',
  'elevenst',
  'gmarket',
  'auction',
  'esm',
  'ably',
  'ohouse',
  'onchannel',
  'ssgmall',
  'hyundai-hmall',
  'cjonestyle',
  'kakao-gift',
  'kakao-store',
  'funtastic-b2b',
  'playauto-emp',
])
const ORDER_RANGE_CONCURRENCY: Record<string, number> = {
  ownerclan: 1,
  '10x10': 2,
  coupang: 2,
  cafe24: 2,
  naver: 1,
  'toss-shopping': 2,
  elevenst: 2,
  gmarket: 1,
  auction: 1,
  esm: 2,
  ably: 2,
  ohouse: 2,
  onchannel: 2,
  ssgmall: 2,
  'hyundai-hmall': 1,
  cjonestyle: 2,
  'kakao-gift': 2,
  'kakao-store': 2,
  'funtastic-b2b': 2,
  'playauto-emp': 1,
}
const ORDER_RANGE_MS = 24 * 60 * 60 * 1000
const MANUAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function splitOrderRanges(since: Date, until: Date): Array<{ since: Date; until: Date }> {
  if (since >= until) return [{ since, until }]
  const ranges: Array<{ since: Date; until: Date }> = []
  for (let start = since.getTime(); start < until.getTime();) {
    const end = Math.min(start + ORDER_RANGE_MS, until.getTime())
    ranges.push({ since: new Date(start), until: new Date(end) })
    start = end
  }
  return ranges
}

function manualDateRange(dateFrom?: string, dateTo?: string, now = new Date()): { since: Date; until: Date; label: string } | null {
  if (!dateFrom || !dateTo) return null
  if (!MANUAL_DATE_RE.test(dateFrom) || !MANUAL_DATE_RE.test(dateTo)) return null

  const since = new Date(`${dateFrom}T00:00:00+09:00`)
  const requestedUntil = new Date(`${dateTo}T23:59:59.999+09:00`)
  const until = requestedUntil > now ? now : requestedUntil

  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since > until) return null
  return { since, until, label: `${dateFrom}~${dateTo}` }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  const workerCount = Math.max(1, Math.min(concurrency, values.length))

  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = next++
      if (index >= values.length) return
      results[index] = await mapper(values[index], index)
    }
  }))

  return results
}

async function fetchOrdersForRange(
  adapter: Pick<MarketplaceAdapter, 'getOrders'>,
  marketplaceId: string,
  since: Date,
  until: Date,
  setProgress: (message: string) => Promise<void>,
): Promise<NormalizedOrder[]> {
  if (!RANGE_AWARE_ORDER_MARKETPLACES.has(marketplaceId)) {
    return adapter.getOrders(since, until)
  }

  const ranges = splitOrderRanges(since, until)
  if (ranges.length <= 1) {
    return adapter.getOrders(since, until)
  }

  const concurrency = ORDER_RANGE_CONCURRENCY[marketplaceId] ?? 2
  await setProgress(`날짜별 주문 조회 중... (${ranges.length}개 구간, 동시 ${concurrency})`)
  const batches = await mapWithConcurrency(ranges, concurrency, async (range, index) => {
    await setProgress(`날짜별 주문 조회 중... (${index + 1}/${ranges.length})`)
    return adapter.getOrders(range.since, range.until)
  })

  return batches.flat()
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
  manualLookbackDays?: number
  manualDateFrom?: string
  manualDateTo?: string
  /** Pre-created job_logs row ID (from API route). If provided, updates it instead of creating new. */
  jobLogId?: string
}): Promise<{ ordersCollected: number; claimsCollected: number }> {
  const {
    marketplaceId,
    connectionId,
    userId,
    jobType = 'order-collection',
    jobLogId,
    manualLookbackDays,
    manualDateFrom,
    manualDateTo,
  } = params

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
  const claimsCollected = 0

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
      .select({
        storeAlias: marketplaceConnections.storeAlias,
        lastSuccessAt: marketplaceConnections.lastSuccessAt,
      })
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

    if (marketplaceId === 'playauto-emp' || marketplaceId === 'hyundai-hmall') {
      const optionalKeys = marketplaceId === 'playauto-emp'
        ? []
        : ['ven2_cd', 'dlv_form_gbcd', 'base_url', 'rgst_ip']
      for (const credKey of optionalKeys) {
        const vaultKey = `${credKey}${aliasTag}`
        const value = await readCredential(marketplaceId, userId, vaultKey)
        if (value) credentials[credKey] = value
      }
    }

    if (marketplaceId === 'cafe24') {
      await setProgress('Cafe24 토큰 갱신 중...')
      await refreshCafe24AccessToken({ userId, credentials, aliasTag })
    }

    // 3. Create adapter with credentials
    const adapter = createAdapter(marketplaceId, credentials)

    // 4. Fetch orders — manual: selected range/preset, scheduled: 7 days.
    // 10x10 rejects requests outside "within 7 days" and appears to count
    // calendar dates inclusively, so keep its manual range safely inside.
    const nowDate = new Date()
    const now = nowDate.getTime()
    const selectedManualRange = jobType === 'manual-order-collection'
      ? manualDateRange(manualDateFrom, manualDateTo, nowDate)
      : null
    const extendedManualMarketplaces = new Set(['10x10', 'cafe24', 'naver'])
    const sixDayManualMarketplaces = new Set(['10x10', 'cafe24', 'domeggook'])
    const manualPresetDays = jobType === 'manual-order-collection' && !selectedManualRange
      ? Math.min(Math.max(Math.floor(manualLookbackDays ?? 3), 1), 14)
      : null
    const lookbackLabel = manualPresetDays
      ? `${manualPresetDays}일`
      : jobType === 'manual-order-collection' && sixDayManualMarketplaces.has(marketplaceId)
      ? '6일'
      : jobType === 'manual-order-collection' && !extendedManualMarketplaces.has(marketplaceId)
      ? '1일'
      : '7일'
    const lookbackMs = manualPresetDays
      ? manualPresetDays * 24 * 60 * 60 * 1000
      : sixDayManualMarketplaces.has(marketplaceId)
      ? 6 * 24 * 60 * 60 * 1000
      : lookbackLabel === '1일'
        ? 1 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000
    const since = selectedManualRange?.since ?? new Date(now - lookbackMs)
    const tenByTenRecentMs = 24 * 60 * 60 * 1000
    const tenByTenLastSuccessAt = connection?.lastSuccessAt?.getTime()
    const tenByTenSinceMs = tenByTenLastSuccessAt
      ? Math.max(tenByTenLastSuccessAt - 5 * 60 * 1000, now - tenByTenRecentMs)
      : now - tenByTenRecentMs
    const effectiveSince = selectedManualRange
      ? selectedManualRange.since
      : marketplaceId === '10x10' ? new Date(tenByTenSinceMs) : since
    const effectiveLookbackLabel = selectedManualRange
      ? selectedManualRange.label
      : marketplaceId === '10x10'
      ? (tenByTenLastSuccessAt ? 'last success' : '1 day')
      : lookbackLabel
    const effectiveUntil = selectedManualRange?.until ?? new Date(now)

    await setProgress(`변경된 주문 조회 중... (${effectiveLookbackLabel})`)
    if (marketplaceId === '10x10') {
      await setProgress(`10x10 order lookup (${effectiveLookbackLabel})`)
    }
    const fetchedOrders = await fetchOrdersForRange(adapter, marketplaceId, effectiveSince, effectiveUntil, setProgress)
    const normalizedOrders = mergeNormalizedOrdersByOrderId(canonicalizeMarketplaceOrderIds(fetchedOrders))
    const existingOrderMatches = await findExistingOrderMatches(userId, marketplaceId, normalizedOrders)
    const ordersToSave = normalizedOrders.filter((order) => {
      const orderKey = `${order.marketplaceId}:${order.marketplaceOrderId}`
      return !existingOrderMatches.skipKeys.has(orderKey)
    })
    const skippedExistingCount = existingOrderMatches.upsertKeys.size + existingOrderMatches.skipKeys.size
    await setProgress(
      `${normalizedOrders.length}건 발견${normalizedOrders.length > 0 ? ` - 저장/갱신 ${ordersToSave.length}건, 기존 ${skippedExistingCount}건 포함` : ''}`,
    )

    type ConfirmTarget = { ids: string[]; marketplaceOrderId: string; rawData: Record<string, unknown> | null }
    const confirmTargets: ConfirmTarget[] = []
    const totalOrders = ordersToSave.length
    let idx = 0
    for (const order of ordersToSave) {
      idx++
      const items = dedupeNormalizedOrderItems(order.items)
      const firstItem = items[0]
      const orderForSave = firstItem && items.length > 1
        ? { ...order, items: [firstItem], totalAmount: lineTotalAmount(firstItem) }
        : { ...order, items }
      const orderKey = `${order.marketplaceId}:${order.marketplaceOrderId}`
      const isExistingOrder = existingOrderMatches.upsertKeys.has(orderKey)
      const [upsertedOrder] = await upsertOrder(orderForSave, connectionId, userId)
      let splitCopyIds: string[] = []

      if (!isExistingOrder && items.length > 0) {
        await db.insert(orderItems).values(orderItemInsertValue(upsertedOrder.id, items[0]))
        splitCopyIds = await createSplitOrderCopies(order, items, upsertedOrder.id, connectionId, userId)
      } else if (isExistingOrder && marketplaceId === 'specialoffer') {
        await fillMissingSpecialofferOptionText(upsertedOrder.id, items[0])
      }
      ordersCollected++

      if (
        shouldConfirmOnCollect(marketplaceId)
        && order.status === 'new'
        && upsertedOrder.marketplaceStatus !== confirmedMarketplaceStatus(marketplaceId)
      ) {
        confirmTargets.push({
          ids: [upsertedOrder.id, ...splitCopyIds],
          marketplaceOrderId: order.marketplaceOrderId,
          rawData: enrichOrderRawData(orderForSave),
        })
      }

      // 진행률 표시(많은 주문 시): 5건마다 또는 마지막 1건에서 갱신
      if (totalOrders >= 5 && (idx % 5 === 0 || idx === totalOrders)) {
        await setProgress(`주문 저장 중 (${idx}/${totalOrders})`)
      }

    }

    if (confirmTargets.length > 0 && typeof adapter.confirmOrder === 'function') {
      await setProgress(`수집 주문 상태 전환 중... (0/${confirmTargets.length})`)
      let confirmIdx = 0
      const confirmFailures: string[] = []

      for (const target of confirmTargets) {
        confirmIdx++
        try {
          const result = await adapter.confirmOrder(target.marketplaceOrderId, target.rawData ?? undefined)
          if (result.success) {
            await db
              .update(orders)
              .set({
                status: 'confirmed',
                marketplaceStatus: confirmedMarketplaceStatus(marketplaceId),
                updatedAt: new Date(),
              })
              .where(inArray(orders.id, target.ids))
          } else if (isIgnorableConfirmFailure(marketplaceId, result.error ?? '')) {
            await db
              .update(orders)
              .set({
                status: 'confirmed',
                marketplaceStatus: confirmedMarketplaceStatus(marketplaceId),
                updatedAt: new Date(),
              })
              .where(inArray(orders.id, target.ids))
          } else {
            confirmFailures.push(`${target.marketplaceOrderId}: ${result.error ?? 'unknown error'}`)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (isIgnorableConfirmFailure(marketplaceId, message)) {
            await db
              .update(orders)
              .set({
                status: 'confirmed',
                marketplaceStatus: confirmedMarketplaceStatus(marketplaceId),
                updatedAt: new Date(),
              })
              .where(inArray(orders.id, target.ids))
          } else {
            confirmFailures.push(`${target.marketplaceOrderId}: ${message}`)
          }
        }

        if (confirmIdx === confirmTargets.length || confirmIdx % 5 === 0) {
          await setProgress(`수집 주문 상태 전환 중... (${confirmIdx}/${confirmTargets.length})`)
        }
      }

      if (confirmFailures.length > 0) {
        throw new Error(`${marketplaceId} 주문 상태 전환 실패: ${confirmFailures.slice(0, 3).join(' / ')}`)
      }
    }

    // 4.5 Auto-confirm is disabled.
    // 수집 → 신규(status='new') → 매핑 → 사용자가 [확정] 클릭 → 확인(status='confirmed').
    if (ordersCollected > 0 && !shouldAutoConfirmOrders()) {
      await setProgress(`${ordersCollected}건 신규/기존 주문 저장 완료`)
    }

    // 5. CS data is collected only from the CS management module.
    // Keep order collection focused on orders so manual and scheduled runs stay fast.

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

export async function saveNormalizedOrdersForConnection(params: {
  marketplaceId: string
  connectionId: string
  userId: string
  normalizedOrders: NormalizedOrder[]
}): Promise<{ ordersCollected: number; ordersSkipped: number; ordersFetched: number }> {
  const { marketplaceId, connectionId, userId } = params
  const normalizedOrders = mergeNormalizedOrdersByOrderId(canonicalizeMarketplaceOrderIds(params.normalizedOrders))
  const existingOrderMatches = await findExistingOrderMatches(userId, marketplaceId, normalizedOrders)
  let ordersCollected = 0
  let ordersSkipped = 0

  for (const order of normalizedOrders) {
    const items = dedupeNormalizedOrderItems(order.items)
    const orderForSave = { ...order, items }
    const orderKey = `${order.marketplaceId}:${order.marketplaceOrderId}`
    if (existingOrderMatches.skipKeys.has(orderKey)) {
      ordersSkipped++
      continue
    }

    const isExistingOrder = existingOrderMatches.upsertKeys.has(orderKey)
    const [upsertedOrder] = await upsertOrder(orderForSave, connectionId, userId)

    if (!isExistingOrder && items.length > 0) {
      await db.insert(orderItems).values(items.map((item) => orderItemInsertValue(upsertedOrder.id, item)))
    } else if (isExistingOrder && marketplaceId === 'specialoffer') {
      await fillMissingSpecialofferOptionText(upsertedOrder.id, items[0])
    }
    ordersCollected++
  }

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

  return { ordersCollected, ordersSkipped, ordersFetched: normalizedOrders.length }
}

function normalizeDuplicateName(value?: string | null): string | null {
  const normalized = value?.replace(/\s+/g, '').trim()
  return normalized ? normalized : null
}

function hasMatchingCustomerName(
  incoming: NormalizedOrder,
  existing: { buyerName: string; recipientName: string },
): boolean {
  const incomingNames = [
    normalizeDuplicateName(incoming.buyerName),
    normalizeDuplicateName(incoming.recipientName),
  ].filter(Boolean)
  const existingNames = [
    normalizeDuplicateName(existing.buyerName),
    normalizeDuplicateName(existing.recipientName),
  ].filter(Boolean)

  if (incomingNames.length === 0 || existingNames.length === 0) return false
  return incomingNames.some((name) => existingNames.includes(name))
}

export async function findExistingOrderMatches(
  userId: string,
  marketplaceId: string,
  normalizedOrders: NormalizedOrder[],
): Promise<{ upsertKeys: Set<string>; skipKeys: Set<string> }> {
  const marketplaceOrderIds = Array.from(
    new Set(normalizedOrders.map((order) => order.marketplaceOrderId).filter(Boolean)),
  )
  if (marketplaceOrderIds.length === 0) {
    return { upsertKeys: new Set(), skipKeys: new Set() }
  }

  const existingOrders = await db
    .select({
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
      buyerName: orders.buyerName,
      recipientName: orders.recipientName,
    })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.isCopy, false),
        inArray(orders.marketplaceOrderId, marketplaceOrderIds),
      ),
    )

  const existingByOrderId = new Map<string, typeof existingOrders>()
  for (const order of existingOrders) {
    const current = existingByOrderId.get(order.marketplaceOrderId) ?? []
    current.push(order)
    existingByOrderId.set(order.marketplaceOrderId, current)
  }

  const upsertKeys = new Set<string>()
  const skipKeys = new Set<string>()

  for (const order of normalizedOrders) {
    const existing = existingByOrderId.get(order.marketplaceOrderId) ?? []
    const exact = existing.find((candidate) => candidate.marketplaceId === marketplaceId)
    const orderKey = `${order.marketplaceId}:${order.marketplaceOrderId}`

    if (exact) {
      upsertKeys.add(orderKey)
      continue
    }

    if (existing.some((candidate) => hasMatchingCustomerName(order, candidate))) {
      skipKeys.add(orderKey)
    }
  }

  return { upsertKeys, skipKeys }
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
  const insertStatus = collectedOrderStatus(order.status, order.marketplaceId)
  const updateStatus = collectedOrderUpdateStatus(order.status, order.marketplaceId)
  const marketplaceCollectionStatus = getMarketplaceCollectionStatus(order)

  return db
    .insert(orders)
    .values({
      internalNo: generateInternalNo(),
      userId,
      connectionId,
      marketplaceId: order.marketplaceId,
      marketplaceOrderId: order.marketplaceOrderId,
      status: insertStatus,
      marketplaceStatus: order.marketplaceStatus,
      marketplaceCollectionStatus,
      buyerName: order.buyerName,
      buyerPhone: order.buyerPhone,
      buyerPhone2: order.buyerPhone2,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      recipientPhone2: order.recipientPhone2,
      shippingAddress: order.shippingAddress,
      orderedAt: order.orderedAt,
      totalAmount: String(order.totalAmount ?? 0),
      shippingFee: order.shippingFee != null ? String(order.shippingFee) : null,
      deliveryMessage: order.deliveryMessage ?? null,
      rawData,
      collectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [orders.marketplaceId, orders.marketplaceOrderId],
      // partial unique index — 복사본은 제외하고 원본끼리만 dedup
      targetWhere: sql`is_copy = false`,
      set: {
        status: updateStatus,
        marketplaceStatus: order.marketplaceStatus,
        marketplaceCollectionStatus,
        totalAmount: String(order.totalAmount ?? 0),
        shippingFee: order.shippingFee != null ? String(order.shippingFee) : null,
        buyerName: order.buyerName,
        buyerPhone: order.buyerPhone,
        buyerPhone2: order.buyerPhone2,
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        recipientPhone2: order.recipientPhone2,
        shippingAddress: order.shippingAddress,
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

    const first = [...group].sort((a, b) => collectionStatusPriority(b) - collectionStatusPriority(a))[0]
    const items = dedupeNormalizedOrderItems(group.flatMap((order) => order.items))
    return {
      ...first,
      items,
      rawData: {
        ...(first.rawData ?? {}),
        mergedOrders: group.map((order) => order.rawData),
      },
    }
  })
}

function collectionStatusPriority(order: NormalizedOrder): number {
  switch (getMarketplaceCollectionStatus(order)) {
    case 'ready':
      return 20
    case 'new':
      return 10
    default:
      return 0
  }
}

function dedupeNormalizedOrderItems(items: NormalizedOrderItem[]): NormalizedOrderItem[] {
  const seen = new Set<string>()
  const deduped: NormalizedOrderItem[] = []

  for (const item of items) {
    const key = [
      item.marketplaceItemId,
      item.productName,
      item.optionText ?? '',
      item.quantity,
      item.unitPrice,
      item.sku ?? '',
    ].join('\u001f')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  return deduped
}

function lineTotalAmount(item: NormalizedOrderItem): number {
  return (Number(item.unitPrice) || 0) * Math.max(1, Number(item.quantity) || 1)
}

function itemSplitRawData(rawData: Record<string, unknown>, meta: Record<string, unknown>): Record<string, unknown> {
  return {
    ...rawData,
    itemSplit: meta,
  }
}

function orderItemInsertValue(orderId: string, item: NormalizedOrderItem) {
  return {
    orderId,
    marketplaceItemId: item.marketplaceItemId,
    productName: item.productName,
    optionText: item.optionText ?? null,
    quantity: item.quantity,
    unitPrice: String(item.unitPrice),
    sku: item.sku ?? null,
  }
}

async function fillMissingSpecialofferOptionText(orderId: string, item?: NormalizedOrderItem): Promise<void> {
  const optionText = item?.optionText?.trim()
  if (!optionText) return

  await db
    .update(orderItems)
    .set({ optionText })
    .where(
      and(
        eq(orderItems.orderId, orderId),
        sql`COALESCE(${orderItems.optionText}, '') = ''`,
      ),
    )
}

async function createSplitOrderCopies(
  order: NormalizedOrder,
  items: NormalizedOrderItem[],
  baseOrderId: string,
  connectionId: string,
  userId: string,
): Promise<string[]> {
  if (items.length <= 1) return []

  const copyIds: string[] = []
  const now = new Date()
  const splitBase = {
    sourceOrderId: baseOrderId,
    splitAt: now.toISOString(),
    totalParts: items.length,
  }

  await db
    .update(orders)
    .set({
      rawData: itemSplitRawData(enrichOrderRawData({ ...order, items: [items[0]] }), {
        ...splitBase,
        partIndex: 1,
        original: true,
      }),
      updatedAt: now,
    })
    .where(eq(orders.id, baseOrderId))

  for (let index = 1; index < items.length; index += 1) {
    const item = items[index]
    const [copy] = await db
      .insert(orders)
      .values({
        internalNo: generateInternalNo(),
        userId,
        connectionId,
        marketplaceId: order.marketplaceId,
        marketplaceOrderId: order.marketplaceOrderId,
        status: order.status,
        marketplaceStatus: order.marketplaceStatus,
        marketplaceCollectionStatus: getMarketplaceCollectionStatus(order),
        buyerName: order.buyerName,
        buyerPhone: order.buyerPhone,
        buyerPhone2: order.buyerPhone2,
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        recipientPhone2: order.recipientPhone2,
        shippingAddress: order.shippingAddress,
        orderedAt: order.orderedAt,
        totalAmount: String(lineTotalAmount(item)),
        shippingFee: order.shippingFee != null ? String(order.shippingFee) : null,
        deliveryMessage: order.deliveryMessage ?? null,
        rawData: itemSplitRawData(enrichOrderRawData({ ...order, items: [item], totalAmount: lineTotalAmount(item) }), {
          ...splitBase,
          partIndex: index + 1,
          originalOrderId: baseOrderId,
        }),
        collectedAt: now,
        isCopy: true,
      })
      .returning({ id: orders.id })

    await db.insert(orderItems).values(orderItemInsertValue(copy.id, item))
    copyIds.push(copy.id)
  }

  return copyIds
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function readNestedOrderId(value: unknown): string | null {
  const record = asPlainRecord(value)
  if (!record) return null
  return stringValue(record.orderId)
}

function readCommonMarketplaceOrderId(rawData: Record<string, unknown> | undefined): string | null {
  if (!rawData) return null

  const directKeys = [
    'orderId',
    'orderNo',
    'ordNo',
    'orordNo',
    'OrderSerial',
    'order_id',
    'order_no',
    'orderCode',
    'order_code',
  ]
  for (const key of directKeys) {
    const value = stringValue(rawData[key])
    if (value) return value
  }

  const orderRecord = asPlainRecord(rawData.order)
  if (orderRecord) {
    for (const key of directKeys) {
      const value = stringValue(orderRecord[key])
      if (value) return value
    }
  }

  return null
}

function getCanonicalMarketplaceOrderId(order: NormalizedOrder): string {
  const rawData = asPlainRecord(order.rawData) ?? {}
  return (
    readNestedOrderId(rawData.marketplaceOrderIdentity)
    ?? readNestedOrderId(rawData.orderIdentity)
    ?? readCommonMarketplaceOrderId(rawData)
    ?? order.marketplaceOrderId
  )
}

function canonicalizeMarketplaceOrderIds(normalizedOrders: NormalizedOrder[]): NormalizedOrder[] {
  return normalizedOrders.map((order) => {
    const canonicalOrderId = getCanonicalMarketplaceOrderId(order)
    if (!canonicalOrderId || canonicalOrderId === order.marketplaceOrderId) return order

    return {
      ...order,
      marketplaceOrderId: canonicalOrderId,
      rawData: {
        ...(order.rawData ?? {}),
        originalMarketplaceOrderId: order.marketplaceOrderId,
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

function getMarketplaceCollectionStatus(order: NormalizedOrder): string | null {
  return order.marketplaceCollectionStatus
    ?? normalizeMarketplaceCollectionStatus(order.marketplaceStatus)
}

/**
 * UPSERT a normalized claim into the database.
 * Looks up the orderId from the orders table using marketplaceOrderId.
 * Deduplicates on (marketplace_id, marketplace_claim_id) per D-04.
 */
export async function upsertClaim(
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
