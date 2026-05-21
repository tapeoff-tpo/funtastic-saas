import ExcelJS from 'exceljs'
import type { Download, Page } from 'playwright'
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
const ORDER_PAGE_REFERRER = `${WMS_BASE_URL}/order`
const DOWNLOAD_TIMEOUT_MS = 120_000
const DOWNLOAD_STREAM_TIMEOUT_MS = 60_000
type DomechangoOrderSearchStatus = 'new' | 'shipping-target'

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
  console.log(`[도매창고-rpa] ${step}`)
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

async function readDownloadBuffer(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  if (!stream) throw new MarketplaceApiError('domechango', 500, '도매창고 엑셀 다운로드 스트림을 열 수 없습니다.')

  return Promise.race([
    (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      return Buffer.concat(chunks)
    })(),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new MarketplaceApiError('domechango', 504, `도매창고 엑셀 다운로드 스트림 수신이 ${DOWNLOAD_STREAM_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`))
      }, DOWNLOAD_STREAM_TIMEOUT_MS)
    }),
  ])
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
  const isOrderPath = new URL(page.url()).pathname === '/wms/order'
  const hasOrderControls = /선택주문|택배송장\s*업로드|주문검색/.test(bodyText)
  const hasOrderGrid = await page.locator('#order_list, #goods_list').first().isVisible({ timeout: 1000 }).catch(() => false)
  return isOrderPath && (hasOrderControls || hasOrderGrid)
}

async function hasWmsSession(page: Page): Promise<boolean> {
  if (/login|signin/i.test(page.url())) return false
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  if (/Error\s*\(\d+\)\s*->/i.test(bodyText)) return false
  return /주문\s*\/?\s*배송|긴급처리사항|로그아웃|신규주문|발송대상/.test(bodyText)
}

async function openOrderListPage(page: Page): Promise<void> {
  await gotoDomechango(page, WMS_BASE_URL)
  if (await hasOrderList(page)) return

  const clicked = await page
    .locator('a[href="/wms/order"], a[href$="/wms/order"]')
    .first()
    .click({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false)

  if (clicked) {
    await page.waitForURL((url) => url.pathname === '/wms/order', { timeout: 10_000 }).catch(() => undefined)
  }
  if (!(await hasOrderList(page))) {
    await gotoDomechango(page, ORDER_PAGE_REFERRER)
  }
  await page.waitForLoadState('domcontentloaded', { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => undefined)
  await page.locator('#order_list, #goods_list, text=선택주문').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)

  if (!(await hasOrderList(page))) {
    throw new MarketplaceApiError('domechango', 500, `도매창고 주문 리스트를 열지 못했습니다. (${await summarizePage(page)})`)
  }
}

async function applyOrderSearch(
  page: Page,
  since: Date,
  until: Date,
  status: DomechangoOrderSearchStatus,
): Promise<void> {
  await page.evaluate(({ since, until, status }) => {
    const fields = [
      ['#sdate, input[name="sdate"]', since],
      ['#edate, input[name="edate"]', until],
      ['#list_size, select[name="list_size"]', '500'],
      ['#page, input[name="page"]', '1'],
    ]

    for (const [selector, value] of fields) {
      const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)
      if (!input) continue
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    const statusPatterns = status === 'new'
      ? [/신규\s*주문/, /주문\s*접수/]
      : [/발송\s*대상/, /배송\s*준비/, /주문\s*확인/]
    const preferredValue = status === 'new' ? '1' : '2'
    const orderStatusRadio =
      document.querySelector<HTMLInputElement>(`#oistep${preferredValue}, input[name="oistep"][value="${preferredValue}"]`) ??
      Array.from(document.querySelectorAll<HTMLInputElement>('input[name="oistep"]')).find((input) => {
        const label = input.closest('label')?.textContent ?? document.querySelector(`label[for="${input.id}"]`)?.textContent ?? ''
        return statusPatterns.some((pattern) => pattern.test(label))
      })
    if (orderStatusRadio) {
      orderStatusRadio.checked = true
      orderStatusRadio.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      orderStatusRadio.dispatchEvent(new Event('input', { bubbles: true }))
      orderStatusRadio.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, { since: formatDateInput(since), until: formatDateInput(until), status })

  await page.locator('#btn_search, button').filter({ hasText: /주문검색|검색/ }).first().click({ timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(3000)
}

async function selectFirstOrderForExcel(page: Page): Promise<boolean> {
  const checkboxLocators = await page.locator('#order_list input[type="checkbox"], #goods_list input[type="checkbox"]').all()
  let selected = false

  for (const checkbox of checkboxLocators) {
    const candidate = await checkbox.evaluate((element, index) => {
      if (!(element instanceof HTMLInputElement)) return false
      if (element.disabled) return false
      const row = element.closest('tr, .tui-grid-row, [role="row"]')
      const text = row?.textContent ?? ''
      if (/전체|선택|checkbox/i.test(`${element.name} ${element.id}`) && !row) return false
      return /\d{6,}|신규주문|발송대상|배송준비중|배송중|배송완료/.test(text) || index > 0
    }, checkboxLocators.indexOf(checkbox)).catch(() => false)
    if (!candidate) continue

    await checkbox.scrollIntoViewIfNeeded().catch(() => undefined)
    const box = await checkbox.boundingBox().catch(() => null)
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(300)
    }
    await checkbox.evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) return
      if (!element.checked) element.click()
      element.checked = true
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }).catch(() => undefined)
    selected = await checkbox.isChecked().catch(() => false)
    if (selected) break
  }

  if (!selected) {
    selected = await page.evaluate(() => {
      const gridRoot = document.querySelector('#order_list') ?? document.querySelector('#goods_list') ?? document
      const checkboxes = gridRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      const visibleCheckboxes: HTMLInputElement[] = []
      for (const checkbox of checkboxes) {
        if (!checkbox.disabled && checkbox.offsetParent !== null) visibleCheckboxes.push(checkbox)
      }

      let rowCheckbox: HTMLInputElement | undefined
      for (const checkbox of visibleCheckboxes) {
        const row = checkbox.closest('tr, .tui-grid-row, [role="row"]')
        if (row && /\d{6,}|신규주문|발송대상|배송준비중|배송중|배송완료/.test(row.textContent ?? '')) {
          rowCheckbox = checkbox
          break
        }
      }
      rowCheckbox = rowCheckbox ?? visibleCheckboxes[1] ?? visibleCheckboxes[0]

      if (!rowCheckbox) return false
      if (!rowCheckbox.checked) rowCheckbox.click()
      rowCheckbox.checked = true
      rowCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      rowCheckbox.dispatchEvent(new Event('input', { bubbles: true }))
      rowCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
      return rowCheckbox.checked
    })
  }

  return selected
}

async function triggerSelectedOrderExcelDownload(
  page: Page,
  setProgress?: (message: string) => Promise<void>,
): Promise<Buffer> {
  await setProgress?.('도매창고 엑셀 다운로드 요청 중...')
  const dialogPromise = page.waitForEvent('dialog', { timeout: 5000 })
    .then(async (dialog) => {
      const message = dialog.message()
      await dialog.accept().catch(() => undefined)
      return message
    })
    .catch(() => null)

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
    page.evaluate(() => {
      const selects = document.querySelectorAll<HTMLSelectElement>('select')
      let select: HTMLSelectElement | undefined
      let option: HTMLOptionElement | undefined
      const visibleSelects = Array.from(selects).filter((candidate) => candidate.offsetParent !== null)
      const isSelectedOrderSelect = (candidate: HTMLSelectElement) => {
        const key = `${candidate.id} ${candidate.name} ${candidate.className} ${candidate.selectedOptions[0]?.textContent ?? ''}`
        const optionText = Array.from(candidate.options).map((candidateOption) => candidateOption.textContent ?? '').join(' ')
        if (/list_size|검색어|search|sdate|edate|page/i.test(key)) return false
        if (/50개씩|주문번호|상품코드|자체상품코드/.test(optionText)) return false
        return /선택\s*주문|선택주문|엑셀\s*다운|다운로드/.test(`${key} ${optionText}`)
      }

      for (const candidate of visibleSelects.filter(isSelectedOrderSelect)) {
        for (const candidateOption of candidate.options) {
          if (/엑셀\s*다운|엑셀.*다운|다운로드/.test(candidateOption.textContent ?? '')) {
            select = candidate
            option = candidateOption
            break
          }
        }
        if (select && option) break
      }

      if (!select || !option) {
        for (const candidate of visibleSelects) {
          for (const candidateOption of candidate.options) {
            const text = candidateOption.textContent ?? ''
            if (/엑셀\s*다운|엑셀.*다운|다운로드/.test(text)) {
              select = candidate
              option = candidateOption
              break
            }
          }
          if (select && option) break
        }
      }

      if (!select) throw new Error('선택주문 엑셀 다운로드 선택 상자를 찾지 못했습니다.')
      if (!option) throw new Error('선택주문 엑셀 다운로드 옵션을 찾지 못했습니다.')

      select.value = option.value
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
      select.onchange?.(new Event('change') as Event)
    }),
  ]).catch(async (error) => {
    const dialogMessage = await dialogPromise
    throw new MarketplaceApiError(
      'domechango',
      504,
      `도매창고 주문 엑셀 다운로드가 ${DOWNLOAD_TIMEOUT_MS / 1000}초 안에 시작되지 않았습니다. (${error instanceof Error ? error.message : 'download timeout'}${dialogMessage ? ` dialog=${dialogMessage}` : ''})`,
    )
  })

  await setProgress?.('도매창고 엑셀 파일 수신 중...')
  return readDownloadBuffer(download)
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

  async getOrders(
    credentials: ScraperCredentials,
    since: Date,
    setProgress?: (message: string) => Promise<void>,
  ): Promise<NormalizedOrder[]> {
    const until = new Date()
    const workbookBuffer = await this.downloadOrdersExcel(credentials, since, until, setProgress)
    if (!workbookBuffer) return []
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
    setProgress?: (message: string) => Promise<void>,
  ): Promise<Buffer | null> {
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

      await setProgress?.('도매창고 주문 목록 여는 중...')
      await runStep('orders: open order list page', () => openOrderListPage(ctx.page))
      let workbook: Buffer | null = null
      let matchedStatus: DomechangoOrderSearchStatus | null = null
      const searchStatuses: DomechangoOrderSearchStatus[] = ['new', 'shipping-target']
      const statusLabel: Record<DomechangoOrderSearchStatus, string> = {
        new: '신규주문',
        'shipping-target': '발송대상',
      }

      for (const status of searchStatuses) {
        await setProgress?.(`도매창고 ${statusLabel[status]} 검색 중...`)
        await runStep(`orders: apply order search (${status})`, () => applyOrderSearch(ctx.page, since, until, status))
        await setProgress?.(`도매창고 ${statusLabel[status]} 엑셀 다운로드 대상 선택 중...`)
        const hasOrder = await runStep(`orders: select first order (${status})`, () => selectFirstOrderForExcel(ctx.page))
        if (!hasOrder) continue

        matchedStatus = status
        workbook = await runStep(`orders: download selected order excel (${status})`, () => triggerSelectedOrderExcelDownload(ctx.page, setProgress))
        break
      }

      if (!workbook || !matchedStatus) {
        await setProgress?.('도매창고 수집 대상 주문 0건')
        return null
      }
      await setProgress?.('도매창고 주문 엑셀 다운로드 완료')
      return workbook
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
