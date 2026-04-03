import type { MarketplaceId } from './types'

/**
 * Thrown when marketplace authentication fails or credentials are invalid/expired.
 */
export class MarketplaceAuthError extends Error {
  readonly name = 'MarketplaceAuthError'

  constructor(
    public readonly marketplaceId: MarketplaceId,
    message: string,
    public readonly isExpired: boolean = false
  ) {
    super(message)
  }
}

/**
 * Thrown when a marketplace API returns a rate limit response.
 * Callers should retry after retryAfterMs milliseconds.
 */
export class MarketplaceRateLimitError extends Error {
  readonly name = 'MarketplaceRateLimitError'

  constructor(
    public readonly marketplaceId: MarketplaceId,
    public readonly retryAfterMs: number
  ) {
    super(`Rate limited on ${marketplaceId}, retry after ${retryAfterMs}ms`)
  }
}

/**
 * Thrown for general marketplace API errors (non-auth, non-rate-limit).
 */
export class MarketplaceApiError extends Error {
  readonly name = 'MarketplaceApiError'

  constructor(
    public readonly marketplaceId: MarketplaceId,
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
  }
}
