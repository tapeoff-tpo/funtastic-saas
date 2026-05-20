import ExcelJS from 'exceljs'
import type { Page } from 'playwright'
import { MarketplaceApiError } from '@/lib/marketplace/errors'
import type {
  InvoiceData,
  MarketplaceId,
  NormalizedClaim,
  NormalizedOrder,
} from '@/lib/marketplace/types'
import { dumpStorageState, openContext } from '../browser'
import type {
  MarketplaceScraper,
  ScraperCredentials,
  ScraperLoginResult,
} from '../types'

const WMS_BASE_URL = 'https://www.wholesaledepot.co.kr/wms'
const LOGIN_PAGE_URL = `${WMS_BASE_URL}/login`
const NAVIGATION_TIMEOUT_MS = 20_000
const LOAD_STATE_TIMEOUT_MS = 8_000
const ORDER_LIST_API_PATH = '/wms/order/list'
const ORDER_EXCEL_API_PATH = '/wms/order/list/excel'
const ORDER_PAGE_REFERRER = `${WMS_BASE_URL}/order`

function formatDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function readCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim()
    }
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value && value.result !== undefined) return String(value.result).trim()
  }
  return String(value).trim()
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function parseNumber(value: string): number {
  const num = Number(value.replaceAll(',', '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(num) ? num : 0
}

function parseKstDate(value: string): Date {
  if (!value) return new Date()
  const normalized = value
    .replaceAll('.', '-')
    .replace(/\s+/, 'T')
    .replace(/-(\d)(?=-)/g, '-0$1')
    .replace(/-(\d)(?=T|$)/g, '-0$1')
  const date = new Date(`${normalized}+09:00`)
  return Number.isNaN(date.getTime()) ? new Date(value) : date
}

function logStep(step: string): void {
  console.log(`[domechango-rpa] ${step}`)
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

async function gotoDomechango(page: Page, url = WMS_BASE_URL): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: NAVIGATION_TIMEOUT_MS }).catch((error) => {
    throw new MarketplaceApiError(
      'domechango',
      504,
      `도매창고 페이지 이동이 ${NAVIGATION_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다. (${url}, ${error instanceof Error ? error.message : 'navigation timeout'})`,
    )
  })
  await page.waitForLoadState('domcontentloaded', { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => undefined)
}

async function submitLoginForm(page: Page): Promise<void> {
  const submit = page.locator('#btn_login, button[type="submit"], input[type="submit"], button, input[type="button"]').filter({
    hasText: /로그인|login/i,
  }).first()

  await page
    .waitForFunction(() => {
      const appWindow = window as typeof window & {
        axios?: unknown
        $?: unknown
        common?: unknown
      }
      return Boolean(appWindow.axios && appWindow.$ && appWindow.common)
    }, undefined, { timeout: 10_000 })
    .catch(() => undefined)

  await submit.click({ timeout: 5000 }).catch(async () => {
    await page.keyboard.press('Enter')
  })
  await page.waitForURL((url) => !/\/login(?:$|\?)/.test(url.pathname), { timeout: 20_000 }).catch(() => undefined)
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
}

async function hasOrderList(page: Page): Promise<boolean> {
  if (/login|signin/i.test(page.url())) return false
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  if (/Error\s*\(\d+\)\s*->/i.test(bodyText)) return false
  return /주문\s*리스트|선택주문|택배송장\s*업로드/.test(bodyText)
}

async function hasWmsSession(page: Page): Promise<boolean> {
  if (/login|signin/i.test(page.url())) return false
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  if (/Error\s*\(\d+\)\s*->/i.test(bodyText)) return false
  return /주문\s*\/?\s*배송|긴급처리사항|로그아웃|신규주문|발송대상/.test(bodyText)
}

async function fetchWmsData<T>(
  page: Page,
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const response = await page.evaluate(async ({ path, params }) => {
    const appWindow = window as typeof window & {
      axios?: {
        get: (url: string, config?: { params?: Record<string, string | number | undefined> }) => Promise<{ data: unknown }>
      }
      common?: {
        serialize_object?: (selector: string) => Record<string, unknown>
      }
    }

    const formParams = appWindow.common?.serialize_object?.('#frm') ?? {}
    const mergedParams = { ...formParams, ...params }

    try {
      if (appWindow.axios?.get) {
        const axiosResponse = await appWindow.axios.get(path, { params: mergedParams })
        return { ok: true, status: 200, text: '', json: axiosResponse.data, href: window.location.href }
      }
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: unknown } }).response
      return {
        ok: false,
        status: response?.status ?? 500,
        text: typeof response?.data === 'string' ? response.data.slice(0, 500) : JSON.stringify(response?.data ?? {}).slice(0, 500),
        json: response?.data ?? null,
        href: window.location.href,
      }
    }

    const url = new URL(path, window.location.origin)
    for (const [key, value] of Object.entries(mergedParams)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }

    const res = await fetch(`${url.pathname}${url.search}`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Pragma: 'no-cache',
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      // Keep text for diagnostics below.
    }
    return { ok: res.ok, status: res.status, text: text.slice(0, 500), json, href: window.location.href }
  }, { path, params })

  const json = response.json as { statusCode?: number; data?: T } | null
  if (!response.ok || !json || json.statusCode !== 200) {
    const message = json && 'data' in json ? String(json.data) : response.text
    throw new MarketplaceApiError('domechango', response.status || 500, `도매창고 API 호출 실패: ${path} (${message}, page=${response.href})`)
  }
  return json.data as T
}

async function prepareOrderApiContext(page: Page, since: Date, until: Date): Promise<void> {
  await gotoDomechango(page, WMS_BASE_URL)

  const hasWmsRuntime = await page
    .waitForFunction(() => {
      const appWindow = window as typeof window & {
        axios?: unknown
        common?: unknown
      }
      return Boolean(appWindow.axios && appWindow.common)
    }, undefined, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false)

  if (!hasWmsRuntime) {
    throw new MarketplaceApiError('domechango', 500, `도매창고 WMS 실행 환경을 찾지 못했습니다. (${await summarizePage(page)})`)
  }

  await page.evaluate(({ since, until, orderPageUrl }) => {
    window.history.replaceState(null, '', orderPageUrl)

    let form = document.querySelector<HTMLFormElement>('#frm')
    if (!form) {
      const createdForm = document.createElement('form')
      createdForm.id = 'frm'
      document.body.appendChild(createdForm)
      form = document.querySelector<HTMLFormElement>('#frm')
    }

    const fields = [
      ['page', '1'],
      ['list_size', '500'],
      ['oistep', '1'],
      ['sdate', since],
      ['edate', until],
      ['orderby', 'order_at-desc'],
    ]

    for (const [name, value] of fields) {
      if (!form) continue
      let input = form.querySelector<HTMLInputElement>(`[name="${name}"]`)
      if (!input) {
        input = document.createElement('input')
        input.name = name
        form.appendChild(input)
      }
      input.value = value
    }
  }, { since: formatDateInput(since), until: formatDateInput(until), orderPageUrl: ORDER_PAGE_REFERRER })
}

function buildApiWorkbook(rows: Record<string, unknown>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('orders')
  const columns = [
    ['주문번호', 'oid'],
    ['주문상품번호', 'oiid'],
    ['주문상태', 'status'],
    ['택배업체코드', 'did'],
    ['송장번호', 'dcode'],
    ['수취인명', 'name_receiver'],
    ['수취인전화번호', 'tel_receiver'],
    ['수취인핸드폰', 'hp_receiver'],
    ['우편번호', 'zip_receiver'],
    ['주소', 'addr_receiver'],
    ['상품코드', 'goodscd'],
    ['업체상품코드', 'goodscd2'],
    ['상품명', 'goodsnm'],
    ['선택옵션', 'sel_option'],
    ['입력옵션', 'input_option'],
    ['공급가', 'price_supply'],
    ['구매수량', 'ea'],
    ['상품합계', 'total_price_goods'],
    ['배송비구분', 'delivery_type'],
    ['배송비', 'price_delivery'],
    ['추가배송비', 'vendor_price_extra'],
    ['총금액', 'total_settle_price'],
    ['주문일', 'order_at'],
    ['주문요청사항', 'memo'],
    ['업체주문관리메모', 'vendor_memo'],
  ] as const

  sheet.addRow(columns.map(([header]) => header))
  for (const row of rows) {
    sheet.addRow(columns.map(([, key]) => stripHtml(String(row[key] ?? ''))))
  }
  return workbook.xlsx.writeBuffer().then((buffer) => Buffer.from(buffer))
}

export class DomechangoScraper implements MarketplaceScraper {
  readonly marketplaceId: MarketplaceId = 'domechango'
  readonly displayName = '도매창고'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const { context, page, close } = await openContext()

    try {
      logStep('login: open login page')
      await gotoDomechango(page, LOGIN_PAGE_URL)
      if (await this.isLoggedIn(page)) {
        return {
          success: true,
          storageState: await dumpStorageState(context),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12),
        }
      }

      logStep('login: fill credentials')
      const idInput = page
        .locator('input[name="m_id"], input#m_id, input[name="id"], input[name="user_id"], input[name="userid"], input[name="login_id"], input[name="email"], input[type="text"], input[type="email"]')
        .first()
      const passwordInput = page.locator('input[name="password"], input[name="passwd"], input[name="pw"], input[type="password"]').first()

      await idInput.fill(credentials.email)
      await passwordInput.fill(credentials.password)
      logStep('login: submit')
      await submitLoginForm(page)

      logStep('login: navigate to order list')
      await gotoDomechango(page, WMS_BASE_URL)
      const ok = await this.isLoggedIn(page)
      if (!ok) {
        return {
          success: false,
          error: `도매창고 로그인에 실패했거나 로그인 후 WMS 홈으로 이동하지 못했습니다. (${await summarizePage(page)})`,
        }
      }

      return {
        success: true,
        storageState: await dumpStorageState(context),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown login error',
      }
    } finally {
      await close()
    }
  }

  async testSession(credentials: ScraperCredentials): Promise<{ ok: boolean; error?: string }> {
    const { page, close } = await openContext(credentials.storageState)
    try {
      await gotoDomechango(page, WMS_BASE_URL)
      if (await this.isLoggedIn(page)) return { ok: true }

      const loginResult = await this.login(credentials)
      return loginResult.success
        ? { ok: true }
        : { ok: false, error: loginResult.error ?? '도매창고 세션 확인 실패' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unknown session error' }
    } finally {
      await close()
    }
  }

  async getOrders(credentials: ScraperCredentials, since: Date): Promise<NormalizedOrder[]> {
    const until = new Date()
    const workbookBuffer = await this.downloadOrdersExcel(credentials, since, until)
    return this.parseOrdersExcel(workbookBuffer)
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
      error: '도매창고 송장 업로드 RPA는 주문 엑셀 수집 안정화 후 택배송장 업로드 양식으로 연결해야 합니다.',
    }
  }

  private async downloadOrdersExcel(
    credentials: ScraperCredentials,
    since: Date,
    until: Date,
  ): Promise<Buffer> {
    let sessionState = credentials.storageState
    let ctx = await openContext(sessionState)

    try {
      const runStep = async <T>(label: string, task: () => Promise<T>): Promise<T> => {
        logStep(label)
        try {
          return await task()
        } catch (error) {
          if (error instanceof MarketplaceApiError) throw error
          throw new MarketplaceApiError(
            'domechango',
            500,
            `도매창고 RPA 단계 실패: ${label} (${error instanceof Error ? error.message : 'unknown error'})`,
          )
        }
      }

      await runStep('orders: open wms home', () => gotoDomechango(ctx.page, WMS_BASE_URL))
      if (!(await this.isLoggedIn(ctx.page))) {
        logStep('orders: session invalid, login')
        await ctx.close()
        const loginResult = await this.login(credentials)
        if (!loginResult.success || !loginResult.storageState) {
          throw new MarketplaceApiError('domechango', 401, loginResult.error ?? '도매창고 로그인 실패')
        }
        sessionState = loginResult.storageState
        ctx = await openContext(sessionState)
        await runStep('orders: reopen wms home after login', () => gotoDomechango(ctx.page, WMS_BASE_URL))
      }

      if (!(await this.isLoggedIn(ctx.page))) {
        throw new MarketplaceApiError('domechango', 401, `도매창고 WMS 세션을 확인하지 못했습니다. (${await summarizePage(ctx.page)})`)
      }

      await runStep('orders: prepare wms order api context', () => prepareOrderApiContext(ctx.page, since, until))

      return await runStep('orders: fetch excel through wms api', async () => {
        const commonParams = {
          page: 1,
          list_size: 500,
          oistep: 1,
          sdate: formatDateInput(since),
          edate: formatDateInput(until),
          orderby: 'order_at-desc',
        }
        const listRows = await fetchWmsData<Record<string, unknown>[]>(ctx.page, ORDER_LIST_API_PATH, commonParams)
        const orderIds = listRows.map((row) => String(row.oid ?? '')).filter(Boolean)
        if (orderIds.length === 0) return buildApiWorkbook([])

        const excelRows = await fetchWmsData<Record<string, unknown>[]>(ctx.page, ORDER_EXCEL_API_PATH, {
          codes: orderIds.join(','),
          sel_step: 1,
        }).catch(() => listRows)
        return buildApiWorkbook(Array.isArray(excelRows) ? excelRows : listRows)
      })
    } finally {
      await ctx.close()
    }
  }

  private async parseOrdersExcel(buffer: Buffer): Promise<NormalizedOrder[]> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return []

    const headerRow = worksheet.getRow(1)
    const columns = new Map<string, number>()
    headerRow.eachCell((cell, colNumber) => {
      const value = readCellText(cell.value)
      if (value) columns.set(value, colNumber)
    })

    const get = (row: ExcelJS.Row, header: string) => {
      const col = columns.get(header)
      return col ? readCellText(row.getCell(col).value) : ''
    }

    const orders: NormalizedOrder[] = []
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return

      const orderNo = get(row, '주문번호').replace(/^_/, '')
      const orderItemNo = get(row, '주문상품번호')
      if (!orderNo) return

      const quantity = Math.max(parseNumber(get(row, '구매수량')), 1)
      const itemTotal = parseNumber(get(row, '상품합계'))
      const totalAmount = parseNumber(get(row, '총금액')) || itemTotal
      const supplyPrice = parseNumber(get(row, '공급가'))
      const shippingFee = parseNumber(get(row, '배송비')) + parseNumber(get(row, '추가배송비'))
      const recipientName = get(row, '수취인명')
      const phone = get(row, '수취인전화번호')
      const mobile = get(row, '수취인핸드폰')
      const productName = get(row, '상품명')
      const productCode = get(row, '상품코드')
      const vendorProductCode = get(row, '업체상품코드')
      const optionText = [get(row, '선택옵션'), get(row, '입력옵션')].filter(Boolean).join(' / ')

      orders.push({
        marketplaceId: 'domechango',
        marketplaceOrderId: orderNo,
        marketplaceStatus: get(row, '주문상태') || '신규주문',
        status: 'new',
        buyerName: recipientName,
        buyerPhone: phone || mobile,
        buyerPhone2: mobile && mobile !== phone ? mobile : undefined,
        recipientName,
        recipientPhone: phone || mobile,
        recipientPhone2: mobile && mobile !== phone ? mobile : undefined,
        shippingAddress: {
          zipCode: get(row, '우편번호'),
          address1: get(row, '주소'),
        },
        orderedAt: parseKstDate(get(row, '주문일')),
        totalAmount,
        shippingType: get(row, '배송비구분') || null,
        shippingFee,
        deliveryMessage: get(row, '주문요청사항') || null,
        rawData: {
          source: 'rpa-excel',
          rowNumber,
          orderNo,
          orderItemNo,
          productCode,
          vendorProductCode,
          carrierCode: get(row, '택배업체코드') || null,
          trackingNumber: get(row, '송장번호') || null,
          taxType: get(row, '과세여부') || null,
          memo: get(row, '업체주문관리메모') || null,
        },
        items: [
          {
            marketplaceItemId: orderItemNo || productCode || orderNo,
            productName,
            optionText: optionText || undefined,
            quantity,
            unitPrice: supplyPrice || (quantity > 0 ? itemTotal / quantity : itemTotal),
            sku: vendorProductCode || productCode || undefined,
          },
        ],
      })
    })

    return orders
  }

  private async isLoggedIn(page: Page): Promise<boolean> {
    return (await hasOrderList(page)) || (await hasWmsSession(page))
  }
}
