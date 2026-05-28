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
const DOWNLOAD_READ_TIMEOUT_MS = 30_000

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
  if ((await checkbox.count().catch(() => 0)) === 0) return
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
  const clickedVisibleControl = await root.locator('body, :scope').first().evaluate((element, source) => {
    const regexp = new RegExp(source)
    const isVisibleControl = (control: HTMLElement) => {
      const style = window.getComputedStyle(control)
      const rect = control.getBoundingClientRect()
      return !control.hasAttribute('disabled')
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && rect.width > 0
        && rect.height > 0
    }
    const controls = Array.from(
      element.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn'),
    )

    const control = controls.find((candidate) => {
      if (!(candidate instanceof HTMLElement) || !isVisibleControl(candidate)) return false
      const text = `${candidate.innerText || ''} ${(candidate as HTMLInputElement).value || ''}`.trim()
      return regexp.test(text)
    })
    if (!(control instanceof HTMLElement)) return false

    control.scrollIntoView({ block: 'center', inline: 'center' })
    control.click()
    return true
  }, pattern.source).catch(() => false)
  if (clickedVisibleControl) return

  const button = root.getByRole('button', { name: pattern }).first()
  if (await button.isVisible().catch(() => false)) {
    await button.click({ force: true, timeout: 15_000 })
    return
  }
  const fallback = root.locator('button, input[type="button"], input[type="submit"], a.btn').filter({ hasText: pattern }).first()
  if (await fallback.isVisible().catch(() => false)) {
    await fallback.click({ force: true, timeout: 15_000 })
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new MarketplaceApiError('onchannel', 504, message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function clickOrderExcelDownloadButton(page: Page, root: Locator | Page): Promise<void> {
  const roleButton = root.getByRole('button', { name: /^다운로드$/ }).first()
  const clickedByRole = await roleButton.click({ force: true, timeout: 3000 }).then(() => true).catch(() => false)
  if (clickedByRole) return

  const clickedById = await page
    .locator('#btn-order-excel-down:visible, button[target="supplier"]:visible, input[target="supplier"]:visible')
    .last()
    .click({ force: true, timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (clickedById) return

  const clickedByDom = await page.evaluate(`(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const candidates = Array.prototype.slice.call(
      document.querySelectorAll('#btn-order-excel-down, button[target="supplier"], input[target="supplier"], button, input[type="button"], input[type="submit"]')
    ).filter((element) => {
      const text = element instanceof HTMLInputElement ? element.value : element.innerText || element.textContent || '';
      return /다운로드/.test(text);
    });
    const target = candidates.find(isVisible) || candidates[candidates.length - 1];
    if (!target) return false;
    target.click();
    return true;
  })()`).catch(() => false)

  if (!clickedByDom) {
    throw new MarketplaceApiError('onchannel', 500, '온채널 주문 엑셀 다운로드 버튼을 클릭하지 못했습니다.')
  }
}

async function clickOrderHistoryDownloadButton(page: Page): Promise<void> {
  const rolePatterns = [
    /주문내역\s*다운로드/,
    /주문.*다운로드/,
    /엑셀\s*다운로드/,
    /엑셀\s*파일\s*신청(?!\s*목록)/,
  ]
  for (const pattern of rolePatterns) {
    const clicked = await page
      .getByRole('button', { name: pattern })
      .last()
      .click({ force: true, timeout: 3000 })
      .then(() => true)
      .catch(() => false)
    if (clicked) return
  }

  const clickedByDom = await page.evaluate(`(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const scoreControl = (control) => {
      const text = (control instanceof HTMLInputElement ? control.value : control.innerText || control.textContent || '').replace(/\\s+/g, ' ').trim();
      const attrs = [
        control.id || '',
        control.getAttribute('name') || '',
        control.getAttribute('class') || '',
        control.getAttribute('href') || '',
        control.getAttribute('onclick') || '',
        control.getAttribute('data-target') || '',
        control.getAttribute('target') || '',
      ].join(' ');
      const source = text + ' ' + attrs;
      if (/목록|이용가이드|공지사항/.test(text)) return 0;
      if (/주문내역\\s*다운로드/.test(text)) return 100;
      if (/주문.*다운로드|다운로드.*주문/.test(text)) return 90;
      if (/엑셀\\s*다운로드|다운로드.*엑셀/.test(text)) return 80;
      if (/엑셀\\s*파일\\s*신청/.test(text) && !/목록/.test(text)) return 70;
      if (/order.*excel|excel.*order|order.*download|download.*order/i.test(source)) return 65;
      if (/excel|xlsx|download|down/i.test(source) && /order|supplier/i.test(source)) return 55;
      return 0;
    };
    const controls = Array.prototype.slice.call(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a, [role="button"]'));
    const candidates = controls
      .filter((control) => visible(control))
      .map((control) => ({ control, score: scoreControl(control) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const target = candidates[0] && candidates[0].control;
    if (!target) return false;
    target.click();
    return true;
  })()`).catch(() => false)

  if (!clickedByDom) {
    throw new MarketplaceApiError('onchannel', 500, '온채널 주문내역 다운로드 버튼을 클릭하지 못했습니다.')
  }
}

async function waitForOrderDownloadDialog(page: Page): Promise<void> {
  const opened = await page
    .waitForFunction(() => Boolean(document.querySelector('#btn-order-excel-down, button[target="supplier"]')), null, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  if (opened) return

  const buttons = await page
    .locator('button, input[type="button"], input[type="submit"], a.btn')
    .evaluateAll((elements) => elements
      .map((element) => element instanceof HTMLInputElement ? element.value : element.textContent || '')
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 30))
    .catch(() => [])

  throw new MarketplaceApiError('onchannel', 500, `온채널 주문내역 다운로드 모달이 열리지 않았습니다. buttons=${buttons.join(' | ')}`)
}

async function getOrderDownloadRoot(page: Page): Promise<Locator | Page> {
  const dialogSelector = '.modal:visible, [role="dialog"]:visible, .swal2-popup:visible'
  const dialogWithDownload = page.locator(dialogSelector).filter({
    has: page.locator('#btn-order-excel-down, button[target="supplier"], input[target="supplier"]'),
  }).last()
  if (await dialogWithDownload.isVisible().catch(() => false)) return dialogWithDownload

  const likelyDialog = page.locator(dialogSelector).filter({ hasText: /다운로드|주문내역|엑셀/ }).last()
  if (await likelyDialog.isVisible().catch(() => false)) return likelyDialog

  return page
}

async function prepareOrderDownloadForm(page: Page, since: Date, until: Date): Promise<void> {
  const sinceValue = JSON.stringify(formatDateInput(since))
  const untilValue = JSON.stringify(formatDateInput(until))
  const prepared = await page.evaluate(`(() => {
    const sinceValue = ${sinceValue};
    const untilValue = ${untilValue};
    const button = document.querySelector('#btn-order-excel-down, button[target="supplier"], input[target="supplier"]');
    const container = button && button.closest('.modal, [role="dialog"], .swal2-popup, form') || document.body;
    if (!button || !container) return { ok: false, reason: 'download-button-missing' };

    const inputs = Array.prototype.slice.call(container.querySelectorAll('input')).filter((input) => {
      const type = (input.getAttribute('type') || 'text').toLowerCase();
      return ['hidden', 'checkbox', 'radio', 'submit', 'button'].indexOf(type) === -1 && !input.disabled;
    });
    if (inputs.length < 2) return { ok: false, reason: 'date-inputs-' + inputs.length };

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    inputs[0].removeAttribute('readonly');
    inputs[1].removeAttribute('readonly');
    if (setter) {
      setter.call(inputs[0], sinceValue);
      setter.call(inputs[1], untilValue);
    } else {
      inputs[0].value = sinceValue;
      inputs[1].value = untilValue;
    }
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].dispatchEvent(new Event('change', { bubbles: true }));

    const checkboxes = Array.prototype.slice.call(container.querySelectorAll('input[type="checkbox"]'));
    const checkbox = checkboxes.find((input) => !input.disabled);
    if (checkbox && !checkbox.checked) {
      checkbox.click();
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return { ok: true, reason: '' };
  })()`).catch((error) => ({
    ok: false,
    reason: error instanceof Error ? error.message : 'prepare-failed',
  })) as { ok: boolean; reason: string }

  if (!prepared.ok) {
    throw new MarketplaceApiError('onchannel', 500, `온채널 주문내역 다운로드 조건 입력에 실패했습니다. (${prepared.reason})`)
  }
}

async function readDownloadBuffer(download: { createReadStream: () => Promise<NodeJS.ReadableStream | null> }): Promise<Buffer> {
  return withTimeout(
    (async () => {
      const stream = await download.createReadStream()
      if (!stream) throw new MarketplaceApiError('onchannel', 500, '온채널 엑셀 다운로드 스트림을 열 수 없습니다.')
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      return Buffer.concat(chunks)
    })(),
    DOWNLOAD_READ_TIMEOUT_MS,
    `온채널 엑셀 다운로드 파일 읽기가 ${DOWNLOAD_READ_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`,
  )
}

function isExcelDownloadResponse(response: { url: () => string; headers: () => Record<string, string>; status: () => number }): boolean {
  if (response.status() >= 400) return false
  const headers = response.headers()
  const contentType = headers['content-type'] ?? ''
  const disposition = headers['content-disposition'] ?? ''
  const url = response.url()
  return /attachment|filename=/i.test(disposition)
    || /spreadsheet|excel|octet-stream|ms-excel|openxmlformats/i.test(contentType)
    || (/excel|xlsx?|download|down/i.test(url) && /order|supplier|excel|down/i.test(url))
}

async function fetchOrderExcelDirect(page: Page, since: Date, until: Date): Promise<Buffer> {
  const startDate = encodeURIComponent(formatDateInput(since))
  const endDate = encodeURIComponent(formatDateInput(until))
  const downType = encodeURIComponent('배송준비중')
  const path = `/PHPExcel_1.8.0_doc/onch_admin_order/excel_onch_order.php?down_type=${downType}&start_date=${startDate}&end_date=${endDate}`
  const result = await page.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(path)}, { credentials: 'include' });
    const contentType = response.headers.get('content-type') || '';
    const disposition = response.headers.get('content-disposition') || '';
    const arrayBuffer = await response.arrayBuffer();
    const bytes = Array.from(new Uint8Array(arrayBuffer));
    let preview = '';
    try {
      preview = new TextDecoder().decode(arrayBuffer.slice(0, 300)).replace(/\\s+/g, ' ').slice(0, 200);
    } catch (error) {
      preview = '';
    }
    return { ok: response.ok, status: response.status, contentType, disposition, bytes, preview };
  })()`).catch((error) => ({
    ok: false,
    status: 0,
    contentType: '',
    disposition: '',
    bytes: [] as number[],
    preview: error instanceof Error ? error.message : 'fetch failed',
  })) as {
    ok: boolean
    status: number
    contentType: string
    disposition: string
    bytes: number[]
    preview: string
  }

  if (!result.ok) {
    throw new MarketplaceApiError(
      'onchannel',
      result.status || 500,
      `온채널 주문 엑셀 직접 다운로드 실패 (${result.status || 'no-status'} ${result.preview || result.contentType || '-'})`,
    )
  }

  const buffer = Buffer.from(result.bytes)
  if (buffer.length === 0) {
    throw new MarketplaceApiError('onchannel', 500, '온채널 주문 엑셀 직접 다운로드 파일이 비어 있습니다.')
  }

  const looksLikeExcel = buffer.subarray(0, 2).toString('utf8') === 'PK'
    || /spreadsheet|excel|octet-stream|ms-excel|openxmlformats/i.test(`${result.contentType} ${result.disposition}`)
  if (!looksLikeExcel) {
    throw new MarketplaceApiError(
      'onchannel',
      500,
      `온채널 주문 엑셀 직접 다운로드 응답이 엑셀이 아닙니다. (${result.contentType || '-'} ${result.preview || '-'})`,
    )
  }

  return buffer
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

  async getOrders(
    credentials: ScraperCredentials,
    since: Date,
    setProgress?: (message: string) => Promise<void>,
  ): Promise<NormalizedOrder[]> {
    const until = new Date()
    const workbookBuffer = await this.downloadOrdersExcel(credentials, since, until, setProgress)
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
      await clickButtonByText(uploadRoot, /저장|등록|확인|전송|완료|입력완료|송장\s*입력/)
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
    setProgress?: (message: string) => Promise<void>,
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
      await setProgress?.('온채널 주문내역 엑셀 직접 다운로드 중...')
      return await withTimeout(
        fetchOrderExcelDirect(ctx.page, since, until),
        DOWNLOAD_TIMEOUT_MS,
        `온채널 엑셀 직접 다운로드가 ${DOWNLOAD_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`,
      )
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
            marketplaceItemId: productCode || sku,
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
