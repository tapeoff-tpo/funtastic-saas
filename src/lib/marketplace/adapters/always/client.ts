/**
 * Always (올웨이즈) API client.
 *
 * // TODO: Update base URL when API documentation becomes available
 */

import ky from 'ky'

const ALWAYS_API_BASE = 'https://api.always.co.kr' // TODO: Update when API docs available

/**
 * Create a ky HTTP client pre-configured for Always API calls.
 */
export function createAlwaysClient(apiKey: string) {
  return ky.create({
    prefixUrl: ALWAYS_API_BASE,
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
