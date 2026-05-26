import ExcelJS from 'exceljs'
import type { Locator, Page } from 'playwright'
import { MarketplaceApiError } from '@/lib/marketplace/errors'
import type {
  MarketplaceId,
  InvoiceData,
  NormalizedClaim,
  NormalizedOrder,
} from '@/lib/marketplace/types'
import { getCarrierName, mapCarrierCode } from '@/lib/shipping/carrier-codes'
import { dumpStorageState, openContext } from '../browser'
import { dismissRpaPopups } from '../popups'
import type {
  MarketplaceScraper,
  ScraperCredentials,
  ScraperLoginResult,
} from '../types'

const ORDER_PAGE_URL = 'https://www.onch3.co.kr/supplier/orders.php?state=preparing'
const ALL_ORDER_PAGE_URL = 'https://www.onch3.co.kr/supplier/orders.php?state=all&orderDate=all&orderBy=obd.id%7Cdesc'
const DOWNLOAD_TIMEOUT_MS = 120_000

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
  await dismissOnchannelPopups(page)
}

async function dismissOnchannelPopups(page: Page): Promise<void> {
  await dismissRpaPopups(page, { marketplaceName: '온채널', maxPasses: 6 })

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

async function clickButtonByText(root: Locator | Page, pattern: RegExp): Promise<void> {
  const button = root.getByRole('button', { name: pattern }).first()
  if (await button.isVisible().catch(() => false)) {
    await button.click({ timeout: 15_000 })
    return
  }
  const fallback = root.locator('button, input[type="button"], input[type="submit"], a.btn').filter({ hasText: pattern }).first()
  if (await fallback.isVisible().catch(() => false)) {
    await fallback.click({ timeout: 15_000 })
    return
  }

  const clicked = await root.locator('body, :scope').first().evaluate((element, source) => {
    const regexp = new RegExp(source)
    const controls = Array.from(
      element.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn'),
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
    throw new MarketplaceApiError('onchannel', 500, `온채널 버튼을 찾지 못했습니다. (${pattern.source})`)
  }
}

async function selectSearchTypeForOrderCode(page: Page): Promise<void> {
  const selects = await visibleLocators(page, 'select')
  for (const select of selects) {
    const selected = await select.evaluate((element) => {
      if (!(element instanceof HTMLSelectElement)) return false
      const option = Array.from(element.options).find((item) => /주문/.test(item.textContent ?? ''))
      if (!option) return false
      element.value = option.value
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }).catch(() => false)
    if (selected) return
  }
}

async function searchOrderCode(page: Page, orderId: string): Promise<void> {
  await gotoOnchannel(page, ALL_ORDER_PAGE_URL)
  await dismissOnchannelPopups(page)

  if (await page.getByText(orderId, { exact: false }).first().isVisible().catch(() => false)) return

  await selectSearchTypeForOrderCode(page)

  const searchInput = page.locator('input[name="searchText"], input[placeholder*="검색"]').first()
  if (await searchInput.isVisible().catch(() => false)) {
    await setInputValue(searchInput, orderId)
  } else {
    const inputs = await visibleLocators(
      page,
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])',
    )
    let candidate = inputs[0]
    for (const input of inputs) {
      const type = await input.getAttribute('type').catch(() => '')
      if (type !== 'date') {
        candidate = input
        break
      }
    }
    if (candidate) await setInputValue(candidate, orderId)
  }

  await dismissOnchannelPopups(page)
  await clickButtonByText(page, /^검색$/)
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined)
  await page.waitForTimeout(1000)
  await dismissOnchannelPopups(page)
}

async function findOrderRow(page: Page, orderId: string): Promise<Locator | null> {
  const selectors = [
    'tr',
    '.order-row',
    '.list-row',
    '.table-row',
    '[class*="order"][class*="row"]',
    '.row',
  ]

  for (const selector of selectors) {
    const row = page.locator(selector).filter({ hasText: orderId }).first()
    if (await row.isVisible().catch(() => false)) return row
  }

  return null
}

async function clickInvoiceInputForOrder(page: Page, orderId: string): Promise<void> {
  const row = await findOrderRow(page, orderId)
  if (row) {
    await clickButtonByText(row, /송장\s*입력|송장등록|송장\s*등록/)
    return
  }

  const clicked = await page.evaluate((targetOrderId) => {
    const isVisible = (element: Element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const hasInvoiceText = (element: Element) => /송장\s*(입력|등록)/.test(element.textContent ?? '')
    const candidateContainers = Array.from(document.querySelectorAll('tr, li, div, section, article'))
      .filter((element) => isVisible(element) && (element.textContent ?? '').includes(targetOrderId))
      .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))

    for (const container of candidateContainers) {
      const controls = Array.from(
        container.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a'),
      )
      const control = controls.find((item) => item instanceof HTMLElement && isVisible(item) && hasInvoiceText(item))
      if (control instanceof HTMLElement) {
        control.click()
        return true
      }
    }
    return false
  }, orderId).catch(() => false)

  if (!clicked) {
    throw new MarketplaceApiError('onchannel', 404, `온채널 주문 행을 찾지 못했습니다. (${orderId})`)
  }
}

async function selectCarrier(root: Locator | Page, invoice: InvoiceData): Promise<void> {
  const carrierName = getCarrierName(invoice.carrierId)
  const carrierCode = mapCarrierCode('onchannel', invoice.carrierId)
  const select = root.locator('select:visible').first()
  if (!(await select.isVisible().catch(() => false))) return

  for (const option of [
    { label: carrierName },
    { label: carrierName.replace(/\s+/g, '') },
    { value: carrierCode },
    { value: invoice.carrierId },
  ]) {
    const selected = await select.selectOption(option, { timeout: 2000 }).then(() => true).catch(() => false)
    if (selected) return
  }

  const normalizedCarrierName = carrierName.replace(/\s+/g, '')
  const selectedByText = await select.evaluate((element, targetName) => {
    if (!(element instanceof HTMLSelectElement)) return false
    const option = Array.from(element.options).find((item) => {
      const label = (item.textContent ?? '').replace(/\s+/g, '')
      return label.includes(targetName) || targetName.includes(label)
    })
    if (!option) return false
    element.value = option.value
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, normalizedCarrierName).catch(() => false)

  if (!selectedByText) {
    throw new MarketplaceApiError('onchannel', 500, `온채널 택배사를 선택하지 못했습니다. (${carrierName})`)
  }
}

async function fillTrackingNumber(root: Locator | Page, trackingNumber: string): Promise<void> {
  const selectors = [
    'input[name*="invoice" i]',
    'input[name*="tracking" i]',
    'input[name*="songjang" i]',
    'input[id*="invoice" i]',
    'input[id*="tracking" i]',
    'input[id*="songjang" i]',
    'input[placeholder*="송장"]',
    'input[placeholder*="운송장"]',
  ]

  for (const selector of selectors) {
    const input = root.locator(selector).first()
    if (await input.isVisible().catch(() => false)) {
      await setInputValue(input, trackingNumber)
      return
    }
  }

  const visibleInputs = await visibleLocators(
    root,
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])',
  )
  let candidate = visibleInputs[0]
  for (const input of visibleInputs) {
    if (await input.isEditable().catch(() => false)) {
      candidate = input
      break
    }
  }
  if (!candidate) {
    throw new MarketplaceApiError('onchannel', 500, '온채널 송장번호 입력칸을 찾지 못했습니다.')
  }
  await setInputValue(candidate, trackingNumber)
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

  async uploadInvoice(
    credentials: ScraperCredentials,
    orderId: string,
    invoice: InvoiceData,
  ): Promise<{ success: boolean; error?: string }> {
    let sessionState = credentials.storageState
    let ctx = await openContext(sessionState)

    try {
      await gotoOnchannel(ctx.page, ALL_ORDER_PAGE_URL)
      await dismissOnchannelPopups(ctx.page)
      if (!(await this.isLoggedIn(ctx.page))) {
        await ctx.close()
        const loginResult = await this.login(credentials)
        if (!loginResult.success || !loginResult.storageState) {
          return { success: false, error: loginResult.error ?? '온채널 로그인 실패' }
        }
        sessionState = loginResult.storageState
        ctx = await openContext(sessionState)
        await gotoOnchannel(ctx.page, ALL_ORDER_PAGE_URL)
        await dismissOnchannelPopups(ctx.page)
      }

      await searchOrderCode(ctx.page, orderId)
      await dismissOnchannelPopups(ctx.page)
      await clickInvoiceInputForOrder(ctx.page, orderId)

      const dialog = ctx.page.locator('.modal:visible, [role="dialog"]:visible, .swal2-popup:visible').first()
      await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined)
      await dismissOnchannelPopups(ctx.page)
      const uploadRoot: Locator | Page = (await dialog.isVisible().catch(() => false)) ? dialog : ctx.page

      await selectCarrier(uploadRoot, invoice)
      await fillTrackingNumber(uploadRoot, invoice.trackingNumber)

      const dialogPromise = ctx.page.waitForEvent('dialog', { timeout: 5000 })
        .then(async (dialogEvent) => {
          await dialogEvent.accept().catch(() => undefined)
          return dialogEvent.message()
        })
        .catch(() => null)

      await dismissOnchannelPopups(ctx.page)
      await clickButtonByText(uploadRoot, /저장|등록|확인|전송|완료|송장\s*입력/)
      const dialogMessage = await dialogPromise

      await ctx.page.waitForTimeout(1000)
      const pageText = await ctx.page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
      if (/실패|오류|error|잘못|확인해/.test(pageText) && !/완료|성공|등록/.test(pageText)) {
        return { success: false, error: dialogMessage ?? '온채널 송장 입력 후 오류 메시지가 표시되었습니다.' }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '온채널 송장 RPA 업로드 실패' }
    } finally {
      await ctx.close()
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
      const dialogPromise = ctx.page.waitForEvent('dialog', { timeout: 5000 })
        .then(async (dialogEvent) => {
          const message = dialogEvent.message()
          await dialogEvent.accept().catch(() => undefined)
          return message
        })
        .catch(() => null)
      const [download] = await Promise.all([
        ctx.page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
        downloadRoot.getByRole('button', { name: /^다운로드$/ }).click({ timeout: 15_000 }),
      ]).catch(async (error) => {
        const dialogMessage = await dialogPromise
        throw new MarketplaceApiError(
          'onchannel',
          504,
          `온채널 엑셀 다운로드가 ${DOWNLOAD_TIMEOUT_MS / 1000}초 안에 시작되지 않았습니다. (${error instanceof Error ? error.message : 'download timeout'}${dialogMessage ? ` dialog=${dialogMessage}` : ''}; ${await summarizePage(ctx.page)})`,
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
