/**
 * Scraper interface — for marketplaces without public API.
 *
 * Mirrors `MarketplaceAdapter` shape so server actions can use either
 * an adapter (API) or a scraper (Playwright) interchangeably.
 *
 * Separation rationale:
 * - Adapters: lightweight, run in Next.js server actions OR worker
 * - Scrapers: heavy (Chromium), run ONLY in dedicated scraper-worker
 */

import type {
  NormalizedOrder,
  NormalizedClaim,
  InvoiceData,
  MarketplaceId,
} from '@/lib/marketplace/types'

/** Credentials a scraper needs to log in to the marketplace seller portal. */
export interface ScraperCredentials {
  /** Login email/ID (the seller portal login, NOT API key) */
  email: string
  /** Login password */
  password: string
  /** Optional: persisted session cookies/state from previous login */
  storageState?: string
  /** Optional: marketplace-specific extras (e.g., kakao_token, naver_2fa_secret) */
  extras?: Record<string, string>
}

/** Result of a scraper login attempt. */
export interface ScraperLoginResult {
  success: boolean
  error?: string
  /** Session state JSON to persist (cookies, localStorage). Pass back as credentials.storageState next call. */
  storageState?: string
  /** When the session is expected to expire. */
  expiresAt?: Date
}

/** Scraper interface — implemented per marketplace. */
export interface MarketplaceScraper {
  readonly marketplaceId: MarketplaceId
  readonly displayName: string

  /**
   * Login to seller portal.
   * Should return persistable session state on success so subsequent
   * scrape calls can skip re-login.
   */
  login(credentials: ScraperCredentials): Promise<ScraperLoginResult>

  /**
   * Test if existing session is still valid.
   * If invalid, scraper should re-login automatically.
   */
  testSession(credentials: ScraperCredentials): Promise<{ ok: boolean; error?: string }>

  /** Fetch orders since a given date. Returns normalized orders. */
  getOrders(
    credentials: ScraperCredentials,
    since: Date,
  ): Promise<NormalizedOrder[]>

  /** Fetch claims (cancel/return/exchange) since a date. */
  getClaimsOrders(
    credentials: ScraperCredentials,
    since: Date,
  ): Promise<NormalizedClaim[]>

  /** Upload an invoice (tracking number) for an order. */
  uploadInvoice(
    credentials: ScraperCredentials,
    orderId: string,
    invoice: InvoiceData,
  ): Promise<{ success: boolean; error?: string }>
}

/** Job payload for the scraping queue. */
export interface ScrapeJobData {
  marketplaceId: MarketplaceId
  connectionId: string
  userId: string
  jobType: 'scrape-orders' | 'scrape-claims' | 'upload-invoice'
  /** For 'scrape-orders' / 'scrape-claims': ISO timestamp to fetch since */
  since?: string
  /** For 'upload-invoice': specific order + tracking */
  orderId?: string
  invoice?: InvoiceData
}
