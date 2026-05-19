import ExcelJS from 'exceljs'
import type { Locator, Page } from 'playwright'
import { MarketplaceApiError } from '@/lib/marketplace/errors'
import type {
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

const ORDER_PAGE_URL = 'https://www.onch3.co.kr/supplier/orders.php?state=preparing'
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

function parseNumber(value: string): number {
  const num = Number(value.replaceAll(',', '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(num) ? num : 0
}

function parseKstDate(value: string): Date {
  if (!value) return new Date()
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(`${normalized}+09:00`)
  return Number.isNaN(date.getTime()) ? new Date(value) : date
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

async function gotoOnchannel(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: 60000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
}

async function dismissOnchannelPopups(page: Page): Promise<void> {
  await page.evaluate(() => {
    const selectors = [
      '.layer_popup',
      '[id^="onch-popup"]',
      '[id*="onch-popup"]',
      '.feedback-top-center',
    ]

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (!(element instanceof HTMLElement)) return
        element.style.pointerEvents = 'none'
        element.style.display = 'none'
        element.setAttribute('aria-hidden', 'true')
      })
    }
  }).catch(() => undefined)
}

async function submitLoginForm(page: Page): Promise<void> {
  const form = page.locator('form.form-signin, form[action*="/login/login_web.php"]').first()
  const submitButton = page.locator('button[type="submit"][name="login"], input[type="submit"][name="login"]').first()
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => undefined),
    form.evaluate((formEl, buttonEl) => {
      if (!(formEl instanceof HTMLFormElement)) return
      if (buttonEl instanceof HTMLElement && typeof formEl.requestSubmit === 'function') {
        formEl.requestSubmit(buttonEl)
        return
      }
      formEl.requestSubmit()
    }, await submitButton.elementHandle().catch(() => null)),
  ])
  await page.waitForLoadState('domcontentloaded').catch(() => undefined)
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

async function ensureCheckboxChecked(root: Locator | Page, checkbox: Locator): Promise<void> {
  if (await checkbox.isChecked().catch(() => false)) return

  await checkbox.check({ force: true, timeout: 3000 }).catch(async () => {
    const id = await checkbox.getAttribute('id').catch(() => null)
    if (id) {
      const label = root.locator(`label[for="${id}"]`).first()
      if (await label.isVisible().catch(() => false)) {
        await label.click({ force: true }).catch(() => undefined)
      }
    }
  })

  if (await checkbox.isChecked().catch(() => false)) return

  await checkbox.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) return
    element.checked = true
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

export class OnchannelScraper implements MarketplaceScraper {
  readonly marketplaceId: MarketplaceId = 'onchannel'
  readonly displayName = '온채널'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const { context, page, close } = await openContext()

    try {
      await gotoOnchannel(page, ORDER_PAGE_URL)
      if (await this.isLoggedIn(page)) {
        return {
          success: true,
          storageState: await dumpStorageState(context),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12),
        }
      }

      const idInput = page
        .locator('input[name="username"], input[name="userid"], input[name="user_id"], input[name="id"], input[type="text"]')
        .first()
      const passwordInput = page.locator('input[name="password"], input[name="passwd"], input[type="password"]').first()

      await idInput.fill(credentials.email)
      await passwordInput.fill(credentials.password)

      await submitLoginForm(page)

      await gotoOnchannel(page, ORDER_PAGE_URL)
      const ok = await this.isLoggedIn(page)
      if (!ok) {
        return {
          success: false,
          error: `온채널 로그인 후 주문정보 페이지에 접근하지 못했습니다. (${await summarizePage(page)})`,
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
      await gotoOnchannel(page, ORDER_PAGE_URL)
      if (await this.isLoggedIn(page)) return { ok: true }

      const loginResult = await this.login(credentials)
      return loginResult.success
        ? { ok: true }
        : { ok: false, error: loginResult.error ?? '온채널 세션 확인 실패' }
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

  async uploadInvoice(): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: '온채널 송장 RPA 업로드는 아직 구현되지 않았습니다.',
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
      await gotoOnchannel(ctx.page, ORDER_PAGE_URL)
      await dismissOnchannelPopups(ctx.page)
      if (!(await this.isLoggedIn(ctx.page))) {
        await ctx.close()
        const loginResult = await this.login(credentials)
        if (!loginResult.success || !loginResult.storageState) {
          throw new MarketplaceApiError('onchannel', 401, loginResult.error ?? '온채널 로그인 실패')
        }
        sessionState = loginResult.storageState
        ctx = await openContext(sessionState)
        await gotoOnchannel(ctx.page, ORDER_PAGE_URL)
        await dismissOnchannelPopups(ctx.page)
      }

      await dismissOnchannelPopups(ctx.page)
      await ctx.page.getByRole('button', { name: /주문내역\s*다운로드/ }).click({ timeout: 15_000 })
      const dialog = ctx.page.locator('.modal:visible, [role="dialog"]:visible, .swal2-popup:visible').first()
      await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined)
      await dismissOnchannelPopups(ctx.page)
      const downloadRoot: Locator | Page = (await dialog.isVisible().catch(() => false)) ? dialog : ctx.page

      const inputSelector =
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])'
      const scopedInputs = await visibleLocators(downloadRoot, inputSelector)
      const dateInputs = scopedInputs.length >= 2 ? scopedInputs : await visibleLocators(ctx.page, inputSelector)

      if (dateInputs.length < 2) {
        throw new MarketplaceApiError(
          'onchannel',
          500,
          `온채널 주문내역 다운로드 기간 입력칸을 찾지 못했습니다. (${await summarizePage(ctx.page)})`,
        )
      }

      await setInputValue(dateInputs[0], formatDateInput(since))
      await setInputValue(dateInputs[1], formatDateInput(until))

      const checkbox = downloadRoot.locator('input[type="checkbox"]').first()
      await ensureCheckboxChecked(downloadRoot, checkbox)

      await dismissOnchannelPopups(ctx.page)
      const [download] = await Promise.all([
        ctx.page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
        downloadRoot.getByRole('button', { name: /^다운로드$/ }).click({ timeout: 15_000 }),
      ]).catch((error) => {
        throw new MarketplaceApiError(
          'onchannel',
          504,
          `온채널 엑셀 다운로드가 ${DOWNLOAD_TIMEOUT_MS / 1000}초 안에 시작되지 않았습니다. (${error instanceof Error ? error.message : 'download timeout'})`,
        )
      })
      const stream = await download.createReadStream()
      if (!stream) throw new MarketplaceApiError('onchannel', 500, '온채널 엑셀 다운로드 스트림을 열 수 없습니다.')

      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      return Buffer.concat(chunks)
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

      const orderCode = get(row, '주문코드')
      if (!orderCode) return

      const quantity = Math.max(parseNumber(get(row, '수량')), 1)
      const totalAmount = parseNumber(get(row, '가격'))
      const productName = get(row, '상품명')
      const productCode = get(row, '상품코드')
      const sku = get(row, '자체코드')
      const customerName = get(row, '고객명')
      const phone = get(row, '연락처')
      const backupPhone = get(row, '비상연락처')

      orders.push({
        marketplaceId: 'onchannel',
        marketplaceOrderId: orderCode,
        marketplaceStatus: '배송준비중',
        status: 'new',
        buyerName: customerName,
        buyerPhone: phone,
        buyerPhone2: backupPhone || undefined,
        recipientName: customerName,
        recipientPhone: phone,
        recipientPhone2: backupPhone || undefined,
        shippingAddress: {
          zipCode: get(row, '우편번호'),
          address1: get(row, '배송지주소'),
        },
        orderedAt: parseKstDate(get(row, '일자')),
        totalAmount,
        shippingType: get(row, '배송여부') || null,
        deliveryMessage: get(row, '남김말') || null,
        rawData: {
          source: 'rpa-excel',
          rowNumber,
          orderCode,
          productCode,
        },
        items: [
          {
            marketplaceItemId: productCode || orderCode,
            productName,
            optionText: get(row, '옵션') || undefined,
            quantity,
            unitPrice: quantity > 0 ? totalAmount / quantity : totalAmount,
            sku: sku || undefined,
          },
        ],
      })
    })

    return orders
  }

  private async isLoggedIn(page: Page): Promise<boolean> {
    if (page.url().includes('login')) return false
    const orderDownloadButton = page.getByRole('button', { name: /주문내역\s*다운로드/ })
    if (await orderDownloadButton.isVisible().catch(() => false)) return true
    return page.locator('text=공급사').first().isVisible().catch(() => false)
  }
}
