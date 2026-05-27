import ExcelJS from 'exceljs'
import type { Dialog, Locator, Page } from 'playwright'
import { MarketplaceApiError } from '@/lib/marketplace/errors'
import { dumpStorageState, openContext } from '../browser'
import { dismissRpaPopups } from '../popups'
import type {
  MarketplaceScraper,
  ScraperCredentials,
  ScraperLoginResult,
} from '../types'
import type { InvoiceData, NormalizedClaim, NormalizedOrder } from '@/lib/marketplace/types'

const DOMESIN_HOME_URL = 'https://domesin.com/'
const DOMESIN_LOGIN_URL = 'https://domesin.com/scm/login.html'
const DOMESIN_ORDER_LIST_URL = 'https://domesin.com/scm/M_order/list.html'
const DOWNLOAD_TIMEOUT_MS = 60_000

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

function logStep(step: string): void {
  console.log(`[도매의신-rpa] ${step}`)
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

async function gotoDomesin(page: Page, url = DOMESIN_HOME_URL): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
  await closePopups(page)
}

async function closePopups(page: Page): Promise<void> {
  await dismissRpaPopups(page, { marketplaceName: '도매의신', maxPasses: 6 })

  const selectors = [
    'text=창닫기',
    'text=오늘 더이상',
    'img[title="창닫기"]',
    '#xbt',
  ]

  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count().catch(() => 0)
    for (let i = 0; i < count; i += 1) {
      await locator.nth(i).click({ timeout: 500 }).catch(() => {})
    }
  }
}

async function tryClick(locator: Locator, timeout: number): Promise<boolean> {
  if (!(await locator.isVisible({ timeout: 1500 }).catch(() => false))) return false

  const clicked = await locator.click({ timeout }).then(() => true).catch(() => false)
  if (clicked) return true

  const forceClicked = await locator.click({ timeout: 3000, force: true }).then(() => true).catch(() => false)
  if (forceClicked) return true

  return locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return false
    element.click()
    return true
  }).catch(() => false)
}

async function clickByText(root: Locator | Page, pattern: RegExp, timeout = 10_000): Promise<boolean> {
  const roleButton = root.getByRole('button', { name: pattern }).first()
  if (await tryClick(roleButton, timeout)) return true

  const roleLink = root.getByRole('link', { name: pattern }).first()
  if (await tryClick(roleLink, timeout)) return true

  const fallback = root
    .locator('button, input[type="button"], input[type="submit"], a, area')
    .filter({ hasText: pattern })
    .first()
  if (await tryClick(fallback, timeout)) return true

  return root.locator('body, :scope').first().evaluate((element, { source, flags }) => {
    const regexp = new RegExp(source, flags)
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
  }, { source: pattern.source, flags: pattern.flags }).catch(() => false)
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

async function hasDomesinSession(page: Page): Promise<boolean> {
  if (/login/i.test(page.url())) return false
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  return /로그아웃|주문관리|신규주문관리|주문조회|주문\/배송조회|엑셀주문|적립금\s*충전/.test(text) && !/아이디\s*찾기|비밀번호\s*찾기/.test(text)
}

async function openOrderListPage(page: Page): Promise<void> {
  await gotoDomesin(page, DOMESIN_ORDER_LIST_URL)
  await closePopups(page)
  if (!(await hasDomesinSession(page))) {
    throw new MarketplaceApiError('domesin', 401, `도매의신 세션을 확인하지 못했습니다. (${await summarizePage(page)})`)
  }

  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  if (!/주문관리|신규주문관리|주문조회|주문\/배송조회|주문번호|수취인|엑셀|주문상태/.test(text)) {
    throw new MarketplaceApiError('domesin', 500, `도매의신 주문조회 화면을 열지 못했습니다. (${await summarizePage(page)})`)
  }
}

async function applyNewOrderSearch(page: Page, since: Date): Promise<void> {
  const sinceText = formatDateInput(since)
  const untilText = formatDateInput(new Date())

  await page.evaluate(({ since, until }) => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
      .filter((input) => input.offsetParent !== null && !input.disabled)

    const dateInputs = inputs.filter((input) => {
      const key = `${input.name} ${input.id} ${input.className}`.toLowerCase()
      return input.type === 'date' || /sdate|start|from|edate|end|to|date|dt/.test(key)
    })

    const set = (input: HTMLInputElement | undefined, value: string) => {
      if (!input) return
      input.removeAttribute('readonly')
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    const startInput = dateInputs.find((input) => /sdate|start|from|fr/.test(`${input.name} ${input.id}`.toLowerCase())) ?? dateInputs[0]
    const endInput = dateInputs.find((input) => /edate|end|to/.test(`${input.name} ${input.id}`.toLowerCase())) ?? dateInputs[1]
    set(startInput, since)
    set(endInput, until)

    for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>('select'))) {
      if (select.disabled || select.offsetParent === null) continue
      const options = Array.from(select.options)
      const newOrderOption = options.find((option) => /신규\s*주문|신규|주문\s*접수/.test(option.textContent ?? ''))
      if (newOrderOption && /status|state|step|주문|상태/i.test(`${select.name} ${select.id} ${select.closest('tr, li, div')?.textContent ?? ''}`)) {
        select.value = newOrderOption.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }

      const largest = options
        .map((option) => Number(option.value))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => b - a)[0]
      if (largest && /page|rows|limit|list|수량|보기/i.test(`${select.name} ${select.id} ${select.closest('tr, li, div')?.textContent ?? ''}`)) {
        select.value = String(largest)
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }

    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]'))
    for (const input of radios) {
      const label = input.closest('label')?.textContent ?? document.querySelector(`label[for="${input.id}"]`)?.textContent ?? input.parentElement?.textContent ?? ''
      if (/신규\s*주문|주문\s*접수/.test(label)) {
        input.checked = true
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
  }, { since: sinceText, until: untilText }).catch(() => undefined)

  await clickByText(page, /검색|조회/i, 10_000).catch(() => false)
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
}

async function selectOrderRows(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .filter((checkbox) => !checkbox.disabled && checkbox.offsetParent !== null)
    const orderLikeRows = Array.from(document.querySelectorAll('tr, .list-row, [role="row"]'))
      .filter((row) => {
        const text = row.textContent?.replace(/\s+/g, ' ') ?? ''
        if (/전체\s*선택|번호\s*상품|주문번호/.test(text)) return false
        return /신규|주문접수|주문번호|\d{6,}/.test(text)
      })

    let selected = 0
    for (const checkbox of checkboxes) {
      const row = checkbox.closest('tr, .list-row, [role="row"]')
      const text = row?.textContent?.replace(/\s+/g, ' ') ?? ''
      if (!row || /전체\s*선택|번호\s*상품|주문번호/.test(text)) continue
      if (!/신규|주문접수|주문번호|\d{6,}/.test(text)) continue
      if (!checkbox.checked) checkbox.click()
      checkbox.dispatchEvent(new Event('change', { bubbles: true }))
      selected += 1
    }

    if (selected > 0) return true
    if (orderLikeRows.length === 0) return false

    const all = checkboxes.find((checkbox) => /전체/.test(checkbox.closest('label, th, td, div')?.textContent ?? ''))
    if (all) {
      if (!all.checked) all.click()
      all.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    return false
  }).catch(() => false)
}

async function downloadOrdersExcel(page: Page): Promise<Buffer> {
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  if (/검색된\s*자료가\s*없|검색\s*결과가\s*없|조회된\s*자료가\s*없|조회\s*결과가\s*없|주문\s*내역이\s*없|내역이\s*없|데이터가\s*없|자료가\s*없|총\s*0\s*건/.test(text)) {
    return Buffer.alloc(0)
  }

  const dialogHandler = (dialog: Dialog) => {
    void dialog.accept().catch(() => undefined)
  }
  page.on('dialog', dialogHandler)

  let download
  try {
    [download] = await Promise.all([
      page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
      page.evaluate(() => {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a, area'),
        )
        const candidate = controls.find((control) => {
          const inputValue = control instanceof HTMLInputElement ? control.value : ''
          const href = control instanceof HTMLAnchorElement ? control.href : ''
          const text = `${control.innerText || ''} ${inputValue} ${control.getAttribute('alt') || ''} ${control.getAttribute('title') || ''}`.replace(/\s+/g, ' ')
          if (/상품\s*DB|상품DB|API/.test(text)) return false
          return /선택\s*주문\s*엑셀|주문.*엑셀|엑셀.*주문|엑셀\s*다운|다운로드|xls/i.test(`${text} ${href}`)
        })
        if (!candidate) throw new Error('주문 엑셀 다운로드 버튼을 찾지 못했습니다.')
        candidate.click()
      }),
    ])
  } catch (error) {
    throw new MarketplaceApiError(
      'domesin',
      504,
      `도매의신 주문 엑셀 다운로드가 ${DOWNLOAD_TIMEOUT_MS / 1000}초 안에 시작되지 않았습니다. (${error instanceof Error ? error.message : 'download timeout'})`,
    )
  } finally {
    page.off('dialog', dialogHandler)
  }

  const stream = await download.createReadStream()
  if (!stream) throw new MarketplaceApiError('domesin', 500, '도매의신 엑셀 다운로드 스트림을 열 수 없습니다.')

  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function confirmSelectedOrders(page: Page): Promise<void> {
  const selected = await selectOrderRows(page)
  if (!selected) return

  const dialogPromise = page.waitForEvent('dialog', { timeout: 5000 })
    .then((dialog) => dialog.accept().catch(() => undefined))
    .catch(() => undefined)

  const clicked = await clickByText(page, /주문\s*확인|선택.*확인|발주\s*확인|확인\s*처리/i, 10_000)

  if (!clicked) {
    const changed = await page.evaluate(() => {
      for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>('select'))) {
        const option = Array.from(select.options).find((candidate) => /주문\s*확인|발주\s*확인|확인\s*처리|주문확인/.test(candidate.textContent ?? ''))
        if (!option) continue
        select.value = option.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
      return false
    })
    if (!changed) {
      throw new MarketplaceApiError('domesin', 500, '도매의신 주문확인 버튼 또는 상태 선택값을 찾지 못했습니다.')
    }
  }

  await dialogPromise
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(1000)
}

type OrderRow = {
  rowNumber: number
  values: Map<string, string>
}

function findOrderHeaderRow(worksheet: ExcelJS.Worksheet): { rowNumber: number; columns: Map<string, number> } | null {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 12); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const columns = new Map<string, number>()
    row.eachCell((cell, colNumber) => {
      const header = normalizeHeader(readCellText(cell.value))
      if (header) columns.set(header, colNumber)
    })

    const headers = Array.from(columns.keys()).join(' ')
    if (/주문번호|주문코드|주문일/.test(headers) && /상품명|품명|제품명/.test(headers)) {
      return { rowNumber, columns }
    }
  }
  return null
}

function getRowValue(row: OrderRow, ...candidates: string[]): string {
  for (const candidate of candidates) {
    const exact = row.values.get(normalizeHeader(candidate))
    if (exact) return exact
  }

  for (const [header, value] of row.values) {
    if (!value) continue
    if (candidates.some((candidate) => header.includes(normalizeHeader(candidate)))) return value
  }

  return ''
}

function makeOrdersFromRows(rows: OrderRow[], source: string): NormalizedOrder[] {
  const orders: NormalizedOrder[] = []

  for (const row of rows) {
    const orderNo = getRowValue(row, '주문번호', '주문코드', '주문ID', '주문고유번호').replace(/^_/, '')
    const productName = getRowValue(row, '상품명', '품명', '제품명')
    if (!orderNo || !productName) continue

    const productCode = getRowValue(row, '상품코드', '상품번호', '제품코드', '도매의신상품코드')
    const sellerSku = getRowValue(row, '자체상품코드', '판매자상품코드', '업체상품코드', '관리코드')
    const orderItemNo = getRowValue(row, '주문상품번호', '상품주문번호', '주문상세번호', '주문상세코드')
    const quantity = Math.max(parseNumber(getRowValue(row, '수량', '구매수량', '주문수량')), 1)
    const itemTotal = parseNumber(getRowValue(row, '상품합계', '상품금액', '결제금액', '총상품금액'))
    const totalAmount = parseNumber(getRowValue(row, '총금액', '총결제금액', '결제금액')) || itemTotal
    const supplyPrice = parseNumber(getRowValue(row, '공급가', '단가', '판매가'))
    const shippingFee = parseNumber(getRowValue(row, '배송비', '배송료', '추가배송비'))
    const recipientName = getRowValue(row, '수취인명', '수취인', '받는사람', '수령인')
    const recipientPhone = getRowValue(row, '수취인전화번호', '수취인연락처', '전화번호', '일반전화')
    const recipientMobile = getRowValue(row, '수취인핸드폰', '수취인휴대폰', '휴대폰', '핸드폰', '모바일')
    const buyerName = getRowValue(row, '주문자명', '주문자', '구매자명', '구매자') || recipientName
    const buyerPhone = getRowValue(row, '주문자전화번호', '구매자전화번호', '주문자연락처') || recipientPhone
    const buyerMobile = getRowValue(row, '주문자핸드폰', '구매자휴대폰', '주문자휴대폰') || recipientMobile
    const optionText = [
      getRowValue(row, '선택옵션', '옵션명', '옵션'),
      getRowValue(row, '입력옵션', '추가옵션'),
    ].filter(Boolean).join(' / ')

    orders.push({
      marketplaceId: 'domesin',
      marketplaceOrderId: orderNo,
      marketplaceStatus: getRowValue(row, '주문상태', '상태') || '신규주문',
      status: 'new',
      buyerName,
      buyerPhone: buyerPhone || buyerMobile || undefined,
      buyerPhone2: buyerMobile && buyerMobile !== buyerPhone ? buyerMobile : undefined,
      recipientName,
      recipientPhone: recipientPhone || recipientMobile || undefined,
      recipientPhone2: recipientMobile && recipientMobile !== recipientPhone ? recipientMobile : undefined,
      shippingAddress: {
        zipCode: getRowValue(row, '우편번호', '우편'),
        address1: getRowValue(row, '주소', '배송주소', '수취인주소'),
        address2: getRowValue(row, '상세주소', '나머지주소') || undefined,
      },
      orderedAt: parseKstDate(getRowValue(row, '주문일시', '주문일', '주문일자', '등록일', '결제일')),
      totalAmount,
      shippingType: getRowValue(row, '배송비구분', '배송구분') || null,
      shippingFee,
      deliveryMessage: getRowValue(row, '배송메세지', '배송메시지', '배송시요청사항', '요청사항', '주문요청사항') || null,
      rawData: {
        source,
        rowNumber: row.rowNumber,
        orderNo,
        orderItemNo,
        productCode,
        sellerSku,
        carrierName: getRowValue(row, '택배사', '배송사') || null,
        trackingNumber: getRowValue(row, '송장번호', '운송장번호') || null,
        memo: getRowValue(row, '메모', '관리메모') || null,
      },
      items: [
        {
          marketplaceItemId: orderItemNo || productCode || orderNo,
          productName,
          optionText: optionText || undefined,
          quantity,
          unitPrice: supplyPrice || (quantity > 0 ? itemTotal / quantity : itemTotal),
          sku: sellerSku || productCode || undefined,
        },
      ],
    })
  }

  return orders
}

export class DomesinScraper implements MarketplaceScraper {
  readonly marketplaceId = 'domesin'
  readonly displayName = '도매의신'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const { context, page, close } = await openContext()
    try {
      logStep('login: open login page')
      await gotoDomesin(page, DOMESIN_LOGIN_URL)
      await closePopups(page)

      if (await hasDomesinSession(page)) {
        return {
          success: true,
          storageState: await dumpStorageState(context),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12),
        }
      }

      logStep('login: fill credentials')
      await setInputValue(page.locator('input[name="m_id"], input#id, input[name="id"], input[type="text"]').first(), credentials.email)
      await setInputValue(page.locator('input[name="m_pw"], input#pw, input[name="pw"], input[type="password"]').first(), credentials.password)

      logStep('login: submit')
      await Promise.all([
        page.waitForURL((url) => !/\/scm\/login\.html|login_form/i.test(url.href), { timeout: 15_000 }).catch(() => undefined),
        page.locator('form[name="loginfrm"] button, form[name="loginfrm"] input[type="submit"], button.login-btn, input[type="submit"]').first().click({ timeout: 10_000 }).catch(async () => {
          await page.keyboard.press('Enter')
        }),
      ])
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
      await closePopups(page)
      await gotoDomesin(page, DOMESIN_HOME_URL)

      if (!(await hasDomesinSession(page))) {
        const alertText = await page.locator('body').innerText().catch(() => '')
        return {
          success: false,
          error: alertText.includes('Error') ? alertText.slice(0, 200) : '도매의신 로그인 확인에 실패했습니다.',
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
        error: error instanceof Error ? error.message : '도매의신 로그인 중 알 수 없는 오류',
      }
    } finally {
      await close()
    }
  }

  async testSession(credentials: ScraperCredentials): Promise<{ ok: boolean; error?: string }> {
    const { page, close } = await openContext(credentials.storageState)
    try {
      await gotoDomesin(page, DOMESIN_HOME_URL)
      await closePopups(page)
      if (await hasDomesinSession(page)) return { ok: true }

      const loginResult = await this.login(credentials)
      return loginResult.success
        ? { ok: true }
        : { ok: false, error: loginResult.error ?? '도매의신 세션 확인 실패' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '세션 확인 실패' }
    } finally {
      await close()
    }
  }

  async getOrders(credentials: ScraperCredentials, since: Date): Promise<NormalizedOrder[]> {
    const workbookBuffer = await this.downloadAndConfirmOrders(credentials, since)
    if (workbookBuffer.length === 0) return []
    return this.parseOrdersExcel(workbookBuffer)
  }

  async getClaimsOrders(_credentials: ScraperCredentials, _since: Date): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(
    _credentials: ScraperCredentials,
    _orderId: string,
    _invoice: InvoiceData,
  ): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: '도매의신 RPA 송장 업로드는 주문조회 화면 확인 후 구현이 필요합니다.',
    }
  }

  private async downloadAndConfirmOrders(credentials: ScraperCredentials, since: Date): Promise<Buffer> {
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
            'domesin',
            500,
            `도매의신 RPA 단계 실패: ${label} (${error instanceof Error ? error.message : 'unknown error'})`,
          )
        }
      }

      await runStep('orders: open order list', () => gotoDomesin(ctx.page, DOMESIN_ORDER_LIST_URL))
      await closePopups(ctx.page)
      if (!(await hasDomesinSession(ctx.page))) {
        logStep('orders: session invalid, login')
        await ctx.close()
        const loginResult = await this.login(credentials)
        if (!loginResult.success || !loginResult.storageState) {
          throw new MarketplaceApiError('domesin', 401, loginResult.error ?? '도매의신 로그인 실패')
        }
        sessionState = loginResult.storageState
        ctx = await openContext(sessionState)
        await runStep('orders: reopen order list after login', () => gotoDomesin(ctx.page, DOMESIN_ORDER_LIST_URL))
      }

      if (!(await hasDomesinSession(ctx.page))) {
        throw new MarketplaceApiError('domesin', 401, `도매의신 세션을 확인하지 못했습니다. (${await summarizePage(ctx.page)})`)
      }

      await runStep('orders: open order list', () => openOrderListPage(ctx.page))
      await runStep('orders: apply new-order search', () => applyNewOrderSearch(ctx.page, since))
      const selected = await runStep('orders: select order rows', () => selectOrderRows(ctx.page))
      if (!selected) {
        logStep('orders: no selectable new orders')
        return Buffer.alloc(0)
      }
      const workbook = await runStep('orders: download order excel', () => downloadOrdersExcel(ctx.page))
      if (workbook.length > 0) {
        await runStep('orders: confirm selected orders', () => confirmSelectedOrders(ctx.page))
      }
      return workbook
    } finally {
      await ctx.close()
    }
  }

  private async parseOrdersExcel(buffer: Buffer): Promise<NormalizedOrder[]> {
    try {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
      const worksheet = workbook.worksheets[0]
      if (!worksheet) return []

      const headerRow = findOrderHeaderRow(worksheet)
      if (!headerRow) return []

      const rows: OrderRow[] = []
      worksheet.eachRow((excelRow, rowNumber) => {
        if (rowNumber <= headerRow.rowNumber) return
        const values = new Map<string, string>()
        for (const [header, colNumber] of headerRow.columns) {
          values.set(header, readCellText(excelRow.getCell(colNumber).value))
        }
        rows.push({ rowNumber, values })
      })

      return makeOrdersFromRows(rows, 'rpa-excel')
    } catch (error) {
      const htmlOrders = this.parseHtmlOrders(buffer)
      if (htmlOrders.length > 0) return htmlOrders
      throw error
    }
  }

  private parseHtmlOrders(buffer: Buffer): NormalizedOrder[] {
    const html = decodeWorkbookText(buffer)
    const rowMatches = Array.from(html.matchAll(/<tr[\s\S]*?<\/tr>/gi)).map((match) => match[0])
    const tableRows = rowMatches.map((rowHtml, index) => ({
      rowNumber: index + 1,
      cells: Array.from(rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((cell) => stripHtml(cell[1] ?? '')),
    })).filter((row) => row.cells.length > 0)

    const header = tableRows.find((row) => {
      const text = row.cells.map(normalizeHeader).join(' ')
      return /주문번호|주문코드|주문일/.test(text) && /상품명|품명|제품명/.test(text)
    })
    if (!header) return []

    const columns = header.cells.map(normalizeHeader)
    const rows: OrderRow[] = []
    for (const tableRow of tableRows) {
      if (tableRow.rowNumber <= header.rowNumber) continue
      const values = new Map<string, string>()
      columns.forEach((column, index) => {
        if (column) values.set(column, tableRow.cells[index] ?? '')
      })
      rows.push({ rowNumber: tableRow.rowNumber, values })
    }

    return makeOrdersFromRows(rows, 'rpa-html-excel')
  }
}
