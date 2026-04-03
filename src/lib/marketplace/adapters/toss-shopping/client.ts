/**
 * Toss Shopping (토스쇼핑) API client.
 *
 * // TODO: Update base URL when API documentation becomes available
 */

import ky from 'ky'

const TOSS_SHOPPING_API_BASE = 'https://api.toss.im/shopping' // TODO: Update when API docs available

/**
 * Create a ky HTTP client pre-configured for Toss Shopping API calls.
 */
export function createTossShoppingClient(apiKey: string) {
  return ky.create({
    prefixUrl: TOSS_SHOPPING_API_BASE,
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
