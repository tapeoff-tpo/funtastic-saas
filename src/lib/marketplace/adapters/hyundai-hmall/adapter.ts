import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedOrderItem,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedProduct,
  InvoiceData,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { buildHmallXml, createHyundaiHmallClient, normalizeHyundaiHmallBaseUrl, parseHmallXml } from './client'
import { mapHyundaiHmallStatus } from './status-map'
import type { HyundaiHmallOrderRow, HyundaiHmallXmlResponse } from './types'

const HYUNDAI_HMALL_CONFIG: MarketplaceConfig = {
  id: 'hyundai-hmall',
  name: '현대홈쇼핑',
  authType: 'api_key',
  rateLimitPerSecond: 2,
  requiredCredentials: ['oauser_id', 'oause_key', 'ven_cd'],
}

const PROGRESS_CODES = ['P0', 'P1', 'P2', 'P3']

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function optionalText(value: unknown): string | undefined {
  const valueText = text(value)
  return valueText ? valueText : undefined
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(text(value).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function formatDate(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return [
    kst.getUTCFullYear(),
    String(kst.getUTCMonth() + 1).padStart(2, '0'),
    String(kst.getUTCDate()).padStart(2, '0'),
  ].join('')
}

function parseDate(value: unknown): Date {
  const raw = text(value)
  if (!raw) return new Date()
  const normalized = raw.length === 8
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00+09:00`
    : raw.replace(' ', 'T')
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

function datasetRows(response: HyundaiHmallXmlResponse): HyundaiHmallOrderRow[] {
  const datasets = [
    ...asArray(response.Response2XML?.Dataset),
    ...asArray(response.Dataset),
  ]
  const rows = datasets.flatMap((dataset) => [
    ...asArray(dataset.rows?.row),
    ...asArray(dataset.row),
  ])
  return rows.filter((row): row is HyundaiHmallOrderRow => Boolean(row && typeof row === 'object'))
}

function responseError(response: HyundaiHmallXmlResponse): string | null {
  if (!response.error) return null
  return [response.error.code, response.error.message, response.error.detail].map(text).filter(Boolean).join(': ')
}

function orderKey(row: HyundaiHmallOrderRow): string {
  return [
    row.ordNo,
    row.ordPtcSeq,
    row.dlvstNo,
    row.dlvstPtcSeq,
  ].map(text).filter(Boolean).join('-')
}

function hmallIdentity(rawData?: Record<string, unknown>): {
  venCd: string
  ven2Cd: string
  dlvstNo: string
  dlvstPtcSeq: string
  ordNo: string
  ordPtcSeq: string
} | null {
  const venCd = text(rawData?.venCd)
  const ven2Cd = text(rawData?.ven2Cd)
  const dlvstNo = text(rawData?.dlvstNo)
  const dlvstPtcSeq = text(rawData?.dlvstPtcSeq)
  const ordNo = text(rawData?.ordNo)
  const ordPtcSeq = text(rawData?.ordPtcSeq)
  if (!venCd || !dlvstNo || !dlvstPtcSeq || !ordNo || !ordPtcSeq) return null
  return { venCd, ven2Cd: ven2Cd || '000000', dlvstNo, dlvstPtcSeq, ordNo, ordPtcSeq }
}

export class HyundaiHmallAdapter implements MarketplaceAdapter {
  readonly config = HYUNDAI_HMALL_CONFIG

  private readonly client: ReturnType<typeof createHyundaiHmallClient>
  private readonly credentials: {
    oauser_id: string
    oause_key: string
    ven_cd: string
    ven2_cd?: string
    mda_gb?: string
    dlv_form_gbcd?: string
    base_url?: string
    rgst_ip?: string
  }

  constructor(credentials: {
    oauser_id: string
    oause_key: string
    ven_cd: string
    ven2_cd?: string
    mda_gb?: string
    dlv_form_gbcd?: string
    base_url?: string
    rgst_ip?: string
  }) {
    this.credentials = credentials
    this.client = createHyundaiHmallClient(credentials)
  }

  async testConnection(
    _credentials?: MarketplaceCredentials
  ): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    void _credentials
    try {
      const response = await this.postXml('/dd/ddb/ddbd/selectDsDlvcoCdList.do', {})
      const error = responseError(response)
      if (error) return { success: false, error }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    return { success: true }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    try {
      const batches = await Promise.all(
        PROGRESS_CODES.map((prgrGb) => this.listOutboundOrders(since, until, prgrGb)),
      )
      const seen = new Set<string>()
      const orders: NormalizedOrder[] = []
      for (const row of batches.flat()) {
        const key = orderKey(row)
        if (!key || seen.has(key)) continue
        seen.add(key)
        orders.push(this.normalizeOrder(row))
      }
      return orders
    } catch (error) {
      if (error instanceof MarketplaceApiError || error instanceof MarketplaceAuthError) throw error
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('401') || message.includes('403') || message.includes('permission denied')) {
        throw new MarketplaceAuthError('hyundai-hmall', message)
      }
      throw new MarketplaceApiError('hyundai-hmall', 500, message)
    }
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    void _since
    return []
  }

  async uploadInvoice(_orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    const identity = hmallIdentity(invoice.rawData as Record<string, unknown> | undefined)
    if (!identity) return { success: false, error: '현대몰 송장등록에 필요한 주문 식별값이 없습니다.' }

    return this.processOutbound({
      ...identity,
      procGb: 'P2',
      invcNo: invoice.trackingNumber,
      dsrvDlvcoCd: text(invoice.carrierId),
    })
  }

  async confirmOrder(
    _marketplaceOrderId: string,
    rawData?: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    const identity = hmallIdentity(rawData)
    if (!identity) return { success: false, error: '현대몰 주문확인에 필요한 주문 식별값이 없습니다.' }
    return this.processOutbound({ ...identity, procGb: 'P1' })
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(_product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    void _product
    return { success: false, error: '현대몰 상품등록은 주문수집 안정화 후 연결합니다.' }
  }

  async updateProduct(_marketplaceProductId: string, _product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    void _marketplaceProductId
    void _product
    return { success: false, error: '현대몰 상품수정은 주문수집 안정화 후 연결합니다.' }
  }

  private async postXml(path: string, row: Record<string, unknown>): Promise<HyundaiHmallXmlResponse> {
    const body = buildHmallXml([row])
    const cleanPath = path.replace(/^\//, '')
    const endpoint = `${normalizeHyundaiHmallBaseUrl(this.credentials.base_url)}/${cleanPath}`
    try {
      const textResponse = await this.client.post(cleanPath, { body }).text()
      const parsed = parseHmallXml<HyundaiHmallXmlResponse>(textResponse)
      const error = responseError(parsed)
      if (error) throw new MarketplaceApiError('hyundai-hmall', 400, error)
      return parsed
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
      const message = error instanceof Error ? error.message : String(error)
      throw new MarketplaceApiError('hyundai-hmall', 500, `Hmall API request failed: ${endpoint}: ${message}${cause}`)
    }
  }

  private async listOutboundOrders(since: Date, until: Date, prgrGb: string): Promise<HyundaiHmallOrderRow[]> {
    const response = await this.postXml('/sc/scb/scbd/selectOshpDtlList.do', {
      venCd: this.credentials.ven_cd,
      ven2Cd: this.credentials.ven2_cd || '000000',
      fromDate: formatDate(since),
      toDate: formatDate(until),
      mdaGb: this.credentials.mda_gb ?? '',
      prgrGb,
      dlvFormGbcd: this.credentials.dlv_form_gbcd ?? '',
      ordNo: '',
      ordPtcSeq: '',
      drctBuyYn: '',
    })
    return datasetRows(response).map((row) => ({
      ...row,
      collectionPrgrGb: prgrGb,
    }))
  }

  private async processOutbound(params: {
    venCd: string
    ven2Cd: string
    dlvstNo: string
    dlvstPtcSeq: string
    ordNo: string
    ordPtcSeq: string
    procGb: string
    invcNo?: string
    dsrvDlvcoCd?: string
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.postXml('/sc/scb/scbd/multiOshpProcess.do', {
        chk: '1',
        venCd: params.venCd,
        ven2Cd: params.ven2Cd || '000000',
        dlvstNo: params.dlvstNo,
        dlvstPtcSeq: params.dlvstPtcSeq,
        ordNo: params.ordNo,
        ordPtcSeq: params.ordPtcSeq,
        procGb: params.procGb,
        invcNo: params.invcNo ?? '',
        dsrvDlvcoCd: params.dsrvDlvcoCd ?? '',
        rgstId: this.credentials.oauser_id,
        rgstIp: this.credentials.rgst_ip ?? '',
      })
      const error = responseError(response)
      return error ? { success: false, error } : { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(row: HyundaiHmallOrderRow): NormalizedOrder {
    const orderId = text(row.ordNo) || text(row.dlvstNo)
    const itemId = orderKey(row) || orderId
    const quantity = toNumber(row.dlvstQty ?? row.ordQty ?? row.prrgQty, 1)
    const totalAmount = toNumber(row.sellSum, 0)
    const unitPrice = toNumber(row.sellUprc, totalAmount > 0 ? totalAmount / Math.max(quantity, 1) : 0)
    const item: NormalizedOrderItem = {
      marketplaceItemId: itemId,
      productName: text(row.slitmNm) || text(row.slitmCd) || '현대몰 상품',
      optionText: optionalText(row.uitmTotNm),
      quantity,
      unitPrice,
      sku: optionalText(row.uitmCd ?? row.slitmCd),
    }
    const progressCode = text(row.collectionPrgrGb || row.lastDlvstPrgrGbcd)

    return {
      marketplaceOrderId: orderId || itemId,
      marketplaceId: 'hyundai-hmall',
      marketplaceStatus: progressCode || 'P0',
      status: mapHyundaiHmallStatus({
        progressCode,
        confirmedAt: optionalText(row.oshpCnfmDtm),
        invoiceNo: optionalText(row.invcNo),
        cancelled: optionalText(row.dlvCnclYn),
      }),
      buyerName: text(row.ordCustNm ?? row.dlvApltNm),
      buyerPhone: optionalText(row.ordCustTel),
      buyerPhone2: optionalText(row.ordCustHp ?? row.dlvApltTel),
      recipientName: text(row.rcvrNm),
      recipientPhone: optionalText(row.rcvrTel),
      recipientPhone2: optionalText(row.rcvrHp),
      shippingAddress: {
        zipCode: text(row.dstnPostNo),
        address1: text(row.dstnAdr),
        address2: optionalText(row.dstnDtlAdr),
      },
      items: [item],
      orderedAt: parseDate(row.oshpReqnDt),
      totalAmount: totalAmount || unitPrice * quantity,
      shippingType: 'prepaid',
      shippingFee: toNumber(row.dlvcAmt, 0),
      deliveryMessage: optionalText(row.dlvMemo),
      rawData: {
        ...row,
        venCd: text(row.venCd) || this.credentials.ven_cd,
        ven2Cd: text(row.ven2Cd) || this.credentials.ven2_cd || '000000',
        orderIdentity: {
          orderId: orderId || itemId,
          itemIds: [itemId],
        },
      },
    }
  }
}
