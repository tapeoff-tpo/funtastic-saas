/**
 * Cafe24 API client with OAuth2 Bearer token authentication.
 *
 * Cafe24 has a well-documented REST API with JSON responses.
 * Each mall has its own subdomain: {mall_id}.cafe24api.com
 */

import ky from 'ky'

/**
 * Create a ky HTTP client pre-configured for Cafe24 API calls.
 * Uses OAuth2 Bearer token for authentication.
 */
export function createCafe24Client(accessToken: string, mallId: string) {
  return ky.create({
    prefixUrl: `https://${mallId}.cafe24api.com/api/v2`,
    hooks: {
      beforeRequest: [
        (request: Request) => {
          request.headers.set('Authorization', `Bearer ${accessToken}`)
          request.headers.set('Content-Type', 'application/json')
          request.headers.set('Accept', 'application/json')
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
