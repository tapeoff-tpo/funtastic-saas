/**
 * Ownerclan (오너클랜) API client with API key authentication.
 *
 * Ownerclan uses JSON API with API key auth.
 * API details are best-effort (per D-03).
 */

import ky from 'ky'

const OWNERCLAN_API_BASE = 'https://api.ownerclan.com/v1'

/**
 * Create a ky HTTP client pre-configured for Ownerclan API calls.
 * Sets the API key in the Authorization header.
 */
export function createOwnerclanClient(apiKey: string) {
  return ky.create({
    prefixUrl: OWNERCLAN_API_BASE,
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
