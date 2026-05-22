import ExcelJS from 'exceljs'
import type { Download, Locator, Page } from 'playwright'
import { MarketplaceApiError } from '@/lib/marketplace/errors'
import type { InvoiceData, MarketplaceId, NormalizedClaim, NormalizedOrder } from '@/lib/marketplace/types'
import { openContext } from '../browser'
import { readNaverVerificationCode } from '../mail/naver'
import type { MarketplaceScraper, ScraperCredentials, ScraperLoginResult } from '../types'

const PARTNER_BASE_URL = 'https://orora.ohou.se'
const LOGIN_URL = `${PARTNER_BASE_URL}/signin?redirectUrl=%2F`
const ORDER_URL_CANDIDATES = [
  `${PARTNER_BASE_URL}/orders?customFilters=PAYMENT_COMPLETE&order=PAYMENT_AT_DESC`,
  `${PARTNER_BASE_URL}/orders?customFilters=READY_FOR_DELIVERY&order=PAYMENT_AT_DESC`,
  `${PARTNER_BASE_URL}/orders?order=PAYMENT_AT_DESC`,
]
const NAVIGATION_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 45_000
const OHOUSE_ACCOUNT_API_URL = 'https://api.ohou.se/orora/member/v1/accounts'
const OHOUSE_RPA_VERSION = 'ohouse-rpa/orora-v34'

function logStep(step: string): void {
  console.log(`[오늘의집-rpa] ${step}`)
}

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
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim()
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

function normalizeAccountKey(value: string | undefined): string {
  return (value || 'default').replace(/[^0-9A-Za-z가-힣_-]/g, '_')
}

function validateOhouseSecondFactor(credentials: ScraperCredentials): string | null {
  if (credentials.extras?.twoFactorMethod !== 'naver_email') {
    return '오늘의집 RPA는 네이버 메일 2차 인증 방식으로 다시 저장해야 합니다.'
  }
  if (!credentials.extras.naverEmail || !credentials.extras.naverPassword) {
    return '오늘의집 RPA 네이버 메일 주소/앱 비밀번호가 저장되어 있지 않습니다.'
  }
  return null
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  const compactText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 300)
  return `url=${page.url()} title=${title || '-'} text=${compactText || '-'}`
}

function isOhouseSignInUrl(url: string): boolean {
  return /^\/signin(?:\/|$)/.test(new URL(url).pathname)
}

async function gotoOhouse(page: Page, url = PARTNER_BASE_URL): Promise<void> {
  await page.goto(url, { waitUntil: 'commit', timeout: NAVIGATION_TIMEOUT_MS }).catch((error) => {
    throw new MarketplaceApiError(
      'ohouse',
      504,
      `오늘의집 파트너센터 이동이 ${NAVIGATION_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다. (${url}, ${error instanceof Error ? error.message : 'navigation timeout'})`,
    )
  })
  await page.waitForLoadState('domcontentloaded', { timeout: 12_000 }).catch(() => undefined)
}

async function setInputValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value, { timeout: 10_000 }).catch(async () => {
    await locator.click({ timeout: 5000 })
    await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await locator.type(value, { delay: 20 })
  })
}

async function clickByText(page: Page, pattern: RegExp): Promise<boolean> {
  const clicked = await page
    .locator('button, input[type="submit"], input[type="button"], a')
    .filter({ hasText: pattern })
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (clicked) return true

  return page
    .locator('input[type="submit"], input[type="button"]')
    .evaluateAll((elements, source) => {
      const pattern = new RegExp(source, 'i')
      const target = elements.find((element) => pattern.test((element as HTMLInputElement).value || '')) as HTMLElement | undefined
      target?.click()
      return Boolean(target)
    }, pattern.source)
    .catch(() => false)
}

async function clickOhouseLoginButton(page: Page): Promise<void> {
  const loginButton = page.locator('button[aria-label="로그인 버튼"], button[type="submit"]').filter({ hasText: /로그인/ }).first()
  const clicked = await loginButton.click({ timeout: 5000 }).then(() => true).catch(() => false)
  if (clicked) return

  await clickByText(page, /로그인/i).then(async (fallbackClicked) => {
    if (!fallbackClicked) await page.keyboard.press('Enter')
  })
}

async function readDownloadBuffer(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  if (!stream) throw new MarketplaceApiError('ohouse', 500, '오늘의집 엑셀 다운로드 스트림을 열 수 없습니다.')
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function hasOhouseSession(page: Page): Promise<boolean> {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  if (/로그아웃|주문\s*관리|상품\s*관리|배송\s*관리|정산\s*관리|매출\s*현황|판매진행|미확인주문|배송준비중|주문배송현황|검색결과\s*엑셀\s*다운로드/.test(bodyText)) {
    return true
  }
  if (/login|signin/i.test(page.url())) return false
  return false
}

async function waitForOhouseAppReady(page: Page): Promise<boolean> {
  return page
    .waitForFunction(() => {
      const text = document.body?.innerText ?? ''
      return /주문배송현황|검색결과\s*엑셀\s*다운로드|총\s*\d+\s*개의\s*주문\s*목록|개씩\s*보기|송장\s*입력/.test(text)
    }, undefined, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
}

function watchOhouseAuthFailures(page: Page): string[] {
  const failures: string[] = []
  page.on('response', (response) => {
    const status = response.status()
    if (status !== 401 && status !== 403) return
    const url = response.url()
    if (!/orora|ohou|bucketplace/i.test(url)) return
    failures.push(`${status} ${url}`)
    if (failures.length > 8) failures.shift()
  })
  return failures
}

interface OhouseLoginDiagnostics {
  secondFactor: string
  authHeaderRequests: string[]
  loginResponses: string[]
  observedAuthorization?: string
  observedAuthorizationShape?: string
  loginWait: string
}

interface OhouseSecondFactorRequest {
  destination: string
  type: string
  partnerId: string
}

function createOhouseLoginDiagnostics(): OhouseLoginDiagnostics {
  return {
    secondFactor: 'not-checked',
    authHeaderRequests: [],
    loginResponses: [],
    loginWait: 'not-started',
  }
}

function watchOhouseAuthHeaders(page: Page, diagnostics: OhouseLoginDiagnostics): void {
  page.on('request', (request) => {
    const url = request.url()
    if (!/api\.ohou\.se\/orora/i.test(url)) return
    const authorization = request.headers().authorization
    const shape = describeAuthorizationHeader(authorization)
    if (authorization) {
      diagnostics.observedAuthorizationShape = shape
      if (isJwtAuthorization(authorization)) diagnostics.observedAuthorization = authorization
    }
    diagnostics.authHeaderRequests.push(`${authorization ? `auth(${shape})` : 'no-auth'} ${url}`)
    if (diagnostics.authHeaderRequests.length > 8) diagnostics.authHeaderRequests.shift()
  })
}

function formatLoginDiagnostics(diagnostics: OhouseLoginDiagnostics): string {
  return ` secondFactor=${diagnostics.secondFactor} loginWait=${diagnostics.loginWait}${diagnostics.observedAuthorization ? ' observedAuth=jwt' : ` observedAuth=${diagnostics.observedAuthorizationShape ?? 'no'}`}${diagnostics.loginResponses.length > 0 ? ` loginResponses=${diagnostics.loginResponses.join(' | ')}` : ''}${diagnostics.authHeaderRequests.length > 0 ? ` authHeaders=${diagnostics.authHeaderRequests.join(' | ')}` : ''}`
}

function watchOhouseLoginResponses(page: Page, diagnostics: OhouseLoginDiagnostics): void {
  page.on('response', async (response) => {
    const url = response.url()
    if (!/api\.ohou\.se\/orora\/member\/v1\/auth(?:\/|$)/i.test(url)) return

    const method = response.request().method()
    const pathname = new URL(url).pathname
    let brief = ''
    try {
      const text = await response.text()
      const parsed = JSON.parse(text) as Record<string, unknown>
      const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload as Record<string, unknown> : undefined
      const safePayloadKeys = payload ? Object.keys(payload).filter((key) => !/token|password|secret/i.test(key)).join(',') : ''
      brief = JSON.stringify({
        success: parsed.success,
        errorCode: parsed.errorCode,
        message: parsed.message,
        payloadKeys: safePayloadKeys || undefined,
      })
    } catch {
      brief = ''
    }

    diagnostics.loginResponses.push(`${method} ${response.status()} ${pathname}${brief ? ` ${brief}` : ''}`)
    if (diagnostics.loginResponses.length > 8) diagnostics.loginResponses.shift()
  })
}

interface OhouseApiSessionCheck {
  ok: boolean
  status?: number
  url: string
  body?: string
  error?: string
  tokenSource?: string
  storageKeys?: string[]
}

interface OhouseAuthToken {
  value: string
  source: string
  storageKeys: string[]
}

function normalizeAuthHeader(value: string): string {
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`
}

function authTokenSegmentCount(value: string): number {
  const token = value.replace(/^Bearer\s+/i, '').trim()
  return token ? token.split('.').length : 0
}

function isJwtAuthorization(value: string): boolean {
  return authTokenSegmentCount(value) === 3
}

function describeAuthorizationHeader(value: string | undefined): string {
  if (!value) return 'none'
  const scheme = value.match(/^([A-Za-z]+)\s+/)?.[1]?.toLowerCase() ?? 'raw'
  const token = value.replace(/^([A-Za-z]+)\s+/i, '').trim()
  const lengthBucket = token.length >= 120 ? 'long' : token.length >= 40 ? 'medium' : token.length > 0 ? 'short' : 'empty'
  return `${scheme}:segments=${authTokenSegmentCount(value)}:${lengthBucket}`
}

function findJwtCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const direct = value.match(/Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i)?.[0]
  if (direct) return direct
  return value.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] ?? null
}

async function readOhouseAuthToken(page: Page): Promise<OhouseAuthToken | null> {
  return page
    .evaluate(async () => {
      const storageKeys: string[] = []
      const inspectValue = (source: string, key: string, value: unknown): { value: string; source: string; storageKeys: string[] } | null => {
        storageKeys.push(`${source}:${key}`)
        const queue: unknown[] = [value]
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index]
          if (typeof current === 'string') {
            const candidate =
              current.match(/Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i)?.[0] ??
              current.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0]
            if (candidate) return { value: candidate, source: `${source}:${key}`, storageKeys }
            try {
              queue.push(JSON.parse(current))
            } catch {
              // ignore plain strings
            }
          } else if (current && typeof current === 'object') {
            for (const [childKey, childValue] of Object.entries(current as Record<string, unknown>)) {
              if (!/token|auth|access|jwt|authorization/i.test(childKey)) continue
              queue.push(childValue)
            }
          }
        }
        return null
      }

      for (const storage of [
        { name: 'localStorage', value: window.localStorage },
        { name: 'sessionStorage', value: window.sessionStorage },
      ]) {
        for (let index = 0; index < storage.value.length; index++) {
          const key = storage.value.key(index)
          if (!key) continue
          const result = inspectValue(storage.name, key, storage.value.getItem(key))
          if (result) return result
        }
      }

      const idb = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string | null }>> }
      const databases = await idb.databases?.().catch(() => []) ?? []
      for (const database of databases) {
        if (database.name) storageKeys.push(`indexedDB:${database.name}`)
      }

      return { value: '', source: '', storageKeys }
    })
    .then((result) => {
      if (!result?.value) return result ? { value: '', source: '', storageKeys: result.storageKeys ?? [] } : null
      const candidate = findJwtCandidate(result.value)
      if (!candidate) return { value: '', source: '', storageKeys: result.storageKeys ?? [] }
      return {
        value: normalizeAuthHeader(candidate),
        source: result.source || 'unknown',
        storageKeys: result.storageKeys ?? [],
      }
    })
    .catch(() => ({ value: '', source: '', storageKeys: ['token-scan-failed'] }))
}

async function checkOhouseApiSession(page: Page, observedAuthorization?: string): Promise<OhouseApiSessionCheck> {
  const token = await readOhouseAuthToken(page)
  const authorization = token?.value || (observedAuthorization && isJwtAuthorization(observedAuthorization) ? observedAuthorization : '')
  if (authorization) {
    await page.setExtraHTTPHeaders({ Authorization: authorization }).catch(() => undefined)
  }

  return page
    .evaluate(async ({ url, authorization }) => {
      try {
        const headers: Record<string, string> = { accept: 'application/json' }
        if (authorization) headers.Authorization = authorization
        const response = await fetch(url, {
          credentials: 'include',
          headers,
        })
        const body = await response.text().catch(() => '')
        return {
          ok: response.ok,
          status: response.status,
          url: response.url,
          body: body.replace(/\s+/g, ' ').slice(0, 220),
        }
      } catch (error) {
        return {
          ok: false,
          url,
          error: error instanceof Error ? error.message : 'api session check failed',
        }
      }
    }, { url: OHOUSE_ACCOUNT_API_URL, authorization })
    .then((result) => ({
      ...result,
      tokenSource: token?.source || (observedAuthorization ? 'observed-request-header' : undefined),
      storageKeys: token?.storageKeys,
    }))
    .catch((error) => ({
      ok: false,
      url: OHOUSE_ACCOUNT_API_URL,
      error: error instanceof Error ? error.message : 'api session check failed',
      tokenSource: token?.source || (observedAuthorization ? 'observed-request-header' : undefined),
      storageKeys: token?.storageKeys,
    }))
}

function formatApiSessionCheck(check: OhouseApiSessionCheck): string {
  const token = check.tokenSource ? ` token=${check.tokenSource}` : ''
  const keys = check.storageKeys?.length ? ` storageKeys=${check.storageKeys.slice(0, 12).join('|')}` : ''
  return `apiSession=${check.status ?? '-'} ${check.url}${token}${keys}${check.body ? ` body=${check.body}` : ''}${check.error ? ` error=${check.error}` : ''}`
}

async function isSecondFactorPage(page: Page): Promise<boolean> {
  if (/\/signin\/multi-factor(?:\/|$)/.test(new URL(page.url()).pathname)) return true
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  if (/인증\s*(번호|코드)|2차\s*인증|이메일\s*인증|메일로\s*전송/.test(bodyText)) return true
  return page.locator('input[name*="otp" i], input[name*="code" i], input[name*="verification" i], input[autocomplete="one-time-code"]').first().isVisible({ timeout: 1000 }).catch(() => false)
}

async function readOhouseSecondFactorRemainingSeconds(page: Page): Promise<number | null> {
  const bodyText = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '')
  const match = bodyText.match(/인증\s*유효시간\s*(\d{1,2}):(\d{2})\s*남음/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

async function hasExpiredOhouseSecondFactorTimer(page: Page): Promise<boolean> {
  const bodyText = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '')
  return /00:00\s*남음|유효\s*시간.*만료|인증.*만료/.test(bodyText)
}

async function waitForOhouseSecondFactorFresh(page: Page, timeoutMs = 7000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!/\/signin\/multi-factor\/auth/.test(new URL(page.url()).pathname)) {
      await page.waitForTimeout(500)
      continue
    }
    const remainingSeconds = await readOhouseSecondFactorRemainingSeconds(page)
    if (remainingSeconds !== null && remainingSeconds > 20) return true
    await page.waitForTimeout(500)
  }
  return false
}

async function readOhouseSecondFactorRequest(page: Page): Promise<OhouseSecondFactorRequest | null> {
  return page
    .evaluate(() => {
      const url = new URL(window.location.href)
      const destination = url.searchParams.get('destination')
      const type = url.searchParams.get('method')
      const partnerId = url.searchParams.get('accountId')
      if (!destination || !type || !partnerId) return null
      return { destination, type, partnerId }
    })
    .catch(() => null)
}

async function requestOhouseSecondFactorEmail(page: Page): Promise<boolean> {
  return page
    .evaluate(async () => {
      const url = new URL(window.location.href)
      const destination = url.searchParams.get('destination')
      const method = url.searchParams.get('method')
      const accountId = url.searchParams.get('accountId')
      if (!destination || !method || !accountId) return false

      const response = await fetch('https://api.ohou.se/orora/member/v1/auth/mfa', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          destination,
          type: method,
          partnerId: accountId,
        }),
      })
      return response.ok
    })
    .catch(() => false)
}

async function requestOhouseSecondFactorEmailWithParams(page: Page, request: OhouseSecondFactorRequest): Promise<boolean> {
  return page
    .evaluate(async (mfaRequest) => {
      const response = await fetch('https://api.ohou.se/orora/member/v1/auth/mfa', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(mfaRequest),
      })
      return response.ok
    }, request)
    .catch(() => false)
}

async function clickOhouseText(page: Page, pattern: RegExp): Promise<boolean> {
  const textClicked = await page.getByText(pattern).first().click({ timeout: 4000 }).then(() => true).catch(() => false)
  if (textClicked) return true

  return page
    .evaluate((source) => {
      const pattern = new RegExp(source, 'i')
      const elements = Array.from(document.querySelectorAll<HTMLElement>('button, a, input, [role="button"], [onclick], div, span'))
      const target = elements.find((element) => {
        const text = element instanceof HTMLInputElement ? element.value : element.innerText || element.textContent || ''
        return pattern.test(text)
      })
      const clickable = target?.closest<HTMLElement>('button, a, input, [role="button"], [onclick]')
      if (!clickable) return false
      clickable?.click()
      return true
    }, pattern.source)
    .catch(() => false)
}

async function clickOhouseSecondFactorSubmit(page: Page): Promise<boolean> {
  const roleClicked = await page
    .getByRole('button', { name: /^인증하기$/ })
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (roleClicked) return true

  const exactClicked = await page
    .locator('button, input[type="submit"], input[type="button"], a')
    .evaluateAll((elements) => {
      const target = elements.find((element) => {
        const text = element instanceof HTMLInputElement ? element.value : element.textContent || ''
        const normalized = text.replace(/\s+/g, '')
        const ariaDisabled = element.getAttribute('aria-disabled') === 'true'
        const disabled = element instanceof HTMLButtonElement || element instanceof HTMLInputElement
          ? element.disabled
          : false
        return normalized === '인증하기' && !disabled && !ariaDisabled
      }) as HTMLElement | undefined
      target?.click()
      return Boolean(target)
    })
    .catch(() => false)
  if (exactClicked) return true

  const customClicked = await page
    .evaluate(() => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"], [onclick], div, span'))
      const target = elements.find((element) => {
        const text = element instanceof HTMLInputElement ? element.value : element.innerText || element.textContent || ''
        const normalized = text.replace(/\s+/g, '')
        if (normalized !== '인증하기') return false
        const ariaDisabled = element.getAttribute('aria-disabled') === 'true'
        const disabled = element instanceof HTMLButtonElement || element instanceof HTMLInputElement
          ? element.disabled
          : false
        return !disabled && !ariaDisabled
      })
      const clickable = target?.closest<HTMLElement>('button, a, [role="button"], [onclick]') ?? target
      if (!clickable) return false
      clickable.click()
      return true
    })
    .catch(() => false)
  if (customClicked) return true

  const formSubmitted = await page
    .evaluate(() => {
      const form = document.querySelector('form')
      if (!(form instanceof HTMLFormElement)) return false
      form.requestSubmit()
      return true
    })
    .catch(() => false)
  if (formSubmitted) return true

  const input = page
    .locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i], input[name*="verification" i], input[name*="auth" i], input[type="number"], input[type="tel"], input[type="text"]')
    .first()
  await input.press('Enter').catch(() => undefined)
  return true
}

async function fillOhouseSecondFactorCode(page: Page, code: string): Promise<string> {
  const filled = await page
    .evaluate((verificationCode) => {
      const visible = (element: HTMLElement) => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }
      const setNativeValue = (input: HTMLInputElement, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const scoreInput = (input: HTMLInputElement) => {
        const text = [
          input.name,
          input.id,
          input.autocomplete,
          input.inputMode,
          input.placeholder,
          input.getAttribute('aria-label') ?? '',
          input.getAttribute('pattern') ?? '',
          typeof input.className === 'string' ? input.className : '',
          input.closest('form, section, div')?.textContent ?? '',
        ].join(' ')
        let score = 0
        if (/one-time-code|otp|code|verification|auth|mfa/i.test(text)) score += 4
        if (/인증|번호|코드/.test(text)) score += 4
        if (input.maxLength > 0 && input.maxLength <= 6) score += 2
        if (/numeric|decimal/.test(input.inputMode)) score += 2
        if (['tel', 'number', 'password'].includes(input.type)) score += 1
        return score
      }
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
        .filter((input) => !input.disabled && !input.readOnly && !['hidden', 'button', 'submit', 'checkbox', 'radio'].includes(input.type) && visible(input))
        .map((input) => ({ input, score: scoreInput(input) }))
        .sort((a, b) => b.score - a.score)
      if (inputs.length === 1) inputs[0].score += 3

      const digitInputs = inputs
        .filter(({ input }) => input.maxLength === 1 || input.getAttribute('maxlength') === '1')
        .map(({ input }) => input)
        .slice(0, verificationCode.length)
      if (digitInputs.length >= verificationCode.length) {
        digitInputs.forEach((input, index) => setNativeValue(input, verificationCode[index] ?? ''))
        digitInputs.at(-1)?.focus()
        return `multi:${digitInputs.length}`
      }

      return ''
    }, code)
    .catch(() => '')

  if (filled) return filled

  const selectors = [
    'input[autocomplete="one-time-code"]:visible',
    'input[inputmode="numeric"]:visible',
    'input[name*="otp" i]:visible',
    'input[name*="code" i]:visible',
    'input[name*="verification" i]:visible',
    'input[name*="auth" i]:visible',
    'input[type="tel"]:visible',
    'input[type="number"]:visible',
    'input[type="password"]:visible',
    'input[type="text"]:visible',
    'input:not([type]):visible',
  ]
  for (const selector of selectors) {
    const input = page.locator(selector).first()
    if (!(await input.isVisible({ timeout: 500 }).catch(() => false))) continue
    await input.click({ timeout: 3000 })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => undefined)
    await page.keyboard.press('Backspace').catch(() => undefined)
    await input.type(code, { delay: 70 })
    await page.waitForTimeout(300)
    const typedValue = await input.inputValue({ timeout: 1000 }).catch(() => '')
    const filledDigits = await page
      .evaluate(() => {
        const visible = (element: HTMLElement) => {
          const style = window.getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        }
        return Array.from(document.querySelectorAll<HTMLInputElement>('input'))
          .filter((input) => !['hidden', 'button', 'submit', 'checkbox', 'radio'].includes(input.type) && visible(input))
          .map((input) => input.value)
          .join('')
          .replace(/\D/g, '').length
      })
      .catch(() => typedValue.replace(/\D/g, '').length)
    if (filledDigits >= code.length) {
      return `typed:${selector}:valueLength=${typedValue.length}`
    }
  }

  throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: 오늘의집 2차 인증번호 입력칸을 찾지 못했습니다. (${await summarizePage(page)})`)
}

async function readOhouseSecondFactorSubmitReason(page: Page): Promise<string | null> {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  return bodyText.match(/인증 요청이 취소되었습니다\.?|다시 인증해 주세요\.?|인증번호[^.\n]*(?:일치|확인|틀|잘못|오류|실패)[^.\n]*|유효시간[^.\n]*(?:만료|00:00)[^.\n]*|인증[^.\n]*(?:만료|실패)[^.\n]*/)?.[0] ?? null
}

async function waitForOhouseSecondFactorSubmitResult(page: Page, timeoutMs = 18_000): Promise<'passed' | 'stayed'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => undefined)
    if (!(await isSecondFactorPage(page))) return 'passed'
    if (await readOhouseSecondFactorSubmitReason(page)) return 'stayed'
    await page.waitForTimeout(600)
  }
  return (await isSecondFactorPage(page)) ? 'stayed' : 'passed'
}

async function selectOhouseSecondFactorEmailMethod(page: Page): Promise<boolean> {
  const selected = await page
    .evaluate(() => {
      const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      const emailRadio = radios.find((radio) => radio.value !== 'SMS') ?? radios[0]
      emailRadio?.click()
      return Boolean(emailRadio)
    })
    .catch(() => false)

  return selected
}

async function sendOhouseSecondFactorFromMethodPage(page: Page): Promise<boolean> {
  const mfaRequest = await readOhouseSecondFactorRequest(page)
  await selectOhouseSecondFactorEmailMethod(page)
  const clicked = await page
    .getByRole('button', { name: /^(인증하기|다음|전송|발송)$/ })
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
    || await clickByText(page, /인증하기|다음|전송|발송/i)

  if (!clicked && mfaRequest) {
    const requested = await requestOhouseSecondFactorEmailWithParams(page, mfaRequest)
    if (!requested) return false
    await gotoOhouse(page, `${PARTNER_BASE_URL}/signin/multi-factor/auth`).catch(() => undefined)
  } else if (!clicked) {
    return false
  }

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => undefined)
    if (/\/signin\/multi-factor\/auth/.test(new URL(page.url()).pathname)) {
      const remainingSeconds = await readOhouseSecondFactorRemainingSeconds(page)
      if (remainingSeconds === null || remainingSeconds > 20) return true
    }
    const bodyText = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '')
    if (/인증번호\s*6자리|메일로\s*전송|이메일.*전송|인증\s*유효시간/.test(bodyText)) return true
    await page.waitForTimeout(500)
  }

  if (mfaRequest) {
    const requested = await requestOhouseSecondFactorEmailWithParams(page, mfaRequest)
    if (requested) {
      await gotoOhouse(page, `${PARTNER_BASE_URL}/signin/multi-factor/auth`).catch(() => undefined)
      return true
    }
  }

  return false
}

async function clickOhouseSecondFactorResend(page: Page): Promise<boolean> {
  const clicked = await clickOhouseText(page, /다시\s*인증하기/i)
  if (!clicked) return false
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    if (/\/signin\/multi-factor\/method/.test(new URL(page.url()).pathname)) {
      return sendOhouseSecondFactorFromMethodPage(page)
    }
    const remainingSeconds = await readOhouseSecondFactorRemainingSeconds(page)
    if (remainingSeconds !== null && remainingSeconds > 20) return true
    await page.waitForTimeout(500)
  }

  return false
}

async function openOhouseSecondFactorMethodPage(page: Page): Promise<boolean> {
  await gotoOhouse(page, `${PARTNER_BASE_URL}/signin/multi-factor/method`).catch(() => undefined)
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  if (!/\/signin\/multi-factor\/method/.test(new URL(page.url()).pathname)) return false
  return sendOhouseSecondFactorFromMethodPage(page)
}

async function refreshOhouseSecondFactorEmail(page: Page): Promise<'clicked' | 'api' | 'method' | 'failed'> {
  const clicked = await clickOhouseSecondFactorResend(page)
  if (clicked) return 'clicked'

  const requested = await requestOhouseSecondFactorEmail(page)
  if (requested && (await waitForOhouseSecondFactorFresh(page))) return 'api'

  const methodOpened = await openOhouseSecondFactorMethodPage(page)
  if (methodOpened) return 'method'

  return 'failed'
}

async function assertOhouseSecondFactorFresh(page: Page, context: string): Promise<void> {
  const remainingSeconds = await readOhouseSecondFactorRemainingSeconds(page)
  if (remainingSeconds === null) return
  if (remainingSeconds <= 20) {
    throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: ${context}: 오늘의집 2차 인증 유효시간이 ${remainingSeconds}초라 인증번호를 입력하지 않았습니다. (${await summarizePage(page)})`)
  }
}

async function handleEmailSecondFactor(
  page: Page,
  credentials: ScraperCredentials,
): Promise<string> {
  if (!(await isSecondFactorPage(page))) return 'not-detected'

  const method = credentials.extras?.twoFactorMethod
  const naverEmail = credentials.extras?.naverEmail
  const naverPassword = credentials.extras?.naverPassword
  if (method !== 'naver_email' || !naverEmail || !naverPassword) {
    throw new MarketplaceApiError('ohouse', 401, '오늘의집 2차 인증이 필요하지만 네이버 메일 인증 정보가 저장되어 있지 않습니다.')
  }

  let codeRequestedAt = new Date()

  if (/\/signin\/multi-factor\/method/.test(new URL(page.url()).pathname)) {
    codeRequestedAt = new Date()
    const sent = await sendOhouseSecondFactorFromMethodPage(page)
    if (!sent) throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: 오늘의집 2차 인증 메일 발송 후 인증번호 입력 화면으로 이동하지 못했습니다. (${await summarizePage(page)})`)
  } else if (/\/signin\/multi-factor\/auth/.test(new URL(page.url()).pathname)) {
    codeRequestedAt = new Date()
    const refreshMethod = await refreshOhouseSecondFactorEmail(page)
    if (refreshMethod === 'failed') {
      throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: 오늘의집 2차 인증 요청 버튼을 눌렀지만 새 인증 시간이 시작되지 않았습니다.`)
    }
    await page.waitForTimeout(1000)
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const remainingSeconds = await readOhouseSecondFactorRemainingSeconds(page)
    if (remainingSeconds !== null && remainingSeconds <= 20) {
      codeRequestedAt = new Date()
      const refreshMethod = await refreshOhouseSecondFactorEmail(page)
      if (refreshMethod === 'failed') {
        throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: 오늘의집 2차 인증 재발송 후에도 유효시간이 00:00에서 갱신되지 않았습니다.`)
      }
      await page.waitForTimeout(1500)
    }

    await assertOhouseSecondFactorFresh(page, `오늘의집 2차 인증 ${attempt}차 시도`)

    const code = await readNaverVerificationCode({
      email: naverEmail,
      password: naverPassword,
      since: new Date(codeRequestedAt.getTime() - 30_000),
      receivedAfter: codeRequestedAt,
      receivedAfterSlackMs: 1000,
      timeoutMs: 45_000,
      pollIntervalMs: 3_000,
      fromHints: ['bucketplace', 'ohou', '오늘의집', ''],
      subjectHints: ['오늘의집', 'ohou', '인증'],
      onlyUnread: true,
      codeLength: 6,
      markAsRead: true,
    })
    if (!code && attempt >= 3) {
      throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: 네이버 메일에서 오늘의집 2차 인증번호를 찾지 못했습니다.`)
    } else if (!code) {
      codeRequestedAt = new Date()
      const refreshMethod = await refreshOhouseSecondFactorEmail(page)
      if (refreshMethod === 'failed') {
        throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: 네이버 메일에서 인증번호를 찾지 못했고 오늘의집 인증 재발송도 실패했습니다.`)
      }
      await page.waitForTimeout(1500)
      continue
    }

    const inputMode = await fillOhouseSecondFactorCode(page, code)
    await clickOhouseSecondFactorSubmit(page)
    const submitResult = await waitForOhouseSecondFactorSubmitResult(page)

    if (submitResult === 'passed') return attempt === 1 ? 'code-submitted' : 'code-submitted-after-resend'
    const reason = await readOhouseSecondFactorSubmitReason(page)
    if (await hasExpiredOhouseSecondFactorTimer(page)) {
      throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: 오늘의집 2차 인증번호 제출 후 만료 상태입니다. input=${inputMode}${reason ? ` reason=${reason}` : ''} (${await summarizePage(page)})`)
    }
    throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: 오늘의집 2차 인증번호 제출 후에도 인증 화면에 머물러 있습니다. input=${inputMode}${reason ? ` reason=${reason}` : ''} (${await summarizePage(page)})`)
  }

  return 'code-submitted'
}

async function waitForOhouseLoginResult(
  page: Page,
  diagnostics: OhouseLoginDiagnostics,
  options: { stopOnSecondFactor?: boolean } = {},
): Promise<void> {
  const deadline = Date.now() + 20_000
  const stopOnSecondFactor = options.stopOnSecondFactor ?? true
  diagnostics.loginWait = 'waiting'
  while (Date.now() < deadline) {
    if (diagnostics.observedAuthorization && isJwtAuthorization(diagnostics.observedAuthorization)) {
      diagnostics.loginWait = 'jwt-observed'
      return
    }
    if (stopOnSecondFactor && await isSecondFactorPage(page)) {
      diagnostics.loginWait = 'second-factor-detected'
      return
    }
    const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')
    if (/이메일.*확인|비밀번호.*확인|일치하지 않습니다|잘못.*입력|계정.*확인|판매자.*확인/.test(bodyText)) {
      diagnostics.loginWait = 'login-error-visible'
      return
    }
    if (!isOhouseSignInUrl(page.url())) {
      const token = await readOhouseAuthToken(page)
      if (token?.value && isJwtAuthorization(token.value)) {
        diagnostics.observedAuthorization = token.value
        diagnostics.observedAuthorizationShape = describeAuthorizationHeader(token.value)
        diagnostics.loginWait = 'jwt-in-storage'
        return
      }
    }
    await page.waitForTimeout(500)
  }
  diagnostics.loginWait = 'timeout'
}

async function submitLogin(page: Page, diagnostics: OhouseLoginDiagnostics): Promise<void> {
  await clickOhouseLoginButton(page)
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
  await waitForOhouseLoginResult(page, diagnostics)
}

async function performOhouseLogin(
  page: Page,
  credentials: ScraperCredentials,
  diagnostics: OhouseLoginDiagnostics,
): Promise<string | null> {
  await gotoOhouse(page, LOGIN_URL)
  if (await hasOhouseSession(page)) return null
  await openLoginForm(page)

  const idInput = page
    .locator('input#user_email, input[name="user[email]"], input[name="email"], input[name*="email" i], input[name*="login" i], input[name*="id" i], input[placeholder*="아이디"], input[placeholder*="이메일"], input[type="email"], input[type="text"]')
    .first()
  const passwordInput = page
    .locator('input#user_password, input[name="user[password]"], input[name="password"], input[name*="password" i], input[name*="pw" i], input[placeholder*="비밀번호"], input[type="password"]')
    .first()
  await setInputValue(idInput, credentials.email)
  await setInputValue(passwordInput, credentials.password)

  logStep('login: submit credentials')
  await submitLogin(page, diagnostics)
  diagnostics.secondFactor = await handleEmailSecondFactor(page, credentials)
  if (diagnostics.secondFactor.startsWith('code-submitted')) {
    await waitForOhouseLoginResult(page, diagnostics, { stopOnSecondFactor: false })
  }

  if (isOhouseSignInUrl(page.url())) {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
    const reason = bodyText.match(/로그인이 필요합니다\.?|이메일.*확인|비밀번호.*확인|일치하지 않습니다|잘못.*입력|계정.*확인|판매자.*확인|인증.*필요|인증\s*유효시간\s*00:00\s*남음|다시\s*인증하기/)?.[0]
    return `${OHOUSE_RPA_VERSION}: 오늘의집 로그인 후에도 로그인 화면에 머물러 있습니다.${reason ? ` (${reason})` : ' 오늘의집 ID/PW, 판매자 계정 권한, 2차 인증 설정을 확인해주세요.'} (${await summarizePage(page)})`
  }

  await gotoOhouse(page, PARTNER_BASE_URL).catch(() => undefined)
  await gotoOhouse(page, ORDER_URL_CANDIDATES[0]).catch(() => undefined)
  if (!(await waitForOhouseAppReady(page))) {
    return `${OHOUSE_RPA_VERSION}: 오늘의집 로그인 후 주문 앱 인증 상태를 확인하지 못했습니다. (${await summarizePage(page)})`
  }

  return null
}

async function completeOhouseAppAuth(
  page: Page,
  credentials: ScraperCredentials,
  diagnostics: OhouseLoginDiagnostics,
): Promise<OhouseApiSessionCheck> {
  let check = await checkOhouseApiSession(page, diagnostics.observedAuthorization)
  if (check.ok) return check

  const appLoginClicked = await page
    .locator('button, a')
    .filter({ hasText: /^로그인$/ })
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)

  if (appLoginClicked) {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
    await page.waitForTimeout(1500)
    diagnostics.secondFactor = await handleEmailSecondFactor(page, credentials)
    await gotoOhouse(page, ORDER_URL_CANDIDATES[0]).catch(() => undefined)
    await waitForOhouseAppReady(page).catch(() => false)
    check = await checkOhouseApiSession(page, diagnostics.observedAuthorization)
  }

  return check
}

async function openLoginForm(page: Page): Promise<void> {
  const hasEmailInput = await page
    .locator('input#user_email, input[name="user[email]"], input[name="email"], input[name*="email" i], input[name*="login" i], input[name*="id" i], input[placeholder*="아이디"], input[placeholder*="이메일"], input[type="email"], input[type="text"]')
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false)
  if (hasEmailInput) return

  await clickByText(page, /판매자\s*로그인|로그인/i).catch(() => false)
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page
    .locator('input#user_email, input[name="user[email]"], input[name="email"], input[name*="email" i], input[name*="login" i], input[name*="id" i], input[placeholder*="아이디"], input[placeholder*="이메일"], input[type="email"], input[type="text"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => undefined)
}

async function clickOhouseUnconfirmedOrdersCard(page: Page): Promise<boolean> {
  await gotoOhouse(page, PARTNER_BASE_URL)
  const clicked = await page
    .evaluate(() => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="button"], [onclick], div, span'))
      const target = elements.find((element) => {
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ')
        return /미확인\s*주문/.test(text) && /\d+\s*건/.test(text)
      })
      const clickable = target?.closest<HTMLElement>('a, button, [role="button"], [onclick]') ?? target
      if (!clickable) return false
      clickable.click()
      return true
    })
    .catch(() => false)

  if (clicked) {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined)
    await page.waitForTimeout(1200)
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
    if (/주문배송현황|검색결과\s*엑셀\s*다운로드|총\s*\d+\s*개의\s*주문\s*목록/.test(bodyText) && !/404|찾을 수 없습니다/.test(bodyText)) return true
  }

  return false
}

async function openOrdersPage(page: Page): Promise<void> {
  if (await clickOhouseUnconfirmedOrdersCard(page)) return

  await gotoOhouse(page, ORDER_URL_CANDIDATES[0]).catch(() => undefined)
  if (!isOhouseSignInUrl(page.url())) {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
    if (/주문배송현황|검색결과\s*엑셀\s*다운로드|총\s*\d+\s*개의\s*주문\s*목록/.test(bodyText) && !/404|찾을 수 없습니다/.test(bodyText)) return
  }

  throw new MarketplaceApiError('ohouse', 500, `${OHOUSE_RPA_VERSION}: 오늘의집 미확인주문 화면을 찾지 못했습니다. (${await summarizePage(page)})`)
}

async function applyOrderSearch(page: Page, since: Date, until: Date): Promise<void> {
  const sinceValue = formatDateInput(since)
  const untilValue = formatDateInput(until)
  await page.evaluate(({ sinceValue, untilValue }) => {
    const dateInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"], input[placeholder*="YYYY"], input[placeholder*="yyyy"], input[name*="start"], input[name*="from"], input[name*="end"], input[name*="to"]'))
    if (dateInputs[0]) {
      dateInputs[0].value = sinceValue
      dateInputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      dateInputs[0].dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (dateInputs[1]) {
      dateInputs[1].value = untilValue
      dateInputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      dateInputs[1].dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, { sinceValue, untilValue })
  await clickByText(page, /검색|조회|적용/i)
  await page.waitForTimeout(2500)
}

async function clickDownloadConfirmIfPresent(page: Page): Promise<string | null> {
  const dialog = page
    .locator('[role="dialog"], [aria-modal="true"], .modal, .ant-modal, .MuiDialog-root, .ReactModal__Content')
    .filter({ hasText: /다운로드|엑셀|개인정보|주문|확인/ })
    .first()
  const dialogVisible = await dialog.isVisible({ timeout: 1500 }).catch(() => false)
  if (!dialogVisible) return null

  const dialogText = await dialog.innerText({ timeout: 1500 }).catch(() => '')
  const clicked = await dialog
    .locator('button, input[type="button"], input[type="submit"], a')
    .filter({ hasText: /확인|다운로드|예|동의|계속/ })
    .first()
    .click({ timeout: 3000 })
    .then(() => true)
    .catch(() => false)

  return clicked ? dialogText.replace(/\s+/g, ' ').trim().slice(0, 160) : null
}

async function readOhouseOrderListCount(page: Page): Promise<number | null> {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  const match = bodyText.match(/총\s*([\d,]+)\s*개의\s*주문\s*목록/)
  if (!match) return null
  return Number(match[1].replaceAll(',', ''))
}

async function downloadOrdersExcel(page: Page, authFailures: string[] = []): Promise<Buffer> {
  if (isOhouseSignInUrl(page.url())) {
    throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: 오늘의집 로그인 화면이라 엑셀 다운로드를 시도할 수 없습니다. (${await summarizePage(page)})`)
  }
  const dialogPromise = page
    .waitForEvent('dialog', { timeout: 8000 })
    .then(async (dialog) => {
      const message = dialog.message()
      await dialog.accept().catch(() => undefined)
      return message
    })
    .catch(() => null)
  const downloadPromise = page
    .waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS })
    .then((download) => readDownloadBuffer(download))
  const excelResponsePromise = page
    .waitForResponse((response) => {
      const headers = response.headers()
      const contentType = headers['content-type'] ?? ''
      const disposition = headers['content-disposition'] ?? ''
      return (
        /attachment|filename/i.test(disposition) ||
        /excel|spreadsheet|officedocument|octet-stream/i.test(contentType) ||
        /\.(xlsx?|csv)(?:$|\?)/i.test(response.url())
      )
    }, { timeout: DOWNLOAD_TIMEOUT_MS })
    .then((response) => response.body())

  const clicked = await clickByText(page, /검색결과\s*엑셀\s*다운로드/i)
  if (!clicked) {
    downloadPromise.catch(() => undefined)
    excelResponsePromise.catch(() => undefined)
    throw new MarketplaceApiError('ohouse', 500, `${OHOUSE_RPA_VERSION}: 오늘의집 주문 엑셀 다운로드 버튼을 찾지 못했습니다. (${await summarizePage(page)})`)
  }

  const dialogMessage = await Promise.race([
    dialogPromise,
    page.waitForTimeout(1500).then(() => null),
  ])
  const modalMessage = await clickDownloadConfirmIfPresent(page)

  try {
    return await Promise.race([downloadPromise, excelResponsePromise])
  } catch (error) {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
    const notice = bodyText.match(/다운로드[^.\n]*|엑셀[^.\n]*|권한[^.\n]*|로그인이 필요합니다\.?|오류[^.\n]*/)?.[0]
    const authNotice = authFailures.length > 0 ? ` authFailures=${authFailures.join(' | ')}` : ''
    const confirmNotice = dialogMessage || modalMessage ? ` confirm=${dialogMessage || modalMessage}` : ''
    throw new MarketplaceApiError(
      'ohouse',
      504,
      `${OHOUSE_RPA_VERSION}: 오늘의집 엑셀 다운로드 응답을 ${DOWNLOAD_TIMEOUT_MS / 1000}초 안에 받지 못했습니다.${authNotice}${confirmNotice}${notice ? ` (${notice})` : ''} (${error instanceof Error ? error.message : 'download timeout'})`,
    )
  }
}

async function selectVisibleOhouseOrders(page: Page): Promise<number> {
  const selected = await page
    .evaluate(() => {
      const visible = (element: HTMLElement) => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }
      const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        .filter((input) => !input.disabled && visible(input))
      if (checkboxes.length === 0) return 0

      const headerCheckbox = checkboxes[0]
      if (!headerCheckbox.checked) headerCheckbox.click()
      return checkboxes.length
    })
    .catch(() => 0)
  if (selected > 0) return selected

  const checkbox = page.locator('input[type="checkbox"]').first()
  if (await checkbox.isVisible({ timeout: 1000 }).catch(() => false)) {
    await checkbox.check({ force: true, timeout: 3000 }).catch(async () => {
      await checkbox.click({ force: true, timeout: 3000 })
    })
    return 1
  }
  return 0
}

async function confirmVisibleOhouseOrders(page: Page): Promise<string> {
  const count = await readOhouseOrderListCount(page)
  if (count === 0) return 'no-orders'

  const selected = await selectVisibleOhouseOrders(page)
  if (selected === 0) {
    throw new MarketplaceApiError('ohouse', 500, `${OHOUSE_RPA_VERSION}: 오늘의집 주문 확인할 체크박스를 찾지 못했습니다. (${await summarizePage(page)})`)
  }

  const dialogPromise = page
    .waitForEvent('dialog', { timeout: 5000 })
    .then(async (dialog) => {
      const message = dialog.message()
      await dialog.accept().catch(() => undefined)
      return message
    })
    .catch(() => null)

  const clicked = await page
    .getByRole('button', { name: /^주문\s*확인$/ })
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
    || await page
      .locator('button, input[type="button"], input[type="submit"], a')
      .filter({ hasText: /^주문\s*확인$/ })
      .first()
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false)

  if (!clicked) {
    dialogPromise.catch(() => undefined)
    throw new MarketplaceApiError('ohouse', 500, `${OHOUSE_RPA_VERSION}: 오늘의집 주문 확인 버튼을 찾지 못했습니다. (${await summarizePage(page)})`)
  }

  const modalMessage = await clickDownloadConfirmIfPresent(page)
  const dialogMessage = await Promise.race([
    dialogPromise,
    page.waitForTimeout(800).then(() => null),
  ])
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)

  return `confirmed:${count ?? 'unknown'}${dialogMessage || modalMessage ? ` confirm=${dialogMessage || modalMessage}` : ''}`
}

export class OhouseScraper implements MarketplaceScraper {
  readonly marketplaceId: MarketplaceId = 'ohouse'
  readonly displayName = '오늘의집'

  async login(credentials: ScraperCredentials): Promise<ScraperLoginResult> {
    const secondFactorError = validateOhouseSecondFactor(credentials)
    if (secondFactorError) {
      return {
        success: false,
        error: `${OHOUSE_RPA_VERSION}: ${secondFactorError} 마켓연동에서 같은 계정명으로 오늘의집 RPA를 다시 저장해주세요.`,
      }
    }

    return {
      success: true,
      expiresAt: new Date(Date.now() + 1000 * 60 * 10),
    }
  }

  async testSession(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: `${OHOUSE_RPA_VERSION}: 오늘의집은 저장 세션을 쓰지 않고 수집마다 새로 로그인합니다.` }
  }

  async getOrders(
    credentials: ScraperCredentials,
    since: Date,
    setProgress?: (message: string) => Promise<void>,
  ): Promise<NormalizedOrder[]> {
    const until = new Date()
    const ctx = await openContext()
    const authFailures = watchOhouseAuthFailures(ctx.page)
    const diagnostics = createOhouseLoginDiagnostics()
    watchOhouseAuthHeaders(ctx.page, diagnostics)
    watchOhouseLoginResponses(ctx.page, diagnostics)

    try {
      await setProgress?.('오늘의집 새 브라우저 세션으로 로그인 중...')
      const error = await performOhouseLogin(ctx.page, credentials, diagnostics)
      if (error) throw new MarketplaceApiError('ohouse', 401, error)

      await setProgress?.('오늘의집 주문 관리 화면 여는 중...')
      await openOrdersPage(ctx.page)
      if (!(await waitForOhouseAppReady(ctx.page)) || isOhouseSignInUrl(ctx.page.url())) {
        throw new MarketplaceApiError('ohouse', 401, `${OHOUSE_RPA_VERSION}: 오늘의집 로그인이 유지되지 않아 주문 화면에 진입하지 못했습니다. (${await summarizePage(ctx.page)})`)
      }
      await setProgress?.('오늘의집 주문 API 인증 확인 중...')
      const apiSession = await completeOhouseAppAuth(ctx.page, credentials, diagnostics)
      if (!apiSession.ok) {
        throw new MarketplaceApiError(
          'ohouse',
          401,
          `${OHOUSE_RPA_VERSION}: 오늘의집 주문 화면은 열렸지만 내부 API 인증이 되지 않았습니다. 2차 인증/판매자 계정 선택이 완료되지 않은 상태입니다.${formatLoginDiagnostics(diagnostics)}${authFailures.length > 0 ? ` authFailures=${authFailures.join(' | ')}` : ''} ${formatApiSessionCheck(apiSession)} (${await summarizePage(ctx.page)})`,
        )
      }
      void since
      void until
      await setProgress?.('오늘의집 미확인주문 목록 확인 중...')
      if (isOhouseSignInUrl(ctx.page.url())) {
        throw new MarketplaceApiError(
          'ohouse',
          401,
          `${OHOUSE_RPA_VERSION}: 오늘의집 주문 화면이 로그인 화면으로 리다이렉트되었습니다.${authFailures.length > 0 ? ` authFailures=${authFailures.join(' | ')}` : ''} (${await summarizePage(ctx.page)})`,
        )
      }
      const orderCount = await readOhouseOrderListCount(ctx.page)
      if (orderCount === 0) {
        await setProgress?.('오늘의집 미확인주문 0건')
        return []
      }
      await setProgress?.(`오늘의집 미확인주문 ${orderCount ?? '확인된'}건 엑셀 다운로드 중...`)
      const workbook = await downloadOrdersExcel(ctx.page, authFailures)
      const orders = await this.parseOrdersExcel(workbook, credentials)
      if (orders.length > 0) {
        await setProgress?.(`오늘의집 ${orders.length}건 다운로드 완료, 주문 확인 처리 중...`)
        const confirmResult = await confirmVisibleOhouseOrders(ctx.page)
        await setProgress?.(`오늘의집 ${orders.length}건 다운로드 완료, ${confirmResult}`)
      }
      return orders
    } finally {
      await ctx.close()
    }
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
      error: '오늘의집 RPA 송장 업로드는 주문 수집 화면 확인 후 구현이 필요합니다.',
    }
  }

  private async parseOrdersExcel(buffer: Buffer, credentials: ScraperCredentials): Promise<NormalizedOrder[]> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return []

    let headerRow: ExcelJS.Row | null = null
    for (let rowNumber = 1; rowNumber <= Math.min(20, worksheet.rowCount); rowNumber++) {
      const row = worksheet.getRow(rowNumber)
      const headers: string[] = []
      row.eachCell((cell) => {
        const value = normalizeHeader(readCellText(cell.value))
        if (value) headers.push(value)
      })
      if (headers.some((header) => /주문번호|주문상세번호|주문ID|주문번호/.test(header)) && headers.some((header) => /상품명|제품명/.test(header))) {
        headerRow = row
        break
      }
    }

    if (!headerRow) {
      throw new MarketplaceApiError('ohouse', 500, '오늘의집 주문 엑셀 헤더를 찾지 못했습니다.')
    }

    const columns = new Map<string, number>()
    headerRow.eachCell((cell, colNumber) => {
      const value = normalizeHeader(readCellText(cell.value))
      if (value) columns.set(value, colNumber)
    })

    const get = (row: ExcelJS.Row, ...headers: string[]) => {
      for (const header of headers) {
        const col = columns.get(normalizeHeader(header))
        if (!col) continue
        const value = readCellText(row.getCell(col).value)
        if (value) return value
      }
      return ''
    }

    const orders: NormalizedOrder[] = []
    const accountKey = normalizeAccountKey(credentials.extras?.accountKey)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= (headerRow?.number ?? 1)) return

      const orderNo = get(row, '주문번호', '주문ID', '주문상세번호', '주문상세ID').replace(/^[_']+/, '')
      if (!orderNo) return
      const scopedOrderNo = `${accountKey}:${orderNo}`

      const quantity = Math.max(parseNumber(get(row, '수량', '구매수량', '주문수량')), 1)
      const itemTotal = parseNumber(get(row, '상품금액', '판매금액', '결제금액', '주문금액'))
      const recipientName = get(row, '수취인', '수령인', '받는분', '받는사람')
      const phone = get(row, '수취인연락처', '수령인연락처', '휴대폰', '전화번호')
      const productName = get(row, '상품명', '제품명')
      const optionText = get(row, '옵션', '옵션명', '상품옵션')
      const sku = get(row, '판매자상품코드', '상품코드', 'SKU', '옵션코드')

      orders.push({
        marketplaceId: 'ohouse',
        marketplaceOrderId: scopedOrderNo,
        marketplaceStatus: get(row, '주문상태', '상태') || '신규주문',
        status: 'new',
        buyerName: get(row, '주문자', '구매자') || recipientName,
        buyerPhone: get(row, '주문자연락처', '구매자연락처') || phone,
        recipientName,
        recipientPhone: phone,
        shippingAddress: {
          zipCode: get(row, '우편번호', '배송지우편번호'),
          address1: get(row, '주소', '배송지주소'),
          address2: get(row, '상세주소', '배송지상세주소') || undefined,
        },
        orderedAt: parseKstDate(get(row, '주문일시', '주문일', '결제일시', '결제일')),
        totalAmount: itemTotal,
        deliveryMessage: get(row, '배송메시지', '배송메세지', '요청사항') || null,
        rawData: {
          source: 'rpa-excel',
          rowNumber,
          accountKey,
          originalMarketplaceOrderId: orderNo,
        },
        items: [
          {
            marketplaceItemId: `${accountKey}:${get(row, '주문상품번호', '주문상세번호', '상품주문번호') || orderNo}`,
            productName,
            optionText: optionText || undefined,
            quantity,
            unitPrice: quantity > 0 ? itemTotal / quantity : itemTotal,
            sku: sku || undefined,
          },
        ],
      })
    })

    return orders
  }
}
