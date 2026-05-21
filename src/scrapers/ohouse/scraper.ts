import ExcelJS from 'exceljs'
import type { Download, Locator, Page } from 'playwright'
import { MarketplaceApiError } from '@/lib/marketplace/errors'
import type { InvoiceData, MarketplaceId, NormalizedClaim, NormalizedOrder } from '@/lib/marketplace/types'
import { dumpStorageState, openContext } from '../browser'
import { readNaverVerificationCode } from '../mail/naver'
import type { MarketplaceScraper, ScraperCredentials, ScraperLoginResult } from '../types'

const PARTNER_BASE_URL = 'https://partners.ohou.se'
const LOGIN_URL = `${PARTNER_BASE_URL}/users/sign_in`
const ORDER_URL_CANDIDATES = [
  `${PARTNER_BASE_URL}/orders`,
  `${PARTNER_BASE_URL}/orders?customFilters=PAYMENT_COMPLETE`,
  `${PARTNER_BASE_URL}/orders?customFilters=READY_FOR_DELIVERY`,
]
const NAVIGATION_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 120_000

function logStep(step: string): void {
  console.log(`[오늘의집-rpa] ${step}`)
}

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
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim()
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

function normalizeAccountKey(value: string | undefined): string {
  return (value || 'default').replace(/[^0-9A-Za-z가-힣_-]/g, '_')
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 300)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

async function gotoOhouse(page: Page, url = PARTNER_BASE_URL): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: NAVIGATION_TIMEOUT_MS }).catch((error) => {
    throw new MarketplaceApiError(
      'ohouse',
      504,
      `오늘의집 파트너센터 이동이 ${NAVIGATION_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다. (${url}, ${error instanceof Error ? error.message : 'navigation timeout'})`,
    )
  })
  await page.waitForLoadState('domcontentloaded', { timeout: 12_000 }).catch(() => undefined)
}

async function setInputValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value, { timeout: 10_000 }).catch(async () => {
    await locator.click({ timeout: 5000 })
    await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await locator.type(value, { delay: 20 })
  })
}

async function clickByText(page: Page, pattern: RegExp): Promise<boolean> {
  const clicked = await page
    .locator('button, input[type="submit"], input[type="button"], a')
    .filter({ hasText: pattern })
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (clicked) return true

  return page
    .locator('input[type="submit"], input[type="button"]')
    .evaluateAll((elements, source) => {
      const pattern = new RegExp(source, 'i')
      const target = elements.find((element) => pattern.test((element as HTMLInputElement).value || '')) as HTMLElement | undefined
      target?.click()
      return Boolean(target)
    }, pattern.source)
    .catch(() => false)
}

async function readDownloadBuffer(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  if (!stream) throw new MarketplaceApiError('ohouse', 500, '오늘의집 엑셀 다운로드 스트림을 열 수 없습니다.')
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function hasOhouseSession(page: Page): Promise<boolean> {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  if (/로그아웃|주문\s*관리|상품\s*관리|배송\s*관리|정산\s*관리|매출\s*현황|판매진행|미확인주문|배송준비중/.test(bodyText)) {
    return true
  }
  if (/login|signin/i.test(page.url())) return false
  return false
}

async function isSecondFactorPage(page: Page): Promise<boolean> {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  if (/인증\s*(번호|코드)|2차\s*인증|이메일\s*인증|메일로\s*전송/.test(bodyText)) return true
  return page.locator('input[name*="otp" i], input[name*="code" i], input[autocomplete="one-time-code"]').first().isVisible({ timeout: 1000 }).catch(() => false)
}

async function handleEmailSecondFactor(page: Page, credentials: ScraperCredentials): Promise<void> {
  if (!(await isSecondFactorPage(page))) return

  const method = credentials.extras?.twoFactorMethod
  const naverEmail = credentials.extras?.naverEmail
  const naverPassword = credentials.extras?.naverPassword
  if (method !== 'naver_email' || !naverEmail || !naverPassword) {
    throw new MarketplaceApiError('ohouse', 401, '오늘의집 2차 인증이 필요하지만 네이버 메일 인증 정보가 저장되어 있지 않습니다.')
  }

  await clickByText(page, /인증\s*번호.*(발송|전송|받기)|메일.*(발송|전송)|이메일.*(발송|전송)/i).catch(() => false)
  const code = await readNaverVerificationCode({
    email: naverEmail,
    password: naverPassword,
    since: new Date(Date.now() - 2 * 60 * 1000),
    fromHints: ['bucketplace', 'ohou', '오늘의집', ''],
    subjectHints: ['오늘의집', 'ohou', '인증'],
  })
  if (!code) {
    throw new MarketplaceApiError('ohouse', 401, '네이버 메일에서 오늘의집 2차 인증번호를 찾지 못했습니다.')
  }

  const codeInput = page
    .locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i], input[name*="auth" i], input[type="tel"], input[type="text"]')
    .first()
  await setInputValue(codeInput, code)
  await clickByText(page, /확인|인증|로그인|다음|완료/i)
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
}

async function submitLogin(page: Page): Promise<void> {
  await clickByText(page, /로그인|login/i).then(async (clicked) => {
    if (!clicked) await page.keyboard.press('Enter')
  })
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
}

async function openOrdersPage(page: Page): Promise<void> {
  for (const url of ORDER_URL_CANDIDATES) {
    await gotoOhouse(page, url).catch(() => undefined)
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
    if (/주문|배송|엑셀|다운로드|검색/.test(bodyText) && !/404|찾을 수 없습니다/.test(bodyText)) return
  }

  await gotoOhouse(page, PARTNER_BASE_URL)
  const clicked = await page
    .locator('a, button')
    .filter({ hasText: /주문\s*관리|주문|배송\s*관리/i })
    .first()
    .click({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false)

  if (clicked) {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
    return
  }

  throw new MarketplaceApiError('ohouse', 500, `오늘의집 주문 관리 화면을 찾지 못했습니다. (${await summarizePage(page)})`)
}

async function applyOrderSearch(page: Page, since: Date, until: Date): Promise<void> {
  const sinceValue = formatDateInput(since)
  const untilValue = formatDateInput(until)
  await page.evaluate(({ sinceValue, untilValue }) => {
    const dateInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"], input[placeholder*="YYYY"], input[placeholder*="yyyy"], input[name*="start"], input[name*="from"], input[name*="end"], input[name*="to"]'))
    if (dateInputs[0]) {
      dateInputs[0].value = sinceValue
      dateInputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      dateInputs[0].dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (dateInputs[1]) {
      dateInputs[1].value = untilValue
      dateInputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      dateInputs[1].dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, { sinceValue, untilValue })
  await clickByText(page, /검색|조회|적용/i)
  await page.waitForTimeout(2500)
}

async function downloadOrdersExcel(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS })
  const clicked = await clickByText(page, /엑셀|excel|다운로드|download/i)
  if (!clicked) {
    downloadPromise.catch(() => undefined)
    throw new MarketplaceApiError('ohouse', 500, `오늘의집 주문 엑셀 다운로드 버튼을 찾지 못했습니다. (${await summarizePage(page)})`)
  }
  const download = await downloadPromise
  return readDownloadBuffer(download)
}

export class OhouseScraper implements MarketplaceScraper {
  readonly marketplaceId: MarketplaceId = 'ohouse'
  readonly displayName = '오늘의집'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const { context, page, close } = await openContext()

    try {
      logStep('login: open login page')
      await gotoOhouse(page, LOGIN_URL)
      if (await hasOhouseSession(page)) {
        return {
          success: true,
          storageState: await dumpStorageState(context),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 8),
        }
      }

      const idInput = page
        .locator('input#user_email, input[name="user[email]"], input[name="email"], input[name*="email" i], input[name*="login" i], input[name*="id" i], input[type="email"], input[type="text"]')
        .first()
      const passwordInput = page
        .locator('input#user_password, input[name="user[password]"], input[name="password"], input[name*="password" i], input[name*="pw" i], input[type="password"]')
        .first()
      await setInputValue(idInput, credentials.email)
      await setInputValue(passwordInput, credentials.password)

      logStep('login: submit credentials')
      await submitLogin(page)
      await handleEmailSecondFactor(page, credentials)
      await gotoOhouse(page, PARTNER_BASE_URL).catch(() => undefined)

      if (!(await hasOhouseSession(page))) {
        return {
          success: false,
          error: `오늘의집 로그인에 실패했거나 세션을 확인하지 못했습니다. (${await summarizePage(page)})`,
        }
      }

      return {
        success: true,
        storageState: await dumpStorageState(context),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 8),
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
      await gotoOhouse(page, PARTNER_BASE_URL)
      if (await hasOhouseSession(page)) return { ok: true }
      const loginResult = await this.login(credentials)
      return loginResult.success ? { ok: true } : { ok: false, error: loginResult.error ?? '오늘의집 세션 확인 실패' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unknown session error' }
    } finally {
      await close()
    }
  }

  async getOrders(
    credentials: ScraperCredentials,
    since: Date,
    setProgress?: (message: string) => Promise<void>,
  ): Promise<NormalizedOrder[]> {
    const until = new Date()
    let sessionState = credentials.storageState
    let ctx = await openContext(sessionState)

    try {
      await setProgress?.('오늘의집 파트너센터 접속 중...')
      await gotoOhouse(ctx.page, PARTNER_BASE_URL)
      if (!(await hasOhouseSession(ctx.page))) {
        await ctx.close()
        const loginResult = await this.login(credentials)
        if (!loginResult.success || !loginResult.storageState) {
          throw new MarketplaceApiError('ohouse', 401, loginResult.error ?? '오늘의집 로그인 실패')
        }
        sessionState = loginResult.storageState
        ctx = await openContext(sessionState)
      }

      await setProgress?.('오늘의집 주문 관리 화면 여는 중...')
      await openOrdersPage(ctx.page)
      await setProgress?.('오늘의집 주문 검색 조건 적용 중...')
      await applyOrderSearch(ctx.page, since, until)
      await setProgress?.('오늘의집 주문 엑셀 다운로드 중...')
      const workbook = await downloadOrdersExcel(ctx.page)
      return this.parseOrdersExcel(workbook, credentials)
    } finally {
      await ctx.close()
    }
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
      error: '오늘의집 RPA 송장 업로드는 주문 수집 화면 확인 후 구현이 필요합니다.',
    }
  }

  private async parseOrdersExcel(buffer: Buffer, credentials: ScraperCredentials): Promise<NormalizedOrder[]> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return []

    let headerRow: ExcelJS.Row | null = null
    for (let rowNumber = 1; rowNumber <= Math.min(20, worksheet.rowCount); rowNumber++) {
      const row = worksheet.getRow(rowNumber)
      const headers: string[] = []
      row.eachCell((cell) => {
        const value = normalizeHeader(readCellText(cell.value))
        if (value) headers.push(value)
      })
      if (headers.some((header) => /주문번호|주문상세번호|주문ID|주문번호/.test(header)) && headers.some((header) => /상품명|제품명/.test(header))) {
        headerRow = row
        break
      }
    }

    if (!headerRow) {
      throw new MarketplaceApiError('ohouse', 500, '오늘의집 주문 엑셀 헤더를 찾지 못했습니다.')
    }

    const columns = new Map<string, number>()
    headerRow.eachCell((cell, colNumber) => {
      const value = normalizeHeader(readCellText(cell.value))
      if (value) columns.set(value, colNumber)
    })

    const get = (row: ExcelJS.Row, ...headers: string[]) => {
      for (const header of headers) {
        const col = columns.get(normalizeHeader(header))
        if (!col) continue
        const value = readCellText(row.getCell(col).value)
        if (value) return value
      }
      return ''
    }

    const orders: NormalizedOrder[] = []
    const accountKey = normalizeAccountKey(credentials.extras?.accountKey)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= (headerRow?.number ?? 1)) return

      const orderNo = get(row, '주문번호', '주문ID', '주문상세번호', '주문상세ID').replace(/^[_']+/, '')
      if (!orderNo) return
      const scopedOrderNo = `${accountKey}:${orderNo}`

      const quantity = Math.max(parseNumber(get(row, '수량', '구매수량', '주문수량')), 1)
      const itemTotal = parseNumber(get(row, '상품금액', '판매금액', '결제금액', '주문금액'))
      const recipientName = get(row, '수취인', '수령인', '받는분', '받는사람')
      const phone = get(row, '수취인연락처', '수령인연락처', '휴대폰', '전화번호')
      const productName = get(row, '상품명', '제품명')
      const optionText = get(row, '옵션', '옵션명', '상품옵션')
      const sku = get(row, '판매자상품코드', '상품코드', 'SKU', '옵션코드')

      orders.push({
        marketplaceId: 'ohouse',
        marketplaceOrderId: scopedOrderNo,
        marketplaceStatus: get(row, '주문상태', '상태') || '신규주문',
        status: 'new',
        buyerName: get(row, '주문자', '구매자') || recipientName,
        buyerPhone: get(row, '주문자연락처', '구매자연락처') || phone,
        recipientName,
        recipientPhone: phone,
        shippingAddress: {
          zipCode: get(row, '우편번호', '배송지우편번호'),
          address1: get(row, '주소', '배송지주소'),
          address2: get(row, '상세주소', '배송지상세주소') || undefined,
        },
        orderedAt: parseKstDate(get(row, '주문일시', '주문일', '결제일시', '결제일')),
        totalAmount: itemTotal,
        deliveryMessage: get(row, '배송메시지', '배송메세지', '요청사항') || null,
        rawData: {
          source: 'rpa-excel',
          rowNumber,
          accountKey,
          originalMarketplaceOrderId: orderNo,
        },
        items: [
          {
            marketplaceItemId: `${accountKey}:${get(row, '주문상품번호', '주문상세번호', '상품주문번호') || orderNo}`,
            productName,
            optionText: optionText || undefined,
            quantity,
            unitPrice: quantity > 0 ? itemTotal / quantity : itemTotal,
            sku: sku || undefined,
          },
        ],
      })
    })

    return orders
  }
}
