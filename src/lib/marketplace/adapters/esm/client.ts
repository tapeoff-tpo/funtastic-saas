/**
 * ESM Trading API HTTP client with API key authentication.
 *
 * The unified ESM Trading API at etapi.ebaykorea.com serves both
 * Gmarket and Auction via a single API with siteType parameter.
 * Authentication uses a Bearer token with the API key.
 */

import ky from 'ky'

const ESM_API_BASE = 'https://etapi.ebaykorea.com'

/**
 * Create a ky HTTP client pre-configured for ESM Trading API calls.
 * Automatically sets Bearer token auth on each request.
 */
export function createEsmClient(apiKey: string) {
  return ky.create({
    prefixUrl: ESM_API_BASE,
    hooks: {
      beforeRequest: [
        (request) => {
          request.headers.set('Authorization', `Bearer ${apiKey}`)
          request.headers.set('Content-Type', 'application/json;charset=UTF-8')
        },
      ],
    },
    timeout: 30_000,
    retry: {
      limit: 2,
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  })
}
