import { MarketplaceApiError } from '@/lib/marketplace/errors'
import type {
  InvoiceData,
  MarketplaceId,
  NormalizedClaim,
  NormalizedOrder,
} from '@/lib/marketplace/types'
import type {
  MarketplaceScraper,
  ScraperCredentials,
  ScraperLoginResult,
} from '../types'

const ALWAYS_SELLER_URL = 'https://alwayzseller.ilevit.com'
const ALWAYS_API_BASE_URL = 'https://alwayz-seller-back.ilevit.com'
const TOKEN_STORAGE_KEY = '@alwayz@seller@token@'

type JsonRecord = Record<string, unknown>

function logStep(step: string): void {
  console.log(`[올웨이즈-rpa] ${step}`)
}

function authHeaders(token?: string): HeadersInit {
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    origin: ALWAYS_SELLER_URL,
    referer: `${ALWAYS_SELLER_URL}/`,
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(token ? { 'x-access-token': token } : {}),
  }
}

async function requestAlways(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<unknown> {
  const response = await fetch(`${ALWAYS_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(options.token),
      ...(options.headers ?? {}),
    },
  })
  const text = await response.text()
  let payload: unknown = text
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'msg' in payload
      ? String((payload as { msg?: unknown }).msg)
      : text.slice(0, 240)
    throw new MarketplaceApiError('always', response.status, message || '올웨이즈 요청 실패')
  }
  return payload
}

function tokenFromStorageState(storageState?: string): string | null {
  if (!storageState) return null
  try {
    const parsed = JSON.parse(storageState) as unknown
    if (parsed && typeof parsed === 'object' && 'alwaysToken' in parsed) {
      const token = (parsed as { alwaysToken?: unknown }).alwaysToken
      return typeof token === 'string' && token ? token : null
    }
    if (parsed && typeof parsed === 'object' && 'origins' in parsed) {
      const origins = (parsed as { origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }> }).origins ?? []
      for (const origin of origins) {
        const token = origin.localStorage?.find((item) => item.name === TOKEN_STORAGE_KEY)?.value
        if (token) return token
      }
    }
  } catch {
    return null
  }
  return null
}

function readString(record: JsonRecord, aliases: string[]): string {
  for (const alias of aliases) {
    const value = record[alias]
    if (value === null || value === undefined) continue
    if (typeof value === 'object') continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function readNestedNumber(record: JsonRecord, paths: string[]): number {
  const text = readNestedString(record, paths)
  const num = Number(text.replaceAll(',', '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(num) ? num : 0
}

function readNestedString(record: JsonRecord, paths: string[]): string {
  for (const path of paths) {
    let value: unknown = record
    for (const part of path.split('.')) {
      if (!isRecord(value)) {
        value = undefined
        break
      }
      value = value[part]
    }
    if (value === null || value === undefined) continue
    const text = typeof value === 'object' ? '' : String(value).trim()
    if (text) return text
  }
  return ''
}

function readNumber(record: JsonRecord, aliases: string[]): number {
  const text = readString(record, aliases)
  const num = Number(text.replaceAll(',', '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(num) ? num : 0
}

function readDate(record: JsonRecord, aliases: string[]): Date {
  const text = readString(record, aliases)
  if (!text) return new Date()
  const normalized = text.includes('T') ? text : text.replace(/\s+/, 'T')
  const date = new Date(normalized.includes('+') || normalized.endsWith('Z') ? normalized : `${normalized}+09:00`)
  return Number.isNaN(date.getTime()) ? new Date(text) : date
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function collectOrderLikeRecords(payload: unknown): JsonRecord[] {
  const results: JsonRecord[] = []
  const visited = new Set<unknown>()
  const visit = (value: unknown) => {
    if (!value || visited.has(value)) return
    if (typeof value === 'object') visited.add(value)
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isRecord(value)) return
    if (isAlwaysDashboardOrder(value)) results.push(value)
    for (const child of Object.values(value)) {
      if (Array.isArray(child) || isRecord(child)) visit(child)
    }
  }
  visit(payload)
  return results
}

function isAlwaysDashboardOrder(row: JsonRecord): boolean {
  const status = readString(row, ['status', 'orderStatus', 'shippingStatus', 'displayStatus'])
  const orderedAt = readString(row, ['payedAt', 'paidAt', 'orderedAt', 'createdAt', 'orderCreatedAt'])
  const hasProduct = isRecord(row.itemInfo) || isRecord(row.item) || isRecord(row.product)
  const hasOrderIdentity = Boolean(readString(row, ['orderId', 'orderNumber', 'orderNo', 'id', '_id', 'merchantOrderId']))
  return hasOrderIdentity && hasProduct && Boolean(orderedAt) && /pre-shipping|paid|payed|payment|결제|신규|주문|shipping/i.test(status)
}

function readAlwaysOptionText(row: JsonRecord): string {
  const selectedOption = isRecord(row.selectedOption) ? row.selectedOption : null
  const selectedId = selectedOption ? readString(selectedOption, ['_id', 'id']) : ''
  const optionsInfo = isRecord(row.itemInfo) && isRecord(row.itemInfo.optionsInfo) ? row.itemInfo.optionsInfo : null
  const totalOptions = Array.isArray(optionsInfo?.totalOptions) ? optionsInfo.totalOptions : []
  const names: string[] = []
  for (const group of totalOptions) {
    if (!Array.isArray(group)) continue
    for (const option of group) {
      if (!isRecord(option)) continue
      const optionId = readString(option, ['_id', 'id'])
      const optionName = readString(option, ['name', 'label', 'value'])
      if (optionName && (!selectedId || selectedId === optionId)) names.push(optionName)
    }
  }
  return names.join(' / ')
}

function collectAlwaysOrderRows(payloads: unknown[]): JsonRecord[] {
  return payloads.flatMap(collectOrderLikeRecords)
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

async function markAlwaysPreShippingOrdersExcelDownloaded(
  token: string,
  orderIds: string[],
): Promise<void> {
  const ids = uniqueStrings(orderIds)
  if (ids.length === 0) return

  const payload = await requestAlways('/sellers/orders/pre-shipping', {
    method: 'PUT',
    token,
    body: JSON.stringify({ orderIds: ids }),
  })
  const status = isRecord(payload) ? readNumber(payload, ['status']) : 0
  if (status && status !== 200) {
    throw new MarketplaceApiError('always', status, '올웨이즈 주문 상품준비중 전환 실패')
  }
}

function normalizeAlwaysOrder(row: JsonRecord): NormalizedOrder | null {
  const orderId = readString(row, [
    'orderId',
    'orderNumber',
    'orderNo',
    'id',
    '_id',
    'merchantOrderId',
  ])
  if (!orderId) return null

  const itemId = readString(row, [
    'itemId',
    'dealItemId',
    'orderItemId',
    'productId',
    'catalogId',
    'id',
    '_id',
  ]) || orderId
  const productName = readString(row, [
    'itemName',
    'productName',
    'goodsName',
    'dealName',
    'name',
    'title',
  ]) || readNestedString(row, ['itemInfo.itemTitle', 'itemInfo.title', 'item.name', 'product.name']) || '올웨이즈 상품'
  const quantity = readNumber(row, ['quantity', 'qty', 'count', 'itemCount', 'orderCount']) || 1
  const unitPrice = readNumber(row, ['unitPrice', 'price', 'salesPrice', 'itemPrice', 'paidPrice'])
  const marketplaceStatus = readString(row, ['status', 'orderStatus', 'shippingStatus', 'displayStatus']) || 'unknown'
  const normalizedStatus: NormalizedOrder['status'] = /취소|cancel/i.test(marketplaceStatus)
    ? 'cancelled'
    : /pre-shipping|상품\s*준비|주문\s*확인/i.test(marketplaceStatus)
      ? 'confirmed'
      : 'new'
  const orderedAt = readDate(row, ['payedAt', 'paidAt', 'orderedAt', 'createdAt', 'created_at', 'orderCreatedAt'])
  const address = readString(row, ['address', 'address1', 'shippingAddress', 'receiverAddress', 'roadAddress'])
    || readNestedString(row, ['shippingAddressInfo.address', 'shippingAddressInfo.address1', 'shippingInfo.address'])
    || readNestedString(row, ['addressInfo.postcodeAddress'])
  const zipCode = readString(row, ['zipCode', 'zipcode', 'postalCode', 'zonecode'])
    || readNestedString(row, ['shippingAddressInfo.zipCode', 'shippingAddressInfo.postalCode'])
    || readNestedString(row, ['addressInfo.postcode'])

  return {
    marketplaceOrderId: orderId,
    marketplaceId: 'always',
    marketplaceStatus,
    status: normalizedStatus,
    buyerName: readString(row, ['buyerName', 'ordererName', 'userName', 'nickname'])
      || readNestedString(row, ['userInfo.name', 'ordererInfo.name'])
      || '-',
    buyerPhone: readString(row, ['buyerPhone', 'ordererPhoneNumber', 'phoneNumber', 'userPhoneNumber'])
      || readNestedString(row, ['userInfo.phoneNumber', 'ordererInfo.phoneNumber']),
    buyerPhone2: readString(row, ['buyerPhone2', 'ordererMobilePhoneNumber', 'mobilePhoneNumber']),
    recipientName: readString(row, ['recipientName', 'receiverName', 'nameReceiver', 'shippingName'])
      || readNestedString(row, ['shippingAddressInfo.name', 'receiverInfo.name'])
      || readNestedString(row, ['addressInfo.recipient'])
      || '-',
    recipientPhone: readString(row, ['recipientPhone', 'receiverPhoneNumber', 'shippingPhoneNumber'])
      || readNestedString(row, ['shippingAddressInfo.phoneNumber', 'receiverInfo.phoneNumber']),
    recipientPhone2: readString(row, ['recipientPhone2', 'receiverMobilePhoneNumber', 'shippingMobilePhoneNumber'])
      || readNestedString(row, ['addressInfo.recipientPhoneNumber']),
    shippingAddress: {
      zipCode,
      address1: address,
      address2: readString(row, ['address2', 'shippingAddressDetail', 'receiverAddressDetail', 'detailAddress'])
        || readNestedString(row, ['addressInfo.detailAddress']),
    },
    items: [{
      marketplaceItemId: itemId,
      productName,
      optionText: readString(row, ['optionName', 'optionText', 'selectedOption', 'option'])
        || readNestedString(row, ['itemInfo.optionName', 'itemInfo.selectedOption'])
        || readAlwaysOptionText(row),
      quantity,
      unitPrice,
      sku: readString(row, ['sku', 'sellerSku', 'itemCode']),
    }],
    orderedAt,
    totalAmount: readNumber(row, ['totalAmount', 'totalPrice', 'paidPrice', 'paymentAmount']) || unitPrice * quantity,
    shippingType: readString(row, ['shippingType', 'deliveryType']) || null,
    shippingFee: readNumber(row, ['shippingFee', 'deliveryFee'])
      || readNestedNumber(row, ['itemInfo.shippingInfo.shippingFee'])
      || null,
    deliveryMessage: readString(row, ['deliveryMessage', 'shippingMessage', 'memo']) || null,
    rawData: row,
  }
}

function uniqueOrders(rows: NormalizedOrder[]): NormalizedOrder[] {
  const byKey = new Map<string, NormalizedOrder>()
  for (const order of rows) {
    const itemKey = order.items.map((item) => item.marketplaceItemId).join(',')
    byKey.set(`${order.marketplaceOrderId}:${itemKey}`, order)
  }
  return [...byKey.values()]
}

export class AlwaysScraper implements MarketplaceScraper {
  readonly marketplaceId: MarketplaceId = 'always'
  readonly displayName = '올웨이즈'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    try {
      logStep('login: request token')
      const payload = await requestAlways('/sellers/login', {
        method: 'POST',
        body: JSON.stringify({
          sellerName: credentials.email,
          password: credentials.password,
        }),
      })
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
      const token = data ? readString(data, ['token', 'accessToken']) : ''
      if (!token) {
        return { success: false, error: '올웨이즈 로그인 토큰을 받지 못했습니다.' }
      }
      return {
        success: true,
        storageState: JSON.stringify({
          alwaysToken: token,
          origins: [{
            origin: ALWAYS_SELLER_URL,
            localStorage: [{ name: TOKEN_STORAGE_KEY, value: token }],
          }],
        }),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '올웨이즈 로그인 실패',
      }
    }
  }

  async testSession(credentials: ScraperCredentials): Promise<{ ok: boolean; error?: string }> {
    const token = tokenFromStorageState(credentials.storageState)
    if (!token) return { ok: false, error: '올웨이즈 저장 세션이 없습니다.' }
    try {
      await requestAlways('/sellers', { method: 'GET', token })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '올웨이즈 세션 확인 실패' }
    }
  }

  async getOrders(
    credentials: ScraperCredentials,
    since: Date,
    setProgress?: (message: string) => Promise<void>,
  ): Promise<NormalizedOrder[]> {
    let token = tokenFromStorageState(credentials.storageState)
    if (!token) {
      const login = await this.login(credentials)
      if (!login.success || !login.storageState) {
        throw new MarketplaceApiError('always', 401, login.error ?? '올웨이즈 로그인 실패')
      }
      token = tokenFromStorageState(login.storageState)
    }
    if (!token) throw new MarketplaceApiError('always', 401, '올웨이즈 로그인 토큰이 없습니다.')

    await setProgress?.('올웨이즈 주문 API 조회 중...')
    const sinceIso = since.toISOString()
    const initialPayloads: unknown[] = []
    const preExcelPayloads: unknown[] = []
    const initialRequests: Array<Promise<unknown>> = [
      requestAlways('/sellers/orders/status/info-request', {
        method: 'POST',
        token,
        body: JSON.stringify({ status: 'pre-shipping', payedAt: sinceIso, preExcel: false }),
      }),
      requestAlways('/sellers/orders/status/pre-excel/info-request', {
        method: 'POST',
        token,
        body: JSON.stringify({ status: 'pre-shipping', payedAt: sinceIso, itemIds: [] }),
      }),
      requestAlways('/sellers/orders/status/post-excel/info-request', {
        method: 'POST',
        token,
        body: JSON.stringify({ status: 'pre-shipping', payedAt: sinceIso }),
      }),
    ]
    const initialResults = await Promise.allSettled(initialRequests)
    for (const [index, result] of initialResults.entries()) {
      if (result.status !== 'fulfilled') continue
      initialPayloads.push(result.value)
      if (index === 1) preExcelPayloads.push(result.value)
    }

    const initialRows = collectAlwaysOrderRows(preExcelPayloads)
    const preExcelOrderIds = uniqueStrings(
      initialRows
        .filter((row) => !readString(row, ['excelDownloadedAt']))
        .map((row) => readString(row, ['orderId', 'orderNumber', 'orderNo', 'id', '_id', 'merchantOrderId'])),
    )

    let payloads = initialPayloads
    if (preExcelOrderIds.length > 0) {
      await setProgress?.(`올웨이즈 상품준비중 전환 중... (${preExcelOrderIds.length}건)`)
      await markAlwaysPreShippingOrdersExcelDownloaded(token, preExcelOrderIds)
      const postExcelPayload = await requestAlways('/sellers/orders/status/post-excel/info-request', {
        method: 'POST',
        token,
        body: JSON.stringify({ status: 'pre-shipping', payedAt: sinceIso }),
      })
      payloads = [...initialPayloads, postExcelPayload]
    }

    const orders = collectAlwaysOrderRows(payloads)
      .map(normalizeAlwaysOrder)
      .filter((order): order is NormalizedOrder => Boolean(order))
      .filter((order) => order.orderedAt >= since)

    return uniqueOrders(orders)
  }

  async getClaimsOrders(): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(
    credentials: ScraperCredentials,
    orderId: string,
    invoice: InvoiceData,
  ): Promise<{ success: boolean; error?: string }> {
    void credentials
    void orderId
    void invoice
    return {
      success: false,
      error: '올웨이즈 RPA 송장 전송은 주문수집 안정화 후 별도 구현이 필요합니다.',
    }
  }
}
