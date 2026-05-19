/**
 * Shared browser/context factory for scrapers.
 *
 * One Chromium browser instance is reused across scrape calls within a worker
 * process; each scrape gets its own context (= isolated cookies/storage),
 * so different marketplace credentials don't leak into each other.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

let _browser: Browser | null = null

/**
 * Get the shared browser instance, lazily launching it on first use.
 * Headless by default; set HEADLESS=false in env to debug visually.
 */
export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser

  const headless = process.env.HEADLESS !== 'false'
  _browser = await chromium.launch({
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox', // required when running in Railway/Docker
    ],
  })
  return _browser
}

/**
 * Open a fresh browser context for a single scrape call.
 *
 * @param storageState - persisted cookies/storage from previous login (re-uses session if valid)
 * @returns context + page; caller must call `close()` when done.
 */
export async function openContext(
  storageState?: string,
): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const browser = await getBrowser()
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    storageState: storageState ? JSON.parse(storageState) : undefined,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  page.setDefaultNavigationTimeout(60_000)
  return {
    context,
    page,
    close: async () => {
      await context.close()
    },
  }
}

/** Serialize the context's session for later re-use (storageState). */
export async function dumpStorageState(context: BrowserContext): Promise<string> {
  const state = await context.storageState()
  return JSON.stringify(state)
}

/** Cleanly shut the browser. Call on worker shutdown. */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
  }
}
