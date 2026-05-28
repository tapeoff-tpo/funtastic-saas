import type { Frame, Locator, Page } from 'playwright'
import { MarketplaceApiError } from '@/lib/marketplace/errors'
import type { InvoiceData } from '@/lib/marketplace/types'
import { getCarrierName, mapCarrierCode } from '@/lib/shipping/carrier-codes'

type UploadInvoiceFormOptions = {
  page: Page
  marketplaceId: string
  displayName: string
  orderId: string
  invoice: InvoiceData
  searchOrder?: (page: Page, orderCandidates: string[]) => Promise<void>
  afterSearch?: (page: Page) => Promise<void>
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
  return ''
}

function collectNestedTexts(value: unknown, output: Set<string>, depth = 0): void {
  if (depth > 4 || value === null || value === undefined) return
  if (typeof value === 'string' || typeof value === 'number') {
    const next = String(value).trim()
    if (next) output.add(next)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNestedTexts(item, output, depth + 1)
    return
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectNestedTexts(item, output, depth + 1)
    }
  }
}

export function buildInvoiceOrderCandidates(orderId: string, invoice: InvoiceData): string[] {
  const candidates = new Set<string>()
  const add = (value: unknown) => {
    const next = text(value)
    if (next && next.length >= 3) candidates.add(next)
  }

  add(orderId)
  add(invoice.marketplaceOrderId)
  add(invoice.orderId)
  add(invoice.orderNo)
  add(invoice.orderNumber)
  add(invoice.marketplaceItemId)
  add(invoice.orderItemNo)
  add(invoice.orderItemId)

  const rawData = invoice.rawData
  if (rawData && typeof rawData === 'object') {
    const raw = rawData as Record<string, unknown>
    for (const key of [
      'orderNo',
      'orderId',
      'orderNumber',
      'marketplaceOrderId',
      'marketplaceItemId',
      'orderItemNo',
      'orderItemId',
      'productOrderId',
      'deliveryOrderId',
      'idx',
      'seq',
    ]) {
      add(raw[key])
    }
    const identity = raw.orderIdentity
    if (identity && typeof identity === 'object') {
      const identityRecord = identity as Record<string, unknown>
      add(identityRecord.orderId)
      add(identityRecord.displayOrderId)
      collectNestedTexts(identityRecord.itemIds, candidates)
    }
  }

  return Array.from(candidates)
    .map((candidate) => candidate.replace(/^_/, '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
}

async function summarizePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => '')
  const bodyText = await page.locator('body').innerText({ timeout: 2500 }).catch(() => '')
  return `url=${page.url()} title=${title || '-'} text=${bodyText.replace(/\s+/g, ' ').trim().slice(0, 360) || '-'}`
}

async function frameContainsAny(frame: Frame, candidates: string[]): Promise<boolean> {
  return frame.evaluate((needles) => {
    const bodyText = document.body?.innerText ?? ''
    return needles.some((needle) => needle && bodyText.includes(needle))
  }, candidates).catch(() => false)
}

async function clickByText(root: Locator | Page, pattern: RegExp, timeout = 10_000): Promise<boolean> {
  const roleButton = root.getByRole('button', { name: pattern }).first()
  if (await roleButton.isVisible({ timeout: 1200 }).catch(() => false)) {
    await roleButton.click({ timeout }).catch(async () => roleButton.click({ timeout: 3000, force: true }))
    return true
  }

  const roleLink = root.getByRole('link', { name: pattern }).first()
  if (await roleLink.isVisible({ timeout: 1200 }).catch(() => false)) {
    await roleLink.click({ timeout }).catch(async () => roleLink.click({ timeout: 3000, force: true }))
    return true
  }

  return root.locator('body, :scope').first().evaluate((element, { source, flags }) => {
    const regexp = new RegExp(source, flags)
    const visible = (item: Element) => {
      const style = window.getComputedStyle(item)
      const rect = item.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const controls = Array.from(
      element.querySelectorAll('button, input[type="button"], input[type="submit"], a, area, [onclick]'),
    )
    for (const control of controls) {
      if (!(control instanceof HTMLElement) || !visible(control)) continue
      const inputValue = control instanceof HTMLInputElement ? control.value : ''
      const textContent = [
        control.innerText,
        inputValue,
        control.getAttribute('alt'),
        control.getAttribute('title'),
        control.getAttribute('aria-label'),
        control.getAttribute('onclick'),
        control.getAttribute('href'),
      ].filter(Boolean).join(' ')
      if (!regexp.test(textContent)) continue
      control.click()
      return true
    }
    return false
  }, { source: pattern.source, flags: pattern.flags }).catch(() => false)
}

async function setInputValue(input: Locator, value: string): Promise<void> {
  await input.fill(value, { timeout: 3000 }).catch(async () => {
    await input.evaluate((element, nextValue) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return
      element.removeAttribute('readonly')
      element.value = nextValue
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
  })
}

async function defaultSearchOrder(page: Page, orderCandidates: string[]): Promise<void> {
  const targetOrder = orderCandidates[0]
  if (!targetOrder) return

  const preferredSelectors = [
    'input[name*="order" i]',
    'input[id*="order" i]',
    'input[name*="ord" i]',
    'input[id*="ord" i]',
    'input[name*="search" i]',
    'input[id*="search" i]',
    'input[name*="keyword" i]',
    'input[id*="keyword" i]',
    'input[placeholder*="주문"]',
    'input[placeholder*="검색"]',
  ]

  for (const selector of preferredSelectors) {
    const input = page.locator(selector).first()
    if (await input.isVisible({ timeout: 700 }).catch(() => false)) {
      await setInputValue(input, targetOrder)
      break
    }
  }

  const filled = await page.evaluate((orderNo) => {
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])'))
      .filter((input) => !input.disabled && visible(input))
    const candidate = inputs.find((input) => {
      const context = `${input.name} ${input.id} ${input.placeholder} ${input.closest('td, th, label, div, li')?.textContent ?? ''}`
      return /주문|order|ord|검색|keyword|search/i.test(context)
    }) ?? inputs.find((input) => input.type !== 'date')
    if (!candidate) return false
    candidate.removeAttribute('readonly')
    candidate.value = orderNo
    candidate.dispatchEvent(new Event('input', { bubbles: true }))
    candidate.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, targetOrder).catch(() => false)

  if (filled) {
    await clickByText(page, /검색|조회|Search|search/i, 10_000).catch(() => false)
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
    await page.waitForTimeout(1500)
  }
}

async function clickInvoiceControlInFrame(frame: Frame, candidates: string[]): Promise<boolean> {
  return frame.evaluate((orderCandidates) => {
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const textOf = (element: Element) => {
      const inputValue = element instanceof HTMLInputElement ? element.value : ''
      return [
        element.textContent,
        inputValue,
        element.getAttribute('alt'),
        element.getAttribute('title'),
        element.getAttribute('aria-label'),
        element.getAttribute('onclick'),
        element.getAttribute('href'),
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ')
    }
    const positive = /송장|운송장|택배|배송\s*정보|배송처리|invoice|tracking|waybill|delivery/i
    const secondary = /입력|등록|수정|관리|처리|update|edit|regist/i
    const negative = /삭제|취소|반품|교환|cancel|delete|return|exchange/i
    const containers = Array.from(document.querySelectorAll<HTMLElement>('tr, li, div, section, article, form'))
      .filter((container) => visible(container) && orderCandidates.some((candidate) => (container.textContent ?? '').includes(candidate)))
      .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))

    for (const container of containers) {
      const controls = Array.from(container.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a, area, [onclick]'))
        .filter((control) => visible(control))
      const preferred = controls.find((control) => {
        const label = textOf(control)
        return positive.test(label) && !negative.test(label)
      }) ?? controls.find((control) => {
        const label = textOf(control)
        return secondary.test(label) && !negative.test(label)
      })
      if (preferred) {
        preferred.click()
        return true
      }

      const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      if (checkbox && !checkbox.disabled) {
        if (!checkbox.checked) checkbox.click()
        checkbox.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }

    const global = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a, area, [onclick]'))
      .find((control) => {
        if (!visible(control)) return false
        const label = textOf(control)
        return positive.test(label) && !negative.test(label)
      })
    if (global) {
      global.click()
      return true
    }
    return false
  }, candidates).catch(() => false)
}

async function selectCarrier(root: Locator | Page, marketplaceId: string, invoice: InvoiceData): Promise<boolean> {
  const carrierName = getCarrierName(invoice.carrierId)
  const carrierCode = mapCarrierCode(marketplaceId, invoice.carrierId)
  const possibleValues = [carrierName, carrierName.replace(/\s+/g, ''), carrierCode, invoice.carrierId]
    .filter(Boolean)

  const selects = await root.locator('select:visible').all().catch(() => [])
  for (const select of selects) {
    for (const value of possibleValues) {
      const byLabel = await select.selectOption({ label: value }, { timeout: 800 }).then(() => true).catch(() => false)
      if (byLabel) return true
      const byValue = await select.selectOption({ value }, { timeout: 800 }).then(() => true).catch(() => false)
      if (byValue) return true
    }
    const selected = await select.evaluate((element, values) => {
      if (!(element instanceof HTMLSelectElement)) return false
      const normalizedValues = values.map((value) => value.replace(/\s+/g, '').toLowerCase())
      const option = Array.from(element.options).find((item) => {
        const label = (item.textContent ?? '').replace(/\s+/g, '').toLowerCase()
        const value = item.value.replace(/\s+/g, '').toLowerCase()
        return normalizedValues.some((target) => target && (label.includes(target) || target.includes(label) || value === target))
      })
      if (!option) return false
      element.value = option.value
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, possibleValues).catch(() => false)
    if (selected) return true
  }

  return false
}

async function fillTrackingNumber(root: Locator | Page, trackingNumber: string): Promise<boolean> {
  const selectors = [
    'input[name*="invoice" i]',
    'input[id*="invoice" i]',
    'input[name*="tracking" i]',
    'input[id*="tracking" i]',
    'input[name*="songjang" i]',
    'input[id*="songjang" i]',
    'input[name*="waybill" i]',
    'input[id*="waybill" i]',
    'input[name*="delivery" i]',
    'input[id*="delivery" i]',
    'input[name*="deli" i]',
    'input[id*="deli" i]',
    'input[placeholder*="송장"]',
    'input[placeholder*="운송장"]',
    'input[placeholder*="배송"]',
  ]

  for (const selector of selectors) {
    const input = root.locator(selector).first()
    if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
      await setInputValue(input, trackingNumber)
      return true
    }
  }

  const filled = await root.locator('body, :scope').first().evaluate((element, value) => {
    const visible = (item: Element) => {
      const style = window.getComputedStyle(item)
      const rect = item.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const inputs = Array.from(element.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])'))
      .filter((input) => !input.disabled && visible(input))
    const target = inputs.find((input) => {
      const context = `${input.name} ${input.id} ${input.className} ${input.placeholder} ${input.closest('td, th, label, div, li')?.textContent ?? ''}`
      return /송장|운송장|택배|배송|invoice|tracking|waybill|deli/i.test(context)
    }) ?? inputs.find((input) => input.type !== 'date' && input.value.replace(/\D/g, '').length < 8)
    if (!target) return false
    target.removeAttribute('readonly')
    target.value = value
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, trackingNumber).catch(() => false)

  return filled
}

async function fillInvoiceForm(page: Page, marketplaceId: string, invoice: InvoiceData): Promise<void> {
  const dialog = page.locator('.modal:visible, [role="dialog"]:visible, .layer:visible, .popup:visible, .ui-dialog:visible').first()
  const roots: Array<Locator | Page> = []
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) roots.push(dialog)
  roots.push(page)

  for (const root of roots) {
    const trackingFilled = await fillTrackingNumber(root, invoice.trackingNumber)
    if (!trackingFilled) continue
    await selectCarrier(root, marketplaceId, invoice).catch(() => false)
    return
  }

  for (const frame of page.frames()) {
    const filled = await frame.evaluate((trackingNumber) => {
      const visible = (item: Element) => {
        const style = window.getComputedStyle(item)
        const rect = item.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])'))
        .filter((input) => !input.disabled && visible(input))
      const target = inputs.find((input) => /송장|운송장|택배|배송|invoice|tracking|waybill|deli/i.test(`${input.name} ${input.id} ${input.placeholder} ${input.closest('td, th, label, div, li')?.textContent ?? ''}`))
        ?? inputs.find((input) => input.type !== 'date')
      if (!target) return false
      target.removeAttribute('readonly')
      target.value = trackingNumber
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, invoice.trackingNumber).catch(() => false)
    if (filled) return
  }

  throw new MarketplaceApiError(marketplaceId, 500, `${marketplaceId} 송장번호 입력칸을 찾지 못했습니다.`)
}

async function clickSubmit(page: Page): Promise<string | null> {
  const dialogPromise = page.waitForEvent('dialog', { timeout: 6000 })
    .then(async (dialog) => {
      const message = dialog.message()
      await dialog.accept().catch(() => undefined)
      return message
    })
    .catch(() => null)

  const dialog = page.locator('.modal:visible, [role="dialog"]:visible, .layer:visible, .popup:visible, .ui-dialog:visible').first()
  const root: Locator | Page = (await dialog.isVisible({ timeout: 800 }).catch(() => false)) ? dialog : page
  const clicked = await clickByText(root, /송장\s*등록|송장\s*입력|운송장\s*등록|배송\s*처리|배송\s*정보\s*저장|저장|등록|확인|완료|전송|submit|save|regist/i, 10_000)
    .then((result) => result && true)
    .catch(() => false)

  if (!clicked) {
    let frameClicked = false
    for (const frame of page.frames()) {
      frameClicked = await frame.evaluate(() => {
        const visible = (item: Element) => {
          const style = window.getComputedStyle(item)
          const rect = item.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        }
        const positive = /송장\s*등록|송장\s*입력|운송장\s*등록|배송\s*처리|배송\s*정보\s*저장|저장|등록|확인|완료|전송|submit|save|regist/i
        const negative = /검색|조회|취소|삭제|닫기|cancel|delete|close|search/i
        const controls = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a, [onclick]'))
        const control = controls.find((item) => {
          if (!visible(item)) return false
          const label = `${item.textContent ?? ''} ${item instanceof HTMLInputElement ? item.value : ''} ${item.getAttribute('title') ?? ''} ${item.getAttribute('onclick') ?? ''}`
          return positive.test(label) && !negative.test(label)
        })
        if (!control) return false
        control.click()
        return true
      }).catch(() => false)
      if (frameClicked) break
    }
    if (!frameClicked) throw new Error('송장 등록 저장 버튼을 찾지 못했습니다.')
  }

  const message = await dialogPromise
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
  return message
}

async function assertNoFailure(page: Page, marketplaceId: string, displayName: string, dialogMessage: string | null): Promise<void> {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  const combined = `${dialogMessage ?? ''} ${bodyText}`.replace(/\s+/g, ' ').trim()
  const failed = /실패|오류|에러|잘못|없습니다|입력하세요|선택하세요|권한|거부|fail|error|invalid|required/i.test(combined)
  const succeeded = /완료|성공|저장|등록되었습니다|처리되었습니다|success/i.test(combined)
  if (failed && !succeeded) {
    throw new MarketplaceApiError(marketplaceId, 500, `${displayName} 송장 등록 실패: ${combined.slice(0, 500)}`)
  }
}

export async function uploadInvoiceThroughOrderForm(options: UploadInvoiceFormOptions): Promise<void> {
  const { page, marketplaceId, displayName, orderId, invoice } = options
  const orderCandidates = buildInvoiceOrderCandidates(orderId, invoice)
  if (orderCandidates.length === 0) {
    throw new MarketplaceApiError(marketplaceId, 400, `${displayName} 송장 등록에 사용할 주문번호가 없습니다.`)
  }

  if (options.searchOrder) await options.searchOrder(page, orderCandidates)
  else await defaultSearchOrder(page, orderCandidates)
  await options.afterSearch?.(page)

  let found = false
  for (const frame of page.frames()) {
    if (await frameContainsAny(frame, orderCandidates)) {
      found = true
      const clicked = await clickInvoiceControlInFrame(frame, orderCandidates)
      if (clicked) break
    }
  }

  if (!found) {
    throw new MarketplaceApiError(marketplaceId, 404, `${displayName} 송장 등록 대상 주문을 찾지 못했습니다. (${orderCandidates.join(', ')}, ${await summarizePage(page)})`)
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(1000)
  await fillInvoiceForm(page, marketplaceId, invoice)
  const dialogMessage = await clickSubmit(page)
  await assertNoFailure(page, marketplaceId, displayName, dialogMessage)
}
