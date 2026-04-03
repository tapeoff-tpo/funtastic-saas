/**
 * Ohouse (오늘의집) API client with Bearer token authentication.
 *
 * Ohouse Open API uses JSON requests/responses with Bearer auth.
 * API details are TBD (per D-03) -- endpoints are best-effort
 * based on Korean marketplace patterns.
 */

import ky from 'ky'

const OHOUSE_API_BASE = 'https://openapi.ohou.se'

/**
 * Create a ky HTTP client pre-configured for Ohouse Open API calls.
 * Automatically sets the Authorization header on each request.
 */
export function createOhouseClient(apiKey: string) {
  return ky.create({
    prefixUrl: OHOUSE_API_BASE,
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
