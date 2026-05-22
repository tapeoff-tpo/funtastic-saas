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

const MARKETPLACE_ID: MarketplaceId = 'gs-shop'
const BASE_URL = 'https://withgs.gsshop.com'
const LOGIN_URL = `${BASE_URL}/cmm/login`

async function gotoGs(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '')
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

async function firstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index)
      if (await item.isVisible().catch(() => false)) return item
    }
  }
  return null
}

async function fillInput(input: Locator, value: string): Promise<void> {
  await input.fill(value, { timeout: 5_000 }).catch(async () => {
    await input.evaluate((element, nextValue) => {
      if (!(element instanceof HTMLInputElement)) return
      element.removeAttribute('readonly')
      element.value = nextValue
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
  })
}

async function clickLoginControl(page: Page): Promise<void> {
  const controls = [
    page.getByRole('button', { name: /로그인|Login/i }).first(),
    page.locator('button[type="submit"], input[type="submit"]').first(),
    page.locator('button, input[type="button"], a').filter({ hasText: /로그인|Login/i }).first(),
  ]

  for (const control of controls) {
    if (await control.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined),
        control.click({ timeout: 10_000 }),
      ])
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
      return
    }
  }

  const submitted = await page.evaluate(() => {
    const form = document.querySelector('form')
    if (!(form instanceof HTMLFormElement)) return false
    form.requestSubmit()
    return true
  }).catch(() => false)

  if (!submitted) {
    throw new MarketplaceApiError(MARKETPLACE_ID, 500, 'GS샵 로그인 버튼을 찾지 못했습니다.')
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
}

async function isLoggedIn(page: Page): Promise<boolean> {
  if (/\/cmm\/login/i.test(page.url())) return false

  const logout = page.getByText(/로그아웃|Logout/i).first()
  if (await logout.isVisible().catch(() => false)) return true

  const bodyText = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '')
  if (/협력사|주문|배송|상품|정산|출고|회수/.test(bodyText) && !/아이디|비밀번호/.test(bodyText)) {
    return true
  }

  return false
}

async function ensureLoggedIn(page: Page, credentials: ScraperCredentials): Promise<void> {
  if (await isLoggedIn(page)) return

  await gotoGs(page, LOGIN_URL)
  if (await isLoggedIn(page)) return

  const idInput = await firstVisible(page, [
    'input[name*="id" i]',
    'input[id*="id" i]',
    'input[placeholder*="아이디"]',
    'input[placeholder*="ID" i]',
    'input[type="text"]',
  ])
  const passwordInput = await firstVisible(page, [
    'input[type="password"]',
    'input[name*="pw" i]',
    'input[id*="pw" i]',
    'input[placeholder*="비밀번호"]',
    'input[placeholder*="password" i]',
  ])

  if (!idInput || !passwordInput) {
    throw new MarketplaceApiError(
      MARKETPLACE_ID,
      500,
      `GS샵 로그인 입력칸을 찾지 못했습니다. (${await summarizePage(page)})`,
    )
  }

  await fillInput(idInput, credentials.email)
  await fillInput(passwordInput, credentials.password)
  await clickLoginControl(page)
  await page.waitForTimeout(1_500)

  if (!(await isLoggedIn(page))) {
    throw new MarketplaceApiError(
      MARKETPLACE_ID,
      401,
      `GS샵 로그인에 실패했습니다. 계정/비밀번호 또는 추가 인증 여부를 확인해주세요. (${await summarizePage(page)})`,
    )
  }
}

export class GsShopScraper implements MarketplaceScraper {
  readonly marketplaceId: MarketplaceId = MARKETPLACE_ID
  readonly displayName = 'GS샵'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const { context, page, close } = await openContext(credentials.storageState)

    try {
      await gotoGs(page, BASE_URL)
      await ensureLoggedIn(page, credentials)
      return {
        success: true,
        storageState: await dumpStorageState(context),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'GS샵 로그인 오류',
      }
    } finally {
      await close()
    }
  }

  async testSession(credentials: ScraperCredentials): Promise<{ ok: boolean; error?: string }> {
    const { page, close } = await openContext(credentials.storageState)

    try {
      await gotoGs(page, BASE_URL)
      if (await isLoggedIn(page)) return { ok: true }
      return { ok: false, error: 'GS샵 세션이 만료되었습니다.' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'GS샵 세션 확인 오류' }
    } finally {
      await close()
    }
  }

  async getOrders(
    credentials: ScraperCredentials,
    _since: Date,
    setProgress?: (message: string) => Promise<void>,
  ): Promise<NormalizedOrder[]> {
    const { page, close } = await openContext(credentials.storageState)

    try {
      await setProgress?.('GS샵 로그인 확인 중...')
      await gotoGs(page, BASE_URL)
      await ensureLoggedIn(page, credentials)
      await setProgress?.('GS샵 주문 화면 확인 필요')
      throw new MarketplaceApiError(
        MARKETPLACE_ID,
        501,
        `GS샵 RPA는 로그인/세션 연결까지 준비되었습니다. 주문목록 또는 엑셀 다운로드 화면 URL과 버튼 구조 확인 후 주문수집을 완성할 수 있습니다. (${await summarizePage(page)})`,
      )
    } finally {
      await close()
    }
  }

  async getClaimsOrders(): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(
    _credentials: ScraperCredentials,
    _orderId: string,
    _invoice: InvoiceData,
  ): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: 'GS샵 RPA 송장전송은 주문목록/송장입력 화면 확인 후 연결이 필요합니다.',
    }
  }
}
