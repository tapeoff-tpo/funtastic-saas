import ExcelJS from 'exceljs'
import type { Locator, Page } from 'playwright'
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

const BANANA_B2B_BASE_URL = 'https://store.bananab2b.shop'
const BANANA_B2B_LOGIN_URL = `${BANANA_B2B_BASE_URL}/login`
const DOWNLOAD_TIMEOUT_MS = 60_000

const ORDER_PAGE_CANDIDATES = [
  `${BANANA_B2B_BASE_URL}/orders`,
  `${BANANA_B2B_BASE_URL}/order`,
  `${BANANA_B2B_BASE_URL}/order/list`,
  `${BANANA_B2B_BASE_URL}/orders/list`,
  `${BANANA_B2B_BASE_URL}/seller/orders`,
  `${BANANA_B2B_BASE_URL}/admin/orders`,
]

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

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, '').replace(/[()[\]{}]/g, '').trim()
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
  console.log(`[바나나B2B-rpa] ${step}`)
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

async function gotoBanana(page: Page, url = BANANA_B2B_BASE_URL): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
}

async function clickByText(root: Locator | Page, pattern: RegExp, timeout = 10_000): Promise<boolean> {
  const roleButton = root.getByRole('button', { name: pattern }).first()
  if (await roleButton.isVisible({ timeout: 1500 }).catch(() => false)) {
    await roleButton.click({ timeout })
    return true
  }

  const roleLink = root.getByRole('link', { name: pattern }).first()
  if (await roleLink.isVisible({ timeout: 1500 }).catch(() => false)) {
    await roleLink.click({ timeout })
    return true
  }

  const fallback = root
    .locator('button, input[type="button"], input[type="submit"], a, area')
    .filter({ hasText: pattern })
    .first()
  if (await fallback.isVisible({ timeout: 1500 }).catch(() => false)) {
    await fallback.click({ timeout })
    return true
  }

  return root.locator('body, :scope').first().evaluate((element, source) => {
    const regexp = new RegExp(source)
    const controls = Array.from(
      element.querySelectorAll('button, input[type="button"], input[type="submit"], a, area'),
    )
    for (const control of controls) {
      if (!(control instanceof HTMLElement)) continue
      const inputValue = control instanceof HTMLInputElement ? control.value : ''
      const text = `${control.innerText || ''} ${inputValue} ${control.getAttribute('alt') || ''} ${control.getAttribute('title') || ''}`.trim()
      if (!regexp.test(text)) continue
      control.click()
      return true
    }
    return false
  }, pattern.source).catch(() => false)
}

async function setInputValue(input: Locator, value: string): Promise<void> {
  await input.fill(value, { timeout: 3000 }).catch(async () => {
    await input.evaluate((element, nextValue) => {
      if (!(element instanceof HTMLInputElement)) return
      element.removeAttribute('readonly')
      element.value = nextValue
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
  })
}

async function hasBananaSession(page: Page): Promise<boolean> {
  if (/login|signin/i.test(page.url())) return false
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  return /로그아웃|주문\s*관리|주문\s*조회|상품\s*관리|판매자|대시보드/.test(text) && !/비밀번호\s*찾기|아이디\s*찾기/.test(text)
}

async function hasOrderPage(page: Page): Promise<boolean> {
  if (/login|signin/i.test(page.url())) return false
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  return /주문번호|수취인|주문상태|배송상태|엑셀|주문일|상품명/.test(text)
}

async function openLoginPage(page: Page): Promise<void> {
  await gotoBanana(page, BANANA_B2B_LOGIN_URL)
  if (await hasBananaSession(page)) return
  if (await page.locator('input[type="password"]').first().isVisible({ timeout: 5000 }).catch(() => false)) return

  throw new MarketplaceApiError('banana-b2b', 500, `바나나B2B 로그인 화면을 열지 못했습니다. (${await summarizePage(page)})`)
}

async function submitLoginForm(page: Page): Promise<void> {
  const submitted = await clickByText(page, /로그인|login/i, 15_000)
  if (!submitted) {
    await page.keyboard.press('Enter')
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
}

async function openOrderManagementPage(page: Page): Promise<void> {
  await gotoBanana(page, BANANA_B2B_BASE_URL)
  if (!(await hasBananaSession(page))) {
    throw new MarketplaceApiError('banana-b2b', 401, `바나나B2B 세션을 확인하지 못했습니다. (${await summarizePage(page)})`)
  }

  if (await hasOrderPage(page)) return

  const clicked = await clickByText(page, /주문\s*관리|주문\s*조회|주문\/배송|발주|배송\s*관리/i, 15_000)
  if (clicked) {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
    await page.waitForTimeout(1000)
    if (await hasOrderPage(page)) return
  }

  for (const url of ORDER_PAGE_CANDIDATES) {
    await gotoBanana(page, url).catch(() => undefined)
    if (await hasOrderPage(page)) return
  }

  throw new MarketplaceApiError('banana-b2b', 500, `바나나B2B 주문관리 화면을 열지 못했습니다. (${await summarizePage(page)})`)
}

async function applyOrderSearch(page: Page, since: Date): Promise<void> {
  const sinceText = formatDateInput(since)
  const untilText = formatDateInput(new Date())

  await page.evaluate(({ since: startDate, until: endDate }) => {
    const dateInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"], input[name*="sdate"], input[name*="start"], input[name*="from"], input[id*="sdate"], input[id*="start"], input[id*="from"], input[name*="edate"], input[name*="end"], input[name*="to"], input[id*="edate"], input[id*="end"], input[id*="to"]'))
      .filter((input) => input.offsetParent !== null && !input.disabled)

    const set = (input: HTMLInputElement | undefined, value: string) => {
      if (!input) return
      input.removeAttribute('readonly')
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    const startInput = dateInputs.find((input) => /sdate|start|from/i.test(`${input.name} ${input.id}`)) ?? dateInputs[0]
    const endInput = dateInputs.find((input) => /edate|end|to/i.test(`${input.name} ${input.id}`)) ?? dateInputs[1]
    set(startInput, startDate)
    set(endInput, endDate)

    const pageSizeSelect = Array.from(document.querySelectorAll<HTMLSelectElement>('select'))
      .find((select) => /page|size|limit|row/i.test(`${select.name} ${select.id}`))
    if (pageSizeSelect) {
      const largest = Array.from(pageSizeSelect.options)
        .map((option) => Number(option.value))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => b - a)[0]
      if (largest) {
        pageSizeSelect.value = String(largest)
        pageSizeSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
  }, { since: sinceText, until: untilText }).catch(() => undefined)

  await clickByText(page, /검색|조회/i, 10_000).catch(() => false)
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
}

async function downloadOrdersExcel(page: Page): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
    clickByText(page, /주문서?\s*엑셀|엑셀\s*다운|엑셀|다운로드/i, 15_000).then((clicked) => {
      if (!clicked) throw new Error('주문 엑셀 다운로드 버튼을 찾지 못했습니다.')
    }),
  ]).catch((error) => {
    throw new MarketplaceApiError(
      'banana-b2b',
      504,
      `바나나B2B 주문 엑셀 다운로드가 ${DOWNLOAD_TIMEOUT_MS / 1000}초 안에 시작되지 않았습니다. (${error instanceof Error ? error.message : 'download timeout'})`,
    )
  })

  const stream = await download.createReadStream()
  if (!stream) throw new MarketplaceApiError('banana-b2b', 500, '바나나B2B 엑셀 다운로드 스트림을 열 수 없습니다.')

  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export class BananaB2bScraper implements MarketplaceScraper {
  readonly marketplaceId: MarketplaceId = 'banana-b2b'
  readonly displayName = '바나나B2B'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const { context, page, close } = await openContext()

    try {
      logStep('login: open login page')
      await openLoginPage(page)

      logStep('login: fill credentials')
      const idInput = page
        .locator('input[name="id"], input[name="userId"], input[name="userid"], input[name="loginId"], input[name="login_id"], input[name="email"], input[type="text"], input[type="email"]')
        .first()
      const passwordInput = page.locator('input[name="password"], input[name="passwd"], input[name="pw"], input[type="password"]').first()

      await setInputValue(idInput, credentials.email)
      await setInputValue(passwordInput, credentials.password)
      logStep('login: submit')
      await submitLoginForm(page)

      const ok = await hasBananaSession(page)
      if (!ok) {
        return {
          success: false,
          error: `바나나B2B 로그인에 실패했습니다. (${await summarizePage(page)})`,
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
      await gotoBanana(page)
      if (await hasBananaSession(page)) return { ok: true }

      const loginResult = await this.login(credentials)
      return loginResult.success
        ? { ok: true }
        : { ok: false, error: loginResult.error ?? '바나나B2B 세션 확인 실패' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unknown session error' }
    } finally {
      await close()
    }
  }

  async getOrders(credentials: ScraperCredentials, since: Date): Promise<NormalizedOrder[]> {
    const buffer = await this.downloadOrdersExcel(credentials, since)
    return this.parseOrdersExcel(buffer)
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
      error: '바나나B2B 송장 등록 RPA는 주문 수집 안정화 후 배송정보 입력/엑셀 업로드 화면으로 연결해야 합니다.',
    }
  }

  private async downloadOrdersExcel(
    credentials: ScraperCredentials,
    since: Date,
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
            'banana-b2b',
            500,
            `바나나B2B RPA 단계 실패: ${label} (${error instanceof Error ? error.message : 'unknown error'})`,
          )
        }
      }

      await runStep('orders: open home', () => gotoBanana(ctx.page))
      if (!(await hasBananaSession(ctx.page))) {
        logStep('orders: session invalid, login')
        await ctx.close()
        const loginResult = await this.login(credentials)
        if (!loginResult.success || !loginResult.storageState) {
          throw new MarketplaceApiError('banana-b2b', 401, loginResult.error ?? '바나나B2B 로그인 실패')
        }
        sessionState = loginResult.storageState
        ctx = await openContext(sessionState)
        await runStep('orders: reopen home after login', () => gotoBanana(ctx.page))
      }

      await runStep('orders: open order management', () => openOrderManagementPage(ctx.page))
      await runStep('orders: apply order search', () => applyOrderSearch(ctx.page, since))
      return await runStep('orders: download order excel', () => downloadOrdersExcel(ctx.page))
    } finally {
      await ctx.close()
    }
  }

  private async parseOrdersExcel(buffer: Buffer): Promise<NormalizedOrder[]> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return []

    let headerRowNumber = 1
    const columns = new Map<string, number>()
    for (let rowNumber = 1; rowNumber <= Math.min(10, worksheet.rowCount); rowNumber += 1) {
      const row = worksheet.getRow(rowNumber)
      const current = new Map<string, number>()
      row.eachCell((cell, colNumber) => {
        const value = normalizeHeader(readCellText(cell.value))
        if (value) current.set(value, colNumber)
      })
      if ([...current.keys()].some((header) => /주문번호|상품명|수취인|받는사람|송장번호/.test(header))) {
        headerRowNumber = rowNumber
        columns.clear()
        current.forEach((value, key) => columns.set(key, value))
        break
      }
    }

    const get = (row: ExcelJS.Row, ...headers: string[]) => {
      for (const header of headers) {
        const normalized = normalizeHeader(header)
        const exact = columns.get(normalized)
        if (exact) return readCellText(row.getCell(exact).value)
        const fuzzy = [...columns.entries()].find(([name]) => name.includes(normalized) || normalized.includes(name))
        if (fuzzy) return readCellText(row.getCell(fuzzy[1]).value)
      }
      return ''
    }

    const orders: NormalizedOrder[] = []
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return

      const orderNo = get(row, '주문번호', '주문코드', '주문ID', '주문고유번호').replace(/^_/, '')
      const productName = get(row, '상품명', '품명', '제품명')
      if (!orderNo || !productName) return

      const quantity = Math.max(parseNumber(get(row, '수량', '구매수량', '주문수량')), 1)
      const itemTotal = parseNumber(get(row, '상품금액', '상품합계', '결제금액', '총금액'))
      const supplyPrice = parseNumber(get(row, '공급가', '단가', '판매가'))
      const shippingFee = parseNumber(get(row, '배송비', '배송료'))
      const recipientName = get(row, '수취인', '수취인명', '받는사람', '수령인')
      const recipientPhone = get(row, '수취인전화번호', '수취인연락처', '핸드폰', '휴대폰', '전화번호')
      const buyerName = get(row, '주문자', '주문자명', '구매자') || recipientName
      const buyerPhone = get(row, '주문자전화번호', '주문자연락처') || recipientPhone
      const productCode = get(row, '상품코드', '상품번호', '제품코드')
      const sku = get(row, '자체상품코드', '판매자상품코드', '업체상품코드') || productCode
      const optionText = get(row, '옵션', '옵션명', '선택옵션')

      orders.push({
        marketplaceId: 'banana-b2b',
        marketplaceOrderId: orderNo,
        marketplaceStatus: get(row, '주문상태', '상태') || '주문',
        status: 'new',
        buyerName,
        buyerPhone,
        recipientName,
        recipientPhone,
        shippingAddress: {
          zipCode: get(row, '우편번호', '우편'),
          address1: get(row, '주소', '배송주소', '수취인주소'),
          address2: get(row, '상세주소', '나머지주소') || undefined,
        },
        orderedAt: parseKstDate(get(row, '주문일자', '주문일', '등록일', '결제일')),
        totalAmount: itemTotal || supplyPrice * quantity,
        shippingType: get(row, '배송구분', '배송비구분') || null,
        shippingFee,
        deliveryMessage: get(row, '배송메세지', '배송메시지', '요청사항', '배송시요청사항') || null,
        rawData: {
          source: 'rpa-excel',
          rowNumber,
          productCode,
          carrierName: get(row, '택배사', '배송사') || null,
          trackingNumber: get(row, '송장번호') || null,
        },
        items: [
          {
            marketplaceItemId: get(row, '주문상품번호', '상품주문번호') || productCode || orderNo,
            productName,
            optionText: optionText || undefined,
            quantity,
            unitPrice: supplyPrice || (quantity > 0 ? itemTotal / quantity : itemTotal),
            sku: sku || undefined,
          },
        ],
      })
    })

    return orders
  }
}
