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

const WMS_BASE_URL = 'https://www.wholesaledepot.co.kr/wms'
const LOGIN_PAGE_URL = `${WMS_BASE_URL}/login`
const ORDER_PAGE_URL = `${WMS_BASE_URL}/order`
const NAVIGATION_TIMEOUT_MS = 20_000
const LOAD_STATE_TIMEOUT_MS = 8_000
const DOWNLOAD_TIMEOUT_MS = 25_000

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

async function gotoDomechango(page: Page, url = ORDER_PAGE_URL): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: NAVIGATION_TIMEOUT_MS }).catch((error) => {
    throw new MarketplaceApiError(
      'domechango',
      504,
      `도매창고 페이지 이동이 ${NAVIGATION_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다. (${url}, ${error instanceof Error ? error.message : 'navigation timeout'})`,
    )
  })
  await page.waitForLoadState('domcontentloaded', { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => undefined)
}

async function visibleLocators(root: Locator | Page, selector: string): Promise<Locator[]> {
  const locator = root.locator(selector)
  const locators: Locator[] = []
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index)
    if (await item.isVisible().catch(() => false)) locators.push(item)
  }
  return locators
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

async function clickButtonByText(root: Locator | Page, pattern: RegExp): Promise<void> {
  const button = root.getByRole('button', { name: pattern }).first()
  if (await button.isVisible().catch(() => false)) {
    await button.click({ timeout: 15_000 })
    return
  }

  const fallback = root
    .locator('button, input[type="button"], input[type="submit"], a, .btn')
    .filter({ hasText: pattern })
    .first()
  if (await fallback.isVisible().catch(() => false)) {
    await fallback.click({ timeout: 15_000 })
    return
  }

  const clicked = await root.locator('body, :scope').first().evaluate((element, source) => {
    const regexp = new RegExp(source)
    const controls = Array.from(
      element.querySelectorAll('button, input[type="button"], input[type="submit"], a, .btn'),
    )
    for (const control of controls) {
      if (!(control instanceof HTMLElement)) continue
      const text = `${control.innerText || ''} ${(control as HTMLInputElement).value || ''}`.trim()
      if (!regexp.test(text)) continue
      control.click()
      return true
    }
    return false
  }, pattern.source).catch(() => false)

  if (!clicked) {
    throw new MarketplaceApiError('domechango', 500, `도매창고 버튼을 찾지 못했습니다. (${pattern.source})`)
  }
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

async function navigateToOrderList(page: Page): Promise<void> {
  await gotoDomechango(page, WMS_BASE_URL)
  if (await hasOrderList(page)) return

  const orderMenu = page.getByText(/주문\s*리스트/).first()
  if (await orderMenu.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => undefined),
      orderMenu.click({ timeout: 5000 }),
    ])
    await page.waitForTimeout(500)
    if (await hasOrderList(page)) return
  }

  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('a, button, li, div, span'))
      .filter((element) => /주문\s*리스트/.test(element.textContent ?? ''))
      .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))
    const directLink = Array.from(document.querySelectorAll('a'))
      .find((anchor) => /\/wms\/order(?:$|\?)/.test((anchor as HTMLAnchorElement).href))

    const target = directLink ?? candidates[0]
    if (!(target instanceof HTMLElement)) return false
    target.click()
    return true
  }).catch(() => false)

  if (clicked) {
    await page.waitForLoadState('domcontentloaded', { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => undefined)
    await page.waitForTimeout(500)
    if (await hasOrderList(page)) return
  }

  await gotoDomechango(page, ORDER_PAGE_URL)
  if (!(await hasOrderList(page))) {
    throw new MarketplaceApiError('domechango', 404, `도매창고 주문 리스트를 열지 못했습니다. (${await summarizePage(page)})`)
  }
}

async function selectNewOrderStatus(page: Page): Promise<void> {
  const label = page.getByText(/^신규주문$/).first()
  if (await label.isVisible().catch(() => false)) {
    await label.click({ timeout: 3000 }).catch(() => undefined)
    return
  }

  await page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('input[type="radio"]'))
    const target = radios.find((radio) => {
      const root = radio.closest('label, td, div, li') ?? radio.parentElement
      return /신규주문/.test(root?.textContent ?? '')
    })
    if (!(target instanceof HTMLInputElement)) return
    target.checked = true
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }).catch(() => undefined)
}

async function setSearchDates(page: Page, since: Date, until: Date): Promise<void> {
  const dateInputs = await visibleLocators(page, 'input[type="date"], input[placeholder*="YYYY"], input[placeholder*="yyyy"], input[placeholder*="날짜"]')
  if (dateInputs.length < 2) return

  await setInputValue(dateInputs[0], formatDateInput(since))
  await setInputValue(dateInputs[1], formatDateInput(until))
}

async function selectAllVisibleOrders(page: Page): Promise<void> {
  const checkbox = page.locator('table input[type="checkbox"]:visible').first()
  if (!(await checkbox.isVisible().catch(() => false))) {
    throw new MarketplaceApiError('domechango', 404, '도매창고 주문 목록에서 선택할 주문 체크박스를 찾지 못했습니다.')
  }
  if (await checkbox.isChecked().catch(() => false)) return

  await checkbox.check({ force: true, timeout: 3000 }).catch(async () => {
    await checkbox.evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) return
      element.checked = true
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  })
}

async function triggerSelectedOrderExcelDownload(page: Page): Promise<Buffer> {
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => undefined)
  })

  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS })
  const triggered = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'))
    const select = selects.find((item) => {
      const text = Array.from(item.options).map((option) => option.textContent ?? '').join(' ')
      return /선택주문|엑셀/.test(text)
    })
    if (select instanceof HTMLSelectElement) {
      const option = Array.from(select.options).find((item) => /엑셀/.test(item.textContent ?? ''))
      if (option) {
        select.value = option.value
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
    }

    const controls = Array.from(document.querySelectorAll('button, input[type="button"], a, .btn'))
    const control = controls.find((item) => /엑셀/.test(item.textContent ?? (item as HTMLInputElement).value ?? ''))
    if (control instanceof HTMLElement) {
      control.click()
      return true
    }
    return false
  })

  if (!triggered) {
    downloadPromise.catch(() => undefined)
    throw new MarketplaceApiError('domechango', 404, '도매창고 선택주문 엑셀 다운로드 컨트롤을 찾지 못했습니다.')
  }

  const download = await downloadPromise.catch((error) => {
    throw new MarketplaceApiError(
      'domechango',
      504,
      `도매창고 엑셀 다운로드가 ${DOWNLOAD_TIMEOUT_MS / 1000}초 안에 시작되지 않았습니다. (${error instanceof Error ? error.message : 'download timeout'})`,
    )
  })

  const stream = await download.createReadStream()
  if (!stream) throw new MarketplaceApiError('domechango', 500, '도매창고 엑셀 다운로드 스트림을 열 수 없습니다.')

  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function hasOrderList(page: Page): Promise<boolean> {
  if (/login|signin/i.test(page.url())) return false
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  if (/Error\s*\(\d+\)\s*->/i.test(bodyText)) return false
  return /주문\s*리스트|선택주문|택배송장\s*업로드/.test(bodyText)
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
      await navigateToOrderList(page)
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
      await navigateToOrderList(page)
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

      await runStep('orders: open order list', () => navigateToOrderList(ctx.page))
      if (!(await this.isLoggedIn(ctx.page))) {
        logStep('orders: session invalid, login')
        await ctx.close()
        const loginResult = await this.login(credentials)
        if (!loginResult.success || !loginResult.storageState) {
          throw new MarketplaceApiError('domechango', 401, loginResult.error ?? '도매창고 로그인 실패')
        }
        sessionState = loginResult.storageState
        ctx = await openContext(sessionState)
        await runStep('orders: reopen order list after login', () => navigateToOrderList(ctx.page))
      }

      if (!(await this.isLoggedIn(ctx.page))) {
        throw new MarketplaceApiError('domechango', 401, `도매창고 주문 리스트에 접근하지 못했습니다. (${await summarizePage(ctx.page)})`)
      }

      await runStep('orders: set search filters', async () => {
        await setSearchDates(ctx.page, since, until)
        await selectNewOrderStatus(ctx.page)
      })
      await runStep('orders: search', async () => {
        await clickButtonByText(ctx.page, /주문검색|검색/)
      })
      await ctx.page.waitForLoadState('domcontentloaded', { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => undefined)
      await ctx.page.waitForTimeout(1000)
      await runStep('orders: select rows', () => selectAllVisibleOrders(ctx.page))
      return await runStep('orders: download excel', () => triggerSelectedOrderExcelDownload(ctx.page))
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
    return hasOrderList(page)
  }
}
