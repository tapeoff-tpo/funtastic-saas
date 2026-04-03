/**
 * Ably (에이블리) API client with API key authentication.
 *
 * Ably uses JSON API with API key auth.
 * API details are best-effort (per D-03).
 */

import ky from 'ky'

const ABLY_API_BASE = 'https://api.a-bly.com/v1'

/**
 * Create a ky HTTP client pre-configured for Ably API calls.
 * Sets the API key in the Authorization header.
 */
export function createAblyClient(apiKey: string) {
  return ky.create({
    prefixUrl: ABLY_API_BASE,
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
