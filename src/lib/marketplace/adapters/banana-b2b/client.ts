/**
 * Banana B2B (바나나B2B) API client.
 *
 * TODO: Update base URL when API documentation becomes available.
 */

import ky from 'ky'

// TODO: Update base URL when API documentation becomes available
const BANANA_B2B_API_BASE = 'https://api.banana-b2b.com'

/**
 * Create a ky HTTP client pre-configured for Banana B2B API calls.
 */
export function createBananaB2bClient(apiKey: string) {
  return ky.create({
    prefixUrl: BANANA_B2B_API_BASE,
    hooks: {
      beforeRequest: [
        (request) => {
          request.headers.set('X-Api-Key', apiKey)
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
