import ExcelJS from 'exceljs'
import type { Dialog, Locator, Page } from 'playwright'
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

const TOBIZON_BASE_URL = 'https://tobizon.co.kr'
const TOBIZON_LOGIN_URL = `${TOBIZON_BASE_URL}/mall/member/login.php?ltype=vender`
const TOBIZON_ORDER_LIST_URL = `${TOBIZON_BASE_URL}/scm/order/order_list.php?type=s&otype=2`
const DOWNLOAD_TIMEOUT_MS = 30_000

type TobizonDownloadResult = {
  buffer: Buffer
  visibleOrders: NormalizedOrder[]
  pageSummary?: string
}

type TobizonVisibleOrderRow = {
  rowIndex: number
  orderNo: string
  orderedAt: string
  recipientName: string
  productName: string
  quantity: string
  totalAmount: string
  supplyPrice: string
  marketplaceStatus: string
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

function decodeWorkbookText(buffer: Buffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  if (!utf8.includes('\uFFFD')) return utf8
  return new TextDecoder('euc-kr').decode(buffer)
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
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

function extractOrderNumber(value: string): string {
  const trimmed = value.replace(/^_/, '').trim()
  const match = trimmed.match(/[A-Z0-9]*\d{10,}[A-Z0-9]*/i)
  return (match?.[0] ?? trimmed.split(/\s+/)[0] ?? trimmed).trim()
}

function extractFirstDate(value: string): string {
  return value.match(/\d{4}[.-]\d{1,2}[.-]\d{1,2}(?:\s*\(?\d{1,2}:\d{2}\)?)?/)?.[0]
    ?.replace(/[()]/g, '')
    .trim() ?? ''
}

function logStep(step: string): void {
  console.log(`[투비즈온-rpa] ${step}`)
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

async function gotoTobizon(page: Page, url = TOBIZON_BASE_URL): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
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

async function hasTobizonSession(page: Page): Promise<boolean> {
  if (/login/i.test(page.url())) return false
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  return /로그아웃|ToBizOn\s*SCM|주문내역|주문\/배송조회|주문\s*관리|적립금충전/.test(text) && !/로그인\s*아이디|비밀번호\s*찾기/.test(text)
}

async function openLoginPage(page: Page): Promise<void> {
  await gotoTobizon(page, TOBIZON_LOGIN_URL)
  if (await hasTobizonSession(page)) return
  if (await page.locator('input[type="password"]').first().isVisible({ timeout: 1500 }).catch(() => false)) return

  await gotoTobizon(page, TOBIZON_LOGIN_URL)
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)

  if (!(await page.locator('input[type="password"]').first().isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new MarketplaceApiError('tobizon', 500, `투비즈온 로그인 화면을 열지 못했습니다. (${await summarizePage(page)})`)
  }
}

async function submitLoginForm(page: Page): Promise<void> {
  const form = page.locator('form#sfrm, form[name="sfrm"]').first()
  const submitted = await form
    .locator('button[onclick*="login"], button[type="submit"], input[type="submit"]')
    .first()
    .click({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  if (!submitted) await page.keyboard.press('Enter')
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
}

async function openOrderManagementPage(page: Page): Promise<void> {
  await gotoTobizon(page, TOBIZON_ORDER_LIST_URL)
  if (!(await hasTobizonSession(page))) {
    throw new MarketplaceApiError('tobizon', 401, `투비즈온 세션을 확인하지 못했습니다. (${await summarizePage(page)})`)
  }

  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  if (!/주문내역|주문\s*상태|주문번호|주문서?\s*엑셀|엑셀|배송\s*완료/.test(text)) {
    throw new MarketplaceApiError('tobizon', 500, `투비즈온 주문관리 화면을 열지 못했습니다. (${await summarizePage(page)})`)
  }
}

async function applyOrderSearch(page: Page, since: Date): Promise<void> {
  const sinceText = formatDateInput(since)
  const untilText = formatDateInput(new Date())

  await page.evaluate(({ since, until }) => {
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
    set(startInput, since)
    set(endInput, until)
  }, { since: sinceText, until: untilText }).catch(() => undefined)

  await clickByText(page, /검색|조회/i, 10_000).catch(() => false)
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
}

async function hasNoOrders(page: Page): Promise<boolean> {
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  return /검색된\s*자료가\s*없|검색\s*결과가\s*없|조회된\s*자료가\s*없|조회\s*결과가\s*없|주문\s*내역이\s*없|내역이\s*없|데이터가\s*없|자료가\s*없|총\s*0\s*건|0\s*건의\s*주문/.test(text)
}

async function selectOrderRows(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const orderRows = Array.from(document.querySelectorAll<HTMLElement>('tr, .list-row, [role="row"]'))
      .filter((row) => {
        const text = row.textContent?.replace(/\s+/g, ' ') ?? ''
        if (/전체\s*선택|주문번호|상품명|수취인|받는사람/.test(text)) return false
        return /주문|결제|배송|신규|\d{6,}|[A-Z0-9]{10,}/.test(text)
      })

    let selected = 0
    for (const row of orderRows) {
      const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')
      if (!checkbox || checkbox.disabled) continue
      if (!checkbox.checked) checkbox.click()
      checkbox.dispatchEvent(new Event('change', { bubbles: true }))
      selected += 1
    }

    if (selected > 0) return true
    if (orderRows.length === 0) return false

    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .filter((checkbox) => !checkbox.disabled)
    const selectAll = checkboxes.find((checkbox) => /전체/.test(checkbox.closest('label, th, td, div')?.textContent ?? ''))
    if (selectAll) {
      if (!selectAll.checked) selectAll.click()
      selectAll.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    return false
  }).catch(() => false)
}

async function downloadOrdersExcel(page: Page): Promise<Buffer> {
  if (await hasNoOrders(page)) return Buffer.alloc(0)

  const dialogHandler = (dialog: Dialog) => {
    void dialog.accept().catch(() => undefined)
  }
  page.on('dialog', dialogHandler)

  let download
  try {
    [download] = await Promise.all([
      page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
      clickByText(page, /주문서?\s*엑셀|선택.*엑셀|엑셀\s*다운|다운로드/i, 15_000).then((clicked) => {
        if (!clicked) throw new Error('주문 엑셀 다운로드 버튼을 찾지 못했습니다.')
      }),
    ])
  } catch (error) {
    throw new MarketplaceApiError(
      'tobizon',
      504,
      `투비즈온 주문 엑셀 다운로드가 ${DOWNLOAD_TIMEOUT_MS / 1000}초 안에 시작되지 않았습니다. (${error instanceof Error ? error.message : 'download timeout'})`,
    )
  } finally {
    page.off('dialog', dialogHandler)
  }

  const stream = await download.createReadStream()
  if (!stream) throw new MarketplaceApiError('tobizon', 500, '투비즈온 엑셀 다운로드 스트림을 열 수 없습니다.')

  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function readVisibleOrderRows(page: Page): Promise<TobizonVisibleOrderRow[]> {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
    const cleanHeader = (value: string) => normalize(value).replace(/\s+/g, '')
    const orderIdPattern = /[A-Z0-9]*\d{12,}[A-Z0-9]*/i
    const allOrderIds = (text: string) => Array.from(text.matchAll(new RegExp(orderIdPattern, 'gi'))).map((match) => match[0])
    const extractOrderNo = (text: string) => allOrderIds(text)[0] ?? ''
    const deriveProductName = (row: HTMLElement, rowText: string, preferredCell?: string) => {
      if (preferredCell && !/선택상품|주문상품/.test(preferredCell)) return preferredCell

      const links = Array.from(row.querySelectorAll('a'))
        .map((link) => normalize(link.textContent))
        .filter((text) => text && !orderIdPattern.test(text) && !/과세|free|1:1문의/.test(text))
        .sort((a, b) => b.length - a.length)
      if (links[0]) return links[0]

      const cleaned = rowText
        .replace(orderIdPattern, ' ')
        .replace(/\d{4}[.-]\d{1,2}[.-]\d{1,2}(?:\s*\(?\d{1,2}:\d{2}\)?)?/g, ' ')
        .replace(/공급단가\s*[:：]?\s*[\d,]+원?/g, ' ')
        .replace(/\bfree\b/gi, ' ')
        .replace(/입금완료|배송준비|배송완료|신규|과세|선택|주문서?\s*엑셀\s*다운로드/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return cleaned.slice(0, 120) || `투비즈온 주문 ${extractOrderNo(rowText)}`
    }

    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr'))
    const headerIndex = rows.findIndex((row) => {
      const text = cleanHeader(row.textContent ?? '')
      return /주문번호/.test(text) && /주문상품|상품명|상품/.test(text)
    })
    const headers = headerIndex >= 0
      ? Array.from(rows[headerIndex].querySelectorAll('th,td')).map((cell) => cleanHeader(cell.textContent ?? ''))
      : []
    const findColumn = (...patterns: RegExp[]) => {
      const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)))
      return index >= 0 ? index : -1
    }

    const orderNoIndex = findColumn(/주문번호/)
    const recipientIndex = findColumn(/수취인|받는사람|수령인/)
    const productIndex = findColumn(/주문상품|상품명|상품/)
    const quantityIndex = findColumn(/구매수량|주문수량|수량/)
    const totalIndex = findColumn(/상품합계|총금액|결제금액|상품금액/)
    const statusIndex = findColumn(/주문상태|상태/)

    const result: TobizonVisibleOrderRow[] = []
    const candidateRows = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows
    for (const [offset, row] of candidateRows.entries()) {
      const cells = Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.textContent))
      const rowText = normalize(row.textContent)
      const orderNo = extractOrderNo(orderNoIndex >= 0 ? cells[orderNoIndex] ?? rowText : rowText)
      if (!orderNo) continue

      const productName = deriveProductName(row, rowText, productIndex >= 0 ? cells[productIndex] : undefined)

      result.push({
        rowIndex: (headerIndex >= 0 ? headerIndex : 0) + offset + 1,
        orderNo,
        orderedAt: orderNo,
        recipientName: recipientIndex >= 0 ? cells[recipientIndex] ?? '' : '',
        productName,
        quantity: quantityIndex >= 0 ? cells[quantityIndex] ?? '' : '',
        totalAmount: totalIndex >= 0 ? cells[totalIndex] ?? '' : '',
        supplyPrice: rowText.match(/공급단가\s*[:：]?\s*([\d,]+)/)?.[1] ?? '',
        marketplaceStatus: statusIndex >= 0 ? cells[statusIndex] ?? '입금완료' : rowText.match(/입금완료|배송준비|배송완료|신규/)?.[0] ?? '입금완료',
      })
    }

    if (result.length === 0) {
      const bodyText = normalize(document.body?.innerText)
      for (const orderNo of [...new Set(allOrderIds(bodyText))]) {
        const index = bodyText.indexOf(orderNo)
        const context = bodyText.slice(Math.max(0, index - 80), index + 260)
        result.push({
          rowIndex: result.length + 1,
          orderNo,
          orderedAt: context,
          recipientName: '',
          productName: deriveProductName(document.body, context),
          quantity: context.match(/(?:구매수량|수량)\s*[:：]?\s*(\d+)/)?.[1] ?? '1',
          totalAmount: context.match(/(?:상품합계|총금액|결제금액|상품금액)\s*[:：]?\s*([\d,]+)/)?.[1] ?? '',
          supplyPrice: context.match(/공급단가\s*[:：]?\s*([\d,]+)/)?.[1] ?? '',
          marketplaceStatus: context.match(/입금완료|배송준비|배송완료|신규/)?.[0] ?? '입금완료',
        })
      }
    }

    return result
  }).catch(() => [])
}

export class TobizonScraper implements MarketplaceScraper {
  readonly marketplaceId: MarketplaceId = 'tobizon'
  readonly displayName = '투비즈온'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const { context, page, close } = await openContext()

    try {
      logStep('login: open login page')
      await openLoginPage(page)
      if (await hasTobizonSession(page)) {
        return {
          success: true,
          storageState: await dumpStorageState(context),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12),
        }
      }

      logStep('login: fill credentials')
      const form = page.locator('form#sfrm, form[name="sfrm"]').first()
      await form.locator('input[name="ltype"], input#ltype').first().evaluate((element) => {
        if (element instanceof HTMLInputElement) element.value = 'vender'
      }).catch(() => undefined)
      const idInput = form
        .locator('input#mid, input[name="mid"], input[name="id"], input[name="user_id"], input[name="userid"], input[name="login_id"], input[name="email"], input[type="text"], input[type="email"]')
        .first()
      const passwordInput = form.locator('input#password, input[name="password"], input[name="passwd"], input[name="pw"], input[type="password"]').first()

      await setInputValue(idInput, credentials.email)
      await setInputValue(passwordInput, credentials.password)
      logStep('login: submit')
      await submitLoginForm(page)

      const ok = await hasTobizonSession(page)
      if (!ok) {
        return {
          success: false,
          error: `투비즈온 로그인에 실패했습니다. (${await summarizePage(page)})`,
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
      await gotoTobizon(page)
      if (await hasTobizonSession(page)) return { ok: true }

      const loginResult = await this.login(credentials)
      return loginResult.success
        ? { ok: true }
        : { ok: false, error: loginResult.error ?? '투비즈온 세션 확인 실패' }
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
    const { buffer, visibleOrders, pageSummary } = await this.downloadOrdersExcel(credentials, since, setProgress)
    if (visibleOrders.length > 0) {
      await setProgress?.(`투비즈온 화면 주문 ${visibleOrders.length}건 저장 중...`)
      return visibleOrders
    }
    await setProgress?.('투비즈온 주문 엑셀 파싱 중...')
    if (buffer.length === 0) {
      if (/총\s*[:：]?\s*0|0\s*건|자료가\s*없|내역이\s*없/.test(pageSummary ?? '')) return []
      throw new MarketplaceApiError('tobizon', 500, `투비즈온 주문 목록과 엑셀 다운로드가 모두 비어 있습니다. (${pageSummary ?? 'page summary unavailable'})`)
    }
    const parsedOrders = await this.parseOrdersExcel(buffer)
    await setProgress?.(`투비즈온 엑셀 주문 ${parsedOrders.length}건, 화면 주문 ${visibleOrders.length}건 확인`)
    if (parsedOrders.length > 0) return parsedOrders
    throw new MarketplaceApiError('tobizon', 500, `투비즈온 주문 엑셀과 화면에서 주문을 찾지 못했습니다. (${pageSummary ?? 'page summary unavailable'})`)
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
      error: '투비즈온 송장 등록 RPA는 주문 수집 안정화 후 배송정보 입력/엑셀 업로드 화면으로 연결해야 합니다.',
    }
  }

  private async downloadOrdersExcel(
    credentials: ScraperCredentials,
    since: Date,
    setProgress?: (message: string) => Promise<void>,
  ): Promise<TobizonDownloadResult> {
    let sessionState = credentials.storageState
    let ctx = await openContext(sessionState)

    try {
      const runStep = async <T>(label: string, task: () => Promise<T>): Promise<T> => {
        logStep(label)
        await setProgress?.(`투비즈온 ${label}`)
        try {
          return await task()
        } catch (error) {
          if (error instanceof MarketplaceApiError) throw error
          throw new MarketplaceApiError(
            'tobizon',
            500,
            `투비즈온 RPA 단계 실패: ${label} (${error instanceof Error ? error.message : 'unknown error'})`,
          )
        }
      }

      await runStep('orders: open order list', () => gotoTobizon(ctx.page, TOBIZON_ORDER_LIST_URL))
      if (!(await hasTobizonSession(ctx.page))) {
        logStep('orders: session invalid, login')
        await ctx.close()
        const loginResult = await this.login(credentials)
        if (!loginResult.success || !loginResult.storageState) {
          throw new MarketplaceApiError('tobizon', 401, loginResult.error ?? '투비즈온 로그인 실패')
        }
        sessionState = loginResult.storageState
        ctx = await openContext(sessionState)
        await runStep('orders: reopen order list after login', () => gotoTobizon(ctx.page, TOBIZON_ORDER_LIST_URL))
      }

      await runStep('orders: open order management', () => openOrderManagementPage(ctx.page))
      const visibleRows = await runStep('orders: read visible order table', () => readVisibleOrderRows(ctx.page))
      const visibleOrders = visibleRows.map((row) => this.normalizeVisibleOrder(row))
      await setProgress?.(`투비즈온 화면 주문 ${visibleOrders.length}건 확인`)
      if (visibleOrders.length > 0) {
        return { buffer: Buffer.alloc(0), visibleOrders, pageSummary: await summarizePage(ctx.page) }
      }
      const selected = await runStep('orders: select order rows', () => selectOrderRows(ctx.page))
      if (!selected) {
        logStep('orders: no selectable orders')
        if (visibleOrders.length === 0) {
          if (await hasNoOrders(ctx.page)) return { buffer: Buffer.alloc(0), visibleOrders, pageSummary: await summarizePage(ctx.page) }
          throw new MarketplaceApiError('tobizon', 500, `투비즈온 주문 목록을 읽지 못했습니다. (${await summarizePage(ctx.page)})`)
        }
        return { buffer: Buffer.alloc(0), visibleOrders, pageSummary: await summarizePage(ctx.page) }
      }
      const buffer = await runStep('orders: download order excel', () => downloadOrdersExcel(ctx.page))
      return { buffer, visibleOrders, pageSummary: await summarizePage(ctx.page) }
    } finally {
      await ctx.close()
    }
  }

  private normalizeVisibleOrder(row: TobizonVisibleOrderRow): NormalizedOrder {
    const orderNo = extractOrderNumber(row.orderNo)
    const quantity = Math.max(parseNumber(row.quantity), 1)
    const supplyPrice = parseNumber(row.supplyPrice)
    const totalAmount = parseNumber(row.totalAmount) || supplyPrice * quantity
    const productName = row.productName
      .replace(/\s*free\s*$/i, '')
      .replace(/\s*공급단가\s*[:：]?\s*[\d,]+원?.*$/i, '')
      .trim()

    return {
      marketplaceId: 'tobizon',
      marketplaceOrderId: orderNo,
      marketplaceStatus: row.marketplaceStatus || '입금완료',
      status: 'new',
      buyerName: row.recipientName,
      recipientName: row.recipientName,
      shippingAddress: {
        zipCode: '',
        address1: '',
      },
      orderedAt: parseKstDate(extractFirstDate(row.orderedAt)),
      totalAmount,
      shippingType: null,
      shippingFee: null,
      deliveryMessage: null,
      rawData: {
        source: 'rpa-visible-table',
        rowIndex: row.rowIndex,
        visibleOrderText: row,
      },
      items: [
        {
          marketplaceItemId: orderNo,
          productName,
          quantity,
          unitPrice: supplyPrice || (quantity > 0 ? totalAmount / quantity : totalAmount),
        },
      ],
    }
  }

  private async parseOrdersExcel(buffer: Buffer): Promise<NormalizedOrder[]> {
    const workbook = new ExcelJS.Workbook()
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    } catch (error) {
      const htmlOrders = this.parseHtmlOrders(buffer)
      if (htmlOrders.length > 0) return htmlOrders
      throw error
    }
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
      if ([...current.keys()].some((header) => /주문번호|주문상품|상품명|수취인|받는사람|송장번호/.test(header))) {
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

      const orderNo = extractOrderNumber(get(row, '주문번호', '주문번호주문일자', '주문코드'))
      const productName = get(row, '주문상품', '상품명', '상품', '품명', '제품명')
      if (!orderNo || !productName) return

      const quantity = Math.max(parseNumber(get(row, '수량', '구매수량', '주문수량')), 1)
      const itemTotal = parseNumber(get(row, '상품금액', '상품합계', '결제금액', '총금액'))
      const supplyPrice = parseNumber(get(row, '공급가', '단가'))
      const shippingFee = parseNumber(get(row, '배송비', '배송료'))
      const recipientName = get(row, '수취인', '수취인명', '받는사람', '수령인')
      const recipientPhone = get(row, '수취인전화번호', '수취인연락처', '핸드폰', '휴대폰', '전화번호')
      const buyerName = get(row, '주문자', '주문자명', '구매자') || recipientName
      const buyerPhone = get(row, '주문자전화번호', '주문자연락처') || recipientPhone
      const productCode = get(row, '상품코드', '상품번호')
      const sku = get(row, '자체상품코드', '판매자상품코드', '업체상품코드') || productCode
      const optionText = get(row, '옵션', '옵션명', '선택옵션')

      orders.push({
        marketplaceId: 'tobizon',
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
        orderedAt: parseKstDate(get(row, '주문일자', '주문일', '등록일')),
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

    if (orders.length === 0) {
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNumber) return
        const cells: string[] = []
        row.eachCell((cell) => {
          const text = readCellText(cell.value)
          if (text) cells.push(text)
        })
        const looseOrder = this.normalizeLooseRowOrder(cells, rowNumber, 'rpa-excel-loose')
        if (looseOrder) orders.push(looseOrder)
      })
    }

    return orders
  }

  private parseHtmlOrders(buffer: Buffer): NormalizedOrder[] {
    const html = decodeWorkbookText(buffer)
    const tableRows = Array.from(html.matchAll(/<tr[\s\S]*?<\/tr>/gi)).map((rowMatch, index) => ({
      rowNumber: index + 1,
      cells: Array.from(rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((cell) => stripHtml(cell[1] ?? '')),
    })).filter((row) => row.cells.length > 0)

    const header = tableRows.find((row) => {
      const text = row.cells.map(normalizeHeader).join(' ')
      return /주문번호|주문일|주문상품|상품명|수취인|받는사람/.test(text)
    })
    if (!header) {
      return tableRows
        .map((row) => this.normalizeLooseRowOrder(row.cells, row.rowNumber, 'rpa-html-excel-loose'))
        .filter((order): order is NormalizedOrder => Boolean(order))
    }

    const columns = header.cells.map(normalizeHeader)
    const get = (row: { cells: string[] }, ...headers: string[]) => {
      for (const headerName of headers) {
        const normalized = normalizeHeader(headerName)
        const index = columns.findIndex((column) => column === normalized || column.includes(normalized) || normalized.includes(column))
        if (index >= 0) return row.cells[index] ?? ''
      }
      return ''
    }

    const orders: NormalizedOrder[] = []
    for (const row of tableRows) {
      if (row.rowNumber <= header.rowNumber) continue
      const orderNo = extractOrderNumber(get(row, '주문번호', '주문코드'))
      const productName = get(row, '주문상품', '상품명', '상품', '품명', '제품명')
      if (!orderNo || !productName) continue

      const quantity = Math.max(parseNumber(get(row, '수량', '구매수량', '주문수량')), 1)
      const itemTotal = parseNumber(get(row, '상품금액', '상품합계', '결제금액', '총금액'))
      const supplyPrice = parseNumber(get(row, '공급가', '단가'))
      const shippingFee = parseNumber(get(row, '배송비', '배송료'))
      const recipientName = get(row, '수취인', '수취인명', '받는사람', '수령인')
      const recipientPhone = get(row, '수취인전화번호', '수취인연락처', '핸드폰', '휴대폰', '전화번호')
      const buyerName = get(row, '주문자', '주문자명', '구매자') || recipientName
      const buyerPhone = get(row, '주문자전화번호', '주문자연락처') || recipientPhone
      const productCode = get(row, '상품코드', '상품번호')
      const sku = get(row, '자체상품코드', '판매자상품코드', '업체상품코드') || productCode
      const optionText = get(row, '옵션', '옵션명', '선택옵션')

      orders.push({
        marketplaceId: 'tobizon',
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
        orderedAt: parseKstDate(get(row, '주문일자', '주문일', '등록일')),
        totalAmount: itemTotal || supplyPrice * quantity,
        shippingType: get(row, '배송구분', '배송비구분') || null,
        shippingFee,
        deliveryMessage: get(row, '배송메세지', '배송메시지', '요청사항', '배송시요청사항') || null,
        rawData: {
          source: 'rpa-html-excel',
          rowNumber: row.rowNumber,
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
    }

    if (orders.length === 0) {
      for (const row of tableRows) {
        if (row.rowNumber <= header.rowNumber) continue
        const looseOrder = this.normalizeLooseRowOrder(row.cells, row.rowNumber, 'rpa-html-excel-loose')
        if (looseOrder) orders.push(looseOrder)
      }
    }

    return orders
  }

  private normalizeLooseRowOrder(
    cells: string[],
    rowNumber: number,
    source: string,
  ): NormalizedOrder | null {
    const joined = cells.join(' ')
    const orderNo = extractOrderNumber(joined)
    if (!orderNo || !/\d{12,}/.test(orderNo)) return null

    const productName = cells
      .map((cell) => cell.replace(/\s+/g, ' ').trim())
      .filter((cell) => {
        if (!cell || cell.includes(orderNo)) return false
        if (/주문번호|주문상품|상품명|수취인|배송|상태|번호|선택|엑셀/.test(cell)) return false
        if (/^\d+$/.test(cell.replaceAll(',', ''))) return false
        if (/^\d{4}[.-]\d{1,2}[.-]\d{1,2}/.test(cell)) return false
        if (/입금완료|배송준비|배송완료|신규|과세|free/i.test(cell)) return false
        return /[가-힣A-Za-z]/.test(cell)
      })
      .sort((a, b) => b.length - a.length)[0]
      ?? `투비즈온 주문 ${orderNo}`

    const quantityText = cells.find((cell) => /^\s*\d+\s*개?\s*$/.test(cell)) ?? '1'
    const quantity = Math.max(parseNumber(quantityText), 1)
    const amountText = [...cells]
      .reverse()
      .find((cell) => parseNumber(cell) > 0 && /[\d,]+/.test(cell))
      ?? ''
    const totalAmount = parseNumber(amountText)
    const recipientName = cells.find((cell) => /^[가-힣]{2,8}$/.test(cell.trim())) ?? '투비즈온'

    return {
      marketplaceId: 'tobizon',
      marketplaceOrderId: orderNo,
      marketplaceStatus: joined.match(/입금완료|배송준비|배송완료|신규/)?.[0] ?? '입금완료',
      status: 'new',
      buyerName: recipientName,
      recipientName,
      shippingAddress: {
        zipCode: '',
        address1: '',
      },
      orderedAt: parseKstDate(extractFirstDate(joined)),
      totalAmount,
      shippingType: null,
      shippingFee: null,
      deliveryMessage: null,
      rawData: {
        source,
        rowNumber,
        cells,
      },
      items: [
        {
          marketplaceItemId: orderNo,
          productName,
          quantity,
          unitPrice: quantity > 0 ? totalAmount / quantity : totalAmount,
        },
      ],
    }
  }
}
