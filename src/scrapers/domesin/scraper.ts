import type { Page } from 'playwright'
import { dumpStorageState, openContext } from '../browser'
import type {
  MarketplaceScraper,
  ScraperCredentials,
  ScraperLoginResult,
} from '../types'
import type { InvoiceData, NormalizedClaim, NormalizedOrder } from '@/lib/marketplace/types'

const DOMESIN_HOME_URL = 'https://www.domesin.com/'
const DOMESIN_LOGIN_URL = 'https://www.domesin.com/index.html?p=member/login_form.html'
const DOMESIN_ORDER_LIST_URL = 'https://www.domesin.com/index.html?p=my/order_list.html'

async function isLoggedIn(page: Page): Promise<boolean> {
  const logoutLink = page.locator('a[href*="logout"]').first()
  if (await logoutLink.isVisible().catch(() => false)) return true
  return page.getByText('로그아웃').first().isVisible().catch(() => false)
}

async function closePopups(page: Page): Promise<void> {
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

export class DomesinScraper implements MarketplaceScraper {
  readonly marketplaceId = 'domesin'
  readonly displayName = '도매의신'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const { context, page, close } = await openContext()
    try {
      await page.goto(DOMESIN_LOGIN_URL, { waitUntil: 'domcontentloaded' })
      await closePopups(page)

      await page.locator('input[name="m_id"]').fill(credentials.email)
      await page.locator('input[name="m_pw"]').fill(credentials.password)
      await Promise.all([
        page.waitForLoadState('networkidle').catch(() => undefined),
        page.locator('form[name="loginfrm"] button, button.login-btn').first().click(),
      ])

      if (!(await isLoggedIn(page))) {
        const alertText = await page.locator('body').innerText().catch(() => '')
        return {
          success: false,
          error: alertText.includes('Error') ? alertText.slice(0, 200) : '도매의신 로그인 확인에 실패했습니다.',
        }
      }

      return {
        success: true,
        storageState: await dumpStorageState(context),
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
      await page.goto(DOMESIN_HOME_URL, { waitUntil: 'domcontentloaded' })
      await closePopups(page)
      if (await isLoggedIn(page)) return { ok: true }
      return { ok: false, error: '도매의신 세션이 만료되었습니다.' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '세션 확인 실패' }
    } finally {
      await close()
    }
  }

  async getOrders(credentials: ScraperCredentials, _since: Date): Promise<NormalizedOrder[]> {
    const { page, close } = await openContext(credentials.storageState)
    try {
      await page.goto(DOMESIN_ORDER_LIST_URL, { waitUntil: 'domcontentloaded' })
      await closePopups(page)
      if (!(await isLoggedIn(page))) {
        throw new Error('도매의신 세션이 없습니다. scraper worker login flow를 먼저 실행해야 합니다.')
      }

      // 주문조회 화면은 로그인 계정의 권한/설정에 따라 컬럼과 엑셀 버튼이 달라질 수 있어
      // 실제 계정 화면 확인 후 파싱/다운로드 매핑을 확정한다.
      return []
    } finally {
      await close()
    }
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
}
