/**
 * Domechango (도매창고) API client.
 *
 * TODO: Update base URL when API documentation becomes available.
 */

import ky from 'ky'

// TODO: Update base URL when API documentation becomes available
const DOMECHANGO_API_BASE = 'https://api.domechango.com'

/**
 * Create a ky HTTP client pre-configured for Domechango API calls.
 */
export function createDomechangoClient(apiKey: string) {
  return ky.create({
    prefixUrl: DOMECHANGO_API_BASE,
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
