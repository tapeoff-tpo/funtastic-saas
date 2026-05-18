import ExcelJS from 'exceljs'
import type { Page } from 'playwright'
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

const ORDER_PAGE_URL = 'https://onch3.co.kr/supplier/orders.php?state=preparing'
const LOGIN_URL = 'https://onch3.co.kr/login.php'

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

export class OnchannelScraper implements MarketplaceScraper {
  readonly marketplaceId: MarketplaceId = 'onchannel'
  readonly displayName = '온채널'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const { context, page, close } = await openContext()

    try {
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })

      const idInput = page
        .locator('input[name="userid"], input[name="user_id"], input[name="id"], input[type="text"]')
        .first()
      const passwordInput = page.locator('input[name="password"], input[name="passwd"], input[type="password"]').first()

      await idInput.fill(credentials.email)
      await passwordInput.fill(credentials.password)

      const loginButton = page
        .getByRole('button', { name: /로그인|login/i })
        .or(page.locator('input[type="submit"], button[type="submit"]').first())
      await Promise.all([
        page.waitForLoadState('domcontentloaded').catch(() => undefined),
        loginButton.click(),
      ])

      await page.goto(ORDER_PAGE_URL, { waitUntil: 'domcontentloaded' })
      const ok = await this.isLoggedIn(page)
      if (!ok) {
        return { success: false, error: '온채널 로그인 후 주문정보 페이지에 접근하지 못했습니다.' }
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
      await page.goto(ORDER_PAGE_URL, { waitUntil: 'domcontentloaded' })
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
      await ctx.page.goto(ORDER_PAGE_URL, { waitUntil: 'domcontentloaded' })
      if (!(await this.isLoggedIn(ctx.page))) {
        await ctx.close()
        const loginResult = await this.login(credentials)
        if (!loginResult.success || !loginResult.storageState) {
          throw new MarketplaceApiError('onchannel', 401, loginResult.error ?? '온채널 로그인 실패')
        }
        sessionState = loginResult.storageState
        ctx = await openContext(sessionState)
        await ctx.page.goto(ORDER_PAGE_URL, { waitUntil: 'domcontentloaded' })
      }

      await ctx.page.getByRole('button', { name: /주문내역\s*다운로드/ }).click()
      const dialog = ctx.page.getByRole('dialog').or(ctx.page.locator('.modal, [role="dialog"]').first())

      const dateInputs = dialog.locator('input[type="date"], input[placeholder*="YYYY"], input[placeholder*="yyyy"]')
      await dateInputs.nth(0).fill(formatDateInput(since))
      await dateInputs.nth(1).fill(formatDateInput(until))

      const checkbox = dialog.locator('input[type="checkbox"]').first()
      if (!(await checkbox.isChecked().catch(() => false))) {
        await checkbox.check({ force: true })
      }

      const downloadPromise = ctx.page.waitForEvent('download')
      await dialog.getByRole('button', { name: /^다운로드$/ }).click()
      const download = await downloadPromise
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
