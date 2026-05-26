import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { dismissRpaPopups } from './popups'

type ProgressCallback = (message: string) => Promise<void>

type RpaDownloadOptions = {
  marketplaceName: string
  actionName: string
  timeoutMs: number
  setProgress?: ProgressCallback
}

function safeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'rpa'
}

function isTimeoutLike(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /timeout|Timeout|시간|제한시간|안에 시작되지|waitForEvent/i.test(message)
}

export async function saveRpaFailureArtifacts(
  page: Page,
  marketplaceName: string,
  actionName: string,
): Promise<{ screenshotPath?: string; htmlPath?: string }> {
  const dir = path.join(process.cwd(), 'tmp', 'rpa-failures')
  await mkdir(dir, { recursive: true }).catch(() => undefined)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const base = `${safeFilePart(marketplaceName)}-${safeFilePart(actionName)}-${stamp}`
  const screenshotPath = path.join(dir, `${base}.png`)
  const htmlPath = path.join(dir, `${base}.html`)

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  const html = await page.content().catch(() => '')
  if (html) await writeFile(htmlPath, html, 'utf8').catch(() => undefined)

  console.log(`[${marketplaceName}-rpa] failure artifacts screenshot=${screenshotPath} html=${htmlPath}`)
  return { screenshotPath, htmlPath }
}

export async function fillExcelPasswordIfVisible(page: Page, marketplaceName: string): Promise<boolean> {
  const password = process.env.EXCEL_PASSWORD
  if (!password) return false

  let filled = false
  for (const frame of page.frames()) {
    const didFill = await frame.evaluate((excelPassword) => {
      const visible = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }
      const passwordInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"], input[name*="pass" i], input[id*="pass" i]'))
        .filter((input) => !input.disabled && visible(input))
      if (passwordInputs.length === 0) return false

      for (const input of passwordInputs) {
        input.focus()
        input.value = excelPassword
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }

      const controls = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a, [role="button"]'))
        .filter((control) => visible(control))
      const confirm = controls.find((control) => {
        const text = `${control instanceof HTMLInputElement ? control.value : control.innerText || control.textContent || ''} ${control.getAttribute('title') || ''} ${control.getAttribute('aria-label') || ''}`
          .replace(/\s+/g, ' ')
          .trim()
        return /확인|입력|다운로드|download|ok/i.test(text)
      })
      confirm?.click()
      return true
    }, password).catch(() => false)

    if (didFill) filled = true
  }

  if (filled) console.log(`[${marketplaceName}-rpa] excel password filled from EXCEL_PASSWORD`)
  return filled
}

function startExcelPasswordWatcher(page: Page, marketplaceName: string): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped || page.isClosed()) return
    await fillExcelPasswordIfVisible(page, marketplaceName).catch(() => undefined)
    if (!stopped) setTimeout(tick, 500)
  }
  setTimeout(tick, 0)
  return () => {
    stopped = true
  }
}

export async function withRpaDownloadRetry<T>(
  page: Page,
  options: RpaDownloadOptions,
  action: (attempt: number) => Promise<T>,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptLabel = attempt === 0 ? 'first' : 'retry-after-refresh'
    console.log(`[${options.marketplaceName}-rpa] ${options.actionName}: start (${attemptLabel})`)
    await options.setProgress?.(`${options.marketplaceName} 엑셀 다운로드 준비 중...`)
    await dismissRpaPopups(page, { marketplaceName: options.marketplaceName, setProgress: options.setProgress, maxPasses: 6 })
    await fillExcelPasswordIfVisible(page, options.marketplaceName)

    const stopPasswordWatcher = startExcelPasswordWatcher(page, options.marketplaceName)
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`${options.actionName} timeout after ${options.timeoutMs}ms`)), options.timeoutMs)
      })
      const result = await Promise.race([action(attempt), timeoutPromise])
      console.log(`[${options.marketplaceName}-rpa] ${options.actionName}: success (${attemptLabel})`)
      return result
    } catch (error) {
      lastError = error
      console.log(`[${options.marketplaceName}-rpa] ${options.actionName}: failed (${attemptLabel}) ${error instanceof Error ? error.message : String(error)}`)
      await saveRpaFailureArtifacts(page, options.marketplaceName, options.actionName).catch(() => undefined)

      if (attempt === 0 && isTimeoutLike(error)) {
        console.log(`[${options.marketplaceName}-rpa] ${options.actionName}: refresh and retry`)
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined)
        await dismissRpaPopups(page, { marketplaceName: options.marketplaceName, setProgress: options.setProgress, maxPasses: 6 })
        continue
      }
      throw error
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      stopPasswordWatcher()
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'download failed'))
}
