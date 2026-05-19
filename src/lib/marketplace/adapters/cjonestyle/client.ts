/**
 * CJ온스타일 API client with API key authentication.
 *
 * CJ온스타일 uses API key auth via a custom header.
 * JSON REST API.
 */

import ky from 'ky'

const CJONESTYLE_API_BASE = 'https://ingress-api.cjoshopping.com'

/**
 * Create a ky HTTP client pre-configured for CJ온스타일 API calls.
 * Uses API key authentication via X-Api-Key header.
 */
export function createCjOnestyleClient(credentials: { apiKey: string; vendorCode: string }) {
  return ky.create({
    prefixUrl: CJONESTYLE_API_BASE,
    hooks: {
      beforeRequest: [
        (request: Request) => {
          request.headers.set('authenticationKey', credentials.apiKey)
          request.headers.set('vendorCode', credentials.vendorCode)
          request.headers.set('Content-Type', 'application/json')
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
