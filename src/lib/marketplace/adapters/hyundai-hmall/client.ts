/**
 * Hyundai Hmall (현대홈쇼핑) API client.
 *
 * TODO: Update base URL when API documentation becomes available.
 */

import ky from 'ky'

// TODO: Update base URL when API documentation becomes available
const HYUNDAI_HMALL_API_BASE = 'https://api.hmall.com'

/**
 * Create a ky HTTP client pre-configured for Hyundai Hmall API calls.
 */
export function createHyundaiHmallClient(apiKey: string) {
  return ky.create({
    prefixUrl: HYUNDAI_HMALL_API_BASE,
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
