import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { Download, Page } from 'playwright'
import { MarketplaceApiError } from '@/lib/marketplace/errors'
import type {
  InvoiceData,
  MarketplaceId,
  NormalizedClaim,
  NormalizedOrder,
} from '@/lib/marketplace/types'
import { getCarrierName, mapCarrierCode } from '@/lib/shipping/carrier-codes'
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
const DOWNLOAD_TIMEOUT_MS = 45_000
const DOWNLOAD_STREAM_TIMEOUT_MS = 60_000
type DomechangoOrderSearchStatus = 'new' | 'shipping-target'
const INVOICE_UPLOAD_TMP_DIR = path.join(process.cwd(), 'tmp', 'rpa-invoices')

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
  const domSelected = await page.evaluate(`(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }

    const hasRows = () => {
      const bodyText = document.body.textContent ?? ''
      if (/총\s*[1-9]\d*\s*개/.test(bodyText)) return true
      return Array.from(document.querySelectorAll('tr, .tui-grid-row, [role="row"]')).some((row) => {
        const text = row.textContent?.replace(/\s+/g, ' ').trim() ?? ''
        return /\d{10,}|신규주문|발송대상|배송준비중|배송중|배송완료/.test(text)
      })
    }

    const markCheckbox = (checkbox) => {
      checkbox.scrollIntoView({ block: 'center', inline: 'center' })
      if (!checkbox.checked) checkbox.click()
      if (!checkbox.checked) {
        checkbox.checked = true
        checkbox.dispatchEvent(new Event('input', { bubbles: true }))
        checkbox.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return checkbox.checked
    }

    const markSelectAll = () => {
      if (!hasRows()) return false
      const candidates = Array.from(document.querySelectorAll([
        'thead input[type="checkbox"]',
        '.tui-grid-cell-header input[type="checkbox"]',
        '.tui-grid-header-area input[type="checkbox"]',
        '#order_list input[type="checkbox"]',
        'table input[type="checkbox"]',
      ].join(', '))).filter((checkbox) => !checkbox.disabled)

      for (const checkbox of candidates) {
        const row = checkbox.closest('tr, .tui-grid-row, [role="row"]')
        const text = row?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
        const key = String(checkbox.name) + ' ' + String(checkbox.id) + ' ' + String(checkbox.className)
        const looksLikeSelectAll = !row || /전체|all|check.?all|header|선택/i.test(key + ' ' + text)
        if (!looksLikeSelectAll) continue
        if (!isVisible(checkbox) && row) continue
        checkbox.click()
        checkbox.dispatchEvent(new Event('input', { bubbles: true }))
        checkbox.dispatchEvent(new Event('change', { bubbles: true }))
        const checkedRows = Array.from(document.querySelectorAll('tbody input[type="checkbox"]:checked, #order_list input[type="checkbox"]:checked'))
          .filter((item) => {
            const itemRow = item.closest('tr, .tui-grid-row, [role="row"]')
            const itemText = itemRow?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
            return /\d{10,}|신규주문|발송대상|배송준비중|배송중|배송완료/.test(itemText)
          })
        if (checkbox.checked || checkedRows.length > 0) return true
      }
      return false
    }

    if (markSelectAll()) return true

    const rows = Array.from(document.querySelectorAll('tr, .tui-grid-row, [role="row"]'))
    for (const row of rows) {
      const text = row.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const checkbox = row.querySelector('input[type="checkbox"]')
      if (!checkbox || checkbox.disabled) continue
      if (!/\d{10,}|신규주문|발송대상|배송준비중|배송중|배송완료/.test(text)) continue
      if (markCheckbox(checkbox)) return true
    }

    const tableCheckboxes = Array.from(document.querySelectorAll('tbody input[type="checkbox"], table input[type="checkbox"]'))
      .filter((checkbox) => !checkbox.disabled)
    for (const checkbox of tableCheckboxes) {
      const row = checkbox.closest('tr, .tui-grid-row, [role="row"]')
      const text = row?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const key = String(checkbox.name) + ' ' + String(checkbox.id) + ' ' + String(checkbox.className)
      if (!isVisible(checkbox) && !/\d{10,}|배송준비중|배송중|배송완료/.test(text)) continue
      if (/전체|all|header/i.test(key) && !/\d{10,}|배송준비중|배송중|배송완료/.test(text)) continue
      if (/보류주문|검색어|기간|주문상태/.test(text) && !/\d{10,}/.test(text)) continue
      if (markCheckbox(checkbox)) return true
    }

    const bodyText = document.body.textContent ?? ''
    const hasResultCount = /총\s*[1-9]\d*\s*개/.test(bodyText)
    if (hasResultCount) {
      const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
        .filter((checkbox) => !checkbox.disabled)
      const dataCheckbox = allCheckboxes.find((checkbox) => {
        const row = checkbox.closest('tr, .tui-grid-row, [role="row"]')
        const text = row?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
        return /\d{10,}|배송준비중|배송중|배송완료/.test(text)
      }) ?? tableCheckboxes.at(-1) ?? allCheckboxes.at(-1)
      if (dataCheckbox) return markCheckbox(dataCheckbox)
    }

    return false
  })()`).catch(() => false)

  if (domSelected) return true

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
    if (box && !(await checkbox.isChecked().catch(() => false))) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(300)
    }
    await checkbox.evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) return
      if (!element.checked) element.click()
      if (!element.checked) {
        element.checked = true
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }).catch(() => undefined)
    selected = await checkbox.isChecked().catch(() => false)
    if (selected) break
  }

  if (!selected) {
    selected = await page.evaluate(`(() => {
      const gridRoot = document.querySelector('#order_list') ?? document.querySelector('#goods_list') ?? document
      const checkboxes = gridRoot.querySelectorAll('input[type="checkbox"]')
      const selectableCheckboxes = []
      for (const checkbox of checkboxes) {
        if (!checkbox.disabled) selectableCheckboxes.push(checkbox)
      }

      let rowCheckbox
      for (const checkbox of selectableCheckboxes) {
        const row = checkbox.closest('tr, .tui-grid-row, [role="row"]')
        if (row && /\d{6,}|신규주문|발송대상|배송준비중|배송중|배송완료/.test(row.textContent ?? '')) {
          rowCheckbox = checkbox
          break
        }
      }
      rowCheckbox = rowCheckbox ?? selectableCheckboxes.at(-1)

      if (!rowCheckbox) return false
      if (!rowCheckbox.checked) rowCheckbox.click()
      if (!rowCheckbox.checked) {
        rowCheckbox.checked = true
        rowCheckbox.dispatchEvent(new Event('input', { bubbles: true }))
        rowCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return rowCheckbox.checked
    })()`)
  }

  return selected
}

async function summarizeOrderSearchState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const text = document.body.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    const counts = text.match(/(?:총\s*\d+\s*개|신규주문\s*\d+\s*건|발송대상\s*\d+\s*건|보류주문\s*\d+\s*건)/g) ?? []
    const rows = Array.from(document.querySelectorAll('tr, .tui-grid-row, [role="row"]'))
      .map((row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((rowText) => /\d{10,}|신규주문|발송대상|배송준비중/.test(rowText))
      .slice(0, 3)
    const checkboxCount = document.querySelectorAll('input[type="checkbox"]').length
    return `counts=${counts.join(', ') || '-'} checkboxes=${checkboxCount} rows=${rows.join(' / ') || '-'}`
  }).catch(async () => summarizePage(page))
}

async function triggerSelectedOrderExcelDownload(
  page: Page,
  setProgress?: (message: string) => Promise<void>,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
): Promise<Buffer> {
  await setProgress?.('도매창고 엑셀 다운로드 요청 중...')
  const dialogPromise = page.waitForEvent('dialog', { timeout: timeoutMs })
    .then(async (dialog) => {
      const message = dialog.message()
      await dialog.accept().catch(() => undefined)
      return { dialogMessage: message }
    })
    .catch(() => null)

  const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs })
    .then((download) => ({ download }))

  const triggered = await page.evaluate(`(() => {
      const selects = document.querySelectorAll('select')
      let select
      let option
      const visibleSelects = Array.from(selects).filter((candidate) => candidate.offsetParent !== null)
      const directSelect = document.querySelector('#act_etc')
      if (directSelect && directSelect.offsetParent !== null) {
        for (const candidateOption of directSelect.options) {
          if (/엑셀\s*다운|엑셀.*다운|다운로드/.test(candidateOption.textContent ?? '')) {
            select = directSelect
            option = candidateOption
            break
          }
        }
      }
      const isSelectedOrderSelect = (candidate) => {
        const key = String(candidate.id) + ' ' + String(candidate.name) + ' ' + String(candidate.className) + ' ' + String(candidate.selectedOptions[0]?.textContent ?? '')
        const optionText = Array.from(candidate.options).map((candidateOption) => candidateOption.textContent ?? '').join(' ')
        if (/list_size|검색어|search|sdate|edate|page/i.test(key)) return false
        if (/50개씩|주문번호|상품코드|자체상품코드/.test(optionText)) return false
        return /선택\s*주문|선택주문|엑셀\s*다운|다운로드/.test(key + ' ' + optionText)
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
      if (typeof select.onchange === 'function') select.onchange(new Event('change'))
      return true
    })()`)
  .catch((error) => {
    throw new MarketplaceApiError(
      'domechango',
      500,
      `도매창고 선택주문 엑셀 다운로드를 실행하지 못했습니다. (${error instanceof Error ? error.message : 'unknown error'})`,
    )
  })

  if (!triggered) {
    throw new MarketplaceApiError('domechango', 500, '도매창고 선택주문 엑셀 다운로드 실행 결과를 확인하지 못했습니다.')
  }

  const result = await Promise.race([
    downloadPromise,
    dialogPromise,
  ]).catch(async (error) => {
    throw new MarketplaceApiError(
      'domechango',
      504,
      `도매창고 주문 엑셀 다운로드가 ${timeoutMs / 1000}초 안에 시작되지 않았습니다. (${error instanceof Error ? error.message : 'download timeout'})`,
    )
  })

  if (!result || 'dialogMessage' in result) {
    throw new MarketplaceApiError(
      'domechango',
      400,
      `도매창고 주문 엑셀 다운로드를 시작하지 못했습니다.${result?.dialogMessage ? ` (${result.dialogMessage})` : ''}`,
    )
  }

  const { download } = result
  await setProgress?.('도매창고 엑셀 파일 수신 중...')
  return readDownloadBuffer(download)
}

async function moveSelectedNewOrdersToShippingTarget(
  page: Page,
  setProgress?: (message: string) => Promise<void>,
): Promise<boolean> {
  await setProgress?.('도매창고 신규주문 배송준비중 전환 중...')
  const dialogPromise = page.waitForEvent('dialog', { timeout: 8000 })
    .then(async (dialog) => {
      const message = dialog.message()
      await dialog.accept().catch(() => undefined)
      return message
    })
    .catch(() => null)

  const moved = await page.evaluate(`(() => {
    const selects = document.querySelectorAll('select')
    let select
    let option
    const visibleSelects = Array.from(selects).filter((candidate) => candidate.offsetParent !== null)
    const isOrderProcessSelect = (candidate) => {
      const key = String(candidate.id) + ' ' + String(candidate.name) + ' ' + String(candidate.className) + ' ' + String(candidate.selectedOptions[0]?.textContent ?? '')
      const optionText = Array.from(candidate.options).map((candidateOption) => candidateOption.textContent ?? '').join(' ')
      if (/list_size|검색어|search|sdate|edate|page/i.test(key)) return false
      if (/50개씩|주문번호|상품코드|자체상품코드/.test(optionText)) return false
      if (/엑셀\s*다운|다운로드|선택\s*주문|선택주문/.test(optionText)) return false
      return /주문\s*처리|배송\s*준비|배송준비중|발송\s*대상/.test(key + ' ' + optionText)
    }

    for (const candidate of visibleSelects.filter(isOrderProcessSelect)) {
      for (const candidateOption of candidate.options) {
        const text = candidateOption.textContent ?? ''
        if (/배송\s*준비\s*중|배송준비중/.test(text)) {
          select = candidate
          option = candidateOption
          break
        }
      }
      if (select && option) break
    }

    if (!select || !option) {
      for (const candidate of visibleSelects.filter(isOrderProcessSelect)) {
        for (const candidateOption of candidate.options) {
          const text = candidateOption.textContent ?? ''
          if (/주문\s*확인|발송\s*대상|배송\s*준비/.test(text) && !/엑셀|다운로드/.test(text)) {
            select = candidate
            option = candidateOption
            break
          }
        }
        if (select && option) break
      }
    }

    if (!select || !option) return false

    select.value = option.value
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    if (typeof select.onchange === 'function') select.onchange(new Event('change'))
    return true
  })()`).catch(() => false)

  if (!moved) return false
  await dialogPromise
  await page.waitForLoadState('domcontentloaded', { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => undefined)
  await page.waitForTimeout(2000)
  return true
}

async function applyInvoiceOrderSearch(page: Page, orderId: string): Promise<void> {
  const until = new Date()
  const since = new Date(until.getTime() - 1000 * 60 * 60 * 24 * 60)
  const payload = JSON.stringify({ since: formatDateInput(since), until: formatDateInput(until), orderId })

  await page.evaluate(`((data) => {
    const setValue = (selector, value) => {
      const input = document.querySelector(selector)
      if (!input) return
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    setValue('#sdate, input[name="sdate"]', data.since)
    setValue('#edate, input[name="edate"]', data.until)
    setValue('#list_size, select[name="list_size"]', '500')
    setValue('#page, input[name="page"]', '1')

    const searchTypeSelect = Array.from(document.querySelectorAll('select')).find((select) => {
      const key = String(select.id) + ' ' + String(select.name) + ' ' + String(select.className)
      const optionText = Array.from(select.options).map((option) => option.textContent ?? '').join(' ')
      return /검색|keyword|skey|stype|search/i.test(key) || /주문번호|상품코드|자체상품코드/.test(optionText)
    })
    if (searchTypeSelect) {
      const orderOption = Array.from(searchTypeSelect.options).find((option) => /주문\s*번호|주문번호/.test(option.textContent ?? ''))
      if (orderOption) {
        searchTypeSelect.value = orderOption.value
        searchTypeSelect.dispatchEvent(new Event('input', { bubbles: true }))
        searchTypeSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }

    const statusInputs = Array.from(document.querySelectorAll('input[name="oistep"], input[name*="status" i]'))
    const shippingStatus = statusInputs.find((input) => {
      const label = input.closest('label')?.textContent ?? document.querySelector('label[for="' + input.id + '"]')?.textContent ?? ''
      return input.value === '2' || /배송\s*준비|배송준비중|발송\s*대상/.test(label)
    })
    const allStatus = statusInputs.find((input) => input.value === '' || input.value === '0' || /all|전체/i.test(input.id + input.name))
    const targetStatus = shippingStatus ?? allStatus
    if (targetStatus) {
      targetStatus.checked = true
      targetStatus.dispatchEvent(new Event('click', { bubbles: true }))
      targetStatus.dispatchEvent(new Event('input', { bubbles: true }))
      targetStatus.dispatchEvent(new Event('change', { bubbles: true }))
    }

    const candidates = Array.from(document.querySelectorAll('textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'))
      .filter((input) => {
        const key = String(input.id) + ' ' + String(input.name) + ' ' + String(input.placeholder)
        if (/sdate|edate|date|page|list|size/.test(key)) return false
        return /keyword|search|sword|order|ord|code|goods|name|주문|검색|번호/.test(key.toLowerCase())
      })

    const input = candidates[0] ?? Array.from(document.querySelectorAll('textarea, input[type="text"]'))
      .find((item) => !/sdate|edate|date|page|list|size/i.test(String(item.id) + ' ' + String(item.name)))
    if (input) {
      input.value = data.orderId
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })(${payload})`)

  await page.locator('#btn_search, button, input[type="button"], input[type="submit"]')
    .filter({ hasText: /주문검색|검색|조회/ })
    .first()
    .click({ timeout: 10_000 })
    .catch(() => undefined)
  await page.waitForTimeout(2500)
}

async function selectOrderByText(page: Page, orderId: string): Promise<boolean> {
  const targetOrderId = JSON.stringify(orderId)
  return page.evaluate(`(() => {
    const targetOrderId = ${targetOrderId}
    const roots = [
      document.querySelector('#order_list'),
      document.querySelector('#goods_list'),
      document,
    ].filter(Boolean)

    for (const root of roots) {
      const rows = Array.from(root.querySelectorAll('tr, .tui-grid-row, [role="row"], li, div'))
      for (const row of rows) {
        const text = row.textContent ?? ''
        if (!text.includes(targetOrderId)) continue

        const checkbox = row.querySelector('input[type="checkbox"]')
          ?? row.closest('tr, .tui-grid-row, [role="row"]')?.querySelector('input[type="checkbox"]')
        if (!checkbox || checkbox.disabled) return true
        if (!checkbox.checked) checkbox.click()
        checkbox.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
    }
    return false
  })()`).catch(() => false)
}

function findHeaderColumn(worksheet: ExcelJS.Worksheet, aliases: string[]): number | null {
  const headerRow = worksheet.getRow(1)
  let found: number | null = null
  headerRow.eachCell((cell, colNumber) => {
    if (found) return
    const value = readCellText(cell.value).replace(/\s+/g, '')
    if (aliases.some((alias) => value === alias.replace(/\s+/g, ''))) found = colNumber
  })
  return found
}

function readRawInvoiceText(invoice: InvoiceData, aliases: string[]): string {
  const rawData = invoice.rawData
  if (!rawData || typeof rawData !== 'object') return ''

  const record = rawData as Record<string, unknown>
  for (const alias of aliases) {
    const value = record[alias]
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

async function buildInvoiceWorkbook(
  orderId: string,
  invoice: InvoiceData,
  templateBuffer?: Buffer,
): Promise<Buffer> {
  const carrierCode = mapCarrierCode('domechango', invoice.carrierId)
  const carrierName = getCarrierName(invoice.carrierId)
  const workbook = new ExcelJS.Workbook()

  if (!templateBuffer?.length) {
    const receiverName = readRawInvoiceText(invoice, [
      '수취인명',
      '수령인명',
      '받는분',
      '받는사람',
      'recipientName',
      'name_receiver',
      'receiverName',
    ])
    const worksheet = workbook.addWorksheet('invoice')
    worksheet.addRow(['주문번호', '택배업체코드', '송장번호', '수취인명'])
    worksheet.addRow([orderId, carrierCode, invoice.trackingNumber, receiverName])
    const raw = await workbook.xlsx.writeBuffer()
    return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
  }

  await workbook.xlsx.load(templateBuffer as unknown as ExcelJS.Buffer)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new MarketplaceApiError('domechango', 500, '도매창고 송장 업로드 엑셀 시트를 만들지 못했습니다.')

  const orderColumn = findHeaderColumn(worksheet, ['주문번호', '주문상품번호', '주문코드'])
  const trackingColumn = findHeaderColumn(worksheet, ['송장번호', '운송장번호', '택배송장번호'])
  const carrierCodeColumn = findHeaderColumn(worksheet, ['택배업체코드', '택배사코드', '배송사코드'])
  const carrierNameColumn = findHeaderColumn(worksheet, ['택배업체', '택배사', '배송사'])

  if (!trackingColumn) throw new MarketplaceApiError('domechango', 500, '도매창고 송장번호 엑셀 컬럼을 찾지 못했습니다.')

  let updated = false
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const rowOrderId = orderColumn ? readCellText(row.getCell(orderColumn).value).replace(/^_/, '') : ''
    if (rowOrderId && !rowOrderId.includes(orderId)) return
    row.getCell(trackingColumn).value = invoice.trackingNumber
    if (carrierCodeColumn) row.getCell(carrierCodeColumn).value = carrierCode
    if (carrierNameColumn) row.getCell(carrierNameColumn).value = carrierName
    updated = true
  })

  if (!updated) {
    const row = worksheet.addRow([])
    if (orderColumn) row.getCell(orderColumn).value = orderId
    row.getCell(trackingColumn).value = invoice.trackingNumber
    if (carrierCodeColumn) row.getCell(carrierCodeColumn).value = carrierCode
    if (carrierNameColumn) row.getCell(carrierNameColumn).value = carrierName
  }

  const raw = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
}

async function uploadInvoiceWorkbook(page: Page, filePath: string): Promise<void> {
  const uploadButton = page.locator('#btn_songjang_upload').first()
  if (!(await uploadButton.isVisible({ timeout: 10_000 }).catch(() => false))) {
    throw new MarketplaceApiError('domechango', 500, `도매창고 택배송장 업로드 버튼을 찾지 못했습니다. (${await summarizePage(page)})`)
  }

  await uploadButton.click({ timeout: 10_000 })

  const frameElement = page.locator('iframe#added_frame').first()
  await frameElement.waitFor({ state: 'attached', timeout: 10_000 })
  const frame = await frameElement.contentFrame()
  if (!frame) {
    throw new MarketplaceApiError('domechango', 500, '도매창고 택배송장 업로드 화면을 열지 못했습니다.')
  }

  await frame.locator('body').waitFor({ state: 'visible', timeout: 10_000 })
  const fileInput = frame.locator('#excel_file, input[type="file"]').first()
  await fileInput.waitFor({ state: 'attached', timeout: 10_000 })

  const uploadResponsePromise = page.waitForResponse(
    (res) => res.request().method() === 'POST' && /\/wms\/order\/songjang\/list(?:\?|$)/.test(res.url()),
    { timeout: 30_000 },
  ).catch(() => null)
  const uploadDialogPromise = page.waitForEvent('dialog', { timeout: 10_000 })
    .then(async (dialogEvent) => {
      const message = dialogEvent.message()
      await dialogEvent.accept().catch(() => undefined)
      return message
    })
    .catch(() => null)

  await fileInput.setInputFiles(filePath)

  const [uploadResponse, uploadDialogMessage] = await Promise.all([uploadResponsePromise, uploadDialogPromise])
  const uploadResponseText = uploadResponse ? await uploadResponse.text().catch(() => '') : ''
  const orderListTotal = frame.locator('#order_list_total').first()
  const uploadCountDeadline = Date.now() + 15_000
  let uploadedCountText = ''
  while (Date.now() < uploadCountDeadline) {
    uploadedCountText = await orderListTotal.innerText({ timeout: 1000 }).catch(() => '')
    if (Number(uploadedCountText.replace(/[^\d]/g, '')) > 0) break
    await page.waitForTimeout(500)
  }
  const uploadedCount = Number(uploadedCountText.replace(/[^\d]/g, '')) || 0
  const uploadCombined = `${uploadDialogMessage ?? ''} ${uploadResponseText} ${await frame.locator('body').innerText({ timeout: 3000 }).catch(() => '')}`
  if (!uploadResponse?.ok() && uploadedCount <= 0) {
    throw new MarketplaceApiError('domechango', 500, `도매창고 송장 엑셀 업로드에 실패했습니다. (${uploadDialogMessage ?? (uploadResponseText || '응답 없음')})`)
  }
  if (/실패|오류|error|잘못|필수|확인해주세요|선택해주세요/.test(uploadCombined) && !/완료|성공|처리되었습니다|등록되었습니다|저장되었습니다|업로드되었습니다/.test(uploadCombined)) {
    throw new MarketplaceApiError('domechango', 500, uploadDialogMessage ?? '도매창고 송장 엑셀 업로드 후 오류 메시지가 표시되었습니다.')
  }
  if (uploadedCount <= 0) {
    throw new MarketplaceApiError('domechango', 500, '도매창고 송장 엑셀 업로드 후 처리할 주문이 표시되지 않았습니다.')
  }

  const registerResponsePromise = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && /\/wms\/order\/list\/status\/4(?:\?|$)/.test(res.url()),
    { timeout: 30_000 },
  ).catch(() => null)
  const registerDialogPromise = page.waitForEvent('dialog', { timeout: 10_000 })
    .then(async (dialogEvent) => {
      const message = dialogEvent.message()
      await dialogEvent.accept().catch(() => undefined)
      return message
    })
    .catch(() => null)

  await frame.locator('#act_status').selectOption('regist', { timeout: 10_000 })

  const [registerResponse, registerDialogMessage] = await Promise.all([registerResponsePromise, registerDialogPromise])
  const registerResponseText = registerResponse ? await registerResponse.text().catch(() => '') : ''
  await page.waitForTimeout(1000)
  const registerCombined = `${registerDialogMessage ?? ''} ${registerResponseText} ${await frame.locator('body').innerText({ timeout: 3000 }).catch(() => '')}`
  if (/실패|오류|error|잘못|필수|확인해주세요|택배사를 선택|송장번호를 입력/.test(registerCombined) && !/완료|성공|처리되었습니다|등록되었습니다|저장되었습니다/.test(registerCombined)) {
    throw new MarketplaceApiError('domechango', 500, registerDialogMessage ?? '도매창고 송장등록 후 오류 메시지가 표시되었습니다.')
  }
  if (!registerResponse?.ok() && !/완료|성공|처리되었습니다|등록되었습니다|저장되었습니다/.test(registerCombined)) {
    throw new MarketplaceApiError('domechango', 500, '도매창고 송장등록 완료 여부를 확인하지 못했습니다. 실제 등록을 확인할 수 없어 실패 처리했습니다.')
  }
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
    let sessionState = credentials.storageState
    let ctx = await openContext(sessionState)
    let tmpFilePath: string | null = null

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
            `도매창고 RPA 송장전송 실패: ${label} (${error instanceof Error ? error.message : 'unknown error'})`,
          )
        }
      }

      await runStep('invoice: open wms home', () => gotoDomechango(ctx.page, WMS_BASE_URL))
      if (!(await this.isLoggedIn(ctx.page))) {
        logStep('invoice: session invalid, login')
        await ctx.close()
        const loginResult = await this.login(credentials)
        if (!loginResult.success || !loginResult.storageState) {
          return { success: false, error: loginResult.error ?? '도매창고 로그인 실패' }
        }
        sessionState = loginResult.storageState
        ctx = await openContext(sessionState)
        await runStep('invoice: reopen wms home after login', () => gotoDomechango(ctx.page, WMS_BASE_URL))
      }

      if (!(await this.isLoggedIn(ctx.page))) {
        throw new MarketplaceApiError('domechango', 401, `도매창고 WMS 세션을 확인하지 못했습니다. (${await summarizePage(ctx.page)})`)
      }

      await runStep('invoice: open order list page', () => openOrderListPage(ctx.page))
      await runStep('invoice: search order', () => applyInvoiceOrderSearch(ctx.page, orderId))
      const selected = await runStep('invoice: select order row', () => selectOrderByText(ctx.page, orderId))
      if (!selected) {
        throw new MarketplaceApiError('domechango', 404, `도매창고 주문을 찾지 못했습니다. (${orderId}, ${await summarizePage(ctx.page)})`)
      }

      const workbookBuffer = await runStep('invoice: build upload workbook', () => buildInvoiceWorkbook(orderId, invoice))
      await mkdir(INVOICE_UPLOAD_TMP_DIR, { recursive: true })
      tmpFilePath = path.join(INVOICE_UPLOAD_TMP_DIR, `domechango-invoice-${orderId}-${Date.now()}.xlsx`)
      await writeFile(tmpFilePath, workbookBuffer)

      await runStep('invoice: upload workbook', () => uploadInvoiceWorkbook(ctx.page, tmpFilePath!))
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '도매창고 송장 RPA 전송 실패',
      }
    } finally {
      if (tmpFilePath) await unlink(tmpFilePath).catch(() => undefined)
      await ctx.close()
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
        if (!hasOrder) {
          const state = await summarizeOrderSearchState(ctx.page)
          await setProgress?.(`도매창고 ${statusLabel[status]} 선택 대상 없음 (${state})`)
          continue
        }

        matchedStatus = status
        workbook = await runStep(`orders: download selected order excel (${status})`, () => triggerSelectedOrderExcelDownload(ctx.page, setProgress))
        if (status === 'new') {
          const moved = await runStep('orders: move selected new order to shipping-target', () => moveSelectedNewOrdersToShippingTarget(ctx.page, setProgress))
          if (!moved) {
            await setProgress?.('도매창고 신규주문 발송대상 전환 옵션을 찾지 못했습니다. 이미 이동됐을 수 있습니다.')
          }
        }
        break
      }

      if (!workbook || !matchedStatus) {
        const state = await summarizeOrderSearchState(ctx.page)
        if (/총\s*[1-9]\d*\s*개|신규주문\s*[1-9]\d*\s*건|발송대상\s*[1-9]\d*\s*건/.test(state)) {
          throw new MarketplaceApiError('domechango', 500, `도매창고 주문은 보이지만 선택할 주문을 잡지 못했습니다. (${state})`)
        }
        await setProgress?.(`도매창고 수집 대상 주문 0건 (${state})`)
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

    let headerRow: ExcelJS.Row | null = null
    for (let rowNumber = 1; rowNumber <= Math.min(20, worksheet.rowCount); rowNumber++) {
      const row = worksheet.getRow(rowNumber)
      const headers: string[] = []
      row.eachCell((cell) => {
        const value = normalizeHeader(readCellText(cell.value))
        if (value) headers.push(value)
      })
      if (headers.includes('주문번호') && (headers.includes('상품명') || headers.includes('수취인명'))) {
        headerRow = row
        break
      }
    }

    if (!headerRow) {
      const firstRows: string[] = []
      for (let rowNumber = 1; rowNumber <= Math.min(5, worksheet.rowCount); rowNumber++) {
        const values: string[] = []
        worksheet.getRow(rowNumber).eachCell((cell) => values.push(readCellText(cell.value)))
        if (values.length > 0) firstRows.push(values.join(' | '))
      }
      throw new MarketplaceApiError(
        'domechango',
        500,
        `도매창고 주문 엑셀 헤더를 찾지 못했습니다. (${firstRows.join(' / ') || 'empty sheet'})`,
      )
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
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= (headerRow?.number ?? 1)) return

      const orderNo = get(row, '주문번호').replace(/^[_']+/, '')
      const orderItemNo = get(row, '주문상품번호', '주문상품번호순번', '주문상세번호')
      if (!orderNo) return

      const quantity = Math.max(parseNumber(get(row, '구매수량', '구매수량개', '수량', '주문수량')), 1)
      const itemTotal = parseNumber(get(row, '상품합계', '상품금액', '상품총액', '총상품금액'))
      const totalAmount = parseNumber(get(row, '총금액', '결제금액', '주문금액', '총주문금액')) || itemTotal
      const supplyPrice = parseNumber(get(row, '공급가', '판매가', '상품가', '단가'))
      const shippingFee = parseNumber(get(row, '배송비', '택배비')) + parseNumber(get(row, '추가배송비', '도서산간배송비'))
      const recipientName = get(row, '수취인명', '받는사람', '수령인')
      const phone = get(row, '수취인전화번호', '수취인전화', '수령인전화번호', '전화번호')
      const mobile = get(row, '수취인핸드폰', '수취인휴대폰', '수령인핸드폰', '휴대폰')
      const productName = get(row, '상품명')
      const productCode = get(row, '상품코드')
      const vendorProductCode = get(row, '업체상품코드', '자체상품코드', '판매자상품코드')
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
          zipCode: get(row, '우편번호', '수취인우편번호', '배송지우편번호'),
          address1: get(row, '주소', '수취인주소', '배송지주소'),
        },
        orderedAt: parseKstDate(get(row, '주문일시', '주문일', '주문일자')),
        totalAmount: totalAmount || itemTotal,
        shippingType: get(row, '배송비구분', '배송구분') || null,
        shippingFee,
        deliveryMessage: get(row, '주문요청사항', '배송메세지', '배송메시지', '주문메모') || null,
        rawData: {
          source: 'rpa-excel',
          rowNumber,
          orderNo,
          orderItemNo,
          productCode,
          vendorProductCode,
          carrierCode: get(row, '택배업체코드', '택배사코드') || null,
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

    if (orders.length === 0 && worksheet.rowCount > headerRow.number) {
      const headers = [...columns.keys()].join(', ')
      const sampleRows: string[] = []
      for (let rowNumber = headerRow.number + 1; rowNumber <= Math.min(headerRow.number + 3, worksheet.rowCount); rowNumber++) {
        const values: string[] = []
        worksheet.getRow(rowNumber).eachCell((cell) => values.push(readCellText(cell.value)))
        if (values.length > 0) sampleRows.push(values.join(' | '))
      }
      throw new MarketplaceApiError(
        'domechango',
        500,
        `도매창고 주문 엑셀을 받았지만 주문번호를 읽지 못했습니다. headers=${headers || '-'} sample=${sampleRows.join(' / ') || '-'}`,
      )
    }

    return orders
  }

  private async isLoggedIn(page: Page): Promise<boolean> {
    return (await hasOrderList(page)) || (await hasWmsSession(page))
  }
}
