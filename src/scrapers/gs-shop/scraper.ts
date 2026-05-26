import type { Frame, Locator, Page } from 'playwright'
import * as XLSX from 'xlsx'
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
const ORDER_LIST_URL = `${BASE_URL}/logistics/partner-logistics-mng?tab=1&openSet=10`
const DOWNLOAD_TIMEOUT_MS = 120_000

function readCellText(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const record = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> }
    if (record.text != null) return String(record.text).trim()
    if (record.result != null) return String(record.result).trim()
    if (Array.isArray(record.richText)) return record.richText.map((part) => String(part.text ?? '')).join('').trim()
  }
  return String(value).trim()
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, '').replace(/[()[\]{}·ㆍ:：/_-]/g, '').trim()
}

function parseNumber(value: string): number {
  const normalized = value.replace(/[^\d.-]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseKstDate(value: string): Date {
  const trimmed = value.trim()
  if (!trimmed) return new Date()
  const normalized = trimmed
    .replace(/\./g, '-')
    .replace(/\//g, '-')
    .replace(/\s+/g, ' ')
  const date = new Date(normalized.includes('T') ? normalized : `${normalized}+09:00`)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function ymdKst(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function isPartnersRootUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === BASE_URL && (url.pathname === '/' || url.pathname === '')
  } catch {
    return false
  }
}

async function gotoGs(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await pageText(page, 1_000)
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

function hasOrderListContent(text: string): boolean {
  return /조회\s*조건|조회\s*결과|주문번호|주문아이템번호|출하지시일|수취인명|고객명|미처리\s*\(/.test(text)
}

function isGsOrderListUrl(url: string): boolean {
  try {
    return new URL(url).pathname === '/logistics/partner-logistics-mng'
  } catch {
    return false
  }
}

async function isGsOrderListPage(page: Page): Promise<boolean> {
  if (!isGsOrderListUrl(page.url())) return false
  const title = await page.title().catch(() => '')
  const text = await pageText(page, 1_500)
  return /협력사\s*배송\s*관리|주문번호|주문아이템번호|조회\s*결과|미처리\s*\(/.test(`${title} ${text}`)
}

async function waitForGsOrderListPage(page: Page, timeoutMs = 45_000): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await isGsOrderListPage(page)) return true
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined)
    await page.waitForTimeout(1_000)
  }
  return false
}

async function waitForOrderListContent(page: Page, timeoutMs = 45_000): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const text = await pageText(page, 2_000)
    if (hasOrderListContent(text)) return true
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined)
    await page.waitForTimeout(1_000)
  }
  return false
}

async function pageText(page: Page, timeoutMs = 3_000): Promise<string> {
  const frameTexts = await Promise.all(
    page.frames().map((frame) => frame.locator('body').innerText({ timeout: timeoutMs }).catch(() => '')),
  )
  return frameTexts.join(' ')
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

async function clickByText(page: Page, pattern: RegExp, timeout = 10_000): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    for (const frame of page.frames()) {
      const roleButton = frame.getByRole('button', { name: pattern }).first()
      if (await roleButton.isVisible().catch(() => false)) {
        await roleButton.click({ timeout: 3_000 }).catch(async () => {
          await roleButton.click({ force: true, timeout: 3_000 })
        })
        return true
      }

      const roleLink = frame.getByRole('link', { name: pattern }).first()
      if (await roleLink.isVisible().catch(() => false)) {
        await roleLink.click({ timeout: 3_000 }).catch(async () => {
          await roleLink.click({ force: true, timeout: 3_000 })
        })
        return true
      }

      const fallback = frame.locator('button, input[type="button"], input[type="submit"], a, [role="button"], li, span, div')
        .filter({ hasText: pattern })
        .first()
      if (await fallback.isVisible().catch(() => false)) {
        await fallback.click({ timeout: 3_000 }).catch(async () => {
          await fallback.click({ force: true, timeout: 3_000 })
        })
        return true
      }
    }
    await page.waitForTimeout(500)
  }
  return false
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
  const bodyText = await pageText(page)
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

async function clickNaverEmailVerificationButton(page: Page): Promise<boolean> {
  const clickedByFixedOrder = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return false
        const text = element instanceof HTMLInputElement
          ? element.value || element.getAttribute('aria-label') || ''
          : element.textContent || element.getAttribute('aria-label') || ''
        return text.replace(/\s+/g, ' ').trim().length > 0
      })

    const target = controls[3]
    if (!(target instanceof HTMLElement)) return false
    target.click()
    return true
  }).catch(() => false)

  if (clickedByFixedOrder) return true

  const clickedByCoordinate = await page.evaluate(() => {
    const textOf = (element: Element): string => {
      if (element instanceof HTMLInputElement) return element.value || element.getAttribute('aria-label') || ''
      return element.textContent || element.getAttribute('aria-label') || ''
    }

    const textElements = Array.from(document.querySelectorAll('body *'))
      .filter((element) => /@naver\.com/i.test((element.textContent || '').replace(/\s+/g, ' ')))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))

    const emailRect = textElements[0]?.rect
    if (!emailRect) return false

    const emailCenterY = emailRect.top + emailRect.height / 2
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'))
      .map((element) => ({ element, rect: element.getBoundingClientRect(), text: textOf(element).replace(/\s+/g, ' ').trim() }))
      .filter(({ rect, text }) => rect.width > 0 && rect.height > 0 && (/인증번호/.test(text) || /verification/i.test(text)))
      .map(({ element, rect }) => ({
        element,
        score: Math.abs((rect.top + rect.height / 2) - emailCenterY) + (rect.left > emailRect.left ? 0 : 500),
      }))
      .sort((a, b) => a.score - b.score)

    const target = buttons[0]?.element
    if (!(target instanceof HTMLElement)) return false
    target.click()
    return true
  }).catch(() => false)

  if (clickedByCoordinate) return true
  return clickEmailVerificationButton(page)
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
  const requested = await clickNaverEmailVerificationButton(page)
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

async function isLoggedIn(page: Page, options?: { acceptAuthenticatedShell?: boolean }): Promise<boolean> {
  if (/\/(cmm\/login|sign-in)/i.test(page.url())) return false

  const logout = page.getByText(/로그아웃|Logout/i).first()
  if (await logout.isVisible().catch(() => false)) return true

  const bodyText = await pageText(page)
  if (/(테이포프주식회사|협력사\s*관리|주문\s*\/\s*배송|상품\s*관리|정산\s*관리|고객\s*문의\s*관리)/.test(bodyText) && !/아이디|비밀번호/.test(bodyText)) {
    return true
  }

  if (options?.acceptAuthenticatedShell) {
    if (isPartnersRootUrl(page.url())) {
      const passwordInput = await page.locator('input[type="password"]').first().isVisible({ timeout: 1_000 }).catch(() => false)
      const signInText = /아이디|비밀번호|인증번호 받기/.test(bodyText)
      if (!passwordInput && !signInText) return true
    }
  }

  return false
}

async function waitForLoggedInAfterSubmit(page: Page): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15_000) {
    if (await isLoggedIn(page, { acceptAuthenticatedShell: true })) return true
    if (await isSecondFactorPage(page)) return false
    await page.waitForTimeout(500)
  }
  return isLoggedIn(page, { acceptAuthenticatedShell: true })
}

async function ensureLoggedIn(page: Page, credentials: ScraperCredentials): Promise<void> {
  if (await isLoggedIn(page)) return

  await gotoGs(page, LOGIN_URL)
  if (await isLoggedIn(page, { acceptAuthenticatedShell: true })) return

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
    if (isPartnersRootUrl(page.url())) return
    if (await isLoggedIn(page, { acceptAuthenticatedShell: true })) return
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

  if (!(await waitForLoggedInAfterSubmit(page)) && await isSecondFactorPage(page)) {
    await handleNaverEmailSecondFactor(page, credentials)
  }

  if (!(await isLoggedIn(page, { acceptAuthenticatedShell: true }))) {
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

async function navigateToOrderList(page: Page, setProgress?: (message: string) => Promise<void>): Promise<void> {
  await setProgress?.('GS샵 주문/배송 메뉴 이동 중...')

  await gotoGs(page, ORDER_LIST_URL)
  if (await waitForGsOrderListPage(page, 45_000)) return

  await gotoGs(page, ORDER_LIST_URL)
  if (await waitForGsOrderListPage(page, 20_000)) return

  const menuClicked = await clickByText(page, /주문\s*\/\s*배송|주문\s*배송|주문/i, 8_000)
  if (menuClicked) {
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
    await page.waitForTimeout(1_000)
    if (await waitForGsOrderListPage(page, 10_000)) return
  }

  const candidates = [
    /출고\s*\/\s*회수\s*리스트/i,
    /출고\s*리스트/i,
    /주문\s*\/\s*배송\s*현황/i,
    /주문\s*배송\s*현황/i,
    /주문\s*목록/i,
    /주문\s*조회/i,
    /주문\s*관리/i,
    /배송\s*관리/i,
  ]

  for (const candidate of candidates) {
    const clicked = await clickByText(page, candidate, 4_000)
    if (!clicked) continue
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
    await page.waitForTimeout(1_500)
    const text = await pageText(page, 1_500)
    if (isGsOrderListUrl(page.url()) && (hasOrderListContent(text) || await waitForGsOrderListPage(page, 15_000))) return
  }

  const currentText = await pageText(page, 1_000)
  if (isGsOrderListUrl(page.url()) && hasOrderListContent(currentText)) return

  throw new MarketplaceApiError(
    MARKETPLACE_ID,
    501,
    `GS샵 주문목록 메뉴를 찾지 못했습니다. 주문/배송 메뉴는 보이나 실제 주문목록 하위 메뉴 확인이 필요합니다. (${await summarizePage(page)})`,
  )
}

async function setSearchRangeAndSearch(page: Page, since: Date, setProgress?: (message: string) => Promise<void>): Promise<void> {
  await setProgress?.('GS샵 주문 검색 조건 설정 중...')
  const sinceText = ymdKst(since)
  const untilText = ymdKst(new Date())

  const setRangeInFrame = async (targetPage: Page | Frame) => targetPage.evaluate(({ sinceValue, untilValue }: { sinceValue: string; untilValue: string }) => {
    const visibleInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
      .filter((input) => input.getBoundingClientRect().width > 0 && input.getBoundingClientRect().height > 0 && !input.disabled)

    const dateInputs = visibleInputs.filter((input) => {
      const meta = `${input.type} ${input.name} ${input.id} ${input.placeholder} ${input.className}`.toLowerCase()
      const value = input.value || ''
      return input.type === 'date'
        || /date|dt|ymd|from|to|start|end|시작|종료|기간/.test(meta)
        || /^\d{4}[-./]\d{2}[-./]\d{2}/.test(value)
    })

    const setInput = (input: HTMLInputElement | undefined, value: string) => {
      if (!input) return
      input.removeAttribute('readonly')
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new Event('blur', { bubbles: true }))
    }

    setInput(dateInputs[0], sinceValue)
    setInput(dateInputs[1], untilValue)
  }, { sinceValue: sinceText, untilValue: untilText }).catch(() => undefined)

  await setRangeInFrame(page)
  for (const frame of page.frames()) {
    await setRangeInFrame(frame)
  }

  await clickByText(page, /조회|검색/i, 8_000).catch(() => false)
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
  await waitForOrderListContent(page, 30_000)
}

async function selectVisibleOrderRows(page: Page, setProgress?: (message: string) => Promise<void>): Promise<void> {
  await setProgress?.('GS샵 주문행 선택 중...')
  for (const frame of page.frames()) {
    const selected = await frame.evaluate(() => {
      const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        .filter((input) => {
          const rect = input.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && !input.disabled
        })

      let changed = 0
      for (const checkbox of checkboxes) {
        if (checkbox.checked) continue
        checkbox.click()
        changed += 1
      }
      return { total: checkboxes.length, changed }
    }).catch(() => ({ total: 0, changed: 0 }))

    if (selected.total > 0) {
      await page.waitForTimeout(500)
      await setProgress?.(`GS샵 주문행 ${selected.total}개 선택 확인`)
      return
    }
  }
}

async function downloadOrdersExcel(page: Page): Promise<Buffer> {
  const text = await pageText(page, 2_000)
  if (/검색된\s*자료가\s*없|검색\s*결과가\s*없|조회된\s*자료가\s*없|조회\s*결과가\s*없|주문\s*내역이\s*없|내역이\s*없|데이터가\s*없|자료가\s*없|총\s*0\s*건/.test(text)) {
    await page.waitForTimeout(0)
  }

  const dialogHandler = (dialog: { accept: () => Promise<void> }) => {
    void dialog.accept().catch(() => undefined)
  }
  page.on('dialog', dialogHandler)
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
      clickGsDownloadFlowKorean(page),
      /* page.evaluate(() => {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a, area, [role="button"]'),
        )
        const candidates = controls
          .map((control) => {
            const rect = control.getBoundingClientRect()
            const inputValue = control instanceof HTMLInputElement ? control.value : ''
            const href = control instanceof HTMLAnchorElement ? control.href : ''
            const text = `${control.innerText || ''} ${inputValue} ${control.getAttribute('alt') || ''} ${control.getAttribute('title') || ''} ${control.getAttribute('aria-label') || ''}`.replace(/\s+/g, ' ').trim()
            let score = 100
            if (/엑셀\s*다운|엑셀\s*저장|Excel\s*Download/i.test(text)) score = 0
            else if (/주문.*엑셀|엑셀.*주문|출고.*엑셀|엑셀.*출고/i.test(text)) score = 10
            else if (/엑셀|excel|xlsx?|download/i.test(`${text} ${href}`)) score = 30
            if (/상품|광고|정산|통계|양식|샘플|도움말/.test(text)) score += 80
            return { control, score, visible: rect.width > 0 && rect.height > 0, text }
          })
          .filter((candidate) => candidate.visible && candidate.score < 100)
          .sort((a, b) => a.score - b.score)

        const target = candidates[0]?.control
        if (!(target instanceof HTMLElement)) {
          throw new Error(`엑셀 다운로드 버튼을 찾지 못했습니다. candidates=${candidates.slice(0, 5).map((item) => item.text).join(' / ')}`)
        }
        target.click()
      }), */
    ])

    const stream = await download.createReadStream()
    if (!stream) throw new MarketplaceApiError(MARKETPLACE_ID, 500, 'GS샵 엑셀 다운로드 스트림을 열 수 없습니다.')
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  } catch (error) {
    throw new MarketplaceApiError(
      MARKETPLACE_ID,
      504,
      `GS샵 주문 엑셀 다운로드가 ${DOWNLOAD_TIMEOUT_MS / 1000}초 안에 시작되지 않았습니다. (${error instanceof Error ? error.message : 'download timeout'}; ${await summarizePage(page)})`,
    )
  } finally {
    page.off('dialog', dialogHandler)
  }
}

async function clickGsDownloadFlowKorean(page: Page): Promise<void> {
  const clickedToolbarDownload = await clickVisibleControl(page, ({ text }) =>
    /다운로드|download/i.test(text)
    && !/엑셀업로드|업로드|필수항목보기|양식|샘플/i.test(text),
  )
  if (!clickedToolbarDownload) {
    throw new Error('GS샵 다운로드 버튼을 찾지 못했습니다.')
  }

  const openedDialog = await waitForText(page, /다운로드\s*방식\s*선택|다운로드시\s*주소\s*표기|도로명주소|지번주소/, 10_000)
  if (!openedDialog) return

  const clickedModalDownload = await clickVisibleControl(page, ({ text }) =>
    /다운로드|download/i.test(text)
    && !/방식\s*선택|주소\s*표기|도로명주소|지번주소|입력기준/i.test(text),
  { preferBottomRight: true })

  if (!clickedModalDownload) {
    throw new Error('GS샵 다운로드 모달의 다운로드 버튼을 찾지 못했습니다.')
  }
}

async function clickGsDownloadFlow(page: Page): Promise<void> {
  const clickedToolbarDownload = await clickVisibleControl(page, ({ text }) => {
    if (!/다운로드|download/i.test(text)) return false
    if (/엑셀업로드|업로드|필수항목보기|양식|샘플/i.test(text)) return false
    return true
  })
  if (!clickedToolbarDownload) {
    throw new Error('GS샵 다운로드 버튼을 찾지 못했습니다.')
  }

  const openedDialog = await waitForText(page, /다운로드\s*방식\s*선택|다운로드시\s*주소\s*표기|도로명주소|지번주소/, 10_000)
  if (!openedDialog) return

  const clickedModalDownload = await clickVisibleControl(page, ({ text }) => {
    if (!/다운로드|download/i.test(text)) return false
    if (/방식\s*선택|주소\s*표기|도로명주소|지번주소|입력기준/.test(text)) return false
    return true
  }, { preferBottomRight: true })

  if (!clickedModalDownload) {
    throw new Error('GS샵 다운로드 모달의 다운로드 버튼을 찾지 못했습니다.')
  }
}

async function waitForText(page: Page, pattern: RegExp, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const text = await pageText(page, 1_000)
    if (pattern.test(text)) return true
    await page.waitForTimeout(300)
  }
  return false
}

async function clickVisibleControl(
  page: Page,
  predicate: (candidate: { text: string; x: number; y: number }) => boolean,
  options?: { preferBottomRight?: boolean },
): Promise<boolean> {
  for (const frame of page.frames()) {
    const candidates = await frame.evaluate(() => {
      const textOf = (element: Element): string => {
        if (element instanceof HTMLInputElement) return element.value || element.getAttribute('aria-label') || ''
        return `${(element as HTMLElement).innerText || element.textContent || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''}`
      }
      return Array.from(document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a, [role="button"]'))
        .map((control, index) => {
          const rect = control.getBoundingClientRect()
          return {
            index,
            text: textOf(control).replace(/\s+/g, ' ').trim(),
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          }
        })
        .filter((item) => item.width > 0 && item.height > 0 && item.text.length > 0)
    }).catch(() => [])

    const target = candidates
      .filter((candidate) => predicate(candidate))
      .sort((a, b) => {
        if (!options?.preferBottomRight) return a.y - b.y || a.x - b.x
        return (b.y + b.x) - (a.y + a.x)
      })[0]
    if (!target) continue

    const clicked = await frame.evaluate((index) => {
      const controls = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a, [role="button"]'))
      const targetControl = controls[index]
      if (!targetControl) return false
      targetControl.click()
      return true
    }, target.index).catch(() => false)
    if (clicked) return true
  }
  return false
}

async function confirmGsSelectedOrders(page: Page, setProgress?: (message: string) => Promise<void>): Promise<void> {
  await clickVisibleControl(page, ({ text }) => /^닫기$/.test(text), { preferBottomRight: true }).catch(() => false)
  await page.waitForTimeout(500)

  await setProgress?.('GS샵 주문확인 처리 중...')
  const dialogHandler = (dialog: { accept: () => Promise<void> }) => {
    void dialog.accept().catch(() => undefined)
  }
  page.on('dialog', dialogHandler)
  try {
    const clicked = await clickVisibleControl(page, ({ text }) => /^주문확인$/.test(text), { preferBottomRight: true })
    if (!clicked) {
      throw new MarketplaceApiError(MARKETPLACE_ID, 500, `GS샵 주문확인 버튼을 찾지 못했습니다. (${await summarizePage(page)})`)
    }

    await page.waitForTimeout(1_000)
    await clickVisibleControl(page, ({ text }) => /^확인$/.test(text), { preferBottomRight: true }).catch(() => false)
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined)
    await page.waitForTimeout(1_500)
  } finally {
    page.off('dialog', dialogHandler)
  }
}

type OrderRow = {
  values: Map<string, string>
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

function parseGsExcelRows(rows: unknown[][]): NormalizedOrder[] {
  let headerIndex = -1
  let headerMap = new Map<string, number>()

  for (let index = 0; index < Math.min(rows.length, 50); index += 1) {
    const map = new Map<string, number>()
    ;(rows[index] ?? []).forEach((value, columnIndex) => {
      const header = normalizeHeader(readCellText(value))
      if (header) map.set(header, columnIndex)
    })
    const joined = Array.from(map.keys()).join(' ')
    if (/주문번호/.test(joined) && /(주문아이템번호|수취인|상품명|출하지시|주문일자)/.test(joined)) {
      headerIndex = index
      headerMap = map
      break
    }
  }

  if (headerIndex < 0) return []

  const get = (row: unknown[], ...headers: string[]) => {
    for (const header of headers) {
      const columnIndex = headerMap.get(normalizeHeader(header))
      if (columnIndex == null) continue
      const value = readCellText(row[columnIndex])
      if (value) return value
    }
    return ''
  }

  const orders: NormalizedOrder[] = []
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const rawRow = rows[index] ?? []
    const orderNo = get(rawRow, '주문번호', '원주문번호').replace(/^_/, '')
    if (!/^\d{6,}$/.test(orderNo)) continue

    const itemNo = get(rawRow, '주문아이템번호')
    const statusText = get(rawRow, '상태', '주문확인') || '미처리'
    const orderConfirm = get(rawRow, '주문확인')
    const collectionStatus = /취소/.test(statusText)
      ? 'cancelled'
      : /확인|미처리|출고|배송|상품준비/.test(`${statusText} ${orderConfirm}`)
        ? 'ready'
        : 'new'
    const recipientName = get(rawRow, '수취인', '수취인명', '고객명')
    const dateText = [
      get(rawRow, '주문일자', '출하지시일자', '출하지시일'),
      get(rawRow, '시간'),
    ].filter(Boolean).join(' ')
    const record = Object.fromEntries(Array.from(headerMap, ([header, columnIndex]) => [header, readCellText(rawRow[columnIndex])]))
    const marketplaceItemId = itemNo && itemNo !== orderNo ? `${orderNo}-${itemNo}` : orderNo

    orders.push({
      marketplaceId: MARKETPLACE_ID,
      marketplaceOrderId: orderNo,
      marketplaceStatus: statusText,
      marketplaceCollectionStatus: collectionStatus,
      status: collectionStatus === 'ready' ? 'confirmed' : collectionStatus === 'cancelled' ? 'cancelled' : 'new',
      buyerName: get(rawRow, '주문자', '주문자명', '고객명') || recipientName || 'GS샵 고객',
      buyerPhone: get(rawRow, '주문자핸드폰', '주문자전화번호') || undefined,
      recipientName: recipientName || 'GS샵 수취인',
      recipientPhone: get(rawRow, '수취인핸드폰', '수취인전화번호') || undefined,
      shippingAddress: {
        zipCode: get(rawRow, '우편번호', '수취인우편번호'),
        address1: get(rawRow, '수취인주소', '배송주소', '주소'),
      },
      orderedAt: parseKstDate(dateText),
      totalAmount: parseNumber(get(rawRow, '고객결제액', '판매가', '협력사지급금액')),
      shippingFee: parseNumber(get(rawRow, '배송비')),
      deliveryMessage: get(rawRow, '배송메세지', '배송메시지', '고객요청사항') || null,
      rawData: { source: 'gs-shop-rpa-excel', row: record },
      items: [{
        marketplaceItemId,
        productName: get(rawRow, '상품명(송장)', '상품명송장', '상품명(인터넷)', '상품명인터넷', '상품명') || `GS샵 주문 ${orderNo}`,
        optionText: get(rawRow, '주문옵션', '옵션', '옵션명') || undefined,
        quantity: Math.max(parseNumber(get(rawRow, '수량')), 1),
        unitPrice: parseNumber(get(rawRow, '판매가', '고객결제액')),
      }],
    })
  }

  return orders
}

function parseOrdersWorkbook(buffer: Buffer): NormalizedOrder[] {
  if (buffer.length === 0) return []

  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false })
  for (const candidateSheetName of workbook.SheetNames) {
    const candidateRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[candidateSheetName], { header: 1, defval: '' })
    const parsed = parseGsExcelRows(candidateRows)
    if (parsed.length > 0) return parsed
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' })
  let headerIndex = -1
  let headerMap = new Map<string, number>()

  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const row = rows[index] ?? []
    const map = new Map<string, number>()
    row.forEach((value, columnIndex) => {
      const header = normalizeHeader(readCellText(value))
      if (header) map.set(header, columnIndex)
    })
    const joined = Array.from(map.keys()).join(' ')
    if (/(주문번호|주문ID|주문상세|주문아이템번호|원주문번호|접수번호)/.test(joined)) {
      headerIndex = index
      headerMap = map
      break
    }
  }

  if (headerIndex < 0) {
    const looseRecords = rowsToLooseOrderRecords(rows)
    const looseOrders = rowsToNormalizedOrders(looseRecords)
    if (looseOrders.length > 0) return looseOrders

    throw new MarketplaceApiError(MARKETPLACE_ID, 500, `GS샵 주문 엑셀 헤더를 찾지 못했습니다. 첫 행=${JSON.stringify(rows[0] ?? []).slice(0, 300)}`)
  }

  const orderRecords: Array<Record<string, string>> = []
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const rawRow = rows[index] ?? []
    const values: Record<string, string> = {}
    for (const [header, columnIndex] of headerMap) {
      values[header] = readCellText(rawRow[columnIndex])
    }
    if (Object.values(values).some(Boolean)) orderRecords.push(values)
  }

  const parsed = rowsToNormalizedOrders(orderRecords.map((row) => ({ ...row, source: 'gs-shop-rpa-excel' })))
  if (parsed.length > 0) return parsed

  return rowsToNormalizedOrders(rowsToLooseOrderRecords(rows))
}

function rowsToLooseOrderRecords(rows: unknown[][]): Array<Record<string, string>> {
  const records: Array<Record<string, string>> = []
  const seen = new Set<string>()

  for (const rawRow of rows) {
    const cells = rawRow.map(readCellText).filter(Boolean)
    const joined = cells.join(' ')
    const orderNo = cells.find((cell) => /^\d{9,12}$/.test(cell))
    if (!orderNo || seen.has(orderNo)) continue
    seen.add(orderNo)

    const itemIndex = cells.findIndex((cell) => cell === orderNo)
    const itemNo = itemIndex >= 0 && /^\d+$/.test(cells[itemIndex + 1] || '') ? cells[itemIndex + 1] : ''
    const dates = cells.filter((cell) => /^\d{4}-\d{2}-\d{2}$/.test(cell))
    const recipient = cells.find((cell) => /^[가-힣][*＊][가-힣]$/.test(cell)) || ''
    const status = /취소/.test(joined)
      ? '취소'
      : /미처리|확인|출고|배송준비|상품준비/.test(joined)
        ? '배송준비'
        : '신규'

    records.push({
      주문번호: orderNo,
      주문아이템번호: itemNo ? `${orderNo}-${itemNo}` : orderNo,
      수취인: recipient,
      상태: status,
      출하지시일: dates[0] || '',
      상품명: `GS샵 주문 ${orderNo}`,
      화면행: joined,
      source: 'gs-shop-rpa-excel-loose',
    })
  }

  return records
}

function workbookDiagnostics(buffer: Buffer): string {
  if (buffer.length === 0) return 'buffer=0'
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false })
    return workbook.SheetNames.map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' })
      const firstRows = rows.slice(0, 3).map((row) => row.map(readCellText).filter(Boolean).join(' | ')).join(' / ')
      return `${sheetName}:rows=${rows.length}:head=${firstRows.slice(0, 500)}`
    }).join(' ; ')
  } catch (error) {
    return `parse-error=${error instanceof Error ? error.message : String(error)} size=${buffer.length}`
  }
}

async function parseVisibleOrders(page: Page): Promise<NormalizedOrder[]> {
  for (const frame of page.frames()) {
    const rows = await frame.evaluate(() => {
      const normalize = (value: string) => value.replace(/\s+/g, '').replace(/[()[\]{}·ㆍ:：/_-]/g, '').trim()
      const text = (element: Element | null | undefined) => (element?.textContent || '').replace(/\s+/g, ' ').trim()

      for (const table of Array.from(document.querySelectorAll('table'))) {
        const tableRows = Array.from(table.querySelectorAll('tr'))
        if (tableRows.length < 2) continue

        let headerCells = Array.from(table.querySelectorAll('thead tr:last-child th, thead tr:last-child td'))
        if (headerCells.length === 0) headerCells = Array.from(tableRows[0].querySelectorAll('th,td'))
        const headers = headerCells.map((cell) => normalize(text(cell)))
        const joinedHeaders = headers.join(' ')
        if (!/주문번호/.test(joinedHeaders) || !/(수취인|고객명|주문아이템번호|출하지시일)/.test(joinedHeaders)) continue

        const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
        const dataRows = bodyRows.length > 0 ? bodyRows : tableRows.slice(1)
        return dataRows.map((row) => {
          const cells = Array.from(row.querySelectorAll('td,th')).map((cell) => text(cell))
          const values: Record<string, string> = {}
          headers.forEach((header, index) => {
            if (header) values[header] = cells[index] || ''
          })
          return values
        }).filter((row) => Object.values(row).some(Boolean))
      }

      return []
    }).catch(() => [])

    const orders = rowsToNormalizedOrders(rows)
    if (orders.length > 0) return orders

    const layoutOrders = rowsToNormalizedOrders(await frame.evaluate(() => {
      type VisibleToken = {
        text: string
        x: number
        y: number
        right: number
        bottom: number
        width: number
        height: number
      }

      const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim()
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return false
        const style = window.getComputedStyle(element)
        return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || '1') > 0
      }
      const hasVisibleTextChild = (element: Element) => Array.from(element.children).some((child) => {
        if (!isVisible(child)) return false
        const text = normalizeText(child.textContent || '')
        return text.length > 0
      })

      const tokens: VisibleToken[] = Array.from(document.querySelectorAll('body *'))
        .filter(isVisible)
        .map((element) => {
          const text = normalizeText(element.textContent || '')
          const rect = element.getBoundingClientRect()
          return { element, text, rect }
        })
        .filter(({ element, text, rect }) => {
          if (!text || text.length > 80) return false
          if (hasVisibleTextChild(element) && !/^\d{9,12}$/.test(text)) return false
          return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight + 200
        })
        .map(({ text, rect }) => ({
          text,
          x: rect.left,
          y: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        }))

      const orderNumberTokens = tokens
        .filter((token) => /^\d{9,12}$/.test(token.text))
        .filter((token, index, all) => all.findIndex((other) => other.text === token.text) === index)
        .sort((a, b) => a.y - b.y || a.x - b.x)

      const rows: Array<Record<string, string>> = []
      for (const orderToken of orderNumberTokens) {
        const centerY = orderToken.y + orderToken.height / 2
        const rowTokens = tokens
          .filter((token) => {
            const tokenCenterY = token.y + token.height / 2
            const overlaps = token.y <= orderToken.bottom + 8 && token.bottom >= orderToken.y - 8
            return overlaps || Math.abs(tokenCenterY - centerY) <= 14
          })
          .sort((a, b) => a.x - b.x || a.y - b.y)

        const seen = new Set<string>()
        const cells = rowTokens
          .map((token) => token.text)
          .filter((text) => {
            const key = text
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })

        const rowText = cells.join(' ')
        if (!rowText.includes(orderToken.text)) continue

        const dates = cells.filter((cell) => /^\d{4}-\d{2}-\d{2}$/.test(cell))
        const itemNoIndex = cells.findIndex((cell, index) => cell === orderToken.text && /^\d+$/.test(cells[index + 1] || ''))
        const itemNo = itemNoIndex >= 0 ? cells[itemNoIndex + 1] : ''
        const recipient = cells.find((cell) => /^[가-힣][*＊][가-힣]$/.test(cell)) || ''
        const isConfirmed = /\b확인\b/.test(rowText) && !/미확인/.test(rowText)
        const isCancelled = /주문취소|취소/.test(rowText)
        const isReady = isConfirmed || /미처리|출고|배송준비|상품준비/.test(rowText)

        rows.push({
          주문번호: orderToken.text,
          주문아이템번호: itemNo ? `${orderToken.text}-${itemNo}` : orderToken.text,
          수취인: recipient,
          상태: isCancelled ? '취소' : isReady ? '배송준비' : '신규',
          출하지시일: dates[0] || '',
          시간: cells.find((cell) => /^\d{1,2}$/.test(cell)) || '',
          상품명: `GS샵 주문 ${orderToken.text}`,
          화면행: rowText,
        })
      }

      return rows
    }).catch(() => []))
    if (layoutOrders.length > 0) return layoutOrders
  }

  return []
}

async function hasVisibleNonZeroResults(page: Page): Promise<boolean> {
  const text = await pageText(page, 2_000)
  const normalized = text.replace(/\s+/g, ' ')
  return /조회\s*결과\s*총\s*[1-9]\d*\s*건/.test(normalized)
    || /총주문\s*\(\s*[1-9]\d*\s*\)/.test(normalized)
    || /미처리\s*\(\s*[1-9]\d*\s*\)/.test(normalized)
}

async function hasVisibleZeroResults(page: Page): Promise<boolean> {
  const text = await pageText(page, 2_000)
  const normalized = text.replace(/\s+/g, ' ')
  return /조회\s*결과\s*총\s*0\s*건/.test(normalized)
    || /조회된\s*데이터가\s*없습니다/.test(normalized)
}

function rowsToNormalizedOrders(rows: Array<Record<string, string>>): NormalizedOrder[] {
  const normalizedRows = rows.map((row) => ({
    values: new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])),
  }))
  const orders: NormalizedOrder[] = []

  for (const row of normalizedRows) {
    const orderNo = getRowValue(row, '주문번호', '주문ID', '접수번호').replace(/^_/, '')
    if (!/^\d{6,}/.test(orderNo)) continue

    const itemNo = getRowValue(row, '주문아이템번호', '상품주문번호', '주문상세번호') || orderNo
    const recipientName = getRowValue(row, '수취인', '수취인명', '고객명')
    const status = getRowValue(row, '상태', '주문상태', '처리상태') || '미처리'
    const collectionStatus = /취소/.test(status)
      ? 'cancelled'
      : /배송준비|상품준비|출고|미처리|확인/.test(status)
        ? 'ready'
        : 'new'
    const dateText = [
      getRowValue(row, '출하지시일', '주문일', '주문일자', '접수일'),
      getRowValue(row, '시간'),
    ].filter(Boolean).join(' ')
    const productName = getRowValue(row, '상품명', '상품', '품명') || `GS샵 주문 ${orderNo}`

    orders.push({
      marketplaceId: MARKETPLACE_ID,
      marketplaceOrderId: orderNo,
      marketplaceStatus: status,
      marketplaceCollectionStatus: collectionStatus,
      status: collectionStatus === 'ready' ? 'confirmed' : collectionStatus === 'cancelled' ? 'cancelled' : 'new',
      buyerName: getRowValue(row, '주문자명', '주문자', '고객명') || recipientName || 'GS샵 고객',
      buyerPhone: getRowValue(row, '주문자전화번호', '주문자연락처') || undefined,
      recipientName: recipientName || 'GS샵 수취인',
      recipientPhone: getRowValue(row, '수취인전화번호', '수취인연락처', '휴대폰번호') || undefined,
      shippingAddress: {
        zipCode: getRowValue(row, '우편번호', '수취인우편번호'),
        address1: getRowValue(row, '주소', '배송주소', '수취인주소'),
        address2: getRowValue(row, '상세주소') || undefined,
      },
      orderedAt: parseKstDate(dateText),
      totalAmount: parseNumber(getRowValue(row, '결제금액', '주문금액', '판매금액', '상품금액')),
      shippingFee: parseNumber(getRowValue(row, '배송비', '배송료')),
      deliveryMessage: getRowValue(row, '배송메시지', '배송메세지', '배송시요청사항') || null,
      rawData: { source: 'gs-shop-rpa-visible-table', row: Object.fromEntries(row.values) },
      items: [{
        marketplaceItemId: itemNo,
        productName,
        optionText: getRowValue(row, '옵션', '옵션명', '규격') || undefined,
        quantity: Math.max(parseNumber(getRowValue(row, '수량', '주문수량', '구매수량')), 1),
        unitPrice: parseNumber(getRowValue(row, '판매가', '단가', '상품금액')),
      }],
    })
  }

  return orders
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
      if (await isLoggedIn(page, { acceptAuthenticatedShell: true })) return { ok: true }
      return { ok: false, error: 'GS샵 세션이 만료되었습니다.' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'GS샵 세션 확인 오류' }
    } finally {
      await close()
    }
  }

  async getOrders(
    credentials: ScraperCredentials,
    since: Date,
    setProgress?: (message: string) => Promise<void>,
  ): Promise<NormalizedOrder[]> {
    const { page, close } = await openContext(credentials.storageState)

    try {
      await setProgress?.('GS샵 로그인 확인 중...')
      await gotoGs(page, BASE_URL)
      await ensureLoggedIn(page, credentials)
      await navigateToOrderList(page, setProgress)
      if (!(await isGsOrderListPage(page))) {
        await navigateToOrderList(page, setProgress)
      }
      await setSearchRangeAndSearch(page, since, setProgress)
      if (!(await isGsOrderListPage(page))) {
        throw new MarketplaceApiError(
          MARKETPLACE_ID,
          500,
          `GS샵 주문배송관리 화면이 아니라 다른 화면입니다. 주문 수집을 중단합니다. (${await summarizePage(page)})`,
        )
      }
      await selectVisibleOrderRows(page, setProgress)
      const visibleOrders = await parseVisibleOrders(page)
      if (visibleOrders.length > 0) {
        await setProgress?.(`GS샵 화면 주문 ${visibleOrders.length}건 수집`)
        await confirmGsSelectedOrders(page, setProgress)
        return visibleOrders
      }
      await setProgress?.('GS샵 주문 엑셀 다운로드 중...')
      let downloadError: unknown
      try {
        const workbook = await downloadOrdersExcel(page)
        await setProgress?.(`GS샵 엑셀 다운로드 완료 (${workbook.length} bytes)`)
        await setProgress?.('GS샵 주문 엑셀 파싱 중...')
        const excelOrders = parseOrdersWorkbook(workbook)
        if (excelOrders.length > 0) {
          await confirmGsSelectedOrders(page, setProgress)
          return excelOrders
        }
        throw new MarketplaceApiError(
          MARKETPLACE_ID,
          500,
          `GS샵 엑셀을 받았지만 주문행을 찾지 못했습니다. ${workbookDiagnostics(workbook)}`,
        )
      } catch (error) {
        downloadError = error
        await setProgress?.(`GS샵 엑셀 다운로드 실패, 화면 주문 ${visibleOrders.length}건으로 수집`)
      }
      if (await hasVisibleNonZeroResults(page)) {
        throw new MarketplaceApiError(
          MARKETPLACE_ID,
          500,
          `GS샵 화면에는 주문 건수가 보이지만 RPA가 행을 읽지 못했습니다. (${await summarizePage(page)})`,
        )
      }
      if (!(await hasVisibleZeroResults(page))) {
        throw new MarketplaceApiError(
          MARKETPLACE_ID,
          500,
          `GS샵 주문 화면 확인은 됐지만 주문행/엑셀을 읽지 못했습니다. 0건으로 완료 처리하지 않습니다. (${await summarizePage(page)})`,
        )
      }
      if (downloadError instanceof Error) throw downloadError
      return visibleOrders
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
