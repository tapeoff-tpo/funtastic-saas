import type { Locator, Page } from 'playwright'
import { MarketplaceApiError } from '@/lib/marketplace/errors'
import type {
  InvoiceData,
  MarketplaceId,
  NormalizedClaim,
  NormalizedOrder,
} from '@/lib/marketplace/types'
import { dumpStorageState, openContext } from '../browser'
import { readNaverVerificationCode } from '../mail/naver'
import type {
  MarketplaceScraper,
  ScraperCredentials,
  ScraperLoginResult,
} from '../types'

const MARKETPLACE_ID: MarketplaceId = 'gs-shop'
const BASE_URL = 'https://partners.gsshop.com'
const LOGIN_URL = `${BASE_URL}/sign-in`

async function gotoGs(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const frameTexts = await Promise.all(
    page.frames().map((frame) => frame.locator('body').innerText({ timeout: 1_000 }).catch(() => '')),
  )
  const bodyText = frameTexts.join(' ')
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

async function firstVisible(page: Page, selectors: string[], timeoutMs = 30_000): Promise<Locator | null> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(selector)
        const count = await locator.count().catch(() => 0)
        for (let index = 0; index < count; index += 1) {
          const item = locator.nth(index)
          if (await item.isVisible().catch(() => false)) return item
        }
      }
    }
    await page.waitForTimeout(500)
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

async function clickLoginControlRobust(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a'))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return false
        const text = element instanceof HTMLInputElement
          ? element.value
          : element.textContent || element.getAttribute('aria-label') || ''
        return /로그인|login|sign\s*in/i.test(text) || element.getAttribute('type') === 'submit'
      })

    const target = candidates[0]
    if (target instanceof HTMLElement) {
      target.click()
      return true
    }

    const form = document.querySelector('form')
    if (!(form instanceof HTMLFormElement)) return false
    form.requestSubmit()
    return true
  }).catch(() => false)

  if (!clicked) {
    await clickLoginControl(page)
    return
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
}

async function isSecondFactorPage(page: Page): Promise<boolean> {
  const bodyText = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '')
  return /인증번호|인증번호 받기|본인 명의|휴대폰번호|이메일 주소|verification|security code/i.test(bodyText)
}

async function clickEmailVerificationButton(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const visibleText = (element: Element): string => {
      if (element instanceof HTMLInputElement) return element.value || element.getAttribute('aria-label') || ''
      return element.textContent || element.getAttribute('aria-label') || ''
    }

    const elements = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return false
        const text = visibleText(element).replace(/\s+/g, ' ').trim()
        return /인증번호|verification/i.test(text)
      })
      .map((element) => {
        const containerText = (element.closest('li, tr, .row, div')?.textContent || '').replace(/\s+/g, ' ')
        let score = 100
        if (/영업담당자/.test(containerText) && /@naver\.com/i.test(containerText)) score = 0
        else if (/영업담당자/.test(containerText) && /@/i.test(containerText)) score = 10
        else if (/@naver\.com/i.test(containerText)) score = 20
        else if (/@|메일|email/i.test(containerText)) score = 50
        return { element, score }
      })
      .sort((a, b) => a.score - b.score)

    const target = elements[0]?.element
    if (!(target instanceof HTMLElement)) return false
    target.click()
    return true
  }).catch(() => false)
}

async function fillVerificationCode(page: Page, code: string): Promise<void> {
  const codeInput = await firstVisible(page, [
    'input[autocomplete="one-time-code"]',
    'input[name*="auth" i]',
    'input[id*="auth" i]',
    'input[name*="cert" i]',
    'input[id*="cert" i]',
    'input[name*="code" i]',
    'input[id*="code" i]',
    'input[type="tel"]',
    'input[type="number"]',
    'input[type="text"]',
  ])
  if (!codeInput) {
    throw new MarketplaceApiError(MARKETPLACE_ID, 401, `GS SHOP 인증번호 입력칸을 찾지 못했습니다. (${await summarizePage(page)})`)
  }

  await fillInput(codeInput, code)

  const submitted = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
    const candidates = controls.filter((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      const text = element instanceof HTMLInputElement ? element.value : element.textContent || ''
      return /확인|인증|로그인|confirm|submit/i.test(text) && !/인증번호\s*받기/.test(text)
    })
    const target = candidates[0]
    if (target instanceof HTMLElement) {
      target.click()
      return true
    }
    const form = document.querySelector('form')
    if (form instanceof HTMLFormElement) {
      form.requestSubmit()
      return true
    }
    return false
  }).catch(() => false)

  if (!submitted) {
    throw new MarketplaceApiError(MARKETPLACE_ID, 401, `GS SHOP 인증 확인 버튼을 찾지 못했습니다. (${await summarizePage(page)})`)
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(1_500)
}

async function handleNaverEmailSecondFactor(page: Page, credentials: ScraperCredentials): Promise<void> {
  const method = credentials.extras?.twoFactorMethod
  const naverEmail = credentials.extras?.naverEmail
  const naverPassword = credentials.extras?.naverPassword
  if (method !== 'naver_email' || !naverEmail || !naverPassword) {
    throw new MarketplaceApiError(
      MARKETPLACE_ID,
      428,
      `GS SHOP 이메일 인증이 필요하지만 네이버 메일 인증수단이 연결되어 있지 않습니다. 마켓연동에서 GS SHOP RPA 계정에 네이버 메일 인증수단을 선택해 주세요. (${await summarizePage(page)})`,
    )
  }

  const requestedAt = new Date()
  const requested = await clickEmailVerificationButton(page)
  if (!requested) {
    throw new MarketplaceApiError(MARKETPLACE_ID, 401, `GS SHOP 이메일 인증번호 받기 버튼을 찾지 못했습니다. (${await summarizePage(page)})`)
  }

  const code = await readNaverVerificationCode({
    email: naverEmail,
    password: naverPassword,
    receivedAfter: requestedAt,
    timeoutMs: 90_000,
    fromHints: ['gsshop', 'gs', 'partners', ''],
    subjectHints: ['GS', 'GSSHOP', 'PARTNERS', '인증', 'verification'],
  })

  if (!code) {
    throw new MarketplaceApiError(MARKETPLACE_ID, 401, '네이버 메일에서 GS SHOP 인증번호를 찾지 못했습니다.')
  }

  await fillVerificationCode(page, code)
}

async function isLoggedIn(page: Page): Promise<boolean> {
  if (/\/(cmm\/login|sign-in)/i.test(page.url())) return false

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
    'input[name*="login" i]',
    'input[id*="login" i]',
    'input[name*="user" i]',
    'input[id*="user" i]',
    'input[type="email"]',
    'input[placeholder*="아이디"]',
    'input[placeholder*="ID" i]',
    'input[placeholder*="id" i]',
    'input[autocomplete="username"]',
    'input:not([type])',
    'input[type="text"]',
  ])
  const passwordInput = await firstVisible(page, [
    'input[type="password"]',
    'input[name*="pw" i]',
    'input[id*="pw" i]',
    'input[name*="pass" i]',
    'input[id*="pass" i]',
    'input[placeholder*="비밀번호"]',
    'input[placeholder*="password" i]',
    'input[autocomplete="current-password"]',
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
  await clickLoginControlRobust(page).catch(async () => {
    await passwordInput.press('Enter')
  })
  await page.waitForTimeout(1_500)

  if (!(await isLoggedIn(page)) && await isSecondFactorPage(page)) {
    await handleNaverEmailSecondFactor(page, credentials)
  }

  if (!(await isLoggedIn(page))) {
    const bodyText = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '')
    if (/2차|인증|OTP|보안|휴대폰|문자|SMS|이메일/.test(bodyText)) {
      throw new MarketplaceApiError(
        MARKETPLACE_ID,
        428,
        `GS샵 2차 인증이 필요합니다. 휴대폰 인증은 서버 RPA에서 안정적으로 자동 처리하기 어려워 API 연동을 우선 검토해야 합니다. (${await summarizePage(page)})`,
      )
    }
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
