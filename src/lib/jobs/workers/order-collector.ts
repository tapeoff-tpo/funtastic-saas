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
import { KakaoGiftAdapter } from '@/lib/marketplace/adapters/kakao-gift/adapter'
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
    case 'kakao-gift':
      return new KakaoGiftAdapter({
        api_key: credentials.api_key ?? credentials.apiKey ?? '',
        store_id: credentials.store_id ?? credentials.storeId ?? '',
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

function shouldMoveMarketplaceOrderToShippingPrepOnCollect(marketplaceId: string): boolean {
  // The SaaS order stays in 신규 until mapping is complete, while marketplaces
  // that require prompt receipt acknowledgement move to their shipping-prep state.
  return new Set([
    '10x10',
    'cafe24',
    'cjonestyle',
    'coupang',
    'domeggook',
    'domesin',
    'elevenst',
    'esm',
    'funtastic-b2b',
    'gmarket',
    'hyundai-hmall',
    'kakao-store',
    'naver',
    'ownerclan',
    'specialoffer',
    'ssgmall',
    'toss-shopping',
  ]).has(marketplaceId)
}

export function marketplaceShippingPrepStatus(marketplaceId: string): string {
  if (marketplaceId === '10x10') return '6'
  if (marketplaceId === 'cafe24') return 'N20'
  if (marketplaceId === 'cjonestyle') return '배송지시확인'
  if (marketplaceId === 'ownerclan') return 'preparing'
  if (marketplaceId === 'naver') return '발주확인'
  if (marketplaceId === 'coupang') return 'INSTRUCT'
  if (marketplaceId === 'ssgmall') return '140'
  if (marketplaceId === 'funtastic-b2b') return 'PREPARING'
  if (marketplaceId === 'toss-shopping') return 'PREPARING_PRODUCT'
  return 'CONFIRMED'
}

function isMarketplaceOrderReadyForShippingPrep(order: NormalizedOrder): boolean {
  if (order.marketplaceId === 'ownerclan') {
    return /^(placed|paid)$/i.test(order.marketplaceStatus?.trim() ?? '')
  }
  if (order.marketplaceId === 'naver') {
    return order.marketplaceStatus === 'PAYED'
  }
  if (order.marketplaceId === 'specialoffer') {
    return ['new', 'ready'].includes(getMarketplaceCollectionStatus(order) ?? '')
  }
  return getMarketplaceCollectionStatus(order) === 'new'
}

function shouldPreserveCollectedConfirmedStatus(marketplaceId: string): boolean {
  void marketplaceId
  // 확인 탭은 로컬 매핑 확정 후 사용자 확인으로만 진입한다.
  return false
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
const MARKETPLACE_CONFIRM_TIMEOUT_MS = 20_000
const MARKETPLACE_CONFIRM_CONCURRENCY: Record<string, number> = {
  ownerclan: 2,
}

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
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

    type ShippingPrepTarget = { ids: string[]; marketplaceOrderId: string; rawData: Record<string, unknown> | null }
    const shippingPrepTargetByKey = new Map<string, ShippingPrepTarget>()
    for (const order of normalizedOrders) {
      if (
        shouldMoveMarketplaceOrderToShippingPrepOnCollect(marketplaceId)
        && isMarketplaceOrderReadyForShippingPrep(order)
      ) {
        const orderKey = `${order.marketplaceId}:${order.marketplaceOrderId}`
        shippingPrepTargetByKey.set(orderKey, {
          ids: [],
          marketplaceOrderId: order.marketplaceOrderId,
          rawData: enrichOrderRawData(order),
        })
      }
    }
    const shippingPrepTargets = Array.from(shippingPrepTargetByKey.values())
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

      // Absolute order storage rule: every multi-item marketplace order is stored as split rows.
      if (!isExistingOrder && items.length > 0) {
        await db.insert(orderItems).values(orderItemInsertValue(upsertedOrder.id, items[0]))
        splitCopyIds = await createSplitOrderCopies(order, items, upsertedOrder.id, connectionId, userId)
      } else if (isExistingOrder && items.length > 1) {
        splitCopyIds = await ensureSplitOrderCopies(order, items, upsertedOrder.id, connectionId, userId)
      } else if (isExistingOrder && marketplaceId === 'specialoffer') {
        await fillMissingSpecialofferOptionText(upsertedOrder.id, items[0])
      }
      ordersCollected++

      if (
        shouldMoveMarketplaceOrderToShippingPrepOnCollect(marketplaceId)
        && isMarketplaceOrderReadyForShippingPrep(order)
      ) {
        const target = shippingPrepTargetByKey.get(orderKey)
        if (target) {
          target.ids = [upsertedOrder.id, ...splitCopyIds]
          target.rawData = enrichOrderRawData(orderForSave)
        }
      }

      // 진행률 표시(많은 주문 시): 5건마다 또는 마지막 1건에서 갱신
      if (totalOrders >= 5 && (idx % 5 === 0 || idx === totalOrders)) {
        await setProgress(`주문 저장 중 (${idx}/${totalOrders})`)
      }

    }

    if (shippingPrepTargets.length > 0 && typeof adapter.confirmOrder === 'function') {
      await setProgress(`몰 주문단계 전환 중... (0/${shippingPrepTargets.length})`)
      const confirmErrors: string[] = []
      const confirmConcurrency = MARKETPLACE_CONFIRM_CONCURRENCY[marketplaceId] ?? 3
      await mapWithConcurrency(shippingPrepTargets, confirmConcurrency, async (target, index) => {
        const result = await withTimeout(
          adapter.confirmOrder!(target.marketplaceOrderId, target.rawData ?? undefined),
          MARKETPLACE_CONFIRM_TIMEOUT_MS,
          `몰 주문단계 전환 제한시간 초과 (${marketplaceId} ${target.marketplaceOrderId})`,
        ).catch((error) => ({
          success: false,
          error: error instanceof Error ? error.message : '알 수 없는 오류',
        }))

        if (!result.success) {
          confirmErrors.push(`${target.marketplaceOrderId}: ${result.error ?? '알 수 없는 오류'}`)
        } else if (target.ids.length > 0) {
          await db
            .update(orders)
            .set({
              marketplaceStatus: marketplaceShippingPrepStatus(marketplaceId),
              marketplaceCollectionStatus: 'ready',
              updatedAt: new Date(),
            })
            .where(inArray(orders.id, target.ids))
        }

        await setProgress(`몰 주문단계 전환 중... (${index + 1}/${shippingPrepTargets.length})`)
        return null
      })
      if (confirmErrors.length > 0) {
        await setProgress(`몰 주문단계 전환 일부 실패 ${confirmErrors.length}건 - 주문 저장은 완료`)
      }
    }

    // Local workflow remains: 신규 -> 매핑 -> 사용자 확인. Marketplace shipping
    // prep acknowledgement above is intentionally tracked separately.
    if (ordersCollected > 0) {
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
    const firstItem = items[0]
    const orderForSave = firstItem && items.length > 1
      ? { ...order, items: [firstItem], totalAmount: lineTotalAmount(firstItem) }
      : { ...order, items }
    const orderKey = `${order.marketplaceId}:${order.marketplaceOrderId}`
    if (existingOrderMatches.skipKeys.has(orderKey)) {
      ordersSkipped++
      continue
    }

    const isExistingOrder = existingOrderMatches.upsertKeys.has(orderKey)
    const [upsertedOrder] = await upsertOrder(orderForSave, connectionId, userId)

    // Absolute order storage rule: every multi-item marketplace order is stored as split rows.
    if (!isExistingOrder && items.length > 0) {
      await db.insert(orderItems).values(orderItemInsertValue(upsertedOrder.id, items[0]))
      await createSplitOrderCopies(order, items, upsertedOrder.id, connectionId, userId)
    } else if (isExistingOrder && items.length > 1) {
      await ensureSplitOrderCopies(order, items, upsertedOrder.id, connectionId, userId)
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
      connectionId: orders.connectionId,
      rawData: orders.rawData,
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
      if (isProtectedExcelCollectedOrder(exact)) {
        skipKeys.add(orderKey)
        continue
      }
      upsertKeys.add(orderKey)
      continue
    }

    if (existing.length > 0) {
      skipKeys.add(orderKey)
    }
  }

  return { upsertKeys, skipKeys }
}

function rawText(rawData: unknown, key: string): string {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return ''
  const value = (rawData as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isProtectedExcelCollectedOrder(order: {
  connectionId: string | null
  rawData: unknown
}): boolean {
  if (order.connectionId) return false

  const source = rawText(order.rawData, 'source')
  const collectionSource = rawText(order.rawData, 'collectionSource')
  const sourceFileName = rawText(order.rawData, 'sourceFileName')
  const importTemplateId = rawText(order.rawData, 'importTemplateId')

  return (
    collectionSource === 'order-excel'
    || collectionSource === 'sabangnet-excel'
    || collectionSource.startsWith('sabangnet-')
    || source === 'sabangnet'
    || source.startsWith('sabangnet-')
    || sourceFileName.includes('sabangnet')
    || sourceFileName.includes('사방넷')
    || importTemplateId.includes('sabangnet')
    || importTemplateId.includes('사방넷')
  )
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
  const enrichedOrder = withFallbackOrderFields(order, rawData)
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
      marketplaceStatus: enrichedOrder.marketplaceStatus,
      marketplaceCollectionStatus,
      buyerName: enrichedOrder.buyerName,
      buyerPhone: enrichedOrder.buyerPhone,
      buyerPhone2: enrichedOrder.buyerPhone2,
      recipientName: enrichedOrder.recipientName,
      recipientPhone: enrichedOrder.recipientPhone,
      recipientPhone2: enrichedOrder.recipientPhone2,
      shippingAddress: enrichedOrder.shippingAddress,
      orderedAt: enrichedOrder.orderedAt,
      totalAmount: String(enrichedOrder.totalAmount ?? 0),
      shippingFee: enrichedOrder.shippingFee != null ? String(enrichedOrder.shippingFee) : null,
      deliveryMessage: enrichedOrder.deliveryMessage ?? null,
      rawData,
      collectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [orders.marketplaceId, orders.marketplaceOrderId],
      // partial unique index — 복사본은 제외하고 원본끼리만 dedup
      targetWhere: sql`is_copy = false`,
      set: {
        status: updateStatus,
        marketplaceStatus: enrichedOrder.marketplaceStatus,
        marketplaceCollectionStatus,
        totalAmount: String(enrichedOrder.totalAmount ?? 0),
        shippingFee: enrichedOrder.shippingFee != null ? String(enrichedOrder.shippingFee) : null,
        buyerName: enrichedOrder.buyerName,
        buyerPhone: enrichedOrder.buyerPhone,
        buyerPhone2: enrichedOrder.buyerPhone2,
        recipientName: enrichedOrder.recipientName,
        recipientPhone: enrichedOrder.recipientPhone,
        recipientPhone2: enrichedOrder.recipientPhone2,
        shippingAddress: enrichedOrder.shippingAddress,
        deliveryMessage: enrichedOrder.deliveryMessage ?? null,
        rawData,
        updatedAt: new Date(),
      },
    })
    .returning({ id: orders.id, status: orders.status })
}

function cleanText(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text && text !== '-' && text !== '--' ? text : undefined
}

function pickText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = cleanText(value)
    if (text) return text
  }
  return undefined
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value == null || value === '') continue
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'object' && value && 'units' in value) {
      const units = Number((value as { units?: unknown }).units)
      if (Number.isFinite(units)) return units
    }
    const parsed = Number(String(value).replaceAll(',', '').replace(/[^\d.-]/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function firstRecordFromArray(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {}
  const first = value.find((item) => item && typeof item === 'object' && !Array.isArray(item))
  return first ? first as Record<string, unknown> : {}
}

function withFallbackOrderFields(order: NormalizedOrder, rawData: Record<string, unknown>): NormalizedOrder {
  const orderer = recordAt(rawData, 'orderer')
  const receiver = recordAt(rawData, 'receiver')
  const buyer = recordAt(rawData, 'buyer')
  const buyerInfo = recordAt(rawData, 'buyerInfo')
  const consumer = recordAt(rawData, 'consumer')
  const delivery = recordAt(rawData, 'delivery')
  const shipment = recordAt(rawData, 'shipment')
  const shipping = recordAt(rawData, 'shipping')
  const shippingInfo = recordAt(rawData, 'shippingInfo')
  const shippingSender = recordAt(shippingInfo, 'sender')
  const shippingRecipient = recordAt(shippingInfo, 'recipient')
  const destinationAddress = recordAt(shippingRecipient, 'destinationAddress')
  const sabangnetRaw = recordAt(rawData, 'sabangnetRaw')
  const firstRowRaw = recordAt(firstRecordFromArray(rawData.rows), 'raw')
  const marketplaceRaw = Object.keys(sabangnetRaw).length > 0 ? sabangnetRaw : firstRowRaw
  const firstRawItem = firstRecordFromArray(rawData.orderItems)
  const fallbackRawItem = Object.keys(firstRawItem).length > 0 ? firstRawItem : firstRecordFromArray(rawData.items)

  const buyerPhone = pickText(
    order.buyerPhone,
    orderer.ordererNumber,
    orderer.safeNumber,
    buyerInfo.buyerMobile,
    buyerInfo.buyerPhone,
    buyer.phone,
    shippingSender.phoneNumber,
    rawData.buyerPhone,
    rawData.ordererPhone,
    rawData.ordererTelephoneNo,
    rawData.OrderHtel,
    rawData.OrderTel,
    rawData.SenderNo,
    rawData.ordpeHpno,
    rawData.ordpeTelno,
    marketplaceRaw['주문자전화번호'],
    marketplaceRaw['주문자연락처'],
    marketplaceRaw['주문자핸드폰'],
    marketplaceRaw['주문자휴대폰'],
    marketplaceRaw['전화번호'],
    marketplaceRaw['휴대폰'],
  )
  const recipientPhone = pickText(
    order.recipientPhone,
    receiver.receiverNumber,
    receiver.safeNumber,
    consumer.mobile,
    consumer.phone,
    shipping.phone,
    shippingRecipient.phoneNumber,
    rawData.recipientPhone,
    rawData.receiverPhone,
    rawData.recipientMobilePhoneNo,
    rawData.recipientTelephoneNo,
    rawData.RecipientHtel,
    rawData.RecipientTel,
    rawData.rcptpeHpno,
    rawData.rcptpeTelno,
    marketplaceRaw['수취인전화번호'],
    marketplaceRaw['수취인연락처'],
    marketplaceRaw['수취인핸드폰'],
    marketplaceRaw['수취인휴대폰'],
    marketplaceRaw['수령자전화번호'],
    marketplaceRaw['수령자연락처'],
    buyerPhone,
  )
  const buyerPhone2 = pickText(order.buyerPhone2, order.buyerPhone && order.buyerPhone !== buyerPhone ? order.buyerPhone : undefined)
  const recipientPhone2 = pickText(order.recipientPhone2, order.recipientPhone && order.recipientPhone !== recipientPhone ? order.recipientPhone : undefined)
  const shippingFee = order.shippingFee ?? pickNumber(
    rawData.shippingFee,
    rawData.shippingPrice,
    rawData.deliveryFee,
    rawData.customerResponsibilityCost,
    delivery.fee,
    shipment.shippingFee,
    shipping.fee,
    shippingInfo.shippingFee,
    rawData.DelivPrice,
    rawData.shppcst,
    marketplaceRaw['배송비'],
    marketplaceRaw['선결제배송비'],
    marketplaceRaw['착불배송비'],
  )
  const totalAmount = order.totalAmount || pickNumber(
    rawData.totalAmount,
    rawData.paymentAmount,
    rawData.paymentPrice,
    rawData.orderAmount,
    rawData.orderAmt,
    rawData.orderAmtPay,
    fallbackRawItem.orderPrice,
    fallbackRawItem.salesPrice,
    fallbackRawItem.paymentPrice,
    rawData.Price,
    rawData.SupplyPrice,
    rawData.rlordAmt,
    rawData.sellprc,
    marketplaceRaw['최종결제금액'],
    marketplaceRaw['결제금액'],
    marketplaceRaw['판매가x수량'],
    marketplaceRaw['판매가'],
  ) || 0

  return {
    ...order,
    buyerName: pickText(
      order.buyerName,
      orderer.name,
      buyerInfo.buyerName,
      buyer.companyName,
      buyer.ownerName,
      buyer.loginId,
      rawData.ordererName,
      rawData.buyerName,
      rawData.OrderName,
      rawData.Sender,
      rawData.ordpeNm,
      marketplaceRaw['주문자명'],
    ) ?? order.buyerName,
    buyerPhone,
    buyerPhone2,
    recipientName: pickText(
      order.recipientName,
      receiver.name,
      consumer.name,
      shipping.name,
      shippingRecipient.name,
      rawData.recipientName,
      rawData.receiverName,
      rawData.RecipientName,
      rawData.rcptpeNm,
      marketplaceRaw['수취인명'],
      marketplaceRaw['수령자명'],
    ) ?? order.recipientName,
    recipientPhone,
    recipientPhone2,
    shippingAddress: {
      zipCode: pickText(order.shippingAddress.zipCode, receiver.postCode, consumer.zipcode, shipping.zip, destinationAddress.postalCode, rawData.postalCode, rawData.RecipientZip, rawData.shpplocZipcd, marketplaceRaw['우편번호']) ?? '',
      address1: pickText(order.shippingAddress.address1, receiver.addr1, consumer.address, shipping.address, destinationAddress.addr1, rawData.address, rawData.RecipientAddress, rawData.shpplocRoadAddr, rawData.shpplocAddr, rawData.shpplocBascAddr, marketplaceRaw['주소']) ?? '',
      address2: pickText(order.shippingAddress.address2, receiver.addr2, shipping.addressDetail, destinationAddress.addr2, rawData.shpplocDtlAddr, marketplaceRaw['상세주소']) ?? undefined,
    },
    totalAmount,
    shippingFee,
    deliveryMessage: pickText(
      order.deliveryMessage,
      rawData.parcelPrintMessage,
      rawData.deliveryNote,
      shipping.memo,
      consumer.deliReq,
      rawData.Msg,
      rawData.Note,
      rawData.ordMemoCntt,
      marketplaceRaw['배송메세지'],
      marketplaceRaw['배송메시지'],
      marketplaceRaw['물류메세지'],
      marketplaceRaw['물류메시지'],
    ) ?? null,
  }
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

async function normalizeBaseOrderItem(baseOrderId: string, item: NormalizedOrderItem): Promise<void> {
  const existingItems = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, baseOrderId))
    .orderBy(orderItems.id)

  const value = orderItemInsertValue(baseOrderId, item)
  const [firstExistingItem, ...extraItems] = existingItems

  if (firstExistingItem) {
    await db
      .update(orderItems)
      .set({
        marketplaceItemId: value.marketplaceItemId,
        productName: value.productName,
        optionText: value.optionText,
        quantity: value.quantity,
        unitPrice: value.unitPrice,
        sku: value.sku,
      })
      .where(eq(orderItems.id, firstExistingItem.id))
  } else {
    await db.insert(orderItems).values(value)
  }

  if (extraItems.length > 0) {
    await db
      .delete(orderItems)
      .where(inArray(orderItems.id, extraItems.map((existingItem) => existingItem.id)))
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
  const copyStatus = collectedOrderStatus(order.status, order.marketplaceId)

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
        status: copyStatus,
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

async function ensureSplitOrderCopies(
  order: NormalizedOrder,
  items: NormalizedOrderItem[],
  baseOrderId: string,
  connectionId: string,
  userId: string,
): Promise<string[]> {
  if (items.length <= 1) {
    if (items[0]) await normalizeBaseOrderItem(baseOrderId, items[0])
    await db
      .delete(orders)
      .where(
        and(
          eq(orders.userId, userId),
          eq(orders.marketplaceId, order.marketplaceId),
          eq(orders.marketplaceOrderId, order.marketplaceOrderId),
          eq(orders.isCopy, true),
        ),
      )
    return []
  }

  await normalizeBaseOrderItem(baseOrderId, items[0])

  const existingCopies = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.marketplaceId, order.marketplaceId),
        eq(orders.marketplaceOrderId, order.marketplaceOrderId),
        eq(orders.isCopy, true),
      ),
    )
    .orderBy(orders.createdAt, orders.id)

  const now = new Date()
  const splitBase = {
    sourceOrderId: baseOrderId,
    splitAt: now.toISOString(),
    totalParts: items.length,
  }
  const copyStatus = collectedOrderStatus(order.status, order.marketplaceId)

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

  const expectedCopyCount = Math.max(0, items.length - 1)
  const reusableCopies = existingCopies.slice(0, expectedCopyCount)
  const staleCopies = existingCopies.slice(expectedCopyCount)

  if (staleCopies.length > 0) {
    await db
      .delete(orders)
      .where(inArray(orders.id, staleCopies.map((copy) => copy.id)))
  }

  const copyIds: string[] = []
  for (let index = 1; index < items.length; index += 1) {
    const item = items[index]
    const existingCopy = reusableCopies[index - 1]
    if (existingCopy) {
      await updateSplitOrderCopy(existingCopy.id, order, item, connectionId, {
        ...splitBase,
        partIndex: index + 1,
        originalOrderId: baseOrderId,
      })
      copyIds.push(existingCopy.id)
      continue
    }

    const [copy] = await db
      .insert(orders)
      .values({
        internalNo: generateInternalNo(),
        userId,
        connectionId,
        marketplaceId: order.marketplaceId,
        marketplaceOrderId: order.marketplaceOrderId,
        status: copyStatus,
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

async function updateSplitOrderCopy(
  copyOrderId: string,
  order: NormalizedOrder,
  item: NormalizedOrderItem,
  connectionId: string,
  splitMeta: Record<string, unknown>,
): Promise<void> {
  const now = new Date()
  const copyStatus = collectedOrderStatus(order.status, order.marketplaceId)
  await db
    .update(orders)
    .set({
      connectionId,
      status: copyStatus,
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
      rawData: itemSplitRawData(enrichOrderRawData({ ...order, items: [item], totalAmount: lineTotalAmount(item) }), splitMeta),
      collectedAt: now,
      updatedAt: now,
    })
    .where(eq(orders.id, copyOrderId))

  await db.delete(orderItems).where(eq(orderItems.orderId, copyOrderId))
  await db.insert(orderItems).values(orderItemInsertValue(copyOrderId, item))
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
